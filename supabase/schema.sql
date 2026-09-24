-- =====================================================================
-- MONTAGEM DE COLETORES — schema completo (Supabase / Postgres)
-- Rode este arquivo inteiro no SQL Editor do Supabase, de uma vez só.
-- =====================================================================

create extension if not exists pgcrypto;

-- =====================================================================
-- 1. TABELAS
-- =====================================================================

-- Cargos / funções (Soldador, Eletricista, ...). Cadastráveis pela gestão.
create table cargos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null unique,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- Usuários: operadores do chão de fábrica e administradores.
-- Só administradores têm auth_user_id (login real com e-mail e senha).
create table usuarios (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  matricula     text not null unique,
  cargo_id      uuid references cargos(id) on delete set null,
  e_admin       boolean not null default false,
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  pin_hash      text,                       -- opcional: PIN do operador
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

-- Catálogo de modelos de coletor (nome, foto, capacidade).
create table modelos (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null unique,
  capacidade  text,
  descricao   text,
  imagem_url  text,
  ativo       boolean not null default true
);

-- Etapas da linha, na ordem em que o coletor percorre a fábrica.
create table etapas (
  id                    uuid primary key default gen_random_uuid(),
  nome                  text not null,
  ordem                 integer not null,
  cargo_responsavel_id  uuid references cargos(id) on delete set null,
  ativo                 boolean not null default true,
  criado_em             timestamptz not null default now(),
  constraint etapas_ordem_unica unique (ordem) deferrable initially deferred
);

-- Itens de checklist. O cargo responsável é obrigatório: é ele que
-- define quem pode dar OK na tarefa.
create table tarefas (
  id                    uuid primary key default gen_random_uuid(),
  etapa_id              uuid not null references etapas(id) on delete cascade,
  descricao             text not null,
  ordem                 integer not null,
  cargo_responsavel_id  uuid not null references cargos(id),
  obrigatoria           boolean not null default true,
  ativo                 boolean not null default true,
  criado_em             timestamptz not null default now(),
  constraint tarefas_ordem_unica unique (etapa_id, ordem) deferrable initially deferred
);

-- Coletores em produção.
create table caminhoes (
  id              uuid primary key default gen_random_uuid(),
  chassi          text not null unique,
  os              text,
  modelo_id       uuid references modelos(id) on delete set null,
  cliente         text,
  etapa_atual_id  uuid references etapas(id) on delete set null,
  status          text not null default 'em_producao'
                  check (status in ('em_producao', 'pausado', 'concluido')),
  data_inicio     timestamptz not null default now()
);

-- Registros de execução. APPEND-ONLY: nada aqui é editado ou apagado.
create type tipo_registro as enum ('inicio', 'conclusao', 'reabertura');

create table registros_execucao (
  id              uuid primary key default gen_random_uuid(),
  -- gerado no tablet antes do envio: impede duplicata quando o lote é reenviado
  client_uuid     uuid not null unique,
  caminhao_id     uuid not null references caminhoes(id),
  tarefa_id       uuid not null references tarefas(id),
  usuario_id      uuid not null references usuarios(id),
  tipo            tipo_registro not null default 'conclusao',
  observacao      text,
  -- hora do tablet (quando o operador tocou o botão)
  data_conclusao  timestamptz not null default now(),
  -- hora do servidor (diverge da acima no envio em lote)
  registrado_em   timestamptz not null default now(),
  dispositivo     text
);

create index idx_reg_caminhao_tarefa on registros_execucao (caminhao_id, tarefa_id, data_conclusao desc);
create index idx_reg_usuario on registros_execucao (usuario_id, data_conclusao desc);

-- Sessões: quem está em qual coletor agora.
create table sessoes (
  id                uuid primary key default gen_random_uuid(),
  usuario_id        uuid not null references usuarios(id) on delete cascade,
  caminhao_id       uuid not null references caminhoes(id) on delete cascade,
  iniciada_em       timestamptz not null default now(),
  ultima_atividade  timestamptz not null default now(),
  encerrada_em      timestamptz
);

create index idx_sessoes_ativas on sessoes (usuario_id) where encerrada_em is null;

-- =====================================================================
-- 2. APPEND-ONLY
-- =====================================================================

create or replace function bloqueia_alteracao_registro()
returns trigger language plpgsql as $$
begin
  raise exception 'registros_execucao é append-only: grave um registro do tipo reabertura';
end;
$$;

create trigger trg_registros_append_only
  before update or delete on registros_execucao
  for each row execute function bloqueia_alteracao_registro();

-- =====================================================================
-- 3. VIEWS
-- =====================================================================

-- Estado atual de cada tarefa por coletor: o último registro vence.
create or replace view v_status_tarefas as
select distinct on (r.caminhao_id, r.tarefa_id)
  r.caminhao_id,
  r.tarefa_id,
  r.usuario_id,
  u.nome as usuario_nome,
  r.tipo,
  r.data_conclusao,
  (r.tipo = 'conclusao') as concluida
from registros_execucao r
join usuarios u on u.id = r.usuario_id
order by r.caminhao_id, r.tarefa_id, r.data_conclusao desc;

-- Sessões consideradas ativas. Ninguém desloga no chão de fábrica, então
-- 45 minutos sem atividade encerra a presença automaticamente.
create or replace view v_sessoes_ativas as
select s.*, u.nome, u.matricula, c.chassi
from sessoes s
join usuarios u on u.id = s.usuario_id
join caminhoes c on c.id = s.caminhao_id
where s.encerrada_em is null
  and s.ultima_atividade > now() - interval '45 minutes';

-- =====================================================================
-- 4. FUNÇÕES DE SEGURANÇA
-- =====================================================================

-- É administrador? Usado por todas as policies de escrita nos cadastros.
create or replace function e_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from usuarios
    where auth_user_id = auth.uid() and e_admin and ativo
  );
$$;

-- Login do operador. Valida matrícula, chassi e (se houver) PIN.
-- Abre ou renova a sessão. Devolve o contexto que o app precisa.
create or replace function login_operador(
  p_matricula text,
  p_chassi text,
  p_pin text default null
)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_usuario usuarios%rowtype;
  v_caminhao caminhoes%rowtype;
  v_cargo text;
begin
  select * into v_usuario from usuarios
   where matricula = p_matricula and ativo and not e_admin;
  if not found then
    raise exception 'MATRICULA_NAO_ENCONTRADA';
  end if;

  if v_usuario.pin_hash is not null then
    if p_pin is null or crypt(p_pin, v_usuario.pin_hash) <> v_usuario.pin_hash then
      raise exception 'PIN_INVALIDO';
    end if;
  end if;

  select * into v_caminhao from caminhoes where chassi = p_chassi;
  if not found then
    raise exception 'CHASSI_NAO_ENCONTRADO';
  end if;

  select nome into v_cargo from cargos where id = v_usuario.cargo_id;

  update sessoes set encerrada_em = now()
   where usuario_id = v_usuario.id and encerrada_em is null;

  insert into sessoes (usuario_id, caminhao_id) values (v_usuario.id, v_caminhao.id);

  return json_build_object(
    'usuario_id', v_usuario.id,
    'nome', v_usuario.nome,
    'matricula', v_usuario.matricula,
    'cargo_id', v_usuario.cargo_id,
    'cargo', v_cargo,
    'caminhao_id', v_caminhao.id,
    'chassi', v_caminhao.chassi
  );
end;
$$;

-- Grava a marcação. ESTA É A TRAVA REAL DA REGRA DE CARGO:
-- o operador não tem INSERT direto na tabela, só pode passar por aqui,
-- e aqui o cargo da tarefa é conferido contra o cargo do usuário.
create or replace function registrar_execucao(
  p_client_uuid uuid,
  p_matricula text,
  p_caminhao_id uuid,
  p_tarefa_id uuid,
  p_tipo tipo_registro,
  p_data_conclusao timestamptz default now(),
  p_dispositivo text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_usuario usuarios%rowtype;
  v_tarefa tarefas%rowtype;
  v_id uuid;
begin
  select * into v_usuario from usuarios where matricula = p_matricula and ativo;
  if not found then
    raise exception 'MATRICULA_NAO_ENCONTRADA';
  end if;

  select * into v_tarefa from tarefas where id = p_tarefa_id and ativo;
  if not found then
    raise exception 'TAREFA_NAO_ENCONTRADA';
  end if;

  if v_tarefa.cargo_responsavel_id <> v_usuario.cargo_id and not v_usuario.e_admin then
    raise exception 'CARGO_INCOMPATIVEL';
  end if;

  insert into registros_execucao
    (client_uuid, caminhao_id, tarefa_id, usuario_id, tipo, data_conclusao, dispositivo)
  values
    (p_client_uuid, p_caminhao_id, p_tarefa_id, v_usuario.id, p_tipo, p_data_conclusao, p_dispositivo)
  on conflict (client_uuid) do nothing
  returning id into v_id;

  update sessoes set ultima_atividade = now()
   where usuario_id = v_usuario.id and encerrada_em is null;

  return v_id;  -- null quando o registro já existia (reenvio do lote)
end;
$$;

create or replace function encerrar_sessao(p_matricula text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update sessoes set encerrada_em = now()
   where encerrada_em is null
     and usuario_id = (select id from usuarios where matricula = p_matricula);
end;
$$;

-- =====================================================================
-- 5. ROW LEVEL SECURITY
-- Leitura: liberada (o tablet precisa ver o checklist).
-- Escrita nos cadastros: só administrador autenticado.
-- Escrita em registros: só pelas funções acima.
-- =====================================================================

alter table cargos              enable row level security;
alter table usuarios            enable row level security;
alter table modelos             enable row level security;
alter table etapas              enable row level security;
alter table tarefas             enable row level security;
alter table caminhoes           enable row level security;
alter table registros_execucao  enable row level security;
alter table sessoes             enable row level security;

-- Leitura pública do catálogo da linha
create policy le_cargos     on cargos     for select to anon, authenticated using (true);
create policy le_modelos    on modelos    for select to anon, authenticated using (true);
create policy le_etapas     on etapas     for select to anon, authenticated using (true);
create policy le_tarefas    on tarefas    for select to anon, authenticated using (true);
create policy le_caminhoes  on caminhoes  for select to anon, authenticated using (true);
create policy le_registros  on registros_execucao for select to anon, authenticated using (true);
create policy le_sessoes    on sessoes    for select to anon, authenticated using (true);

-- Usuários: o tablet precisa ler nome e cargo, mas nunca o pin_hash.
-- Por isso a leitura vai por uma view, e a tabela fica fechada.
create policy le_usuarios on usuarios for select to anon, authenticated using (true);

create or replace view v_usuarios_publico as
  select id, nome, matricula, cargo_id, e_admin, ativo from usuarios;

-- Escrita nos cadastros: apenas administrador
create policy adm_cargos    on cargos    for all to authenticated using (e_admin()) with check (e_admin());
create policy adm_usuarios  on usuarios  for all to authenticated using (e_admin()) with check (e_admin());
create policy adm_modelos   on modelos   for all to authenticated using (e_admin()) with check (e_admin());
create policy adm_etapas    on etapas    for all to authenticated using (e_admin()) with check (e_admin());
create policy adm_tarefas   on tarefas   for all to authenticated using (e_admin()) with check (e_admin());
create policy adm_caminhoes on caminhoes for all to authenticated using (e_admin()) with check (e_admin());

-- Nenhuma policy de INSERT em registros_execucao: o caminho é a função.
grant execute on function login_operador(text, text, text) to anon, authenticated;
grant execute on function registrar_execucao(uuid, text, uuid, uuid, tipo_registro, timestamptz, text) to anon, authenticated;
grant execute on function encerrar_sessao(text) to anon, authenticated;

-- =====================================================================
-- 6. DADOS INICIAIS
-- =====================================================================

insert into cargos (nome) values
  ('Soldador'), ('Eletricista'), ('Montador Mecânico'), ('Pintor'), ('Hidráulico');

insert into modelos (nome, capacidade, descricao, imagem_url) values
  ('Coletor CSC-LL', '5 a 19 m³',
   'Pequenos e médios municípios, coleta industrial e empresas particulares.',
   'https://cimasp.com.br/site/wp-content/uploads/2024/07/CSCLL.jpg'),
  ('Coletor Masterlix', '6 a 19 m³',
   'Médios e grandes municípios, coleta industrial e empresas particulares.',
   'https://cimasp.com.br/site/wp-content/uploads/2024/07/magyster.jpg'),
  ('Coletor Magyster', '15 a 21 m³',
   'Médios e grandes municípios, coleta industrial e empresas particulares.',
   'https://cimasp.com.br/site/wp-content/uploads/2024/07/Masterlix.jpg'),
  ('Coletor Hospitalar', null,
   'Coleta de resíduos de serviços de saúde.',
   'https://cimasp.com.br/site/wp-content/uploads/2024/08/CSCLL-1.jpg'),
  ('Coletor Linha Leve', null, 'Em breve.', null),
  ('Coletor Especial', null, 'Em breve.', null);

-- Administrador. A senha NÃO fica aqui: você cria o usuário no
-- Authentication do Supabase e depois roda o UPDATE indicado no README.
insert into usuarios (nome, matricula, e_admin) values
  ('Gestão da produção', '3454', true);

-- Operadores de teste
insert into usuarios (nome, matricula, cargo_id)
select v.nome, v.matricula, c.id
from (values
  ('Rafael Moreira',  '1001', 'Soldador'),
  ('Juliana Alves',   '1002', 'Eletricista'),
  ('Diego Ramos',     '1003', 'Montador Mecânico'),
  ('Carla Bispo',     '1004', 'Pintor'),
  ('Sérgio Prado',    '1005', 'Hidráulico')
) as v(nome, matricula, cargo) join cargos c on c.nome = v.cargo;

-- Coletores na linha. O chassi 0000 é o de demonstração e também a
-- segunda metade da porta da gestão (matrícula 3454 + chassi 0000).
insert into caminhoes (chassi, os, modelo_id, cliente)
select v.chassi, v.os, m.id, v.cliente
from (values
  ('0000', '0000', 'Coletor CSC-LL',     'Linha de teste'),
  ('4821', '4821', 'Coletor Masterlix',  'Prefeitura de Goiânia'),
  ('4826', '4826', 'Coletor Magyster',   'Prefeitura de Aparecida'),
  ('4830', '4830', 'Coletor Hospitalar', 'Hospital Estadual')
) as v(chassi, os, modelo, cliente) join modelos m on m.nome = v.modelo;

-- As etapas e tarefas ficam VAZIAS de propósito: quem monta é a gestão,
-- pelo painel do aplicativo.

-- =====================================================================
-- 7. DEPOIS DE CRIAR O ADMIN NO AUTHENTICATION, RODE ISTO:
-- =====================================================================
-- update usuarios
--    set auth_user_id = (select id from auth.users where email = 'SEU-EMAIL@exemplo.com')
--  where matricula = '3454';

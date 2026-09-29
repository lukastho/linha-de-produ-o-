-- =====================================================================
-- MIGRAÇÃO 002 — PADRÃO DE FÁBRICA (etapas e tarefas obrigatórias)
--
-- Fonte: cheklists.xlsx (abas hidraulica, eletrica, eletrica pipa, finalização)
--
-- COMO RODAR: SQL Editor do Supabase → New query (caixa VAZIA) → colar
-- este arquivo inteiro → Run.
--
-- É SEGURO RODAR MAIS DE UMA VEZ: cada passo verifica se já foi feito.
-- Se parar no meio por qualquer motivo, corrija a causa e rode de novo:
-- ele completa o que faltou sem duplicar nada.
-- (O SQL Editor do Supabase grava comando a comando; não conte com
-- "tudo-ou-nada" nele. A proteção real é poder rodar de novo.)
-- NÃO APAGA NENHUMA MARCAÇÃO: a tabela registros_execucao não é tocada.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. CARGO NOVO
-- A conferência final não tem cargo definido na planilha. Criamos
-- "Inspetor de Qualidade" para que quem confere não seja quem montou.
-- Troque no painel se na fábrica for outro cargo.
-- ---------------------------------------------------------------------
insert into cargos (nome)
select 'Inspetor de Qualidade'
where not exists (select 1 from cargos where nome = 'Inspetor de Qualidade');

-- ---------------------------------------------------------------------
-- 2. TIPO DE EQUIPAMENTO NOS MODELOS
-- A planilha tem um checklist elétrico separado para TANQUE PIPA.
-- O tipo decide qual padrão cada caminhão recebe. Todos os modelos
-- atuais são coletores.
-- ---------------------------------------------------------------------
alter table modelos add column if not exists tipo_equipamento text not null default 'coletor';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'modelos_tipo_equipamento_check') then
    alter table modelos add constraint modelos_tipo_equipamento_check
      check (tipo_equipamento in ('coletor', 'pipa'));
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. TABELAS DE TEMPLATE (o padrão oficial)
-- ---------------------------------------------------------------------
create table if not exists etapas_padrao (
  id                    uuid primary key default gen_random_uuid(),
  nome                  text not null,
  ordem                 integer not null,
  tipo_equipamento      text not null default 'coletor'
                        check (tipo_equipamento in ('coletor', 'pipa')),
  cargo_responsavel_id  uuid references cargos(id) on delete set null,
  bloqueada             boolean not null default false,  -- true = padrão de fábrica
  ativo                 boolean not null default true,
  criado_em             timestamptz not null default now(),
  constraint etapas_padrao_ordem_unica
    unique (tipo_equipamento, ordem) deferrable initially deferred
);

create table if not exists tarefas_padrao (
  id                    uuid primary key default gen_random_uuid(),
  etapa_padrao_id       uuid not null references etapas_padrao(id) on delete cascade,
  grupo                 text,          -- seção do checklist em papel (ex.: PTO E BOMBA)
  descricao             text not null,
  ordem                 integer not null,
  cargo_responsavel_id  uuid not null references cargos(id),
  obrigatoria           boolean not null default true,
  bloqueada             boolean not null default false,
  ativo                 boolean not null default true,
  criado_em             timestamptz not null default now(),
  constraint tarefas_padrao_ordem_unica
    unique (etapa_padrao_id, ordem) deferrable initially deferred
);

create index if not exists idx_tarefas_padrao_etapa on tarefas_padrao (etapa_padrao_id);

-- ---------------------------------------------------------------------
-- 4. ETAPAS E TAREFAS PASSAM A PERTENCER A UM CAMINHÃO
--
-- caminhao_id NULL  = etapa antiga, compartilhada por todos (as que você
--                     criou antes do padrão). Continuam funcionando igual.
-- caminhao_id <id>  = cópia do padrão, exclusiva daquele chassi.
-- ---------------------------------------------------------------------
alter table etapas
  add column if not exists caminhao_id     uuid references caminhoes(id) on delete cascade,
  add column if not exists etapa_padrao_id uuid references etapas_padrao(id) on delete set null,
  add column if not exists bloqueada       boolean not null default false;

alter table tarefas
  add column if not exists tarefa_padrao_id uuid references tarefas_padrao(id) on delete set null,
  add column if not exists grupo            text,
  add column if not exists bloqueada        boolean not null default false;

-- A ordem deixa de ser única na fábrica toda e passa a ser única por
-- caminhão. Sem isso, o segundo caminhão já colidiria com o primeiro.
alter table etapas drop constraint if exists etapas_ordem_unica;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'etapas_ordem_por_caminhao') then
    alter table etapas add constraint etapas_ordem_por_caminhao
      unique nulls not distinct (caminhao_id, ordem) deferrable initially deferred;
  end if;
end $$;

-- Rede de segurança: impossível existir duas cópias da mesma etapa ou
-- tarefa padrão no mesmo caminhão, mesmo que algo rode duas vezes.
create unique index if not exists etapas_uma_copia_por_padrao
  on etapas (caminhao_id, etapa_padrao_id) where etapa_padrao_id is not null;
create unique index if not exists tarefas_uma_copia_por_padrao
  on tarefas (etapa_id, tarefa_padrao_id) where tarefa_padrao_id is not null;

create index if not exists idx_etapas_caminhao on etapas (caminhao_id);
create index if not exists idx_tarefas_etapa   on tarefas (etapa_id);

-- ---------------------------------------------------------------------
-- 5. DADOS DO PADRÃO, EXTRAÍDOS DA PLANILHA
-- Só insere se o template ainda estiver vazio. Rodar de novo não duplica
-- e não desfaz edições que você tenha feito pelo painel.
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from etapas_padrao) then

    insert into etapas_padrao (nome, ordem, tipo_equipamento, cargo_responsavel_id, bloqueada)
    select v.nome, v.ordem, v.tipo, c.id, true
    from (values
    ('Montagem do Sistema Hidráulico', 10, 'coletor', 'Hidráulico'),
    ('Montagem Elétrica', 20, 'coletor', 'Eletricista'),
    ('Conferência Final', 30, 'coletor', 'Inspetor de Qualidade'),
    ('Montagem Elétrica', 10, 'pipa', 'Eletricista')
    ) as v(nome, ordem, tipo, cargo)
    join cargos c on c.nome = v.cargo;

    insert into tarefas_padrao
      (etapa_padrao_id, grupo, descricao, ordem, cargo_responsavel_id, obrigatoria, bloqueada)
    select ep.id, v.grupo, v.descricao, v.ordem, ep.cargo_responsavel_id, true, true
    from (values
    ('coletor', 'Montagem do Sistema Hidráulico', 'PTO E BOMBA', 1, 'Montagem da tomada de força'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'PTO E BOMBA', 2, 'Fixação da tomada de força'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'PTO E BOMBA', 3, 'Montagem da bomba hidráulica'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'PTO E BOMBA', 4, 'Fixação da bomba'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'TANQUE E FILTROS', 5, 'Montagem do tanque'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'TANQUE E FILTROS', 6, 'Montagem do filtro de sucção'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'TANQUE E FILTROS', 7, 'Conferir O-ring do filtro de sucção'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'TANQUE E FILTROS', 8, 'Apertar suporte do filtro de sucção'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'TANQUE E FILTROS', 9, 'Montagem do filtro de retorno'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'TANQUE E FILTROS', 10, 'Conferir O-ring do filtro de retorno'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'TANQUE E FILTROS', 11, 'Apertar suporte do filtro de retorno'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'TANQUE E FILTROS', 12, 'Montagem do bocal de abastecimento'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'TANQUE E FILTROS', 13, 'Conferir vedação do bocal'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'MANGUEIRAS', 14, 'Mangueira de sucção'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'MANGUEIRAS', 15, 'Mangueira de pressão'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'MANGUEIRAS', 16, 'Mangueiras do comando'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'MANGUEIRAS', 17, 'Mangueiras da tampa traseira'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'MANGUEIRAS', 18, 'Mangueiras do escudo/painel ejetor'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'MANGUEIRAS', 19, 'Mangueiras do comando traseiro'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'MANGUEIRAS', 20, 'Mangueiras das placas'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'MANGUEIRAS', 21, 'Abraçadeiras e suportes'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'COMANDO', 22, 'Montagem do comando hidráulico'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'COMANDO', 23, 'Ligação pressão'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'COMANDO', 24, 'Ligação retorno'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'COMANDO', 25, 'Conferência das conexões'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'TESTES', 26, 'Abastecimento com óleo'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'TESTES', 27, 'Regulagem de pressão'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'TESTES', 28, 'Verificar vazamentos'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'TESTES', 29, 'Teste de funcionamento'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'TESTES', 30, 'Limpeza final'),
    ('coletor', 'Montagem do Sistema Hidráulico', 'TESTES', 31, 'Liberação'),
    ('coletor', 'Montagem Elétrica', 'SISTEMA DA CABINE', 1, 'Montagem e fixação do painel/central elétrica na cabine'),
    ('coletor', 'Montagem Elétrica', 'SISTEMA DA CABINE', 2, 'Montagem das botoeiras, interruptores e sinalizadores'),
    ('coletor', 'Montagem Elétrica', 'SISTEMA DA CABINE', 3, 'Ligação da alimentação positiva, pós-chave e aterramento'),
    ('coletor', 'Montagem Elétrica', 'SISTEMA DA CABINE', 4, 'Conferir fusíveis, relés e comando da tomada de força'),
    ('coletor', 'Montagem Elétrica', 'SISTEMA DA CABINE', 5, 'Instalação e fixação do monitor na cabine'),
    ('coletor', 'Montagem Elétrica', 'SISTEMA DA CABINE', 6, 'Passagem e proteção do cabos na cabine'),
    ('coletor', 'Montagem Elétrica', 'SISTEMA DA CABINE', 7, 'Ligação da alimentação da câmera e do monitor'),
    ('coletor', 'Montagem Elétrica', 'SISTEMA DA CABINE', 8, 'Ligação do acionamento pela marcha à ré'),
    ('coletor', 'Montagem Elétrica', 'SISTEMA DA CABINE', 9, 'Regulagem do ângulo e teste da imagem'),
    ('coletor', 'Montagem Elétrica', 'CÂMERA DE RÉ E COMANDOS TRASEIROS', 10, 'Montagem e fixação da câmera de ré'),
    ('coletor', 'Montagem Elétrica', 'CÂMERA DE RÉ E COMANDOS TRASEIROS', 11, 'Montagem das botoeiras e comandos traseiros'),
    ('coletor', 'Montagem Elétrica', 'CÂMERA DE RÉ E COMANDOS TRASEIROS', 12, 'Ligação dos botões de emergência'),
    ('coletor', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 13, 'Montagem e fixação das lanternas traseiras'),
    ('coletor', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 14, 'Montagem lanternas lateral'),
    ('coletor', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 15, 'Montagem válvula pneumática'),
    ('coletor', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 16, 'Montagem do bloco da parada de emergência'),
    ('coletor', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 17, 'Ligação das luzes de posição e de freio'),
    ('coletor', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 18, 'Ligação das setas e do pisca-alerta'),
    ('coletor', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 19, 'Ligação das luzes de marcha à ré'),
    ('coletor', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 20, 'Ligação da luz da placa, giroflex e luz de trabalho'),
    ('coletor', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 21, 'Organização e roteamento de todos os cabos'),
    ('coletor', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 22, 'Proteção dos cabos com conduíte ou corrugado'),
    ('coletor', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 23, 'Fixação com abraçadeiras, presilhas e suportes'),
    ('coletor', 'Montagem Elétrica', 'SOLDAGEM, ISOLAMENTO E CONEXÕES', 24, 'Soldagem de todas as emendas e terminais'),
    ('coletor', 'Montagem Elétrica', 'SOLDAGEM, ISOLAMENTO E CONEXÕES', 25, 'Isolamento com termo retrátil e vedação dos conectores'),
    ('coletor', 'Montagem Elétrica', 'SOLDAGEM, ISOLAMENTO E CONEXÕES', 26, 'Conferir cabos longe de calor, partes móveis e arestas'),
    ('coletor', 'Montagem Elétrica', 'SOLDAGEM, ISOLAMENTO E CONEXÕES', 27, 'Identificação dos cabos e conferência dos aterramentos'),
    ('coletor', 'Montagem Elétrica', 'TESTES E CONFERÊNCIA FINAL', 28, 'Conferir continuidade, polaridade e tensão do sistema'),
    ('coletor', 'Montagem Elétrica', 'TESTES E CONFERÊNCIA FINAL', 29, 'Conferir fusíveis, relés e ausência de curto-circuito'),
    ('coletor', 'Montagem Elétrica', 'TESTES E CONFERÊNCIA FINAL', 30, 'Testar comandos da cabine, traseiros e tomada de força'),
    ('coletor', 'Montagem Elétrica', 'TESTES E CONFERÊNCIA FINAL', 31, 'Testar câmera, lanternas, sinalizações, sensores e emergências'),
    ('coletor', 'Montagem Elétrica', 'TESTES E CONFERÊNCIA FINAL', 32, 'Conferir organização final, limpeza e liberação do equipamento'),
    ('coletor', 'Conferência Final', 'CONJUNTO, FIXAÇÃO E INSTALAÇÃO GERAL', 1, 'Conferir fixação do coletor ao chassi e alinhamento do conjunto'),
    ('coletor', 'Conferência Final', 'CONJUNTO, FIXAÇÃO E INSTALAÇÃO GERAL', 2, 'Conferir parafusos, porcas, suportes e pontos de solda da instalação'),
    ('coletor', 'Conferência Final', 'CONJUNTO, FIXAÇÃO E INSTALAÇÃO GERAL', 3, 'Conferir folgas, interferências e distância de partes móveis do caminhão'),
    ('coletor', 'Conferência Final', 'CONJUNTO, FIXAÇÃO E INSTALAÇÃO GERAL', 4, 'Conferir tampas, proteções, travas e acabamento geral do implemento'),
    ('coletor', 'Conferência Final', 'SISTEMA HIDRÁULICO', 5, 'Conferir mangueiras hidráulicas e ausência de vazamentos'),
    ('coletor', 'Conferência Final', 'SISTEMA HIDRÁULICO', 6, 'Conferir conexões, terminais, adaptadores e aperto das mangueiras'),
    ('coletor', 'Conferência Final', 'SISTEMA HIDRÁULICO', 7, 'Conferir canos hidráulicos, suportes, fixação e possíveis amassados'),
    ('coletor', 'Conferência Final', 'SISTEMA HIDRÁULICO', 8, 'Conferir montagem dos filtros hidráulicos e sentido correto do fluxo'),
    ('coletor', 'Conferência Final', 'SISTEMA HIDRÁULICO', 9, 'Conferir tanque, tampa, respiro e visor de nível do óleo hidráulico'),
    ('coletor', 'Conferência Final', 'SISTEMA HIDRÁULICO', 10, 'Conferir hastes dos cilindros, vedações, riscos e vazamentos'),
    ('coletor', 'Conferência Final', 'SISTEMA HIDRÁULICO', 11, 'Conferir tomada de força, bomba hidráulica, sucção e linha de pressão'),
    ('coletor', 'Conferência Final', 'SISTEMA HIDRÁULICO', 12, 'Conferir comando hidráulico, válvulas, cilindros e todas as funções'),
    ('coletor', 'Conferência Final', 'SISTEMA ELÉTRICO E ELETRÔNICO', 13, 'Conferir organização, roteamento e proteção de todos os cabos'),
    ('coletor', 'Conferência Final', 'SISTEMA ELÉTRICO E ELETRÔNICO', 14, 'Conferir soldas, terminais, conectores, isolamentos e vedações'),
    ('coletor', 'Conferência Final', 'SISTEMA ELÉTRICO E ELETRÔNICO', 15, 'Conferir fusíveis, relés, alimentação, pós-chave e aterramentos'),
    ('coletor', 'Conferência Final', 'SISTEMA ELÉTRICO E ELETRÔNICO', 16, 'Conferir painel, botoeiras, sinalizadores e tomada de força na cabine'),
    ('coletor', 'Conferência Final', 'SISTEMA ELÉTRICO E ELETRÔNICO', 17, 'Conferir comandos traseiros, sensores e botões de emergência'),
    ('coletor', 'Conferência Final', 'SISTEMA ELÉTRICO E ELETRÔNICO', 18, 'Conferir câmera de ré, monitor, imagem'),
    ('coletor', 'Conferência Final', 'SISTEMA ELÉTRICO E ELETRÔNICO', 19, 'Conferir lanternas traseiras, freio, setas, posição e marcha à ré'),
    ('coletor', 'Conferência Final', 'SISTEMA ELÉTRICO E ELETRÔNICO', 20, 'Conferir giroflex, iluminação traseira, luz de placa e luz de trabalho'),
    ('coletor', 'Conferência Final', 'ACABAMENTOS E ITENS DO CAMINHÃO', 21, 'Conferir estepe, suporte, trava, fixação'),
    ('coletor', 'Conferência Final', 'ACABAMENTOS E ITENS DO CAMINHÃO', 22, 'Conferir para-lamas, para-barros, protetores laterais e para-choque'),
    ('coletor', 'Conferência Final', 'ACABAMENTOS E ITENS DO CAMINHÃO', 23, 'Conferir placa, faixas refletivas, adesivos e sinalizações de segurança'),
    ('coletor', 'Conferência Final', 'ACABAMENTOS E ITENS DO CAMINHÃO', 24, 'Conferir limpeza, pintura, vedação e ausência de peças ou ferramentas soltas'),
    ('coletor', 'Conferência Final', 'TESTES FUNCIONAIS E LIBERAÇÃO FINAL', 25, 'Acionar o sistema sob pressão e conferir vazamentos, ruídos e aquecimento'),
    ('coletor', 'Conferência Final', 'TESTES FUNCIONAIS E LIBERAÇÃO FINAL', 26, 'Testar ciclos de compactação, descarga, abertura e fechamento da porta'),
    ('coletor', 'Conferência Final', 'TESTES FUNCIONAIS E LIBERAÇÃO FINAL', 27, 'Testar comandos da cabine, traseiros, emergências e dispositivos de segurança'),
    ('coletor', 'Conferência Final', 'TESTES FUNCIONAIS E LIBERAÇÃO FINAL', 28, 'Testar câmera, iluminação, lanternas, sinalizações e funcionamento do caminhão'),
    ('coletor', 'Conferência Final', 'TESTES FUNCIONAIS E LIBERAÇÃO FINAL', 29, 'Conferir nível de óleo, limpeza final, documentação e liberação do equipamento'),
    ('coletor', 'Conferência Final', 'TESTES FUNCIONAIS E LIBERAÇÃO FINAL', 30, 'Conferir engraxamento de todo o coletor'),
    ('pipa', 'Montagem Elétrica', 'SISTEMA DA CABINE', 1, 'Montagem e fixação do painel/central elétrica na cabine'),
    ('pipa', 'Montagem Elétrica', 'SISTEMA DA CABINE', 2, 'Montagem das botoeiras, interruptores e sinalizadores'),
    ('pipa', 'Montagem Elétrica', 'SISTEMA DA CABINE', 3, 'Ligação da alimentação positiva, pós-chave e aterramento'),
    ('pipa', 'Montagem Elétrica', 'SISTEMA DA CABINE', 4, 'Conferir fusíveis, relés e comando da tomada de força'),
    ('pipa', 'Montagem Elétrica', 'SISTEMA DA CABINE', 5, 'Instalação e fixação do monitor na cabine'),
    ('pipa', 'Montagem Elétrica', 'SISTEMA DA CABINE', 6, 'Passagem e proteção do cabos na cabine'),
    ('pipa', 'Montagem Elétrica', 'SISTEMA DA CABINE', 7, 'Ligação da alimentação da câmera e do monitor'),
    ('pipa', 'Montagem Elétrica', 'SISTEMA DA CABINE', 8, 'Ligação do acionamento pela marcha à ré'),
    ('pipa', 'Montagem Elétrica', 'SISTEMA DA CABINE', 9, 'Regulagem do ângulo e teste da imagem'),
    ('pipa', 'Montagem Elétrica', 'CÂMERA DE RÉ E COMANDOS TRASEIROS', 10, 'Montagem e fixação da câmera de ré'),
    ('pipa', 'Montagem Elétrica', 'CÂMERA DE RÉ E COMANDOS TRASEIROS', 11, 'Montagem das botoeiras e comandos traseiros'),
    ('pipa', 'Montagem Elétrica', 'CÂMERA DE RÉ E COMANDOS TRASEIROS', 12, 'Ligação dos botões de emergência'),
    ('pipa', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 13, 'Montagem e fixação das lanternas traseiras'),
    ('pipa', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 14, 'Montagem lanternas lateral'),
    ('pipa', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 15, 'Montagem válvula pneumática'),
    ('pipa', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 16, 'Montagem do bloco da parada de emergência'),
    ('pipa', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 17, 'Ligação das luzes de posição e de freio'),
    ('pipa', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 18, 'Ligação das setas e do pisca-alerta'),
    ('pipa', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 19, 'Ligação das luzes de marcha à ré'),
    ('pipa', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 20, 'Ligação da luz da placa, giroflex e luz de trabalho'),
    ('pipa', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 21, 'Organização e roteamento de todos os cabos'),
    ('pipa', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 22, 'Proteção dos cabos com conduíte ou corrugado'),
    ('pipa', 'Montagem Elétrica', 'LANTERNAS E ORGANIZAÇÃO DOS CABOS', 23, 'Fixação com abraçadeiras, presilhas e suportes'),
    ('pipa', 'Montagem Elétrica', 'SOLDAGEM, ISOLAMENTO E CONEXÕES', 24, 'Soldagem de todas as emendas e terminais'),
    ('pipa', 'Montagem Elétrica', 'SOLDAGEM, ISOLAMENTO E CONEXÕES', 25, 'Isolamento com termo retrátil e vedação dos conectores'),
    ('pipa', 'Montagem Elétrica', 'SOLDAGEM, ISOLAMENTO E CONEXÕES', 26, 'Conferir cabos longe de calor, partes móveis e arestas'),
    ('pipa', 'Montagem Elétrica', 'SOLDAGEM, ISOLAMENTO E CONEXÕES', 27, 'Identificação dos cabos e conferência dos aterramentos'),
    ('pipa', 'Montagem Elétrica', 'TESTES E CONFERÊNCIA FINAL', 28, 'Conferir continuidade, polaridade e tensão do sistema'),
    ('pipa', 'Montagem Elétrica', 'TESTES E CONFERÊNCIA FINAL', 29, 'Conferir fusíveis, relés e ausência de curto-circuito'),
    ('pipa', 'Montagem Elétrica', 'TESTES E CONFERÊNCIA FINAL', 30, 'Testar comandos da cabine, traseiros e tomada de força'),
    ('pipa', 'Montagem Elétrica', 'TESTES E CONFERÊNCIA FINAL', 31, 'Testar câmera, lanternas, sinalizações, sensores e emergências'),
    ('pipa', 'Montagem Elétrica', 'TESTES E CONFERÊNCIA FINAL', 32, 'Conferir organização final, limpeza e liberação do equipamento')
    ) as v(tipo, etapa, grupo, ordem, descricao)
    join etapas_padrao ep on ep.tipo_equipamento = v.tipo and ep.nome = v.etapa;

    -- se algum cargo tiver sido renomeado, o join acima perderia linhas em silêncio
    if (select count(*) from etapas_padrao) <> 4 then
      raise exception 'PADRAO_INCOMPLETO: esperadas 4 etapas. Confira se existem os cargos Hidráulico, Eletricista e Inspetor de Qualidade.';
    end if;
    if (select count(*) from tarefas_padrao) <> 125 then
      raise exception 'PADRAO_INCOMPLETO: esperadas 125 tarefas no padrão.';
    end if;

  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. PROTEÇÃO: ITEM DE PADRÃO DE FÁBRICA NÃO PODE SER EXCLUÍDO
-- Vale no banco, não só na tela. Excluir um caminhão inteiro continua
-- permitido (as cópias dele vão junto, em cascata).
-- Para liberar um item de propósito:  update <tabela> set bloqueada = false where id = '...';
-- ---------------------------------------------------------------------
create or replace function protege_etapa_padrao()
returns trigger language plpgsql as $$
begin
  if old.bloqueada then
    raise exception 'PADRAO_DE_FABRICA';
  end if;
  return old;
end $$;

create or replace function protege_tarefa_padrao()
returns trigger language plpgsql as $$
begin
  -- se a etapa-mãe já foi apagada, é exclusão em cascata: permitir
  if old.bloqueada and exists (select 1 from etapas_padrao where id = old.etapa_padrao_id) then
    raise exception 'PADRAO_DE_FABRICA';
  end if;
  return old;
end $$;

create or replace function protege_etapa_do_caminhao()
returns trigger language plpgsql as $$
begin
  if old.bloqueada and exists (select 1 from caminhoes where id = old.caminhao_id) then
    raise exception 'PADRAO_DE_FABRICA';
  end if;
  return old;
end $$;

create or replace function protege_tarefa_do_caminhao()
returns trigger language plpgsql as $$
begin
  if old.bloqueada and exists (select 1 from etapas where id = old.etapa_id) then
    raise exception 'PADRAO_DE_FABRICA';
  end if;
  return old;
end $$;

drop trigger if exists trg_protege_etapa_padrao on etapas_padrao;
create trigger trg_protege_etapa_padrao before delete on etapas_padrao
  for each row execute function protege_etapa_padrao();

drop trigger if exists trg_protege_tarefa_padrao on tarefas_padrao;
create trigger trg_protege_tarefa_padrao before delete on tarefas_padrao
  for each row execute function protege_tarefa_padrao();

drop trigger if exists trg_protege_etapa on etapas;
create trigger trg_protege_etapa before delete on etapas
  for each row execute function protege_etapa_do_caminhao();

drop trigger if exists trg_protege_tarefa on tarefas;
create trigger trg_protege_tarefa before delete on tarefas
  for each row execute function protege_tarefa_do_caminhao();

-- ---------------------------------------------------------------------
-- 7. COPIAR O PADRÃO PARA UM CAMINHÃO
-- Cria só o que falta. Nunca altera nem apaga o que já existe.
-- Serve tanto para caminhão novo quanto para o retroativo.
-- Devolve quantas tarefas foram criadas.
-- ---------------------------------------------------------------------
create or replace function aplicar_padrao_ao_caminhao(p_caminhao_id uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_tipo   text;
  v_ep     record;
  v_tp     record;
  v_etapa  uuid;
  v_ordem  integer;
  v_novas  integer := 0;
begin
  select coalesce(m.tipo_equipamento, 'coletor') into v_tipo
    from caminhoes c
    left join modelos m on m.id = c.modelo_id
   where c.id = p_caminhao_id;

  if not found then
    raise exception 'CAMINHAO_NAO_ENCONTRADO';
  end if;

  for v_ep in
    select * from etapas_padrao
     where ativo and tipo_equipamento = v_tipo
     order by ordem
  loop
    select id into v_etapa
      from etapas
     where caminhao_id = p_caminhao_id and etapa_padrao_id = v_ep.id;

    if v_etapa is null then
      -- usa a ordem do padrão; se já estiver ocupada neste caminhão, vai para o fim
      v_ordem := v_ep.ordem;
      if exists (select 1 from etapas where caminhao_id = p_caminhao_id and ordem = v_ordem) then
        select coalesce(max(ordem), 0) + 10 into v_ordem from etapas where caminhao_id = p_caminhao_id;
      end if;

      insert into etapas (nome, ordem, cargo_responsavel_id, caminhao_id, etapa_padrao_id, bloqueada)
      values (v_ep.nome, v_ordem, v_ep.cargo_responsavel_id, p_caminhao_id, v_ep.id, v_ep.bloqueada)
      returning id into v_etapa;
    end if;

    for v_tp in
      select * from tarefas_padrao
       where etapa_padrao_id = v_ep.id and ativo
       order by ordem
    loop
      if not exists (select 1 from tarefas where etapa_id = v_etapa and tarefa_padrao_id = v_tp.id) then
        v_ordem := v_tp.ordem;
        if exists (select 1 from tarefas where etapa_id = v_etapa and ordem = v_ordem) then
          select coalesce(max(ordem), 0) + 1 into v_ordem from tarefas where etapa_id = v_etapa;
        end if;

        insert into tarefas
          (etapa_id, descricao, grupo, ordem, cargo_responsavel_id, obrigatoria, tarefa_padrao_id, bloqueada)
        values
          (v_etapa, v_tp.descricao, v_tp.grupo, v_ordem, v_tp.cargo_responsavel_id,
           v_tp.obrigatoria, v_tp.id, v_tp.bloqueada);

        v_novas := v_novas + 1;
      end if;
    end loop;
  end loop;

  -- caminhão sem etapa atual passa a apontar para a primeira etapa dele.
  -- quem já tem etapa atual continua exatamente onde estava.
  update caminhoes c
     set etapa_atual_id = (
       select e.id from etapas e
        where e.caminhao_id = c.id and e.ativo
        order by e.ordem limit 1)
   where c.id = p_caminhao_id and c.etapa_atual_id is null;

  return v_novas;
end $$;

-- Aplica o padrão a todos os caminhões. É o botão "Aplicar padrão aos
-- coletores existentes" do painel, e também o passo retroativo abaixo.
create or replace function aplicar_padrao_a_todos()
returns table (chassi text, tarefas_adicionadas integer)
language plpgsql security definer set search_path = public as $$
begin
  -- pelo app, só a gestão; pelo SQL Editor (sem usuário logado), liberado
  if auth.uid() is not null and not e_admin() then
    raise exception 'SOMENTE_GESTAO';
  end if;

  return query
    select c.chassi, aplicar_padrao_ao_caminhao(c.id)
      from caminhoes c
     order by c.chassi;
end $$;

-- ---------------------------------------------------------------------
-- 8. TRIGGER: TODO CAMINHÃO NOVO RECEBE O PADRÃO AUTOMATICAMENTE
-- Roda na mesma transação do cadastro: quando o INSERT termina, as
-- etapas e tarefas já existem.
-- ---------------------------------------------------------------------
create or replace function trg_caminhao_recebe_padrao()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform aplicar_padrao_ao_caminhao(new.id);
  return new;
end $$;

drop trigger if exists trg_novo_caminhao_padrao on caminhoes;
create trigger trg_novo_caminhao_padrao
  after insert on caminhoes
  for each row execute function trg_caminhao_recebe_padrao();

-- ---------------------------------------------------------------------
-- 9. REORDENAR NO PAINEL
-- Correção de um defeito da versão anterior: trocar dois itens de lugar
-- falhava, porque cada item era gravado numa transação separada e a
-- ordem ficava repetida no meio do caminho. Agora vai tudo de uma vez.
-- ---------------------------------------------------------------------
create or replace function reordenar_etapas_padrao(p_ids uuid[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not e_admin() then raise exception 'SOMENTE_GESTAO'; end if;
  update etapas_padrao ep
     set ordem = x.pos * 10
    from unnest(p_ids) with ordinality as x(id, pos)
   where ep.id = x.id;
end $$;

create or replace function reordenar_tarefas_padrao(p_ids uuid[])
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not e_admin() then raise exception 'SOMENTE_GESTAO'; end if;
  update tarefas_padrao tp
     set ordem = x.pos
    from unnest(p_ids) with ordinality as x(id, pos)
   where tp.id = x.id;
end $$;

-- ---------------------------------------------------------------------
-- 10. MARCAÇÃO: TAREFA PRECISA SER DO CAMINHÃO CERTO
-- Mesma função de antes, com uma trava a mais: agora que cada caminhão
-- tem as próprias tarefas, não pode marcar a tarefa de outro chassi.
-- ---------------------------------------------------------------------
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
  v_tarefa  tarefas%rowtype;
  v_dono    uuid;
  v_id      uuid;
begin
  select * into v_usuario from usuarios where matricula = p_matricula and ativo;
  if not found then
    raise exception 'MATRICULA_NAO_ENCONTRADA';
  end if;

  select * into v_tarefa from tarefas where id = p_tarefa_id and ativo;
  if not found then
    raise exception 'TAREFA_NAO_ENCONTRADA';
  end if;

  select caminhao_id into v_dono from etapas where id = v_tarefa.etapa_id;
  if v_dono is not null and v_dono <> p_caminhao_id then
    raise exception 'TAREFA_DE_OUTRO_CAMINHAO';
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

  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 11. PERMISSÕES
-- ---------------------------------------------------------------------
alter table etapas_padrao  enable row level security;
alter table tarefas_padrao enable row level security;

drop policy if exists adm_etapas_padrao on etapas_padrao;
create policy adm_etapas_padrao on etapas_padrao
  for all to authenticated using (e_admin()) with check (e_admin());

drop policy if exists adm_tarefas_padrao on tarefas_padrao;
create policy adm_tarefas_padrao on tarefas_padrao
  for all to authenticated using (e_admin()) with check (e_admin());

-- funções internas: ninguém chama pela API
revoke execute on function aplicar_padrao_ao_caminhao(uuid) from public, anon, authenticated;
revoke execute on function trg_caminhao_recebe_padrao()      from public, anon, authenticated;

-- funções da gestão: só usuário logado (e elas conferem e_admin por dentro)
revoke execute on function aplicar_padrao_a_todos()          from public, anon;
revoke execute on function reordenar_etapas_padrao(uuid[])   from public, anon;
revoke execute on function reordenar_tarefas_padrao(uuid[])  from public, anon;
grant  execute on function aplicar_padrao_a_todos()          to authenticated;
grant  execute on function reordenar_etapas_padrao(uuid[])   to authenticated;
grant  execute on function reordenar_tarefas_padrao(uuid[])  to authenticated;

-- ---------------------------------------------------------------------
-- 12. ETAPAS ANTIGAS VAZIAS
-- Etapas criadas antes do padrão e que nunca receberam tarefa (hoje,
-- a "Hidráulica" antiga) apareceriam duplicadas ao lado da oficial.
-- São desativadas, não apagadas: para trazer de volta, ativo = true.
-- Etapas antigas COM tarefas (a "Solda do baú") continuam intactas.
-- ---------------------------------------------------------------------
update caminhoes c
   set etapa_atual_id = null
  from etapas e
 where c.etapa_atual_id = e.id
   and e.caminhao_id is null
   and e.ativo
   and not exists (select 1 from tarefas t where t.etapa_id = e.id);

update etapas e
   set ativo = false
 where e.caminhao_id is null
   and e.ativo
   and not exists (select 1 from tarefas t where t.etapa_id = e.id);

-- ---------------------------------------------------------------------
-- 13. RETROATIVO: APLICA O PADRÃO AOS CAMINHÕES JÁ CADASTRADOS
-- ---------------------------------------------------------------------
select * from aplicar_padrao_a_todos();

-- trava 1: todo caminhão tem de ter recebido o padrão completo do seu tipo
do $$
declare v_falhas integer;
begin
  select count(*) into v_falhas
    from caminhoes c
    left join modelos m on m.id = c.modelo_id
   where (select count(*)
            from tarefas_padrao tp
            join etapas_padrao ep on ep.id = tp.etapa_padrao_id
           where tp.ativo and ep.ativo
             and ep.tipo_equipamento = coalesce(m.tipo_equipamento, 'coletor'))
      <> (select count(*)
            from tarefas t
            join etapas e         on e.id  = t.etapa_id
            join tarefas_padrao tp on tp.id = t.tarefa_padrao_id
            join etapas_padrao ep  on ep.id = tp.etapa_padrao_id
           where e.caminhao_id = c.id and tp.ativo and ep.ativo);

  if v_falhas > 0 then
    raise exception 'RETROATIVO_INCOMPLETO: % caminhão(ões) sem o padrão completo', v_falhas;
  end if;
end $$;

commit;

-- =====================================================================
-- CONFERÊNCIA — é o que aparece na tela depois do Run
-- =====================================================================
select c.chassi,
       e.ordem,
       e.nome                                     as etapa,
       count(t.id)                                as tarefas,
       (select count(*) from registros_execucao)  as marcacoes_preservadas
  from caminhoes c
  join etapas e       on e.caminhao_id = c.id
  left join tarefas t on t.etapa_id   = e.id
 group by c.chassi, e.ordem, e.nome
 order by c.chassi, e.ordem;

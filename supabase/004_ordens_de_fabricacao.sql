-- =====================================================================
-- 004 — Ordens de Fabricação (OF)
--
-- Cada pedido feito à indústria gera uma OF. A gestão cria a OF e diz
-- quais coletores pertencem a ela; o app acompanha o andamento por OF e
-- por coletor.
--
-- Coletores que já tinham algo no campo "OF / OS" (caminhoes.os) são
-- agrupados automaticamente em OFs com esse número.
--
-- Pode rodar mais de uma vez sem problema.
-- =====================================================================
begin;

-- 1. Tabela das OFs --------------------------------------------------
create table if not exists ordens_fabricacao (
  id          uuid primary key default gen_random_uuid(),
  numero      text not null unique,
  cliente     text,
  data_pedido date not null default current_date,
  prazo       date,
  observacao  text,
  status      text not null default 'aberta'
              check (status in ('aberta', 'concluida', 'cancelada')),
  criado_em   timestamptz not null default now()
);

-- 2. Coletor aponta para a OF ----------------------------------------
-- on delete restrict: uma OF com coletores não pode ser apagada por engano
alter table caminhoes
  add column if not exists of_id uuid references ordens_fabricacao(id) on delete restrict;
create index if not exists idx_caminhoes_of on caminhoes (of_id);

-- 3. Agrupa os coletores que já tinham número de OF digitado ----------
insert into ordens_fabricacao (numero, cliente, data_pedido)
select trim(c.os), min(c.cliente), min(c.data_inicio)::date
  from caminhoes c
 where nullif(trim(c.os), '') is not null
 group by trim(c.os)
on conflict (numero) do nothing;

update caminhoes c
   set of_id = o.id
  from ordens_fabricacao o
 where c.of_id is null
   and o.numero = trim(c.os);

-- 4. Permissões ------------------------------------------------------
alter table ordens_fabricacao enable row level security;

drop policy if exists le_ordens  on ordens_fabricacao;
drop policy if exists adm_ordens on ordens_fabricacao;
create policy le_ordens  on ordens_fabricacao
  for select to anon, authenticated using (true);
create policy adm_ordens on ordens_fabricacao
  for all to authenticated using (e_admin()) with check (e_admin());

grant select on table ordens_fabricacao to anon, authenticated;
grant insert, update, delete on table ordens_fabricacao to authenticated;

-- 5. Andamento de cada coletor (tarefas concluídas / total) -----------
-- Conta as mesmas tarefas que o operador vê: as do coletor e as das
-- etapas antigas compartilhadas, só as ativas.
create or replace view v_progresso_caminhoes with (security_invoker = true) as
select c.id as caminhao_id,
       count(t.id)::int                                  as total,
       (count(t.id) filter (where st.concluida))::int    as concluidas
  from caminhoes c
  left join etapas e
         on e.ativo and (e.caminhao_id = c.id or e.caminhao_id is null)
  left join tarefas t
         on t.etapa_id = e.id and t.ativo
  left join v_status_tarefas st
         on st.caminhao_id = c.id and st.tarefa_id = t.id
 group by c.id;

grant select on v_progresso_caminhoes to anon, authenticated;

commit;

-- Conferência: OFs criadas e quantos coletores cada uma tem
select o.numero, o.cliente, o.status, count(c.id) as coletores
  from ordens_fabricacao o
  left join caminhoes c on c.of_id = o.id
 group by o.id
 order by o.numero;

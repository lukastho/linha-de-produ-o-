-- =====================================================================
-- 003 — Correções de segurança apontadas pelo Security Advisor do Supabase
--
-- 1. A tabela usuarios estava legível por qualquer pessoa com a chave
--    pública do app, inclusive a coluna pin_hash. Agora o público só
--    enxerga as colunas seguras; pin_hash fica só para a gestão.
-- 2. As views rodavam com o poder do dono (SECURITY DEFINER), ignorando
--    as regras de acesso. Agora respeitam as permissões de quem consulta.
-- 3. Funções sem search_path fixo recebem um, como o Supabase recomenda.
--
-- Pode rodar mais de uma vez sem problema.
-- =====================================================================
begin;

-- 1. usuarios: público vê só colunas seguras -------------------------
revoke select on table usuarios from anon;
grant select (id, nome, matricula, cargo_id, e_admin, ativo, criado_em)
  on table usuarios to anon;

drop policy if exists le_usuarios          on usuarios;
drop policy if exists le_usuarios_publico  on usuarios;
drop policy if exists le_usuarios_proprio  on usuarios;

-- tablet do chão de fábrica (sem login): lê as colunas liberadas acima
create policy le_usuarios_publico on usuarios
  for select to anon using (true);

-- conta logada: só a própria linha (login da gestão) ou tudo, se for admin
create policy le_usuarios_proprio on usuarios
  for select to authenticated using (auth_user_id = auth.uid() or e_admin());

-- 2. views respeitam as regras de acesso de quem consulta -------------
alter view v_usuarios_publico set (security_invoker = true);
alter view v_status_tarefas   set (security_invoker = true);
alter view v_sessoes_ativas   set (security_invoker = true);

-- 3. search_path fixo nas funções do app ------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as assinatura
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and pg_get_userbyid(p.proowner) = current_user
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, extensions', f.assinatura);
  end loop;
end $$;

commit;

-- Conferência: deve listar as 3 views com security_invoker=true
select c.relname as view, c.reloptions
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'v';

-- ============================================================
-- StudyApp — RLS AUDIT (READ-ONLY, safe to run in prod)
-- Run in Supabase → SQL Editor. Paste all 4 result sets back.
-- Nothing here modifies data or policies.
-- ============================================================

-- 1) Which public tables have RLS enabled/forced?
--    Anything with rls_enabled = false is readable/writable by any
--    logged-in user via the anon key -> a data-leak risk.
select
  c.relname                as table_name,
  c.relrowsecurity         as rls_enabled,
  c.relforcerowsecurity    as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
order by c.relrowsecurity asc, c.relname;

-- 2) Existing policies on public tables (what's already protecting them)
select
  tablename,
  policyname,
  cmd,            -- SELECT / INSERT / UPDATE / DELETE / ALL
  roles,
  qual            as using_expr,
  with_check      as with_check_expr
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;

-- 3) Ownership columns present per table (tells us how to scope each policy:
--    direct user_id, or via a parent FK like classroom_id / quiz_id / document_id)
select
  table_name,
  string_agg(column_name, ', ' order by column_name) as ownership_columns
from information_schema.columns
where table_schema = 'public'
  and column_name in
    ('user_id','classroom_id','document_id','quiz_id','lesson_id','id')
group by table_name
order by table_name;

-- 4) Storage policies on the 'handouts' bucket (frontend uploads/reads directly)
select
  policyname,
  cmd,
  qual        as using_expr,
  with_check  as with_check_expr
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;

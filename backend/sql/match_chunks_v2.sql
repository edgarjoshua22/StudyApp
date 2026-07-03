-- ============================================================
-- match_chunks v2 — returns cosine `similarity` and accepts an optional
-- `match_threshold` so /ask can tell whether the handouts actually cover a
-- question (handouts-first gating). Run once in Supabase SQL editor.
--
-- Backward compatible: with match_threshold = 0 it returns the same top-N as
-- before, just with an extra `similarity` column. The only caller (/ask) reads
-- `content` today; the extra columns are additive.
--
-- If the DROP errors on signature, run this to see the current one, then adjust
-- the arg types below:
--   select p.oid::regprocedure
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'match_chunks';
-- ============================================================
drop function if exists public.match_chunks(vector, uuid, integer);

create or replace function public.match_chunks(
  query_embedding     vector,
  match_classroom_id  uuid,
  match_count         integer,
  match_threshold     double precision default 0
)
returns table (
  id           uuid,
  content      text,
  chunk_index  integer,
  document_id  uuid,
  similarity   double precision
)
language sql
stable
as $$
  select
    dc.id,
    dc.content,
    dc.chunk_index,
    dc.document_id,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  where dc.classroom_id = match_classroom_id
    and 1 - (dc.embedding <=> query_embedding) >= match_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

grant execute on function
  public.match_chunks(vector, uuid, integer, double precision)
  to authenticated, service_role;

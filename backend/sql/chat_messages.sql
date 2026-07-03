-- ============================================================
-- Durable, per-classroom chat history. Run once in Supabase SQL editor.
-- Owner-scoped RLS matching the audited pattern (auth.uid() = user_id).
-- Frontend reads/writes directly with the anon key, so RLS is required.
-- ============================================================
create table if not exists public.chat_messages (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id)      on delete cascade,
  classroom_id uuid not null references public.classrooms(id) on delete cascade,
  role         text not null check (role in ('user', 'ai')),
  text         text not null,
  model        text,
  web_sources  jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists chat_messages_classroom_created_idx
  on public.chat_messages (classroom_id, created_at);

alter table public.chat_messages enable row level security;

drop policy if exists "own chat messages" on public.chat_messages;
create policy "own chat messages" on public.chat_messages
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

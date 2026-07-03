-- Phase 2: Flashcards + spaced repetition (SM-2).
-- One row per card. SRS state lives ON the card (cards are single-user: a
-- classroom belongs to exactly one user), so no separate reviews table is
-- needed for the MVP — review history/analytics can be added additively later.
--
-- Generation INSERTs run backend-side with the SERVICE key (bypasses RLS).
-- The app (anon key) only ever SELECTs the due queue and UPDATEs SM-2 state,
-- so those are the only policies below. No client INSERT/DELETE policy on
-- purpose — keeps the surface tight.

create table if not exists public.flashcards (
  id               uuid primary key default gen_random_uuid(),
  classroom_id     uuid not null references public.classrooms(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  front            text not null,
  back             text not null,
  source_chunk_id  uuid,                         -- optional provenance (document_chunks.id)
  ease             real not null default 2.5,    -- SM-2 easiness factor (floor 1.3)
  interval_days    real not null default 0,      -- current interval
  repetitions      int  not null default 0,      -- consecutive successful reviews
  due_at           timestamptz not null default now(),  -- new cards are due immediately
  last_reviewed_at timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists flashcards_due_idx  on public.flashcards (user_id, due_at);
create index if not exists flashcards_class_idx on public.flashcards (classroom_id);

alter table public.flashcards enable row level security;

-- Owner may read their own cards (the due queue).
drop policy if exists flashcards_select_own on public.flashcards;
create policy flashcards_select_own on public.flashcards
  for select using (auth.uid() = user_id);

-- Owner may write back SM-2 state after a review. WITH CHECK keeps ownership
-- from being reassigned in an update.
drop policy if exists flashcards_update_own on public.flashcards;
create policy flashcards_update_own on public.flashcards
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

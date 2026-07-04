-- Phase 3: per-concept mastery (the adaptive engine).
--
-- One row per canonical concept per classroom. Concepts DON'T come from the
-- brain graph (which fragments per-document and is rarely built) — they emerge
-- from generation: the quiz/flashcard generators emit a short concept label per
-- item, and every practice result feeds this table via the record_concept_results
-- RPC (see record_concept_results.sql).
--
-- `concept_key` = lower(label) is the canonical identity within a classroom, so
-- the same concept from different handouts/quizzes accrues to ONE row.
--
-- mastery is a plain EMA in [0,1]; SM-2 already owns scheduling, this exists only
-- for the knowledge map and for focusing weak-concept practice.
--
-- Writes go through record_concept_results (SECURITY DEFINER); the app (anon key)
-- only SELECTs its own rows, so that's the only policy here.

create table if not exists public.concept_mastery (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  classroom_id   uuid not null references public.classrooms(id) on delete cascade,
  concept_key    text not null,               -- lower(label): canonical identity
  label          text not null,               -- display label (last-seen casing)
  topic_id       uuid references public.topics(id) on delete set null,  -- set from lessons → unit grouping
  mastery        real not null default 0,     -- 0..1 EMA
  attempts       int  not null default 0,
  correct        real not null default 0,     -- sum of outcomes (for accuracy display)
  last_seen_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  unique (user_id, classroom_id, concept_key)
);

create index if not exists concept_mastery_class_idx
  on public.concept_mastery (user_id, classroom_id);
create index if not exists concept_mastery_weak_idx
  on public.concept_mastery (user_id, classroom_id, mastery);

alter table public.concept_mastery enable row level security;

-- Owner may read their own mastery (the map + weak-concept queries).
drop policy if exists concept_mastery_select_own on public.concept_mastery;
create policy concept_mastery_select_own on public.concept_mastery
  for select using (auth.uid() = user_id);

-- No client INSERT/UPDATE policy on purpose — all writes go through
-- record_concept_results (SECURITY DEFINER), which stamps user_id from auth.uid().

-- ------------------------------------------------------------------
-- Concept tags on the items that train a concept, so the client knows
-- which concept each answered question / reviewed card belongs to.
-- Nullable + backward-compatible: pre-Phase-3 rows stay null and simply
-- don't contribute mastery.
-- ------------------------------------------------------------------
alter table public.quiz_questions
  add column if not exists concept_key   text,
  add column if not exists concept_label text;

alter table public.flashcards
  add column if not exists concept_key   text,
  add column if not exists concept_label text;

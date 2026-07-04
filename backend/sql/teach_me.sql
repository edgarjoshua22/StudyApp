-- Phase 4a: "Teach me anything" — zero-content AI mini-courses.
--
-- These courses have NO uploaded handout, so their lessons/quizzes carry no
-- document_id, and each lesson caches its own AI-generated teaching content.
-- Run once in Supabase → SQL Editor. RLS unchanged (lessons/quizzes/classrooms
-- are already owner-scoped and audited).

-- Source-less lessons/quizzes: allow a NULL handout. (DROP NOT NULL is a no-op
-- if the column is already nullable, so this is safe to run either way.)
alter table public.lessons alter column document_id drop not null;
alter table public.quizzes alter column document_id drop not null;

-- AI-course topics carry no embedding (nothing matches chunks to them). Every
-- upload-path topic-insert supplies one, so this column is likely NOT NULL —
-- allow NULL so /teach-me's topic insert doesn't throw. (No-op if already nullable.)
alter table public.topics alter column embedding drop not null;

-- Cached per-lesson teaching content (the "read the lesson" screen).
-- jsonb shape: { "explanation": text, "key_points": [text, ...] }.
alter table public.lessons add column if not exists content jsonb;

-- Marks a source-less AI course so the app frames it right and hides handout UI.
-- 'ai_course' = built by /teach-me; NULL = a normal upload-based classroom.
alter table public.classrooms add column if not exists origin text;

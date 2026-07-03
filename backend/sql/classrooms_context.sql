-- ============================================================
-- Classroom context ("what it's about" + "goal") for better
-- topic/brain/path generation. Run once in Supabase SQL editor.
-- semester becomes nullable so pathfinders (no semester) can create
-- classrooms. RLS unchanged (auth.uid() = user_id).
-- ============================================================
alter table public.classrooms
  add column if not exists description text,
  add column if not exists goal        text;

-- No-op if already nullable.
alter table public.classrooms alter column semester drop not null;

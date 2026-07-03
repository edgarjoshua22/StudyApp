-- ============================================================
-- Onboarding fields on profiles. Run once in Supabase SQL editor.
-- RLS already covers profiles via auth.uid() = id (audited).
-- ============================================================
alter table public.profiles
  add column if not exists full_name            text,
  add column if not exists birthdate            date,
  add column if not exists user_type            text
    check (user_type in ('student', 'pathfinder')),
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists privacy_accepted_at  timestamptz,
  add column if not exists legal_version        text;

-- ============================================================
-- #18 — Atomic lesson-completion + XP award
-- Run once in Supabase → SQL Editor.
--
-- Wraps the two existing RPCs (complete_lesson + award_xp) in a single
-- function. A plpgsql function runs in ONE transaction, so either BOTH the
-- lesson completion and the XP award commit, or neither does. This closes the
-- partial-failure window that existed when the client called the two RPCs as
-- separate network round-trips.
--
-- Both inner functions derive the user from auth.uid(); that GUC is preserved
-- across nested calls (SECURITY DEFINER changes the role, not the JWT claims),
-- so ownership/streak logic behaves exactly as before.
-- ============================================================

create or replace function public.complete_lesson_and_award_xp(
  p_lesson_id uuid,
  p_score     integer,
  p_total     integer,
  p_amount    integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  award jsonb;
begin
  -- 1) Mark the path node complete (earliest completion kept, best score raised)
  perform public.complete_lesson(p_lesson_id, p_score, p_total);
  -- 2) Award XP + daily-reset/streak math; capture the result to hand back
  award := public.award_xp(p_amount)::jsonb;
  return award;
end;
$$;

grant execute on function
  public.complete_lesson_and_award_xp(uuid, integer, integer, integer)
  to authenticated;

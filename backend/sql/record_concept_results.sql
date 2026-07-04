-- Phase 3: the single mastery-update seam.
--
-- The app calls this once per practice event (one quiz = one call with an array
-- of per-question results; one flashcard/recall = one call with a single result)
-- instead of an RPC per item. SECURITY DEFINER + auth.uid() so the anon-key
-- client can write mastery without a client-side UPDATE policy on the table.
--
-- p_results is a JSON array of objects:
--   { "concept_key": "photosynthesis", "label": "Photosynthesis",
--     "topic_id": "<uuid|null>", "outcome": 1 }
-- outcome is in [0,1]: quiz correct/incorrect -> 1/0; flashcard again/hard/good/easy
-- -> 0/0.4/0.8/1; recall incorrect/partial/correct/excellent -> 0/0.4/0.8/1.
--
-- Mastery is an EMA: m := m + alpha*(outcome - m), alpha = 0.4.

create or replace function public.record_concept_results(
  p_classroom_id uuid,
  p_results      jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_alpha real := 0.4;
  r       jsonb;
  v_key   text;
  v_label text;
  v_topic uuid;
  v_out   real;
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  -- Ownership: only write mastery for a classroom the caller owns.
  if not exists (
    select 1 from public.classrooms
    where id = p_classroom_id and user_id = v_user
  ) then
    raise exception 'not classroom owner';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb))
  loop
    v_key := nullif(trim(lower(r->>'concept_key')), '');
    if v_key is null then
      continue;                         -- untagged item: skip, don't pollute the map
    end if;
    v_label := coalesce(nullif(trim(r->>'label'), ''), initcap(v_key));
    v_topic := nullif(r->>'topic_id', '')::uuid;
    v_out   := greatest(0, least(1, coalesce((r->>'outcome')::real, 0)));

    insert into public.concept_mastery
      (user_id, classroom_id, concept_key, label, topic_id, mastery, attempts, correct, last_seen_at)
    values
      (v_user, p_classroom_id, v_key, v_label, v_topic, v_out * v_alpha, 1, v_out, now())
    on conflict (user_id, classroom_id, concept_key) do update
      set mastery      = concept_mastery.mastery + v_alpha * (v_out - concept_mastery.mastery),
          attempts     = concept_mastery.attempts + 1,
          correct      = concept_mastery.correct + v_out,
          label        = excluded.label,
          topic_id     = coalesce(excluded.topic_id, concept_mastery.topic_id),
          last_seen_at = now();
  end loop;
end;
$$;

grant execute on function public.record_concept_results(uuid, jsonb) to authenticated;

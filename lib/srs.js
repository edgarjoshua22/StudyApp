// SM-2 spaced repetition, adapted for a 4-button review UI.
//
// Grades: 'again' | 'hard' | 'good' | 'easy'  (mapped to SM-2 qualities 2/3/4/5).
// Only 'again' is a failure. 'hard' is a pass that lowers ease. Ease is updated
// on EVERY grade (including fails) and never drops below 1.3. The first two
// successful intervals are fixed (1 day, then 6 days); after that the interval
// grows by the ease factor.
//
// State kept on each card row: { ease, interval_days, repetitions }.
// schedule() returns the fields to persist back to the flashcards row.

export const GRADES = ['again', 'hard', 'good', 'easy'];

const QUALITY = { again: 2, hard: 3, good: 4, easy: 5 };
const EASE_FLOOR = 1.3;
const DAY_MS = 86400000;

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Given a card's current SRS state and a grade, return the next state to save.
export function schedule(card, grade, now = Date.now()) {
  const q = QUALITY[grade] ?? QUALITY.good;
  let ease = typeof card?.ease === 'number' ? card.ease : 2.5;
  let interval = typeof card?.interval_days === 'number' ? card.interval_days : 0;
  let reps = typeof card?.repetitions === 'number' ? card.repetitions : 0;

  if (q < 3) {
    // Fail: relearn from the start.
    reps = 0;
    interval = 1;
  } else {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.round(interval * ease);
    reps += 1;
  }

  // SM-2 ease update, applied for every grade.
  ease = ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (ease < EASE_FLOOR) ease = EASE_FLOOR;

  return {
    ease: round2(ease),
    interval_days: interval,
    repetitions: reps,
    due_at: new Date(now + interval * DAY_MS).toISOString(),
    last_reviewed_at: new Date(now).toISOString(),
  };
}

// Only 'again' keeps a card in the current session (relearning step).
export function keepsInSession(grade) {
  return grade === 'again';
}

// Human-friendly "next due" preview for a button, e.g. "6d" / "<1d".
export function previewInterval(card, grade, now = Date.now()) {
  const next = schedule(card, grade, now);
  const d = next.interval_days;
  return d < 1 ? '<1d' : `${d}d`;
}

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView,
  TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../lib/api';
import { palette, gradients, space, radius, type, shadow } from '../lib/theme';
import { schedule, keepsInSession, previewInterval } from '../lib/srs';

// Review a due-flashcard queue with SM-2 scheduling. Cards can be scoped to one
// classroom (route.params.classroom) or the whole account (the Today "Review"
// tile). RLS restricts every query to the signed-in user's own cards, so we
// never filter by user_id ourselves.
const GRADE_META = {
  again: { label: 'Again', color: palette.red,    soft: palette.redSoft },
  hard:  { label: 'Hard',  color: palette.orange, soft: palette.orangeSoft },
  good:  { label: 'Good',  color: palette.green,   soft: palette.greenSoft },
  easy:  { label: 'Easy',  color: palette.blue,    soft: palette.blueSoft },
};
const ORDER = ['again', 'hard', 'good', 'easy'];
// Active-recall verdicts map onto the SM-2 grades.
const VERDICT_GRADE = { incorrect: 'again', partial: 'hard', correct: 'good', excellent: 'easy' };
const VERDICT_META = {
  incorrect: { label: 'Keep practising', color: palette.red },
  partial:   { label: 'Almost',          color: palette.orange },
  correct:   { label: 'Correct',         color: palette.green },
  excellent: { label: 'Excellent!',      color: palette.blue },
};

export default function FlashcardsScreen({ route, navigation }) {
  const classroom = route.params?.classroom || null;

  const [mode, setMode] = useState('flip');    // 'flip' (self-grade) | 'recall' (AI-graded)
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState([]);      // remaining cards this session
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0); // distinct grades applied
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState('');

  // Recall-mode state
  const [answer, setAnswer] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);  // {verdict,feedback} | {fallback:true} | null

  const card = queue[0] || null;

  function resetCardState() {
    setFlipped(false);
    setAnswer('');
    setResult(null);
  }

  useEffect(() => { load(); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('flashcards')
      .select('id,front,back,ease,interval_days,repetitions')
      .lte('due_at', new Date().toISOString())
      .order('due_at', { ascending: true })
      .limit(60);
    if (classroom) q = q.eq('classroom_id', classroom.id);
    const { data } = await q;
    setQueue(data || []);
    resetCardState();
    setLoading(false);
  }, [classroom]);

  async function grade(g) {
    if (!card || saving) return;
    setSaving(true);
    const next = schedule(card, g);
    // Persist SM-2 state. RLS ensures we can only touch our own card.
    await supabase.from('flashcards').update(next).eq('id', card.id);
    setReviewed((n) => n + 1);

    setQueue((prev) => {
      const [first, ...rest] = prev;
      // 'Again' keeps the card in this session (relearning) — send it to the back
      // with its freshly-lowered state so the preview stays honest.
      return keepsInSession(g) ? [...rest, { ...first, ...next }] : rest;
    });
    resetCardState();
    setSaving(false);
  }

  // Recall mode: grade the typed answer with the AI, then map its verdict to SM-2.
  // If grading is unavailable, degrade to manual self-grade so the session never
  // dead-ends on a failed LLM call.
  async function checkAnswer() {
    if (!card || checking || !answer.trim()) return;
    setChecking(true);
    try {
      const res = await apiFetch('/grade-answer', {
        method: 'POST',
        body: JSON.stringify({ prompt: card.front, reference: card.back, answer: answer.trim() }),
      });
      const data = await res.json();
      if (data.error || !data.verdict) setResult({ fallback: true });
      else setResult({ verdict: data.verdict, feedback: data.feedback });
    } catch (_) {
      setResult({ fallback: true });
    } finally {
      setChecking(false);
    }
  }

  function switchMode(m) {
    if (m === mode) return;
    setMode(m);
    resetCardState();
  }

  async function generateDeck() {
    if (!classroom || generating) return;
    setGenerating(true);
    setGenMsg('Reading your handouts and writing cards…');
    try {
      const res = await apiFetch(`/generate-flashcards?classroom_id=${classroom.id}&count=12`, { method: 'POST' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setGenMsg('');
      await load();
    } catch (e) {
      setGenMsg(e.message || 'Could not generate flashcards.');
    } finally {
      setGenerating(false);
    }
  }

  const done = !loading && queue.length === 0;

  // Award a little XP the first time a session clears (reinforces the daily habit).
  useEffect(() => {
    if (!done || reviewed === 0) return;
    (async () => {
      try { await supabase.rpc('award_xp', { amount: Math.min(reviewed * 2, 40) }); } catch (_) {}
    })();
  }, [done]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Top bar */}
      <View style={styles.topbar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={palette.ink} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>
          {classroom ? classroom.name : 'Daily review'}
        </Text>
        <Text style={styles.counter}>{loading || done ? '' : queue.length}</Text>
      </View>

      {!loading && !done ? (
        <View style={styles.segment}>
          {['flip', 'recall'].map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.segBtn, mode === m && styles.segBtnOn]}
              onPress={() => switchMode(m)}
              activeOpacity={0.85}
            >
              <Text style={[styles.segText, mode === m && styles.segTextOn]}>
                {m === 'flip' ? '🔄 Flip' : '✍️ Recall'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={palette.primary} size="large" /></View>
      ) : done ? (
        <View style={styles.center}>
          <Text style={styles.doneEmoji}>{reviewed ? '🎉' : '✅'}</Text>
          <Text style={styles.doneTitle}>{reviewed ? 'Review complete!' : 'Nothing due'}</Text>
          <Text style={styles.doneSub}>
            {reviewed
              ? `You reviewed ${reviewed} card${reviewed === 1 ? '' : 's'}. Come back when more are due.`
              : classroom
                ? 'No cards are due right now. Add some from this subject’s handouts.'
                : 'No cards are due right now. Check back later.'}
          </Text>
          {genMsg ? <Text style={styles.genMsg}>{genMsg}</Text> : null}
          {classroom && !reviewed ? (
            <TouchableOpacity style={[styles.doneBtn, generating && styles.dim]} onPress={generateDeck} disabled={generating} activeOpacity={0.85}>
              {generating
                ? <ActivityIndicator color={palette.white} />
                : <Text style={styles.doneBtnText}>✨ Generate flashcards</Text>}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.doneBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
              <Text style={styles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : mode === 'recall' ? (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.cardWrap} keyboardShouldPersistTaps="handled">
            <View style={styles.promptCard}>
              <Text style={styles.promptTag}>RECALL — WRITE IT FROM MEMORY</Text>
              <Text style={styles.promptText}>{card.front}</Text>
            </View>

            {!result ? (
              <TextInput
                style={styles.answerInput}
                placeholder="Type what you remember…"
                placeholderTextColor={palette.hint}
                value={answer}
                onChangeText={setAnswer}
                multiline
                editable={!checking}
              />
            ) : (
              <View style={styles.resultCard}>
                <Text style={[styles.verdict, { color: result.verdict ? VERDICT_META[result.verdict].color : palette.inkSoft }]}>
                  {result.verdict ? VERDICT_META[result.verdict].label : 'Grade yourself'}
                </Text>
                {result.feedback ? <Text style={styles.feedback}>{result.feedback}</Text> : null}
                {result.fallback ? <Text style={styles.feedback}>Auto-grading is unavailable right now — compare with the answer and grade yourself.</Text> : null}
                <Text style={styles.refLabel}>ANSWER</Text>
                <Text style={styles.refText}>{card.back}</Text>
              </View>
            )}
          </ScrollView>

          {!result ? (
            <View style={styles.grades}>
              <TouchableOpacity
                style={[styles.revealBtn, (checking || !answer.trim()) && styles.dim]}
                onPress={checkAnswer}
                disabled={checking || !answer.trim()}
                activeOpacity={0.85}
              >
                {checking ? <ActivityIndicator color={palette.white} /> : <Text style={styles.revealText}>Check answer</Text>}
              </TouchableOpacity>
            </View>
          ) : result.verdict ? (
            <View style={styles.grades}>
              <TouchableOpacity
                style={[styles.revealBtn, saving && styles.dim]}
                onPress={() => grade(VERDICT_GRADE[result.verdict])}
                disabled={saving}
                activeOpacity={0.85}
              >
                <Text style={styles.revealText}>Next</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.grades}>
              {ORDER.map((g) => {
                const m = GRADE_META[g];
                return (
                  <TouchableOpacity
                    key={g}
                    style={[styles.gradeBtn, { backgroundColor: m.soft }, saving && styles.dim]}
                    onPress={() => grade(g)}
                    disabled={saving}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.gradeLabel, { color: m.color }]}>{m.label}</Text>
                    <Text style={[styles.gradeInt, { color: m.color }]}>{previewInterval(card, g)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </KeyboardAvoidingView>
      ) : (
        <>
          {/* Card */}
          <ScrollView contentContainerStyle={styles.cardWrap}>
            <TouchableOpacity activeOpacity={0.95} onPress={() => setFlipped((f) => !f)} style={{ width: '100%' }}>
              <LinearGradient
                colors={flipped ? gradients.mint : gradients.primary}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={styles.card}
              >
                <Text style={styles.cardTag}>{flipped ? 'ANSWER' : 'PROMPT'}</Text>
                <Text style={styles.cardText}>{flipped ? card.back : card.front}</Text>
                {!flipped ? <Text style={styles.tapHint}>Tap to reveal</Text> : null}
              </LinearGradient>
            </TouchableOpacity>
          </ScrollView>

          {/* Grade buttons (only after flip) */}
          {flipped ? (
            <View style={styles.grades}>
              {ORDER.map((g) => {
                const m = GRADE_META[g];
                return (
                  <TouchableOpacity
                    key={g}
                    style={[styles.gradeBtn, { backgroundColor: m.soft }, saving && styles.dim]}
                    onPress={() => grade(g)}
                    disabled={saving}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.gradeLabel, { color: m.color }]}>{m.label}</Text>
                    <Text style={[styles.gradeInt, { color: m.color }]}>{previewInterval(card, g)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <View style={styles.grades}>
              <TouchableOpacity style={styles.revealBtn} onPress={() => setFlipped(true)} activeOpacity={0.85}>
                <Text style={styles.revealText}>Show answer</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bgSoft },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: space.xxl },

  topbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.sm },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  topTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: palette.ink },
  counter: { fontSize: 16, fontWeight: '800', color: palette.inkSoft, minWidth: 24, textAlign: 'right' },

  segment: { flexDirection: 'row', backgroundColor: palette.lineSoft, borderRadius: radius.pill, padding: 4, marginHorizontal: space.xl, marginBottom: space.xs },
  segBtn: { flex: 1, paddingVertical: 8, borderRadius: radius.pill, alignItems: 'center' },
  segBtnOn: { backgroundColor: palette.bg, ...shadow.card },
  segText: { fontSize: 14, fontWeight: '800', color: palette.inkSoft },
  segTextOn: { color: palette.primary },

  cardWrap: { flexGrow: 1, justifyContent: 'center', padding: space.xl },

  // Recall mode
  promptCard: { backgroundColor: palette.bg, borderRadius: radius.xl, padding: space.xl, ...shadow.card },
  promptTag: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: palette.hint, marginBottom: space.sm },
  promptText: { fontSize: 20, fontWeight: '800', color: palette.ink, lineHeight: 28 },
  answerInput: {
    marginTop: space.lg, backgroundColor: palette.bg, borderRadius: radius.lg, borderWidth: 2, borderColor: palette.line,
    padding: space.lg, minHeight: 120, fontSize: 16, color: palette.ink, textAlignVertical: 'top',
  },
  resultCard: { marginTop: space.lg, backgroundColor: palette.bg, borderRadius: radius.lg, padding: space.lg, ...shadow.card },
  verdict: { fontSize: 18, fontWeight: '800' },
  feedback: { fontSize: 15, color: palette.ink, lineHeight: 22, marginTop: space.sm },
  refLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, color: palette.hint, marginTop: space.lg },
  refText: { fontSize: 15, color: palette.inkSoft, lineHeight: 22, marginTop: 4, fontWeight: '600' },

  card: { borderRadius: radius.xl, padding: space.xxl, minHeight: 260, justifyContent: 'center', alignItems: 'center', ...shadow.card },
  cardTag: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginBottom: space.lg },
  cardText: { color: palette.white, fontSize: 22, fontWeight: '800', textAlign: 'center', lineHeight: 30 },
  tapHint: { color: 'rgba(255,255,255,0.85)', fontSize: 13, fontWeight: '600', marginTop: space.xl },

  grades: { flexDirection: 'row', gap: space.sm, padding: space.lg },
  gradeBtn: { flex: 1, borderRadius: radius.lg, paddingVertical: 14, alignItems: 'center', gap: 2 },
  gradeLabel: { fontSize: 15, fontWeight: '800' },
  gradeInt: { fontSize: 11, fontWeight: '700', opacity: 0.9 },
  dim: { opacity: 0.6 },
  revealBtn: { flex: 1, borderRadius: radius.lg, paddingVertical: 16, alignItems: 'center', backgroundColor: palette.primary, ...shadow.card },
  revealText: { color: palette.white, fontSize: 16, fontWeight: '800' },

  doneEmoji: { fontSize: 60, marginBottom: space.md },
  doneTitle: { fontSize: 24, fontWeight: '800', color: palette.ink },
  doneSub: { fontSize: 15, color: palette.inkSoft, textAlign: 'center', marginTop: space.sm, lineHeight: 22 },
  doneBtn: { marginTop: space.xl, backgroundColor: palette.primary, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: 40, minHeight: 52, justifyContent: 'center', ...shadow.card },
  doneBtnText: { color: palette.white, fontSize: 16, fontWeight: '800' },
  genMsg: { marginTop: space.lg, fontSize: 13, color: palette.inkSoft, textAlign: 'center', fontWeight: '600' },
});

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { palette, space, radius, type, shadow, solid } from '../lib/theme';

export default function QuizScreen({ route, navigation }) {
  const { quiz, lesson } = route.params;    // quiz: { quiz_id, title, questions }; lesson: { id } | undefined
  const questions = quiz.questions || [];

  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState(null);
  const [checked, setChecked] = useState(false);
  const [score, setScore] = useState(0);
  const [finished, setFinished] = useState(false);
  const [award, setAward] = useState(null);
  const [awardErr, setAwardErr] = useState(null);

  // XP for this run: 10 per correct answer + a 5 XP completion bonus
  const xpEarned = score * 10 + 5;

  useEffect(() => {
    navigation.setOptions({ title: quiz.title || 'Quiz' });
  }, []);

  // Save the attempt + award XP/streak once, when the quiz finishes
  useEffect(() => {
    if (!finished) return;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('quiz_attempts').insert({
        quiz_id: quiz.quiz_id,
        user_id: user.id,
        score,
        total: questions.length,
      });
      // award_xp handles the daily reset + streak math atomically in the DB
      const { data, error } = await supabase.rpc('award_xp', { amount: xpEarned });
      if (error) {
        console.warn('award_xp failed:', error);
        setAwardErr(error.message || 'Unknown error');
      } else if (data) {
        setAward(data);
      }

      // If this quiz was launched from a learning-path node, mark it complete
      // (atomic upsert in the DB: keeps earliest completion, raises best score).
      if (lesson?.id) {
        const { error: lessonErr } = await supabase.rpc('complete_lesson', {
          p_lesson_id: lesson.id,
          p_score: score,
          p_total: questions.length,
        });
        if (lessonErr) console.warn('complete_lesson failed:', lessonErr);
      }
    })();
  }, [finished]);

  function restart() {
    setIndex(0);
    setSelected(null);
    setChecked(false);
    setScore(0);
    setFinished(false);
    setAward(null);
    setAwardErr(null);
  }

  if (questions.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🤔</Text>
          <Text style={styles.emptyText}>This quiz has no questions.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ---------- Results screen ----------
  if (finished) {
    const pct = Math.round((score / questions.length) * 100);
    const passed = pct >= 70;
    const ace = pct === 100;
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.center}>
          <Text style={styles.resultEmoji}>{ace ? '🏆' : passed ? '🎉' : '💪'}</Text>
          <Text style={styles.resultTitle}>{ace ? 'Perfect!' : passed ? 'Great job!' : 'Keep practicing!'}</Text>

          <View style={styles.scoreCard}>
            <Text style={styles.resultScore}>{score} / {questions.length}</Text>
            <View style={styles.resultBarTrack}>
              <View style={[styles.resultBarFill, { width: `${pct}%`, backgroundColor: passed ? palette.green : palette.orange }]} />
            </View>
            <Text style={styles.resultPct}>{pct}% correct</Text>
          </View>

          {award && (
            <View style={styles.xpCard}>
              <Text style={styles.xpEarned}>+{award.awarded} XP</Text>
              <Text style={styles.streakLine}>
                🔥 {award.current_streak} day{award.current_streak === 1 ? '' : 's'} streak{award.streak_increased ? ' — nice!' : ''}
              </Text>
              {award.daily_xp >= award.daily_goal ? (
                <Text style={styles.goalDone}>🏆 Daily goal reached!</Text>
              ) : (
                <Text style={styles.goalProg}>{award.daily_xp} / {award.daily_goal} XP toward today's goal</Text>
              )}
            </View>
          )}

          {awardErr && (
            <Text style={styles.awardErr}>XP didn't save: {awardErr}</Text>
          )}

          <View style={styles.footerStretch}>
            <TouchableOpacity style={[styles.primaryBtn, solid(palette.green, palette.greenDark, radius.lg)]} onPress={restart} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>TRY AGAIN</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
              <Text style={styles.secondaryBtnText}>DONE</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ---------- Question screen ----------
  const q = questions[index];
  const isCorrect = selected === q.correct_index;
  const isLast = index + 1 >= questions.length;
  const progress = ((index + (checked ? 1 : 0)) / questions.length) * 100;

  function onAction() {
    if (selected === null) return;
    if (!checked) {
      setChecked(true);
      if (selected === q.correct_index) setScore((s) => s + 1);
    } else if (isLast) {
      setFinished(true);
    } else {
      setIndex((i) => i + 1);
      setSelected(null);
      setChecked(false);
    }
  }

  // returns { box, txt, icon } style decisions per choice
  function choiceState(i) {
    if (!checked) {
      return i === selected
        ? { box: styles.choiceSelected, txt: styles.choiceTextSelected, icon: null }
        : { box: styles.choice, txt: styles.choiceText, icon: null };
    }
    if (i === q.correct_index) return { box: styles.choiceCorrect, txt: styles.choiceTextCorrect, icon: 'checkmark-circle', iconColor: palette.green };
    if (i === selected) return { box: styles.choiceWrong, txt: styles.choiceTextWrong, icon: 'close-circle', iconColor: palette.red };
    return { box: styles.choice, txt: styles.choiceText, icon: null };
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={28} color={palette.hint} />
        </TouchableOpacity>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        <Text style={styles.counter}>{index + 1} / {questions.length}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.askRow}>
          <Text style={styles.askOwl}>🦉</Text>
          <View style={styles.askBubble}>
            <Text style={styles.question}>{q.question}</Text>
            <View style={styles.askTail} />
          </View>
        </View>
        {q.choices.map((choice, i) => {
          const st = choiceState(i);
          return (
            <TouchableOpacity
              key={i}
              style={st.box}
              activeOpacity={0.85}
              disabled={checked}
              onPress={() => setSelected(i)}
            >
              <Text style={[st.txt, { flex: 1 }]}>{choice}</Text>
              {st.icon ? <Ionicons name={st.icon} size={22} color={st.iconColor} /> : null}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {checked && (
        <View style={[styles.feedback, isCorrect ? styles.feedbackGood : styles.feedbackBad]}>
          <Text style={[styles.feedbackTitle, isCorrect ? styles.feedbackTitleGood : styles.feedbackTitleBad]}>
            {isCorrect ? '✅ Correct!' : '❌ Not quite'}
          </Text>
          {q.explanation ? <Text style={styles.feedbackText}>{q.explanation}</Text> : null}
        </View>
      )}

      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            selected === null
              ? styles.btnDisabled
              : solid(checked ? (isCorrect ? palette.green : palette.orange) : palette.green,
                      checked ? (isCorrect ? palette.greenDark : palette.orangeDark) : palette.greenDark, radius.lg),
          ]}
          onPress={onAction}
          disabled={selected === null}
          activeOpacity={0.85}
        >
          <Text style={[styles.primaryBtnText, selected === null && styles.btnTextDisabled]}>
            {!checked ? 'CHECK' : isLast ? 'FINISH' : 'CONTINUE'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bgSoft },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },

  askRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: space.xxl },
  askOwl: { fontSize: 44 },
  askBubble: { flex: 1, backgroundColor: palette.bg, borderWidth: 2, borderColor: palette.line,
    borderRadius: radius.lg, padding: space.lg },
  askTail: { position: 'absolute', left: -9, top: 20, width: 14, height: 14, backgroundColor: palette.bg,
    borderLeftWidth: 2, borderBottomWidth: 2, borderColor: palette.line, transform: [{ rotate: '45deg' }] },
  emptyEmoji: { fontSize: 56, marginBottom: space.md },
  emptyText: { fontSize: 16, color: palette.inkSoft, fontWeight: '600' },

  topBar: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm },
  progressTrack: { flex: 1, height: 14, backgroundColor: palette.line, borderRadius: 7 },
  progressFill: { height: 14, backgroundColor: palette.green, borderRadius: 7 },
  counter: { fontSize: 13, color: palette.inkSoft, fontWeight: '800' },

  body: { padding: space.xl },
  question: { fontSize: 21, fontWeight: '800', color: palette.ink, lineHeight: 29 },

  choice: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderBottomWidth: 4, borderColor: palette.line, borderRadius: radius.md, padding: 18, marginBottom: space.md, backgroundColor: palette.bg },
  choiceSelected: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderBottomWidth: 4, borderColor: palette.blue, borderRadius: radius.md, padding: 18, marginBottom: space.md, backgroundColor: palette.blueSoft },
  choiceCorrect: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderBottomWidth: 4, borderColor: palette.greenDark, borderRadius: radius.md, padding: 18, marginBottom: space.md, backgroundColor: palette.greenSoft },
  choiceWrong: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderBottomWidth: 4, borderColor: palette.redDark, borderRadius: radius.md, padding: 18, marginBottom: space.md, backgroundColor: palette.redSoft },
  choiceText: { fontSize: 16, color: palette.ink, fontWeight: '600' },
  choiceTextSelected: { fontSize: 16, color: palette.blue, fontWeight: '700' },
  choiceTextCorrect: { fontSize: 16, color: palette.green, fontWeight: '700' },
  choiceTextWrong: { fontSize: 16, color: palette.red, fontWeight: '700' },

  feedback: { paddingHorizontal: space.xl, paddingVertical: space.lg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  feedbackGood: { backgroundColor: palette.greenSoft },
  feedbackBad: { backgroundColor: palette.redSoft },
  feedbackTitle: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
  feedbackTitleGood: { color: palette.green },
  feedbackTitleBad: { color: palette.red },
  feedbackText: { fontSize: 14, color: palette.ink, lineHeight: 20, fontWeight: '500' },

  footer: { padding: space.lg, borderTopWidth: 1, borderTopColor: palette.lineSoft },
  primaryBtn: { paddingVertical: 16, borderRadius: radius.lg, alignItems: 'center' },
  primaryBtnText: { color: palette.white, fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  btnDisabled: { backgroundColor: palette.line },
  btnTextDisabled: { color: palette.hint },
  secondaryBtn: { paddingVertical: 16, borderRadius: radius.lg, alignItems: 'center', marginTop: space.md },
  secondaryBtnText: { color: palette.hint, fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },

  resultEmoji: { fontSize: 76, marginBottom: space.md },
  resultTitle: { fontSize: 27, fontWeight: '800', color: palette.ink, marginBottom: space.xl },
  scoreCard: { alignSelf: 'stretch', alignItems: 'center', backgroundColor: palette.bg, borderRadius: radius.xl, paddingVertical: space.xl, marginBottom: space.xl },
  resultScore: { fontSize: 44, fontWeight: '800', color: palette.green },
  resultBarTrack: { width: '70%', height: 12, backgroundColor: palette.line, borderRadius: 6, marginTop: space.md },
  resultBarFill: { height: 12, borderRadius: 6 },
  resultPct: { fontSize: 14, color: palette.inkSoft, marginTop: space.sm, fontWeight: '700' },

  xpCard: { alignSelf: 'stretch', alignItems: 'center', backgroundColor: palette.orangeSoft, borderWidth: 2, borderColor: palette.orangeDark, borderRadius: radius.lg, paddingVertical: 18, paddingHorizontal: 24, marginBottom: space.xl },
  xpEarned: { fontSize: 30, fontWeight: '800', color: palette.orange },
  streakLine: { fontSize: 15, color: palette.ink, fontWeight: '700', marginTop: space.sm },
  goalDone: { fontSize: 14, color: palette.greenDark, fontWeight: '800', marginTop: 6 },
  goalProg: { fontSize: 13, color: palette.inkSoft, marginTop: 6, fontWeight: '600' },
  awardErr: { fontSize: 12, color: palette.redDark, textAlign: 'center', marginBottom: space.xl, paddingHorizontal: 20 },

  footerStretch: { alignSelf: 'stretch' },
});

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';

export default function QuizScreen({ route, navigation }) {
  const { quiz } = route.params;            // { quiz_id, title, questions: [...] }
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
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.center}>
          <Text style={styles.emptyText}>This quiz has no questions.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ---------- Results screen ----------
  if (finished) {
    const pct = Math.round((score / questions.length) * 100);
    const passed = pct >= 70;
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.center}>
          <Text style={styles.resultEmoji}>{passed ? '🎉' : '💪'}</Text>
          <Text style={styles.resultTitle}>{passed ? 'Great job!' : 'Keep practicing!'}</Text>
          <Text style={styles.resultScore}>{score} / {questions.length}</Text>
          <Text style={styles.resultPct}>{pct}% correct</Text>

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

          <TouchableOpacity style={styles.primaryBtn} onPress={restart} activeOpacity={0.8}>
            <Text style={styles.primaryBtnText}>TRY AGAIN</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Text style={styles.secondaryBtnText}>DONE</Text>
          </TouchableOpacity>
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

  function choiceStyle(i) {
    if (!checked) return i === selected ? styles.choiceSelected : styles.choice;
    if (i === q.correct_index) return styles.choiceCorrect;
    if (i === selected) return styles.choiceWrong;
    return styles.choice;
  }
  function choiceTextStyle(i) {
    if (!checked) return i === selected ? styles.choiceTextSelected : styles.choiceText;
    if (i === q.correct_index) return styles.choiceTextCorrect;
    if (i === selected) return styles.choiceTextWrong;
    return styles.choiceText;
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${progress}%` }]} />
      </View>
      <Text style={styles.counter}>Question {index + 1} of {questions.length}</Text>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.question}>{q.question}</Text>
        {q.choices.map((choice, i) => (
          <TouchableOpacity
            key={i}
            style={choiceStyle(i)}
            activeOpacity={0.8}
            disabled={checked}
            onPress={() => setSelected(i)}
          >
            <Text style={choiceTextStyle(i)}>{choice}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {checked && (
        <View style={[styles.feedback, isCorrect ? styles.feedbackGood : styles.feedbackBad]}>
          <Text style={[styles.feedbackTitle, isCorrect ? styles.feedbackTitleGood : styles.feedbackTitleBad]}>
            {isCorrect ? 'Correct!' : 'Not quite'}
          </Text>
          {q.explanation ? <Text style={styles.feedbackText}>{q.explanation}</Text> : null}
        </View>
      )}

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryBtn, selected === null && styles.btnDisabled]}
          onPress={onAction}
          disabled={selected === null}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryBtnText}>
            {!checked ? 'CHECK' : isLast ? 'FINISH' : 'CONTINUE'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  emptyText: { fontSize: 16, color: '#999' },

  progressTrack: { height: 12, backgroundColor: '#e5e5e5', borderRadius: 6, margin: 16, marginBottom: 8 },
  progressFill: { height: 12, backgroundColor: '#58cc02', borderRadius: 6 },
  counter: { fontSize: 13, color: '#999', fontWeight: '600', textAlign: 'center', marginBottom: 4 },

  body: { padding: 20 },
  question: { fontSize: 22, fontWeight: 'bold', color: '#3c3c3c', marginBottom: 24, lineHeight: 30 },

  choice: { borderWidth: 2, borderColor: '#e5e5e5', borderRadius: 14, padding: 18, marginBottom: 12, backgroundColor: '#fff' },
  choiceSelected: { borderWidth: 2, borderColor: '#1cb0f6', borderRadius: 14, padding: 18, marginBottom: 12, backgroundColor: '#eaf6ff' },
  choiceCorrect: { borderWidth: 2, borderColor: '#58a700', borderRadius: 14, padding: 18, marginBottom: 12, backgroundColor: '#d7ffb8' },
  choiceWrong: { borderWidth: 2, borderColor: '#ea2b2b', borderRadius: 14, padding: 18, marginBottom: 12, backgroundColor: '#ffdfe0' },
  choiceText: { fontSize: 16, color: '#3c3c3c' },
  choiceTextSelected: { fontSize: 16, color: '#1899d6', fontWeight: '600' },
  choiceTextCorrect: { fontSize: 16, color: '#58a700', fontWeight: '600' },
  choiceTextWrong: { fontSize: 16, color: '#ea2b2b', fontWeight: '600' },

  feedback: { paddingHorizontal: 20, paddingVertical: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  feedbackGood: { backgroundColor: '#d7ffb8' },
  feedbackBad: { backgroundColor: '#ffdfe0' },
  feedbackTitle: { fontSize: 17, fontWeight: 'bold', marginBottom: 4 },
  feedbackTitleGood: { color: '#58a700' },
  feedbackTitleBad: { color: '#ea2b2b' },
  feedbackText: { fontSize: 14, color: '#4b4b4b', lineHeight: 20 },

  footer: { padding: 16, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  primaryBtn: { backgroundColor: '#58cc02', borderBottomWidth: 4, borderBottomColor: '#58a700',
    paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold', letterSpacing: 0.5 },
  btnDisabled: { backgroundColor: '#e5e5e5', borderBottomColor: '#cfcfcf' },
  secondaryBtn: { paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 12 },
  secondaryBtnText: { color: '#afafaf', fontSize: 16, fontWeight: 'bold', letterSpacing: 0.5 },

  resultEmoji: { fontSize: 72, marginBottom: 12 },
  resultTitle: { fontSize: 26, fontWeight: 'bold', color: '#3c3c3c' },
  resultScore: { fontSize: 48, fontWeight: 'bold', color: '#58cc02', marginTop: 16 },
  resultPct: { fontSize: 16, color: '#999', marginTop: 4, marginBottom: 28 },

  xpCard: { alignSelf: 'stretch', alignItems: 'center', backgroundColor: '#fff7e6',
    borderWidth: 2, borderColor: '#ffd97a', borderRadius: 18, paddingVertical: 18, paddingHorizontal: 24, marginBottom: 32 },
  xpEarned: { fontSize: 30, fontWeight: 'bold', color: '#ff9600' },
  streakLine: { fontSize: 15, color: '#3c3c3c', fontWeight: '600', marginTop: 8 },
  goalDone: { fontSize: 14, color: '#58a700', fontWeight: '700', marginTop: 6 },
  goalProg: { fontSize: 13, color: '#999', marginTop: 6 },
  awardErr: { fontSize: 12, color: '#ea2b2b', textAlign: 'center', marginBottom: 20, paddingHorizontal: 20 },
});

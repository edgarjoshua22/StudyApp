import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiFetch } from '../lib/api';
import { palette, space, radius, type, shadow } from '../lib/theme';
import { Card, GradientButton } from './ui';

// Phase 4 — the "read the lesson" screen for AI courses. Fetches the lesson's
// cached teaching content (generated on first open), shows a tight explainer +
// key points, then launches the quiz. Reuses /lesson-quiz for the quiz itself.
export default function LessonScreen({ route, navigation }) {
  const { lesson, classroom } = route.params;   // lesson: {id, topic_id, title}; classroom: {id, name}
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState(null);  // { explanation, key_points }
  const [err, setErr] = useState(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch(`/lesson-content?lesson_id=${lesson.id}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `Server error ${res.status}`);
      setContent(data.content || null);
    } catch (e) {
      setErr(e.message || 'Could not load this lesson.');
    } finally {
      setLoading(false);
    }
  }, [lesson.id]);

  useEffect(() => { load(); }, [load]);

  // Generate (or fetch cached) the quiz for this lesson, then hand off to Quiz.
  async function startQuiz() {
    if (starting) return;
    setStarting(true);
    try {
      const res = await apiFetch(`/lesson-quiz?lesson_id=${lesson.id}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `Server error ${res.status}`);
      navigation.navigate('Quiz', {
        quiz: data,
        lesson: { id: lesson.id, topic_id: lesson.topic_id },
        classroomId: classroom?.id,
      });
    } catch (e) {
      Alert.alert('Could not start the quiz', e.message || 'Please try again in a moment.');
    } finally {
      setStarting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Ionicons name="chevron-back" size={26} color={palette.ink} onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle} numberOfLines={1}>{lesson.title || 'Lesson'}</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.primary} />
          <Text style={styles.loadingText}>Preparing your lesson…</Text>
        </View>
      ) : err ? (
        <View style={styles.center}>
          <Text style={styles.emoji}>😕</Text>
          <Text style={styles.errText}>{err}</Text>
          <GradientButton title="Try again" onPress={load} style={{ marginTop: space.lg, minWidth: 160 }} />
          <Text style={styles.skip} onPress={startQuiz}>Skip to the quiz →</Text>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: space.xl }}>
            <Text style={styles.lessonTitle}>{lesson.title}</Text>
            <Text style={styles.explanation}>{content?.explanation}</Text>

            {content?.key_points?.length ? (
              <Card style={{ marginTop: space.xl }}>
                <Text style={styles.kpHeader}>Key points</Text>
                {content.key_points.map((k, i) => (
                  <View key={i} style={[styles.kpRow, i > 0 && styles.kpDivider]}>
                    <View style={styles.kpDot}><Text style={styles.kpDotText}>{i + 1}</Text></View>
                    <Text style={styles.kpText}>{k}</Text>
                  </View>
                ))}
              </Card>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <GradientButton
              title="Start quiz"
              loading={starting}
              onPress={startQuiz}
              icon={<Ionicons name="arrow-forward" size={18} color={palette.white} />}
            />
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bgSoft },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: space.md,
  },
  headerTitle: { ...type.h3, flex: 1, textAlign: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl },
  loadingText: { ...type.caption, marginTop: space.md },
  emoji: { fontSize: 44, marginBottom: space.md },
  errText: { ...type.body, color: palette.inkSoft, textAlign: 'center' },
  skip: { ...type.label, color: palette.primary, marginTop: space.xl },
  lessonTitle: { ...type.h1, marginBottom: space.md },
  explanation: { ...type.body, lineHeight: 26, color: palette.ink },
  kpHeader: { ...type.label, marginBottom: space.sm },
  kpRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: space.md },
  kpDivider: { borderTopWidth: 1, borderTopColor: palette.lineSoft },
  kpDot: {
    width: 24, height: 24, borderRadius: 12, backgroundColor: palette.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginRight: space.md, marginTop: 1,
  },
  kpDotText: { color: palette.primaryDark, fontWeight: '800', fontSize: 12 },
  kpText: { ...type.body, flex: 1, lineHeight: 22 },
  footer: {
    padding: space.xl, borderTopWidth: 1, borderTopColor: palette.line, backgroundColor: palette.bg,
  },
});

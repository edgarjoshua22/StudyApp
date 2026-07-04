import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../lib/api';
import { palette, space, radius, type, shadow } from '../lib/theme';
import { Card, ProgressBar, SectionHeader, GradientButton } from './ui';

// How many of the weakest concepts to funnel into a "practice your gaps" quiz.
const WEAK_FOR_PRACTICE = 6;

// Phase 3 — the knowledge map: "what you know vs. where your gaps are".
// Reads concept_mastery (RLS-scoped to the signed-in user) for one classroom and
// groups concepts by topic/unit, colored by mastery. Concepts emerge from real
// practice (quiz/flashcard/recall), so this works even if no brain was ever built.

// Mastery bands. Kept in sync with the plan: gap < 0.4, learning 0.4–0.75, known > 0.75.
const band = (m) =>
  m >= 0.75 ? 'known' : m >= 0.4 ? 'learning' : 'gap';
const BAND = {
  known:    { dot: '🟢', color: palette.green,  grad: 'mint',   label: 'known' },
  learning: { dot: '🟠', color: palette.orange, grad: 'sunset', label: 'learning' },
  gap:      { dot: '🔴', color: palette.red,    grad: 'coral',  label: 'gap' },
};

export default function KnowledgeMap({ route, navigation }) {
  const classroom = route.params?.classroom;
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState([]);       // [{ id, name, order, concepts:[], avg }]
  const [summary, setSummary] = useState({ known: 0, learning: 0, gap: 0 });
  const [weakLabels, setWeakLabels] = useState([]); // weakest concept labels, for practice
  const [practicing, setPracticing] = useState(false);

  const load = useCallback(async () => {
    if (!classroom?.id) { setLoading(false); return; }
    // Both queries are RLS-scoped to the signed-in user's own rows.
    const [{ data: cm }, { data: topics }] = await Promise.all([
      supabase.from('concept_mastery')
        .select('concept_key,label,topic_id,mastery,attempts')
        .eq('classroom_id', classroom.id)
        .order('mastery', { ascending: true }),
      supabase.from('topics')
        .select('id,name,order_index')
        .eq('classroom_id', classroom.id),
    ]);

    const rows = cm || [];
    const topicById = {};
    (topics || []).forEach((t) => { topicById[t.id] = t; });

    // Group by topic; concepts with no topic fall into a "General" bucket (shown last).
    const GENERAL = '__general__';
    const byTopic = {};
    for (const r of rows) {
      const key = r.topic_id && topicById[r.topic_id] ? r.topic_id : GENERAL;
      (byTopic[key] ||= []).push(r);
    }

    const grouped = Object.entries(byTopic).map(([key, concepts]) => {
      const avg = concepts.reduce((s, c) => s + c.mastery, 0) / concepts.length;
      const t = topicById[key];
      return {
        id: key,
        name: t ? t.name : 'General',
        order: t ? (t.order_index ?? 9998) : 9999,   // General always last
        concepts,   // already weakest-first from the query order
        avg,
      };
    }).sort((a, b) => a.order - b.order);

    const s = { known: 0, learning: 0, gap: 0 };
    rows.forEach((r) => { s[band(r.mastery)] += 1; });

    // rows are weakest-first (query order) — the first few labels are the gaps.
    setWeakLabels(rows.slice(0, WEAK_FOR_PRACTICE).map((r) => r.label).filter(Boolean));
    setGroups(grouped);
    setSummary(s);
    setLoading(false);
  }, [classroom?.id]);

  // Reuse the existing quiz generator, focused on the weakest concepts. The
  // generated questions come back concept-tagged, so completing them flows
  // straight back into mastery and lifts exactly these gaps.
  async function practiceGaps() {
    if (practicing || !weakLabels.length) return;
    setPracticing(true);
    try {
      const params = new URLSearchParams({
        classroom_id: classroom.id,
        topics: weakLabels.join(', '),
        num_questions: '6',
      });
      const res = await apiFetch(`/generate-quiz?${params.toString()}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `Server error ${res.status}`);
      navigation.navigate('Quiz', { quiz: data, classroomId: classroom.id });
    } catch (e) {
      Alert.alert('Could not build a practice quiz', e.message || 'Please try again in a moment.');
    } finally {
      setPracticing(false);
    }
  }

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [load]));

  const total = summary.known + summary.learning + summary.gap;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Ionicons name="chevron-back" size={26} color={palette.ink} onPress={() => navigation.goBack()} />
        <Text style={styles.headerTitle} numberOfLines={1}>Knowledge map</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={palette.primary} /></View>
      ) : total === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🗺️</Text>
          <Text style={styles.emptyTitle}>Nothing mapped yet</Text>
          <Text style={styles.emptySub}>
            Take a lesson quiz or review flashcards for {classroom?.name || 'this subject'} and
            your strengths and gaps will show up here.
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.xl, paddingBottom: 60 }}>
          <Text style={styles.subject} numberOfLines={1}>{classroom?.name}</Text>
          <View style={styles.summaryRow}>
            <Stat n={summary.known}    label="known"    dot="🟢" />
            <Stat n={summary.learning} label="learning" dot="🟠" />
            <Stat n={summary.gap}      label="gaps"     dot="🔴" />
          </View>

          {weakLabels.length > 0 && classroom?.origin !== 'ai_course' ? (
            <GradientButton
              title="Practice your gaps"
              grad="coral"
              loading={practicing}
              onPress={practiceGaps}
              icon={<Ionicons name="barbell" size={18} color={palette.white} />}
              style={{ marginTop: space.lg }}
            />
          ) : null}

          {groups.map((g) => (
            <View key={g.id} style={{ marginTop: space.xl }}>
              <SectionHeader
                title={g.name}
                right={<Text style={styles.pct}>{Math.round(g.avg * 100)}%</Text>}
              />
              <ProgressBar progress={g.avg} grad={BAND[band(g.avg)].grad} height={10} />
              <Card style={{ marginTop: space.md, padding: space.sm }}>
                {g.concepts.map((c, i) => (
                  <View
                    key={c.concept_key}
                    style={[styles.conceptRow, i > 0 && styles.conceptDivider]}
                  >
                    <Text style={styles.conceptDot}>{BAND[band(c.mastery)].dot}</Text>
                    <Text style={styles.conceptLabel} numberOfLines={1}>{c.label}</Text>
                    <Text style={[styles.conceptPct, { color: BAND[band(c.mastery)].color }]}>
                      {Math.round(c.mastery * 100)}%
                    </Text>
                  </View>
                ))}
              </Card>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Stat({ n, label, dot }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statDot}>{dot}</Text>
      <Text style={styles.statN}>{n}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
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
  emptyEmoji: { fontSize: 48, marginBottom: space.md },
  emptyTitle: { ...type.h2, marginBottom: space.sm },
  emptySub: { ...type.body, color: palette.inkSoft, textAlign: 'center', lineHeight: 22 },
  subject: { ...type.h1, marginBottom: space.lg },
  summaryRow: { flexDirection: 'row', gap: space.md },
  stat: {
    flex: 1, backgroundColor: palette.bg, borderRadius: radius.lg,
    paddingVertical: space.lg, alignItems: 'center', ...shadow.card,
  },
  statDot: { fontSize: 18 },
  statN: { ...type.h1, marginTop: space.xs },
  statLabel: { ...type.caption },
  pct: { ...type.label, color: palette.inkSoft },
  conceptRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, paddingHorizontal: space.sm },
  conceptDivider: { borderTopWidth: 1, borderTopColor: palette.lineSoft },
  conceptDot: { fontSize: 13, marginRight: space.sm },
  conceptLabel: { ...type.body, flex: 1 },
  conceptPct: { ...type.label },
});

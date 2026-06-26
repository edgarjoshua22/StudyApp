import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { palette } from '../lib/theme';

function ymd(d) { return d.toLocaleDateString('en-CA'); }

export default function QuestsScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase
      .from('profiles')
      .select('xp,daily_xp,daily_xp_date,daily_goal,current_streak,last_active_date')
      .eq('id', user?.id).maybeSingle();
    setProfile(data || null);
    setLoading(false);
  }

  const todayStr = ymd(new Date());
  const yStr = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return ymd(d); })();
  const alive = profile?.last_active_date === todayStr || profile?.last_active_date === yStr;
  const streak = alive ? (profile?.current_streak ?? 0) : 0;
  const dailyGoal = profile?.daily_goal ?? 50;
  const dailyXp = profile?.daily_xp_date === todayStr ? (profile?.daily_xp ?? 0) : 0;

  const weekend = { have: Math.min(streak, 3), need: 3 };
  const daily = { have: Math.min(dailyXp, dailyGoal), need: dailyGoal };

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={palette.purple} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.hero, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.heroClose}
          onPress={() => navigation.goBack()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="close" size={26} color={palette.white} />
        </TouchableOpacity>
        <View style={styles.heroBody}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>Quests</Text>
            <Text style={styles.heroSub}>Complete quests to earn rewards!</Text>
          </View>
          <Text style={styles.heroMascot}>🦉</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
        <QuestCard
          tag="WEEKEND QUEST"
          timer="2d"
          banner={palette.green}
          icon="barbell"
          title="Practice 3 days in a row"
          have={weekend.have}
          need={weekend.need}
        />
        <QuestCard
          tag="DAILY QUEST"
          timer="today"
          banner={palette.blue}
          icon="flash"
          title={`Earn ${dailyGoal} XP`}
          have={daily.have}
          need={daily.need}
          reward
        />
      </ScrollView>
    </View>
  );
}

function QuestCard({ tag, timer, banner, icon, title, have, need, reward }) {
  const pct = need > 0 ? Math.min(have / need, 1) : 0;
  const done = have >= need;
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Text style={styles.cardTag}>{tag}</Text>
        <View style={styles.timerPill}>
          <Ionicons name="time-outline" size={14} color={palette.inkSoft} />
          <Text style={styles.timerText}>{timer}</Text>
        </View>
      </View>

      <View style={[styles.banner, { backgroundColor: banner }]}>
        <Ionicons name={icon} size={52} color={palette.white} />
      </View>

      <Text style={styles.cardTitle}>{title}</Text>

      <View style={styles.progressRow}>
        <View style={styles.progTrack}>
          <View style={[styles.progFill, done && { backgroundColor: palette.green }, { width: `${pct * 100}%` }]} />
          <Text style={styles.progLabel}>{have} / {need}</Text>
        </View>
        {reward && (
          <Ionicons name={done ? 'gift' : 'gift-outline'} size={30} color={done ? palette.gold : palette.hint} />
        )}
        {!reward && done && (
          <Ionicons name="checkmark-circle" size={28} color={palette.green} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bgSoft },
  center: { alignItems: 'center', justifyContent: 'center' },

  hero: { backgroundColor: palette.purple, paddingHorizontal: 20, paddingBottom: 24 },
  heroClose: { alignSelf: 'flex-start' },
  heroBody: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  heroTitle: { color: palette.white, fontSize: 30, fontWeight: '900' },
  heroSub: { color: palette.white, fontSize: 16, fontWeight: '600', marginTop: 6, opacity: 0.95, maxWidth: 220 },
  heroMascot: { fontSize: 64 },

  card: { backgroundColor: palette.bg, borderRadius: 18, padding: 16, marginBottom: 16,
    borderWidth: 2, borderColor: palette.line },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  cardTag: { fontSize: 12, fontWeight: '800', letterSpacing: 1, color: palette.inkSoft },
  timerPill: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timerText: { fontSize: 13, fontWeight: '700', color: palette.inkSoft },

  banner: { height: 120, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },

  cardTitle: { fontSize: 19, fontWeight: '800', color: palette.ink, marginBottom: 12 },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  progTrack: { flex: 1, height: 26, backgroundColor: palette.track, borderRadius: 13, overflow: 'hidden', justifyContent: 'center' },
  progFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: palette.purple, borderRadius: 13 },
  progLabel: { alignSelf: 'center', fontSize: 13, fontWeight: '800', color: palette.white },
});

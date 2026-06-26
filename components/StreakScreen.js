import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { palette } from '../lib/theme';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const GOALS = [7, 14, 30, 50, 100, 200, 365];

function ymd(d) { return d.toLocaleDateString('en-CA'); }

export default function StreakScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const today = new Date();
  const [view, setView] = useState({ year: today.getFullYear(), month: today.getMonth() });

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data } = await supabase
      .from('profiles')
      .select('current_streak,longest_streak,last_active_date')
      .eq('id', user?.id).maybeSingle();
    setProfile(data || null);
    setLoading(false);
  }

  const todayStr = ymd(today);
  const yStr = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return ymd(d); })();
  const alive = profile?.last_active_date === todayStr || profile?.last_active_date === yStr;
  const streak = alive ? (profile?.current_streak ?? 0) : 0;
  const longest = profile?.longest_streak ?? 0;

  // Days highlighted on the calendar: the `streak` consecutive days ending at
  // last_active_date (clamped to the streak count).
  const activeSet = new Set();
  if (streak > 0) {
    const anchor = profile?.last_active_date ? new Date(profile.last_active_date + 'T00:00:00') : today;
    for (let i = 0; i < streak; i++) {
      const d = new Date(anchor); d.setDate(anchor.getDate() - i);
      activeSet.add(ymd(d));
    }
  }

  const nextGoal = GOALS.find((g) => g > streak) || (streak + 1);
  const goalPct = Math.min(streak / nextGoal, 1);

  // Build the month grid
  const first = new Date(view.year, view.month, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  function shiftMonth(delta) {
    setView((v) => {
      let m = v.month + delta, y = v.year;
      if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
      return { year: y, month: m };
    });
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={palette.orange} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Orange hero */}
      <View style={[styles.hero, { paddingTop: insets.top + 8 }]}>
        <View style={styles.heroTop}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={26} color={palette.white} />
          </TouchableOpacity>
          <Text style={styles.heroBarTitle}>Streak</Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={styles.heroBody}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroNum}>{streak}</Text>
            <Text style={styles.heroLabel}>day streak!</Text>
          </View>
          <Ionicons name="flame" size={96} color={palette.white} />
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
        <View style={styles.freezeCard}>
          <Ionicons name="snow" size={28} color={palette.blue} />
          <Text style={styles.freezeText}>
            Keep it alive! Study any day to extend your streak. Your best run is{' '}
            <Text style={{ fontWeight: '800', color: palette.ink }}>{longest} days</Text>.
          </Text>
        </View>

        <Text style={styles.sectionTitle}>Streak Calendar</Text>
        <View style={styles.calCard}>
          <View style={styles.calHead}>
            <TouchableOpacity onPress={() => shiftMonth(-1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="chevron-back" size={22} color={palette.inkSoft} />
            </TouchableOpacity>
            <Text style={styles.calMonth}>{MONTHS[view.month]} {view.year}</Text>
            <TouchableOpacity onPress={() => shiftMonth(1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="chevron-forward" size={22} color={palette.inkSoft} />
            </TouchableOpacity>
          </View>
          <View style={styles.calRow}>
            {WEEKDAYS.map((w) => <Text key={w} style={styles.calWeekday}>{w}</Text>)}
          </View>
          {Array.from({ length: cells.length / 7 }).map((_, r) => (
            <View key={r} style={styles.calRow}>
              {cells.slice(r * 7, r * 7 + 7).map((d, c) => {
                if (d === null) return <View key={c} style={styles.calCell} />;
                const ds = ymd(new Date(view.year, view.month, d));
                const isToday = ds === todayStr;
                const isActive = activeSet.has(ds);
                return (
                  <View key={c} style={styles.calCell}>
                    <View style={[
                      styles.calDay,
                      isActive && styles.calDayActive,
                      isToday && styles.calDayToday,
                    ]}>
                      <Text style={[styles.calDayText, (isActive || isToday) && styles.calDayTextOn]}>{d}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Streak Goal</Text>
        <View style={styles.goalCard}>
          <View style={styles.goalRow}>
            <Ionicons name="flag" size={22} color={palette.orange} />
            <Text style={styles.goalText}>{nextGoal}-day streak</Text>
            <Text style={styles.goalCount}>{streak} / {nextGoal}</Text>
          </View>
          <View style={styles.goalTrack}>
            <View style={[styles.goalFill, { width: `${goalPct * 100}%` }]} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bgSoft },
  center: { alignItems: 'center', justifyContent: 'center' },

  hero: { backgroundColor: palette.orange, paddingHorizontal: 20, paddingBottom: 24,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroBarTitle: { color: palette.white, fontSize: 17, fontWeight: '800' },
  heroBody: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  heroNum: { color: palette.white, fontSize: 64, fontWeight: '900', lineHeight: 66 },
  heroLabel: { color: palette.white, fontSize: 26, fontWeight: '800' },

  freezeCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.bg,
    borderRadius: 16, padding: 16, marginBottom: 22 },
  freezeText: { flex: 1, color: palette.inkSoft, fontSize: 14, fontWeight: '600', lineHeight: 20 },

  sectionTitle: { fontSize: 20, fontWeight: '800', color: palette.ink, marginBottom: 12 },
  calCard: { backgroundColor: palette.bg, borderRadius: 16, padding: 14, marginBottom: 24, borderWidth: 2, borderColor: palette.line },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  calMonth: { fontSize: 16, fontWeight: '800', color: palette.ink },
  calRow: { flexDirection: 'row' },
  calWeekday: { flex: 1, textAlign: 'center', color: palette.hint, fontSize: 13, fontWeight: '700', marginBottom: 8 },
  calCell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  calDay: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  calDayActive: { backgroundColor: palette.orange },
  calDayToday: { backgroundColor: palette.gold },
  calDayText: { fontSize: 14, fontWeight: '700', color: palette.inkSoft },
  calDayTextOn: { color: palette.white },

  goalCard: { backgroundColor: palette.bg, borderRadius: 16, padding: 16, borderWidth: 2, borderColor: palette.line },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  goalText: { flex: 1, fontSize: 15, fontWeight: '800', color: palette.ink },
  goalCount: { fontSize: 14, fontWeight: '700', color: palette.inkSoft },
  goalTrack: { height: 14, backgroundColor: palette.track, borderRadius: 7, overflow: 'hidden' },
  goalFill: { height: '100%', backgroundColor: palette.orange, borderRadius: 7 },
});

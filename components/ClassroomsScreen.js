import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  Alert, ActivityIndicator, Modal, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { palette, unitColor, subjectEmoji, space, radius, type, shadow, solid } from '../lib/theme';

const SEMESTERS = ['1st Semester', '2nd Semester', 'Mid Year'];
const CURRENT_YEAR = new Date().getFullYear();
const START_YEARS = Array.from({ length: 7 }, (_, i) => CURRENT_YEAR - 1 + i);

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function greetingWord() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}
function nameFromEmail(email = '') {
  const local = (email.split('@')[0] || '').split(/[._\-+0-9]/)[0] || '';
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : 'there';
}

function Dropdown({ placeholder, value, options, onSelect }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <TouchableOpacity style={styles.input} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={value ? styles.inputText : styles.placeholderText}>{value || placeholder}</Text>
        <Ionicons name="chevron-down" size={20} color={palette.hint} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{placeholder}</Text>
            <ScrollView>
              {options.map((opt) => (
                <TouchableOpacity key={opt.value} style={styles.option}
                  onPress={() => { onSelect(opt.value); setOpen(false); }}>
                  <Text style={styles.optionText}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function StatChip({ icon, value, label }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipIcon}>{icon}</Text>
      <View>
        <Text style={styles.chipValue}>{value}</Text>
        <Text style={styles.chipLabel}>{label}</Text>
      </View>
    </View>
  );
}

export default function ClassroomsScreen({ navigation, session }) {
  const [name, setName] = useState('');
  const [semester, setSemester] = useState('');
  const [startYear, setStartYear] = useState(null);
  const [classrooms, setClassrooms] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useFocusEffect(useCallback(() => { fetchClassrooms(); fetchProfile(); }, []));

  async function fetchClassrooms() {
    const { data, error } = await supabase
      .from('classrooms').select('*').order('created_at', { ascending: false });
    if (error) Alert.alert('Could not load classrooms', error.message);
    else setClassrooms(data);
  }

  async function fetchProfile() {
    const { data } = await supabase
      .from('profiles')
      .select('xp,daily_xp,daily_xp_date,daily_goal,current_streak')
      .eq('id', session.user.id).maybeSingle();
    setProfile(data || null);
  }

  async function addClassroom() {
    if (!name.trim() || !semester || !startYear) {
      Alert.alert('Missing info', 'Please enter a subject, semester, and academic year.');
      return;
    }
    const fullSemester = `${semester}, AY ${startYear}-${startYear + 1}`;
    setLoading(true);
    const { error } = await supabase.from('classrooms').insert({
      name: name.trim(), semester: fullSemester, user_id: session.user.id,
    });
    if (error) Alert.alert('Could not save', error.message);
    else { setName(''); setSemester(''); setStartYear(null); setShowForm(false); fetchClassrooms(); }
    setLoading(false);
  }

  const streak = profile?.current_streak || 0;
  const xp = profile?.xp || 0;
  const goal = profile?.daily_goal || 0;
  const todayXp = profile?.daily_xp_date === localToday() ? (profile?.daily_xp || 0) : 0;

  const Hero = (
    <View style={styles.hero}>
      <Text style={styles.heroMascot}>🧠</Text>
      <Text style={styles.heroOverline}>{greetingWord().toUpperCase()}</Text>
      <Text style={styles.heroName}>{nameFromEmail(session.user.email)} 👋</Text>
      <Text style={styles.heroSub}>Ready to build your brain today?</Text>
      <View style={styles.chipRow}>
        <StatChip icon="🔥" value={streak} label={streak === 1 ? 'day streak' : 'day streak'} />
        <StatChip icon="⚡" value={xp} label="total XP" />
        <StatChip icon="🎯" value={goal ? `${todayXp}/${goal}` : todayXp} label="today" />
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <FlatList
        data={classrooms}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: space.xl, paddingBottom: 140 }}
        ListHeaderComponent={
          <View>
            {Hero}
            {showForm ? (
              <View style={styles.form}>
                <Text style={styles.formTitle}>New subject</Text>
                <TextInput style={[styles.input, styles.inputText]}
                  placeholder="Subject name (e.g. Calculus)" placeholderTextColor={palette.hint}
                  value={name} onChangeText={setName} />
                <Dropdown placeholder="Select semester" value={semester}
                  options={SEMESTERS.map((s) => ({ label: s, value: s }))} onSelect={setSemester} />
                <Dropdown placeholder="Select academic year"
                  value={startYear ? `AY ${startYear}-${startYear + 1}` : ''}
                  options={START_YEARS.map((y) => ({ label: `${y}-${y + 1}`, value: y }))}
                  onSelect={setStartYear} />
                {loading ? <ActivityIndicator style={{ marginVertical: 12 }} color={palette.green} /> : (
                  <TouchableOpacity style={styles.saveButton} onPress={addClassroom} activeOpacity={0.85}>
                    <Text style={styles.saveButtonText}>SAVE SUBJECT</Text>
                  </TouchableOpacity>
                )}
              </View>
            ) : null}
            {classrooms.length > 0 ? (
              <Text style={styles.sectionLabel}>
                YOUR SUBJECTS · {classrooms.length}
              </Text>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📚</Text>
            <Text style={styles.emptyText}>No subjects yet</Text>
            <Text style={styles.emptySub}>Tap the + button to add your first one and start a learning path!</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const c = unitColor(index);
          return (
            <TouchableOpacity style={styles.card} activeOpacity={0.85}
              onPress={() => navigation.navigate('ClassroomDetail', { classroom: item })}>
              <View style={[styles.cardIcon, solid(c.main, c.dark, radius.md)]}>
                <Text style={styles.cardEmoji}>{subjectEmoji(item.name)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.cardSemester} numberOfLines={1}>{item.semester}</Text>
              </View>
              <View style={[styles.cardArrow, { backgroundColor: c.soft }]}>
                <Ionicons name="chevron-forward" size={20} color={c.dark} />
              </View>
            </TouchableOpacity>
          );
        }}
      />
      <TouchableOpacity style={styles.fab} onPress={() => setShowForm((v) => !v)} activeOpacity={0.85}>
        <Ionicons name={showForm ? 'close' : 'add'} size={32} color={palette.white} />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bgSoft },

  // Hero
  hero: {
    backgroundColor: palette.green, borderRadius: radius.xl, padding: space.xl,
    borderBottomWidth: 5, borderBottomColor: palette.greenDark, marginBottom: space.xl,
    overflow: 'hidden',
  },
  heroMascot: { position: 'absolute', right: 14, top: 6, fontSize: 64, opacity: 0.28 },
  heroOverline: { color: '#eaffd6', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  heroName: { color: palette.white, fontSize: 26, fontWeight: '800', marginTop: 2 },
  heroSub: { color: '#eaffd6', fontSize: 14, fontWeight: '600', marginTop: 4, marginBottom: space.lg },
  chipRow: { flexDirection: 'row', gap: space.sm },
  chip: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: radius.md,
    paddingVertical: 10, paddingHorizontal: 10,
  },
  chipIcon: { fontSize: 20 },
  chipValue: { color: palette.white, fontSize: 16, fontWeight: '800' },
  chipLabel: { color: '#eaffd6', fontSize: 10, fontWeight: '700' },

  // Add form
  form: { marginBottom: space.lg, backgroundColor: palette.bg, borderRadius: radius.lg, padding: space.lg, ...shadow.card },
  formTitle: { ...type.h3, marginBottom: space.md },
  input: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 2, borderColor: palette.line, borderRadius: radius.md,
    paddingHorizontal: space.lg, marginBottom: space.md, minHeight: 56, backgroundColor: palette.bg,
  },
  inputText: { fontSize: 16, color: palette.ink, flex: 1 },
  placeholderText: { fontSize: 16, color: palette.hint, flex: 1 },
  saveButton: { ...solid(palette.green, palette.greenDark, radius.md), paddingVertical: 16, marginTop: space.xs },
  saveButtonText: { color: palette.white, fontSize: 16, fontWeight: '800', textAlign: 'center', letterSpacing: 0.5 },

  // Section label
  sectionLabel: { ...type.tiny, color: palette.inkSoft, letterSpacing: 1, marginBottom: space.md, marginLeft: space.xs },

  // Classroom card
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: palette.bg,
    borderRadius: radius.lg, padding: space.md, marginBottom: space.md, ...shadow.card,
  },
  cardIcon: { width: 56, height: 56, justifyContent: 'center', alignItems: 'center', marginRight: space.md },
  cardEmoji: { fontSize: 28 },
  cardName: { fontSize: 18, fontWeight: '800', color: palette.ink },
  cardSemester: { fontSize: 13, color: palette.inkSoft, marginTop: 3, fontWeight: '600' },
  cardArrow: { width: 34, height: 34, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center', marginLeft: space.sm },

  // Empty
  empty: { alignItems: 'center', marginTop: 40, paddingHorizontal: 30 },
  emptyEmoji: { fontSize: 56, marginBottom: space.lg },
  emptyText: { fontSize: 20, fontWeight: '800', color: palette.ink },
  emptySub: { fontSize: 15, color: palette.inkSoft, textAlign: 'center', marginTop: space.sm, lineHeight: 22 },

  // FAB
  fab: {
    position: 'absolute', right: 24, bottom: 24, width: 64, height: 64, borderRadius: 32,
    backgroundColor: palette.green, borderBottomWidth: 4, borderBottomColor: palette.greenDark,
    justifyContent: 'center', alignItems: 'center', ...shadow.lift,
  },

  // Dropdown sheet
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: { width: '100%', maxHeight: '60%', backgroundColor: palette.bg, borderRadius: radius.lg, paddingVertical: space.sm },
  sheetTitle: { fontSize: 13, fontWeight: '700', color: palette.inkSoft, paddingHorizontal: 18, paddingVertical: 10 },
  option: { paddingVertical: 16, paddingHorizontal: 18, borderTopWidth: 1, borderTopColor: palette.lineSoft },
  optionText: { fontSize: 17, color: palette.ink },
});

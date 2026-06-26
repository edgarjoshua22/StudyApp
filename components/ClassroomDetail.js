import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { supabase } from '../lib/supabase';
import { API_BASE } from '../lib/api';
import HandoutsList from './HandoutsList';
import Prerequisites from './Prerequisites';
import { syncExamReminders, clearExamReminders } from '../lib/reminders';
import { palette, unitColors, subjectEmoji, space, radius, type, shadow, solid } from '../lib/theme';

const QUESTION_OPTIONS = [5, 8, 10, 15];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Stable accent color per classroom (so its hub matches its Home card vibe).
function hashIndex(str = '', n = 1) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % n;
}

// Manual date formatting (avoids relying on Intl options under Hermes)
function formatExamDate(iso) {
  if (!iso) return 'No date set';
  const d = new Date(iso);
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()} · ${h}:${m} ${ampm}`;
}

function countdownText(iso) {
  if (!iso) return '';
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (days < 0) return ' · past';
  if (days === 0) return ' · today';
  if (days === 1) return ' · tomorrow';
  return ` · in ${days} days`;
}

function nextHour() {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

export default function ClassroomDetail({ route, navigation }) {
  const { classroom } = route.params;
  const accent = unitColors[hashIndex(classroom.id, unitColors.length)];
  const [quiz, setQuiz] = useState(null);          // the single MANUAL quiz, or null
  const [generating, setGenerating] = useState(false);
  const [opening, setOpening] = useState(false);

  // Coverage picker state (quiz)
  const [pickerOpen, setPickerOpen] = useState(false);
  const [handouts, setHandouts] = useState([]);
  const [selected, setSelected] = useState({});    // { [documentId]: true }
  const [topics, setTopics] = useState('');
  const [numQ, setNumQ] = useState(8);

  // Exams state
  const [exams, setExams] = useState([]);
  const [coverageCounts, setCoverageCounts] = useState({}); // { [examId]: count }
  const [examModalOpen, setExamModalOpen] = useState(false);
  const [editingExam, setEditingExam] = useState(null);     // exam row when editing, else null
  const [examName, setExamName] = useState('');
  const [examDate, setExamDate] = useState(null);           // Date object or null
  const [pickerMode, setPickerMode] = useState(null);       // 'date' | 'time' | null
  const [tempDate, setTempDate] = useState(new Date());
  const [examHandouts, setExamHandouts] = useState([]);     // [{id,file_name,exam_id}]
  const [examSelected, setExamSelected] = useState({});     // { [documentId]: true }
  const [savingExam, setSavingExam] = useState(false);

  useFocusEffect(useCallback(() => {
    navigation.setOptions({ title: classroom.name });
    fetchQuiz();
    fetchExams();
  }, []));

  async function fetchQuiz() {
    const { data } = await supabase
      .from('quizzes').select('*')
      .eq('classroom_id', classroom.id)
      .eq('origin', 'manual')
      .order('created_at', { ascending: false })
      .limit(1);
    setQuiz((data && data[0]) || null);
  }

  // ----- Exams -----

  async function fetchExams() {
    const { data: exData } = await supabase
      .from('exams').select('*')
      .eq('classroom_id', classroom.id)
      .order('exam_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    setExams(exData || []);

    const { data: docRows } = await supabase
      .from('documents').select('exam_id')
      .eq('classroom_id', classroom.id);
    const counts = {};
    (docRows || []).forEach((r) => { if (r.exam_id) counts[r.exam_id] = (counts[r.exam_id] || 0) + 1; });
    setCoverageCounts(counts);
  }

  // Load every handout in the classroom; pre-check those already on this exam
  async function loadCoverage(examId) {
    const { data } = await supabase
      .from('documents').select('id,file_name,exam_id')
      .eq('classroom_id', classroom.id)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    const rows = data || [];
    setExamHandouts(rows);
    const pre = {};
    rows.forEach((h) => { if (examId && h.exam_id === examId) pre[h.id] = true; });
    setExamSelected(pre);
  }

  async function openAddExam() {
    setEditingExam(null);
    setExamName('');
    setExamDate(null);
    await loadCoverage(null);
    setExamModalOpen(true);
  }

  async function openEditExam(ex) {
    setEditingExam(ex);
    setExamName(ex.name);
    setExamDate(ex.exam_date ? new Date(ex.exam_date) : null);
    await loadCoverage(ex.id);
    setExamModalOpen(true);
  }

  function toggleExamDoc(id) {
    setExamSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  // Native picker: pick date, then chain to time
  function openDatePicker() {
    setTempDate(examDate || nextHour());
    setPickerMode('date');
  }

  function onPickerChange(event, selectedVal) {
    if (event.type === 'dismissed' || !selectedVal) {
      setPickerMode(null);
      return;
    }
    if (pickerMode === 'date') {
      const d = new Date(tempDate);
      d.setFullYear(selectedVal.getFullYear(), selectedVal.getMonth(), selectedVal.getDate());
      setTempDate(d);
      setPickerMode('time');           // chain straight to time selection
    } else {
      const d = new Date(tempDate);
      d.setHours(selectedVal.getHours(), selectedVal.getMinutes(), 0, 0);
      setExamDate(d);
      setPickerMode(null);
    }
  }

  async function saveExam() {
    const name = examName.trim();
    if (!name) { Alert.alert('Name required', 'Give your exam a name.'); return; }
    setSavingExam(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('You are not logged in.');

      const payload = {
        classroom_id: classroom.id,
        user_id: user.id,
        name,
        exam_date: examDate ? examDate.toISOString() : null,
      };

      let examId;
      if (editingExam) {
        const { error } = await supabase.from('exams').update(payload).eq('id', editingExam.id);
        if (error) throw new Error(error.message);
        examId = editingExam.id;
      } else {
        const { data, error } = await supabase.from('exams').insert(payload).select().single();
        if (error) throw new Error(error.message);
        examId = data.id;
      }

      // Apply coverage: checked -> this exam; unchecked-but-was-this-exam -> NULL
      const checkedIds = examHandouts.filter((h) => examSelected[h.id]).map((h) => h.id);
      const unassignIds = examHandouts
        .filter((h) => !examSelected[h.id] && h.exam_id === examId)
        .map((h) => h.id);

      if (checkedIds.length) {
        const { error } = await supabase.from('documents')
          .update({ exam_id: examId }).in('id', checkedIds);
        if (error) throw new Error(error.message);
      }
      if (unassignIds.length) {
        const { error } = await supabase.from('documents')
          .update({ exam_id: null }).in('id', unassignIds);
        if (error) throw new Error(error.message);
      }

      setExamModalOpen(false);
      await fetchExams();

      // Step 4: schedule the device reminder (+ calendar drop on dev builds).
      const savedExam = { id: examId, name, exam_date: examDate ? examDate.toISOString() : null };
      if (savedExam.exam_date) {
        const r = await syncExamReminders(savedExam);
        let msg = '';
        if (r.notif.scheduled) {
          msg = `Reminder set for ${formatExamDate(r.notif.when.toISOString())}.`;
        } else if (r.notif.reason === 'permission_denied') {
          msg = 'Saved — but notifications are off. Turn them on in Settings to get exam reminders.';
        } else if (r.notif.reason === 'in_past') {
          msg = 'Saved. No reminder set because that date has already passed.';
        }
        if (r.cal.added) msg += ' Added to your device calendar.';
        if (msg) Alert.alert('Exam saved', msg);
      } else {
        // Date cleared on edit -> remove any reminder that was set before.
        await clearExamReminders(examId);
      }
    } catch (e) {
      Alert.alert('Could not save exam', e.message || 'Something went wrong.');
    } finally {
      setSavingExam(false);
    }
  }

  function confirmDeleteExam(ex) {
    Alert.alert(
      'Delete exam?',
      `"${ex.name}" will be removed. Its handouts stay — they just become unassigned.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteExam(ex) },
      ]
    );
  }

  async function deleteExam(ex) {
    const { error } = await supabase.from('exams').delete().eq('id', ex.id);
    if (error) { Alert.alert('Could not delete', error.message); return; }
    await clearExamReminders(ex.id);
    setExamModalOpen(false);
    await fetchExams();
  }

  // ----- Quiz generate flow -----

  function onGeneratePress() {
    if (quiz) {
      Alert.alert(
        'You already have a quiz',
        'Retake your current quiz, or generate a new one? Generating a new quiz deletes the current one.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Retake', onPress: () => openQuiz(quiz) },
          { text: 'Generate new', style: 'destructive', onPress: openPicker },
        ]
      );
    } else {
      openPicker();
    }
  }

  async function openPicker() {
    const { data } = await supabase
      .from('documents').select('id,file_name,status')
      .eq('classroom_id', classroom.id)
      .eq('status', 'ready')
      .order('created_at', { ascending: true });
    setHandouts(data || []);
    setSelected({});
    setTopics('');
    setNumQ(8);
    setPickerOpen(true);
  }

  function toggleDoc(id) {
    setSelected((s) => ({ ...s, [id]: !s[id] }));
  }

  async function runGenerate() {
    setGenerating(true);
    try {
      const ids = Object.keys(selected).filter((k) => selected[k]);
      const params = new URLSearchParams({
        classroom_id: classroom.id,
        num_questions: String(numQ),
      });
      if (ids.length) params.append('document_ids', ids.join(','));
      if (topics.trim()) params.append('topics', topics.trim());

      const res = await fetch(`${API_BASE}/generate-quiz?${params.toString()}`, { method: 'POST' });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error(`Server error ${res.status}: ${text.slice(0, 140) || 'no response body'}`); }
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
      if (data.error) throw new Error(data.error);

      setPickerOpen(false);
      await fetchQuiz();
      navigation.navigate('Quiz', { quiz: data });
    } catch (e) {
      Alert.alert(
        'Could not make a quiz',
        e.message || "Make sure Docker is running and lib/api.js has your PC's current IPv4."
      );
    } finally {
      setGenerating(false);
    }
  }

  async function openQuiz(q) {
    setOpening(true);
    try {
      const { data, error } = await supabase
        .from('quiz_questions').select('*')
        .eq('quiz_id', q.id)
        .order('position');
      if (error) throw error;
      navigation.navigate('Quiz', {
        quiz: { quiz_id: q.id, title: q.title, questions: data },
      });
    } catch (e) {
      Alert.alert('Could not open quiz', e.message);
    } finally {
      setOpening(false);
    }
  }

  // ----- Classroom delete -----

  function confirmDelete() {
    Alert.alert(
      'Delete classroom?',
      `"${classroom.name}" will be removed. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteClassroom },
      ]
    );
  }

  async function deleteClassroom() {
    const { error } = await supabase.from('classrooms').delete().eq('id', classroom.id);
    if (error) Alert.alert('Could not delete', error.message);
    else navigation.goBack();
  }

  // Map exam id -> name, for the "in: X" coverage tag
  const examNameById = {};
  exams.forEach((e) => { examNameById[e.id] = e.name; });

  const nextExam = exams.find((e) => e.exam_date && new Date(e.exam_date).getTime() > Date.now());

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: space.xl, paddingBottom: 48 }}>
      {/* ---------- Subject hero ---------- */}
      <View style={[styles.hero, solid(accent.main, accent.dark, radius.xl)]}>
        <Text style={styles.heroEmoji}>{subjectEmoji(classroom.name)}</Text>
        <Text style={styles.heroName}>{classroom.name}</Text>
        <Text style={styles.heroSem}>{classroom.semester}</Text>
        {nextExam ? (
          <View style={styles.heroPill}>
            <Text style={styles.heroPillText}>
              ⏰ {nextExam.name}{countdownText(nextExam.exam_date)}
            </Text>
          </View>
        ) : null}
      </View>

      {/* ---------- Learning Path — the star CTA ---------- */}
      <TouchableOpacity
        style={[styles.pathBtn, solid(palette.green, palette.greenDark, radius.lg)]}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('LessonPath', { classroom })}
      >
        <Text style={styles.pathEmoji}>🗺️</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.pathBtnText}>Learning Path</Text>
          <Text style={styles.pathBtnSub}>Your daily study route</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color={palette.white} />
      </TouchableOpacity>

      {/* ---------- Exams ---------- */}
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionDot, { backgroundColor: palette.blueSoft }]}>
          <Ionicons name="calendar" size={18} color={palette.blueDark} />
        </View>
        <Text style={styles.sectionTitle}>Exams</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={[styles.smallAdd, solid(palette.blue, palette.blueDark, radius.pill)]}
          onPress={openAddExam} activeOpacity={0.85}
        >
          <Ionicons name="add" size={24} color={palette.white} />
        </TouchableOpacity>
      </View>

      {exams.length === 0 ? (
        <Text style={styles.emptyLine}>No exams yet. Add one to shape your study schedule. 📅</Text>
      ) : exams.map((ex) => {
        const n = coverageCounts[ex.id] || 0;
        return (
          <TouchableOpacity key={ex.id} style={styles.rowCard} activeOpacity={0.85} onPress={() => openEditExam(ex)}>
            <View style={[styles.rowIcon, { backgroundColor: palette.blueSoft }]}>
              <Ionicons name="calendar" size={20} color={palette.blueDark} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>{ex.name}</Text>
              <Text style={styles.rowMeta} numberOfLines={1}>
                {formatExamDate(ex.exam_date)}{countdownText(ex.exam_date)} · {n} handout{n === 1 ? '' : 's'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={palette.hint} />
          </TouchableOpacity>
        );
      })}

      <View style={{ height: space.xxl }} />

      <HandoutsList classroomId={classroom.id} />

      <Prerequisites classroom={classroom} />

      {/* ---------- Quiz ---------- */}
      <View style={[styles.sectionHeader, { marginTop: space.sm }]}>
        <View style={[styles.sectionDot, { backgroundColor: palette.purpleSoft }]}>
          <Ionicons name="help-circle" size={18} color={palette.purpleDark} />
        </View>
        <Text style={styles.sectionTitle}>Practice quiz</Text>
      </View>

      <TouchableOpacity
        style={[styles.generateBtn, solid(palette.purple, palette.purpleDark, radius.lg), generating && styles.dim]}
        onPress={onGeneratePress}
        disabled={generating}
        activeOpacity={0.85}
      >
        {generating ? (
          <ActivityIndicator color={palette.white} />
        ) : (
          <>
            <Ionicons name="sparkles" size={20} color={palette.white} />
            <Text style={styles.generateBtnText}>
              {quiz ? 'Generate a new quiz' : 'Generate a quiz'}
            </Text>
          </>
        )}
      </TouchableOpacity>

      {!quiz ? (
        <Text style={styles.emptyLine}>
          No quiz yet. Tap “Generate a quiz,” choose what it should cover, and you’re set. ✨
        </Text>
      ) : (
        <TouchableOpacity style={styles.rowCard} activeOpacity={0.85} onPress={() => openQuiz(quiz)} disabled={opening}>
          <View style={[styles.rowIcon, { backgroundColor: palette.purpleSoft }]}>
            <Text style={{ fontSize: 20 }}>📝</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle} numberOfLines={1}>{quiz.title}</Text>
            <Text style={styles.rowMeta}>Tap to retake · {new Date(quiz.created_at).toLocaleDateString()}</Text>
          </View>
          {opening
            ? <ActivityIndicator color={palette.purple} />
            : <Ionicons name="chevron-forward" size={20} color={palette.hint} />}
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.deleteButton} onPress={confirmDelete} activeOpacity={0.7}>
        <Ionicons name="trash-outline" size={18} color={palette.red} />
        <Text style={styles.deleteButtonText}>Delete classroom</Text>
      </TouchableOpacity>

      {/* ---------- Exam add/edit sheet ---------- */}
      <Modal visible={examModalOpen} transparent animationType="slide" onRequestClose={() => setExamModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{editingExam ? 'Edit exam' : 'Add exam'}</Text>

            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              style={styles.nameInput}
              placeholder="e.g. Midterm, Final, Quiz 2"
              placeholderTextColor={palette.hint}
              value={examName}
              onChangeText={setExamName}
            />

            <Text style={[styles.fieldLabel, { marginTop: space.lg }]}>Date & time (optional)</Text>
            <Text style={styles.fieldHint}>Leave empty for a normal path; set it to schedule study toward the exam.</Text>
            <View style={styles.dateBtn}>
              <TouchableOpacity style={styles.dateBtnMain} onPress={openDatePicker} activeOpacity={0.7}>
                <Ionicons name="calendar-outline" size={20} color={palette.blue} />
                <Text style={styles.dateBtnText}>
                  {examDate ? formatExamDate(examDate.toISOString()) : 'Set date & time'}
                </Text>
              </TouchableOpacity>
              {examDate ? (
                <TouchableOpacity onPress={() => setExamDate(null)}><Text style={styles.clearDate}>CLEAR</Text></TouchableOpacity>
              ) : null}
            </View>

            <Text style={[styles.fieldLabel, { marginTop: space.lg }]}>Covered handouts</Text>
            <Text style={styles.fieldHint}>Which handouts does this exam include?</Text>
            <ScrollView style={styles.handoutBox}>
              {examHandouts.length === 0 ? (
                <Text style={styles.emptyHandouts}>No handouts in this classroom yet.</Text>
              ) : examHandouts.map((h) => {
                const on = !!examSelected[h.id];
                const otherExam = h.exam_id && h.exam_id !== (editingExam && editingExam.id)
                  ? examNameById[h.exam_id] : null;
                return (
                  <TouchableOpacity key={h.id} style={styles.checkRow} onPress={() => toggleExamDoc(h.id)} activeOpacity={0.7}>
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? palette.blue : palette.hint} />
                    <Text style={styles.checkLabel} numberOfLines={1}>
                      {(h.file_name || 'Handout').replace(/\.pdf$/i, '')}
                    </Text>
                    {otherExam ? <Text style={styles.coverNote} numberOfLines={1}>in: {otherExam}</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              style={[styles.examConfirm, solid(palette.blue, palette.blueDark, radius.lg), savingExam && styles.dim]}
              onPress={saveExam}
              disabled={savingExam}
              activeOpacity={0.85}
            >
              {savingExam
                ? <ActivityIndicator color={palette.white} />
                : <Text style={styles.genConfirmText}>{editingExam ? 'SAVE CHANGES' : 'CREATE EXAM'}</Text>}
            </TouchableOpacity>

            {editingExam ? (
              <TouchableOpacity style={styles.deleteExamBtn} onPress={() => confirmDeleteExam(editingExam)} disabled={savingExam}>
                <Text style={styles.deleteExamText}>Delete exam</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity style={styles.cancelBtn} onPress={() => setExamModalOpen(false)} disabled={savingExam}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>

            {pickerMode && (
              <DateTimePicker
                value={tempDate}
                mode={pickerMode}
                is24Hour={false}
                onChange={onPickerChange}
              />
            )}
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ---------- Quiz coverage picker ---------- */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalWrap}
        >
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>What should this quiz cover?</Text>

            <Text style={styles.fieldLabel}>Handouts</Text>
            <Text style={styles.fieldHint}>Leave all unchecked to cover the whole classroom.</Text>
            <ScrollView style={styles.handoutBox}>
              {handouts.length === 0 ? (
                <Text style={styles.emptyHandouts}>No processed handouts yet.</Text>
              ) : handouts.map((h) => {
                const on = !!selected[h.id];
                return (
                  <TouchableOpacity key={h.id} style={styles.checkRow} onPress={() => toggleDoc(h.id)} activeOpacity={0.7}>
                    <Ionicons
                      name={on ? 'checkbox' : 'square-outline'}
                      size={24}
                      color={on ? palette.purple : palette.hint}
                    />
                    <Text style={styles.checkLabel} numberOfLines={1}>
                      {(h.file_name || 'Handout').replace(/\.pdf$/i, '')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Text style={styles.fieldLabel}>Topics (optional)</Text>
            <TextInput
              style={styles.topicInput}
              placeholder="e.g. Newton's laws, friction, momentum"
              placeholderTextColor={palette.hint}
              value={topics}
              onChangeText={setTopics}
              multiline
            />

            <Text style={styles.fieldLabel}>Questions</Text>
            <View style={styles.chipRow}>
              {QUESTION_OPTIONS.map((n) => (
                <TouchableOpacity
                  key={n}
                  style={[styles.chip, numQ === n && styles.chipOn]}
                  onPress={() => setNumQ(n)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.chipText, numQ === n && styles.chipTextOn]}>{n}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.genConfirm, solid(palette.purple, palette.purpleDark, radius.lg), generating && styles.dim]}
              onPress={runGenerate}
              disabled={generating}
              activeOpacity={0.85}
            >
              {generating
                ? <ActivityIndicator color={palette.white} />
                : <Text style={styles.genConfirmText}>GENERATE</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setPickerOpen(false)} disabled={generating}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bgSoft },

  // Hero
  hero: { alignItems: 'center', padding: space.xxl, marginBottom: space.xl },
  heroEmoji: { fontSize: 52, marginBottom: space.sm },
  heroName: { fontSize: 24, fontWeight: '800', color: palette.white, textAlign: 'center' },
  heroSem: { fontSize: 14, color: 'rgba(255,255,255,0.85)', marginTop: 4, textAlign: 'center', fontWeight: '600' },
  heroPill: { marginTop: space.md, backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: radius.pill, paddingVertical: 7, paddingHorizontal: 14 },
  heroPillText: { color: palette.white, fontSize: 13, fontWeight: '800' },

  // Path CTA
  pathBtn: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, marginBottom: space.xxl, ...shadow.card },
  pathEmoji: { fontSize: 30 },
  pathBtnText: { color: palette.white, fontSize: 18, fontWeight: '800' },
  pathBtnSub: { color: 'rgba(255,255,255,0.9)', fontSize: 13, fontWeight: '600', marginTop: 1 },

  // Sections
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  sectionDot: { width: 34, height: 34, borderRadius: radius.sm, justifyContent: 'center', alignItems: 'center' },
  sectionTitle: { fontSize: 19, fontWeight: '800', color: palette.ink },
  smallAdd: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center', borderBottomWidth: 3 },

  emptyLine: { fontSize: 14, color: palette.inkSoft, textAlign: 'center', paddingVertical: space.md, lineHeight: 20, fontWeight: '600' },

  // Generic row card (exam / quiz)
  rowCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.bg, borderRadius: radius.lg, padding: space.md, marginBottom: space.md, ...shadow.card },
  rowIcon: { width: 44, height: 44, borderRadius: radius.md, justifyContent: 'center', alignItems: 'center', marginRight: space.md },
  rowTitle: { fontSize: 16, fontWeight: '800', color: palette.ink },
  rowMeta: { fontSize: 12, color: palette.inkSoft, marginTop: 3, fontWeight: '600' },

  generateBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.sm, paddingVertical: 16, marginBottom: space.md, minHeight: 56 },
  generateBtnText: { color: palette.white, fontSize: 15, fontWeight: '800' },
  dim: { opacity: 0.7 },

  deleteButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: space.sm, paddingVertical: 16, marginTop: space.xxl },
  deleteButtonText: { color: palette.red, fontSize: 15, fontWeight: '800' },

  // Shared sheet
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: palette.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, paddingBottom: space.xxl, maxHeight: '88%' },
  sheetHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: palette.line, alignSelf: 'center', marginBottom: space.md },
  sheetTitle: { fontSize: 20, fontWeight: '800', color: palette.ink, marginBottom: space.lg },

  fieldLabel: { fontSize: 14, fontWeight: '800', color: palette.ink, marginTop: space.sm },
  fieldHint: { fontSize: 12, color: palette.inkSoft, marginBottom: space.sm },

  nameInput: { borderWidth: 2, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: palette.ink, marginTop: 6 },
  dateBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: palette.line, borderRadius: radius.md, paddingHorizontal: 14, marginTop: 6 },
  dateBtnMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 13 },
  dateBtnText: { fontSize: 15, color: palette.ink, fontWeight: '600' },
  clearDate: { color: palette.red, fontWeight: '800', fontSize: 13, paddingLeft: 10 },
  coverNote: { fontSize: 11, color: palette.orangeDark, fontWeight: '700', marginLeft: 6, maxWidth: 110 },
  examConfirm: { paddingVertical: 16, alignItems: 'center', marginTop: space.lg },
  deleteExamBtn: { paddingVertical: 14, alignItems: 'center', marginTop: 2 },
  deleteExamText: { color: palette.red, fontWeight: '800', fontSize: 14 },

  handoutBox: { maxHeight: 180, borderWidth: 2, borderColor: palette.lineSoft, borderRadius: radius.md, paddingHorizontal: 6, marginBottom: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 10, paddingHorizontal: 6 },
  checkLabel: { fontSize: 15, color: palette.ink, flex: 1 },
  emptyHandouts: { fontSize: 13, color: palette.inkSoft, padding: 12 },

  topicInput: { borderWidth: 2, borderColor: palette.line, borderRadius: radius.md, padding: 12, fontSize: 15, minHeight: 48, marginBottom: 6, textAlignVertical: 'top', color: palette.ink },

  chipRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm, marginBottom: space.xl },
  chip: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: radius.md, borderWidth: 2, borderColor: palette.line },
  chipOn: { borderColor: palette.purple, backgroundColor: palette.purpleSoft },
  chipText: { fontSize: 15, fontWeight: '800', color: palette.inkSoft },
  chipTextOn: { color: palette.purpleDark },

  genConfirm: { paddingVertical: 16, alignItems: 'center' },
  genConfirmText: { color: palette.white, fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  cancelBtn: { paddingVertical: 14, alignItems: 'center' },
  cancelText: { color: palette.hint, fontSize: 15, fontWeight: '800' },
});

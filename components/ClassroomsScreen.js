import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  Alert, ActivityIndicator, Modal, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

const SEMESTERS = ['1st Semester', '2nd Semester', 'Mid Year'];
const CURRENT_YEAR = new Date().getFullYear();
const START_YEARS = Array.from({ length: 7 }, (_, i) => CURRENT_YEAR - 1 + i);
const COLORS = ['#58cc02', '#1cb0f6', '#ff9600', '#ce82ff', '#ff4b4b'];

function Dropdown({ placeholder, value, options, onSelect }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <TouchableOpacity style={styles.input} onPress={() => setOpen(true)}>
        <Text style={value ? styles.inputText : styles.placeholderText}>{value || placeholder}</Text>
        <Ionicons name="chevron-down" size={20} color="#aaa" />
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

export default function ClassroomsScreen({ navigation, session }) {
  const [name, setName] = useState('');
  const [semester, setSemester] = useState('');
  const [startYear, setStartYear] = useState(null);
  const [classrooms, setClassrooms] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useFocusEffect(useCallback(() => { fetchClassrooms(); }, []));

  async function fetchClassrooms() {
    const { data, error } = await supabase
      .from('classrooms').select('*').order('created_at', { ascending: false });
    if (error) Alert.alert('Could not load classrooms', error.message);
    else setClassrooms(data);
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

  return (
    <View style={styles.container}>
      <FlatList
        data={classrooms}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 20, paddingBottom: 140 }}
        ListHeaderComponent={
          showForm ? (
            <View style={styles.form}>
              <TextInput style={[styles.input, styles.inputText]}
                placeholder="Subject name (e.g. Calculus)" placeholderTextColor="#aaa"
                value={name} onChangeText={setName} />
              <Dropdown placeholder="Select semester" value={semester}
                options={SEMESTERS.map((s) => ({ label: s, value: s }))} onSelect={setSemester} />
              <Dropdown placeholder="Select academic year"
                value={startYear ? `AY ${startYear}-${startYear + 1}` : ''}
                options={START_YEARS.map((y) => ({ label: `${y}-${y + 1}`, value: y }))}
                onSelect={setStartYear} />
              {loading ? <ActivityIndicator style={{ marginVertical: 12 }} /> : (
                <TouchableOpacity style={styles.saveButton} onPress={addClassroom}>
                  <Text style={styles.saveButtonText}>SAVE CLASSROOM</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📚</Text>
            <Text style={styles.emptyText}>No classrooms yet</Text>
            <Text style={styles.emptySub}>Tap the + button to add your first subject!</Text>
          </View>
        }
        renderItem={({ item, index }) => (
          <TouchableOpacity style={styles.card} activeOpacity={0.7}
            onPress={() => navigation.navigate('ClassroomDetail', { classroom: item })}>
            <View style={[styles.cardIcon, { backgroundColor: COLORS[index % COLORS.length] }]}>
              <Text style={styles.cardEmoji}>📘</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardName}>{item.name}</Text>
              <Text style={styles.cardSemester}>{item.semester}</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color="#ccc" />
          </TouchableOpacity>
        )}
      />
      <TouchableOpacity style={styles.fab} onPress={() => setShowForm((v) => !v)} activeOpacity={0.8}>
        <Ionicons name={showForm ? 'close' : 'add'} size={32} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  form: { marginBottom: 16 },
  input: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 2, borderColor: '#e5e5e5', borderRadius: 14, paddingHorizontal: 16, marginBottom: 12, minHeight: 56 },
  inputText: { fontSize: 16, color: '#3c3c3c', flex: 1 },
  placeholderText: { fontSize: 16, color: '#aaa', flex: 1 },
  saveButton: { backgroundColor: '#58cc02', borderBottomWidth: 4, borderBottomColor: '#58a700',
    paddingVertical: 16, borderRadius: 14, marginTop: 4 },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold', textAlign: 'center', letterSpacing: 0.5 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16,
    padding: 14, marginBottom: 12, borderWidth: 2, borderColor: '#e5e5e5' },
  cardIcon: { width: 52, height: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  cardEmoji: { fontSize: 26 },
  cardName: { fontSize: 18, fontWeight: 'bold', color: '#3c3c3c' },
  cardSemester: { fontSize: 13, color: '#999', marginTop: 3 },
  empty: { alignItems: 'center', marginTop: 80, paddingHorizontal: 30 },
  emptyEmoji: { fontSize: 56, marginBottom: 16 },
  emptyText: { fontSize: 20, fontWeight: 'bold', color: '#3c3c3c' },
  emptySub: { fontSize: 15, color: '#999', textAlign: 'center', marginTop: 8 },
  fab: { position: 'absolute', right: 24, bottom: 24, width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#58cc02', borderBottomWidth: 4, borderBottomColor: '#58a700',
    justifyContent: 'center', alignItems: 'center', elevation: 6 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: { width: '100%', maxHeight: '60%', backgroundColor: '#fff', borderRadius: 16, paddingVertical: 8 },
  sheetTitle: { fontSize: 13, fontWeight: '600', color: '#999', paddingHorizontal: 18, paddingVertical: 10 },
  option: { paddingVertical: 16, paddingHorizontal: 18, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  optionText: { fontSize: 17, color: '#3c3c3c' },
});
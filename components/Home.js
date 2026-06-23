import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, FlatList, StyleSheet, Alert,
  ActivityIndicator, Modal, ScrollView,
} from 'react-native';
import { supabase } from '../lib/supabase';

const SEMESTERS = ['1st Semester', '2nd Semester', 'Mid Year'];

// Build the academic-year start options: last year through 5 years ahead
const CURRENT_YEAR = new Date().getFullYear();
const START_YEARS = Array.from({ length: 7 }, (_, i) => CURRENT_YEAR - 1 + i);

// A reusable dropdown built from a Modal — no extra packages needed
function Dropdown({ placeholder, value, options, onSelect }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <TouchableOpacity style={styles.input} onPress={() => setOpen(true)}>
        <Text style={value ? styles.inputText : styles.placeholderText}>
          {value || placeholder}
        </Text>
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{placeholder}</Text>
            <ScrollView>
              {options.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={styles.option}
                  onPress={() => { onSelect(opt.value); setOpen(false); }}
                >
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

export default function Home({ session }) {
  const [name, setName] = useState('');
  const [semester, setSemester] = useState('');
  const [startYear, setStartYear] = useState(null);
  const [classrooms, setClassrooms] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { fetchClassrooms(); }, []);

  async function fetchClassrooms() {
    const { data, error } = await supabase
      .from('classrooms')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) Alert.alert('Could not load classrooms', error.message);
    else setClassrooms(data);
  }

  async function addClassroom() {
    if (!name.trim() || !semester || !startYear) {
      Alert.alert('Missing info', 'Please enter a subject, semester, and academic year.');
      return;
    }
    const academicYear = `${startYear}-${startYear + 1}`;
    const fullSemester = `${semester}, AY ${academicYear}`;

    setLoading(true);
    const { error } = await supabase.from('classrooms').insert({
      name: name.trim(),
      semester: fullSemester,
      user_id: session.user.id,
    });
    if (error) {
      Alert.alert('Could not save', error.message);
    } else {
      setName('');
      setSemester('');
      setStartYear(null);
      fetchClassrooms();
    }
    setLoading(false);
  }

  // react-native's TextInput is still used for the subject name
  const TextInput = require('react-native').TextInput;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Classrooms</Text>
        <TouchableOpacity onPress={() => supabase.auth.signOut()}>
          <Text style={styles.signOut}>Sign Out</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.form}>
        <TextInput
          style={[styles.input, styles.inputText]}
          placeholder="Subject name (e.g. Calculus)"
          placeholderTextColor="#aaa"
          value={name}
          onChangeText={setName}
        />

        <Dropdown
          placeholder="Select semester"
          value={semester}
          options={SEMESTERS.map((s) => ({ label: s, value: s }))}
          onSelect={setSemester}
        />

        <Dropdown
          placeholder="Select academic year"
          value={startYear ? `AY ${startYear}-${startYear + 1}` : ''}
          options={START_YEARS.map((y) => ({ label: `${y}-${y + 1}`, value: y }))}
          onSelect={setStartYear}
        />

        {loading ? (
          <ActivityIndicator style={{ marginVertical: 12 }} />
        ) : (
          <TouchableOpacity style={styles.button} onPress={addClassroom}>
            <Text style={styles.buttonText}>+ Add Classroom</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={classrooms}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.empty}>No classrooms yet. Add your first one above!</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardName}>{item.name}</Text>
            <Text style={styles.cardSemester}>{item.semester}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60, paddingHorizontal: 20, backgroundColor: '#fff' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#1cb0f6' },
  signOut: { color: '#ff4b4b', fontWeight: '600' },
  form: { marginBottom: 20 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingHorizontal: 14, marginBottom: 10, justifyContent: 'center', minHeight: 52 },
  inputText: { fontSize: 16, color: '#333' },
  placeholderText: { fontSize: 16, color: '#aaa' },
  button: { backgroundColor: '#1cb0f6', padding: 16, borderRadius: 10, marginTop: 4 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: 'bold', textAlign: 'center' },
  empty: { textAlign: 'center', color: '#999', marginTop: 40, fontSize: 16 },
  card: { backgroundColor: '#f7f9fc', borderRadius: 12, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  cardName: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  cardSemester: { fontSize: 14, color: '#777', marginTop: 4 },

  // --- the dropdown panel styles that were missing ---
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  sheet: {
    width: '100%',
    maxHeight: '60%',
    backgroundColor: '#fff',
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 8,
  },
  sheetTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#999',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  option: {
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  optionText: { fontSize: 17, color: '#333' },
});
import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { API_BASE } from '../lib/api';
import HandoutsList from './HandoutsList';
import Prerequisites from './Prerequisites';

export default function ClassroomDetail({ route, navigation }) {
  const { classroom } = route.params;
  const [quizzes, setQuizzes] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [openingId, setOpeningId] = useState(null);

  useFocusEffect(useCallback(() => {
    navigation.setOptions({ title: classroom.name });
    fetchQuizzes();
  }, []));

  async function fetchQuizzes() {
    const { data } = await supabase
      .from('quizzes').select('*')
      .eq('classroom_id', classroom.id)
      .order('created_at', { ascending: false });
    setQuizzes(data || []);
  }

  async function generateQuiz() {
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/generate-quiz?classroom_id=${classroom.id}`, { method: 'POST' });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        // Non-JSON response = the server crashed or we hit the wrong address
        throw new Error(`Server error ${res.status}: ${text.slice(0, 140) || 'no response body'}`);
      }
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
      if (data.error) throw new Error(data.error);
      await fetchQuizzes();
      navigation.navigate('Quiz', { quiz: data });
    } catch (e) {
      Alert.alert(
        'Could not make a quiz',
        e.message || "Make sure the backend (Docker) is running and lib/api.js has your PC's current IPv4."
      );
    } finally {
      setGenerating(false);
    }
  }

  async function openQuiz(quiz) {
    setOpeningId(quiz.id);
    try {
      const { data, error } = await supabase
        .from('quiz_questions').select('*')
        .eq('quiz_id', quiz.id)
        .order('position');
      if (error) throw error;
      navigation.navigate('Quiz', {
        quiz: { quiz_id: quiz.id, title: quiz.title, questions: data },
      });
    } catch (e) {
      Alert.alert('Could not open quiz', e.message);
    } finally {
      setOpeningId(null);
    }
  }

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

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      <View style={styles.banner}>
        <Text style={styles.bannerEmoji}>📘</Text>
        <Text style={styles.name}>{classroom.name}</Text>
        <Text style={styles.semester}>{classroom.semester}</Text>
      </View>

      <HandoutsList classroomId={classroom.id} />

      <Prerequisites classroom={classroom} />

      <View style={styles.sectionHeader}>
        <Ionicons name="help-circle" size={22} color="#ce82ff" />
        <Text style={styles.sectionTitle}>Quizzes</Text>
      </View>

      <TouchableOpacity
        style={[styles.generateBtn, generating && styles.generateBtnDisabled]}
        onPress={generateQuiz}
        disabled={generating}
        activeOpacity={0.8}
      >
        {generating ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="sparkles" size={20} color="#fff" />
            <Text style={styles.generateBtnText}>Generate a quiz from your handouts</Text>
          </>
        )}
      </TouchableOpacity>

      {quizzes.length === 0 ? (
        <Text style={styles.noQuiz}>
          No quizzes yet. Upload a handout above, then tap “Generate a quiz.”
        </Text>
      ) : (
        quizzes.map((quiz) => (
          <TouchableOpacity
            key={quiz.id}
            style={styles.quizCard}
            activeOpacity={0.7}
            onPress={() => openQuiz(quiz)}
            disabled={openingId === quiz.id}
          >
            <View style={styles.quizIcon}><Text style={{ fontSize: 20 }}>📝</Text></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.quizTitle} numberOfLines={1}>{quiz.title}</Text>
              <Text style={styles.quizDate}>{new Date(quiz.created_at).toLocaleDateString()}</Text>
            </View>
            {openingId === quiz.id
              ? <ActivityIndicator color="#ce82ff" />
              : <Ionicons name="chevron-forward" size={22} color="#ccc" />}
          </TouchableOpacity>
        ))
      )}

      <TouchableOpacity style={styles.deleteButton} onPress={confirmDelete} activeOpacity={0.8}>
        <Ionicons name="trash-outline" size={20} color="#fff" />
        <Text style={styles.deleteButtonText}>DELETE CLASSROOM</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  banner: { backgroundColor: '#f7f9fc', borderRadius: 20, padding: 28, alignItems: 'center', marginBottom: 24 },
  bannerEmoji: { fontSize: 56, marginBottom: 10 },
  name: { fontSize: 24, fontWeight: 'bold', color: '#3c3c3c', textAlign: 'center' },
  semester: { fontSize: 15, color: '#999', marginTop: 6, textAlign: 'center' },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#3c3c3c' },

  generateBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
    backgroundColor: '#ce82ff', borderBottomWidth: 4, borderBottomColor: '#a568cc',
    paddingVertical: 16, borderRadius: 14, marginBottom: 16, minHeight: 56 },
  generateBtnDisabled: { opacity: 0.7 },
  generateBtnText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },

  noQuiz: { fontSize: 14, color: '#999', textAlign: 'center', paddingHorizontal: 20, marginBottom: 8, lineHeight: 20 },

  quizCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 16,
    padding: 14, marginBottom: 12, borderWidth: 2, borderColor: '#e5e5e5' },
  quizIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#f7eaff',
    justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  quizTitle: { fontSize: 16, fontWeight: 'bold', color: '#3c3c3c' },
  quizDate: { fontSize: 12, color: '#999', marginTop: 3 },

  deleteButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
    backgroundColor: '#ff4b4b', borderBottomWidth: 4, borderBottomColor: '#d63a3a',
    paddingVertical: 16, borderRadius: 14, marginTop: 24 },
  deleteButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold', letterSpacing: 0.5 },
});

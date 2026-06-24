import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import UploadHandout from './UploadHandout';

export default function ClassroomDetail({ route, navigation }) {
  const { classroom } = route.params;

  useEffect(() => { navigation.setOptions({ title: classroom.name }); }, []);

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
    <View style={styles.container}>
      <View style={styles.banner}>
        <Text style={styles.bannerEmoji}>📘</Text>
        <Text style={styles.name}>{classroom.name}</Text>
        <Text style={styles.semester}>{classroom.semester}</Text>
        <UploadHandout classroomId={classroom.id} />
      </View>

      <View style={styles.comingSoon}>
        <Ionicons name="construct-outline" size={48} color="#1cb0f6" />
        <Text style={styles.comingSoonTitle}>Lessons coming soon!</Text>
        <Text style={styles.comingSoonSub}>
          Soon you'll upload your handouts here and get AI-powered lessons, quizzes, and daily tasks.
        </Text>
      </View>

      <TouchableOpacity style={styles.deleteButton} onPress={confirmDelete} activeOpacity={0.8}>
        <Ionicons name="trash-outline" size={20} color="#fff" />
        <Text style={styles.deleteButtonText}>DELETE CLASSROOM</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', padding: 20 },
  banner: { backgroundColor: '#f7f9fc', borderRadius: 20, padding: 28, alignItems: 'center', marginBottom: 24 },
  bannerEmoji: { fontSize: 56, marginBottom: 10 },
  name: { fontSize: 24, fontWeight: 'bold', color: '#3c3c3c', textAlign: 'center' },
  semester: { fontSize: 15, color: '#999', marginTop: 6, textAlign: 'center' },
  comingSoon: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  comingSoonTitle: { fontSize: 20, fontWeight: 'bold', color: '#3c3c3c', marginTop: 16 },
  comingSoonSub: { fontSize: 15, color: '#999', textAlign: 'center', marginTop: 10, lineHeight: 22 },
  deleteButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8,
    backgroundColor: '#ff4b4b', borderBottomWidth: 4, borderBottomColor: '#d63a3a',
    paddingVertical: 16, borderRadius: 14 },
  deleteButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold', letterSpacing: 0.5 },
});
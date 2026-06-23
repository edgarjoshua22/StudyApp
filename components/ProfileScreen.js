import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';

export default function ProfileScreen({ session }) {
  const [count, setCount] = useState(0);
  const email = session.user.email;

  useFocusEffect(useCallback(() => {
    supabase.from('classrooms').select('id', { count: 'exact', head: true })
      .then(({ count }) => setCount(count || 0));
  }, []));

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Text style={styles.title}>Profile</Text>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{email[0].toUpperCase()}</Text>
      </View>
      <Text style={styles.email}>{email}</Text>

      <View style={styles.statCard}>
        <Text style={styles.statNumber}>{count}</Text>
        <Text style={styles.statLabel}>Classrooms</Text>
      </View>

      <View style={{ flex: 1 }} />

      <TouchableOpacity style={styles.signOutButton} onPress={() => supabase.auth.signOut()} activeOpacity={0.8}>
        <Ionicons name="log-out-outline" size={20} color="#fff" />
        <Text style={styles.signOutText}>SIGN OUT</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingHorizontal: 20, alignItems: 'center' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#58cc02', alignSelf: 'flex-start', marginTop: 12, marginBottom: 24 },
  avatar: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#58cc02', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  avatarText: { fontSize: 40, fontWeight: 'bold', color: '#fff' },
  email: { fontSize: 17, color: '#3c3c3c', fontWeight: '600', marginBottom: 28 },
  statCard: { width: '100%', backgroundColor: '#f7f9fc', borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 2, borderColor: '#e5e5e5' },
  statNumber: { fontSize: 40, fontWeight: 'bold', color: '#1cb0f6' },
  statLabel: { fontSize: 14, color: '#999', marginTop: 4, fontWeight: '600' },
  signOutButton: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, width: '100%',
    backgroundColor: '#ff4b4b', borderBottomWidth: 4, borderBottomColor: '#d63a3a', paddingVertical: 16, borderRadius: 14, marginBottom: 20 },
  signOutText: { color: '#fff', fontSize: 16, fontWeight: 'bold', letterSpacing: 0.5 },
});
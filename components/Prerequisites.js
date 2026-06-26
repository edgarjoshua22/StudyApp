import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { API_BASE } from '../lib/api';
import { palette } from '../lib/theme';

export default function Prerequisites({ classroom }) {
  const [allClassrooms, setAllClassrooms] = useState([]);
  const [prereqs, setPrereqs] = useState([]);   // rows: { id, prereq_classroom_id }
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useFocusEffect(useCallback(() => { fetchData(); }, []));

  async function fetchData() {
    const [cls, pre] = await Promise.all([
      supabase.from('classrooms').select('id,name').order('created_at', { ascending: true }),
      supabase.from('classroom_prerequisites').select('id,prereq_classroom_id').eq('classroom_id', classroom.id),
    ]);
    setAllClassrooms(cls.data || []);
    setPrereqs(pre.data || []);
  }

  const nameById = {};
  allClassrooms.forEach((c) => { nameById[c.id] = c.name; });
  const prereqIds = new Set(prereqs.map((p) => p.prereq_classroom_id));
  const candidates = allClassrooms.filter((c) => c.id !== classroom.id && !prereqIds.has(c.id));

  async function reconnect() {
    try { await fetch(`${API_BASE}/connect-brain?classroom_id=${classroom.id}`, { method: 'POST' }); } catch (_) {}
  }

  async function addPrereq(prereqClassroomId) {
    setPickerOpen(false);
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('classroom_prerequisites').insert({
        user_id: user.id, classroom_id: classroom.id, prereq_classroom_id: prereqClassroomId,
      });
      if (error) throw error;
      await fetchData();
      await reconnect();
    } catch (e) {
      Alert.alert('Could not add prerequisite', e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removePrereq(row) {
    setBusy(true);
    try {
      await supabase.from('classroom_prerequisites').delete().eq('id', row.id);
      await fetchData();
      await reconnect();
    } catch (e) {
      Alert.alert('Could not remove', e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ marginBottom: 24 }}>
      <View style={styles.headerRow}>
        <Ionicons name="git-branch" size={20} color="#ff9600" />
        <Text style={styles.title}>Prerequisites</Text>
        <View style={{ flex: 1 }} />
        {busy ? (
          <ActivityIndicator color="#ff9600" size="small" />
        ) : (
          <TouchableOpacity
            style={[styles.addBtn, candidates.length === 0 && styles.addBtnDisabled]}
            onPress={() => setPickerOpen(true)} disabled={candidates.length === 0} activeOpacity={0.8}
          >
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {prereqs.length === 0 ? (
        <Text style={styles.empty}>
          None set. Add subjects taken before this one so the whole brain links them.
        </Text>
      ) : (
        <View style={styles.chipWrap}>
          {prereqs.map((p) => (
            <View key={p.id} style={styles.chip}>
              <Text style={styles.chipText}>{nameById[p.prereq_classroom_id] || 'Unknown'}</Text>
              <TouchableOpacity onPress={() => removePrereq(p)} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
                <Ionicons name="close-circle" size={18} color="#ff9600" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Which subject comes before “{classroom.name}”?</Text>
            <ScrollView>
              {candidates.length === 0 ? (
                <Text style={styles.noneText}>No other classrooms available.</Text>
              ) : candidates.map((c) => (
                <TouchableOpacity key={c.id} style={styles.option} onPress={() => addPrereq(c.id)}>
                  <Ionicons name="book-outline" size={20} color="#ff9600" />
                  <Text style={styles.optionText}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  title: { fontSize: 18, fontWeight: 'bold', color: palette.ink },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.orange,
    borderBottomWidth: 3, borderBottomColor: palette.orangeDark, justifyContent: 'center', alignItems: 'center' },
  addBtnDisabled: { opacity: 0.4 },
  empty: { fontSize: 14, color: palette.inkSoft, lineHeight: 20 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: palette.orangeSoft,
    borderWidth: 2, borderColor: palette.orangeDark, borderRadius: 18, paddingLeft: 14, paddingRight: 10, paddingVertical: 8 },
  chipText: { fontSize: 14, fontWeight: '600', color: palette.orange },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: { width: '100%', maxHeight: '60%', backgroundColor: palette.bg, borderRadius: 16, paddingVertical: 8 },
  sheetTitle: { fontSize: 14, fontWeight: '600', color: palette.inkSoft, paddingHorizontal: 18, paddingVertical: 12 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 15, paddingHorizontal: 18,
    borderTopWidth: 1, borderTopColor: palette.lineSoft },
  optionText: { fontSize: 16, color: palette.ink, fontWeight: '500' },
  noneText: { padding: 20, textAlign: 'center', color: palette.inkSoft },
});

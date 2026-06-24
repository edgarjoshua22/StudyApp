import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  Modal, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { API_BASE } from '../lib/api';

const AI_MODEL = 'Gemini'; // we'll set the exact model in Phase 2

export default function ChatScreen({ session }) {
  const [classrooms, setClassrooms] = useState([]);
  const [selected, setSelected] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const listRef = useRef(null);

  useFocusEffect(useCallback(() => {
    supabase.from('classrooms').select('*').order('created_at', { ascending: false })
      .then(({ data }) => {
        setClassrooms(data || []);
        if (data && data.length && !selected) setSelected(data[0]);
      });
  }, []));

  async function send() {
  if (!input.trim() || !selected || loading) return;

  const question = input.trim();
  const userMsg = { id: Date.now().toString(), role: 'user', text: question };
  const thinkingId = (Date.now() + 1).toString();
  const thinkingMsg = { id: thinkingId, role: 'ai', text: 'Thinking…' };

  // Show the question + a placeholder reply immediately
  setMessages((prev) => [...prev, userMsg, thinkingMsg]);
  setInput('');
  setLoading(true);
  setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

  try {
    // Call your backend's /ask endpoint (question + classroom go as query params)
    const url = `${API_BASE}/ask?question=${encodeURIComponent(question)}&classroom_id=${encodeURIComponent(selected.id)}`;
    const response = await fetch(url, { method: 'POST' });
    const data = await response.json();
    const answer = data.answer || 'Sorry, I could not find an answer.';

    // Replace the "Thinking…" bubble with the real answer
    setMessages((prev) =>
      prev.map((m) => (m.id === thinkingId ? { ...m, text: answer } : m))
    );
  } catch (e) {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === thinkingId
          ? { ...m, text: '⚠️ Could not reach the tutor. Make sure the backend (Docker) is running.' }
          : m
      )
    );
  } finally {
    setLoading(false);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }
}

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header: classroom selector + model badge */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.classPicker} onPress={() => setPickerOpen(true)} activeOpacity={0.7}>
          <Ionicons name="book" size={18} color="#1cb0f6" />
          <Text style={styles.classPickerText} numberOfLines={1}>
            {selected ? selected.name : 'No classroom'}
          </Text>
          <Ionicons name="chevron-down" size={18} color="#1cb0f6" />
        </TouchableOpacity>
        <View style={styles.modelBadge}>
          <Ionicons name="sparkles" size={13} color="#8b5cf6" />
          <Text style={styles.modelText}>{AI_MODEL}</Text>
        </View>
      </View>

      {/* Messages */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>💬</Text>
            <Text style={styles.emptyText}>Ask anything about your class</Text>
            <Text style={styles.emptySub}>
              {selected
                ? `You're asking in "${selected.name}". Tap the name above to switch.`
                : 'Add a classroom first, then come back to ask questions.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={[styles.bubbleRow, item.role === 'user' ? styles.rowRight : styles.rowLeft]}>
            <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.aiBubble]}>
              <Text style={item.role === 'user' ? styles.userText : styles.aiText}>{item.text}</Text>
            </View>
          </View>
        )}
      />

      {/* Input bar */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inputBar}>
          <TextInput
            style={styles.textInput}
            placeholder={selected ? 'Type your question…' : 'Add a classroom first'}
            placeholderTextColor="#aaa"
            value={input}
            onChangeText={setInput}
            editable={!!selected}
            multiline
          />
          <TouchableOpacity style={[styles.sendButton, !input.trim() && styles.sendDisabled]} onPress={send}>
            <Ionicons name="arrow-up" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Classroom picker modal */}
      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setPickerOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Ask in which classroom?</Text>
            <ScrollView>
              {classrooms.length === 0 ? (
                <Text style={styles.noClass}>No classrooms yet. Add one from the Home tab.</Text>
              ) : (
                classrooms.map((c) => (
                  <TouchableOpacity key={c.id} style={styles.option}
                    onPress={() => { setSelected(c); setPickerOpen(false); }}>
                    <Ionicons name="book-outline" size={20} color="#1cb0f6" />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.optionName}>{c.name}</Text>
                      <Text style={styles.optionSem}>{c.semester}</Text>
                    </View>
                    {selected?.id === c.id && <Ionicons name="checkmark-circle" size={22} color="#58cc02" />}
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  classPicker: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#eaf6ff',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, flexShrink: 1, maxWidth: '65%' },
  classPickerText: { fontSize: 15, fontWeight: 'bold', color: '#1cb0f6', flexShrink: 1 },
  modelBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f3eaff',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16 },
  modelText: { fontSize: 13, fontWeight: 'bold', color: '#8b5cf6' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  emptyEmoji: { fontSize: 52, marginBottom: 14 },
  emptyText: { fontSize: 19, fontWeight: 'bold', color: '#3c3c3c' },
  emptySub: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 8, lineHeight: 20 },
  bubbleRow: { marginBottom: 10, flexDirection: 'row' },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '80%', padding: 12, borderRadius: 18 },
  userBubble: { backgroundColor: '#1cb0f6', borderBottomRightRadius: 4 },
  aiBubble: { backgroundColor: '#f0f0f0', borderBottomLeftRadius: 4 },
  userText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  aiText: { color: '#3c3c3c', fontSize: 15, lineHeight: 21 },
  inputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: 12, gap: 8,
    borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  textInput: { flex: 1, backgroundColor: '#f7f7f7', borderRadius: 22, paddingHorizontal: 16,
    paddingTop: 12, paddingBottom: 12, fontSize: 15, maxHeight: 120, color: '#3c3c3c' },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#58cc02',
    justifyContent: 'center', alignItems: 'center' },
  sendDisabled: { backgroundColor: '#c0e8a0' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: { width: '100%', maxHeight: '60%', backgroundColor: '#fff', borderRadius: 16, paddingVertical: 8 },
  sheetTitle: { fontSize: 13, fontWeight: '600', color: '#999', paddingHorizontal: 18, paddingVertical: 10 },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 18,
    borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  optionName: { fontSize: 16, fontWeight: '600', color: '#3c3c3c' },
  optionSem: { fontSize: 12, color: '#999', marginTop: 2 },
  noClass: { padding: 20, textAlign: 'center', color: '#999', fontSize: 15 },
});
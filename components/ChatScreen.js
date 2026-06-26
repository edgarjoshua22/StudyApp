import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet,
  Modal, ScrollView, KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { API_BASE } from '../lib/api';
import { palette, space, radius, shadow } from '../lib/theme';

const AI_MODEL = 'Gemini'; // fallback label until a real answer comes back

// Rotating placeholder while the tutor works (implies the web step on longer waits).
const STAGES = ['Thinking…', 'Searching the web…', 'Putting it together…'];

// 'gemini-3-flash' -> 'Gemini 3 Flash'
function prettyModel(id) {
  if (!id) return AI_MODEL;
  return id
    .split('-')
    .map((p) => (/^\d/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

export default function ChatScreen({ session }) {
  const [classrooms, setClassrooms] = useState([]);
  const [selected, setSelected] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastModel, setLastModel] = useState(null);
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
    const history = messages
      .filter((m) => m.text && !STAGES.includes(m.text) && !m.text.startsWith('⚠️'))
      .slice(-8)
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'ai', text: m.text }));
    const userMsg = { id: Date.now().toString(), role: 'user', text: question };
    const thinkingId = (Date.now() + 1).toString();
    const thinkingMsg = { id: thinkingId, role: 'ai', text: STAGES[0] };

    // Show the question + a placeholder reply immediately
    setMessages((prev) => [...prev, userMsg, thinkingMsg]);
    setInput('');
    setLoading(true);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);

    // Staged placeholder: Thinking… -> Searching the web… -> Putting it together…
    let stageIdx = 0;
    const stageTimer = setInterval(() => {
      stageIdx = Math.min(stageIdx + 1, STAGES.length - 1);
      setMessages((prev) => prev.map((m) => (m.id === thinkingId ? { ...m, text: STAGES[stageIdx] } : m)));
    }, 1400);

    try {
      // /ask: question + classroom in the URL, recent history in the body.
      const url = `${API_BASE}/ask?question=${encodeURIComponent(question)}&classroom_id=${encodeURIComponent(selected.id)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history }),
      });
      const data = await response.json();
      const answer = data.answer || 'Sorry, I could not find an answer.';
      if (data.model) setLastModel(data.model);

      // Replace the "Thinking…" bubble with the real answer (+ any web sources)
      setMessages((prev) =>
        prev.map((m) => (m.id === thinkingId
          ? { ...m, text: answer, web: Array.isArray(data.web_sources) ? data.web_sources : [] }
          : m))
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
      clearInterval(stageTimer);
      setLoading(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header: classroom selector + model badge */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.classPicker} onPress={() => setPickerOpen(true)} activeOpacity={0.7}>
          <Ionicons name="book" size={18} color={palette.blueDark} />
          <Text style={styles.classPickerText} numberOfLines={1}>
            {selected ? selected.name : 'No classroom'}
          </Text>
          <Ionicons name="chevron-down" size={18} color={palette.blueDark} />
        </TouchableOpacity>
        <View style={styles.modelBadge}>
          <Ionicons name="sparkles" size={13} color={palette.purpleDark} />
          <Text style={styles.modelText}>{lastModel ? prettyModel(lastModel) : AI_MODEL}</Text>
        </View>
      </View>

      {/* Messages */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: space.lg, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>🧠</Text>
            <Text style={styles.emptyText}>Ask your study buddy anything</Text>
            <Text style={styles.emptySub}>
              {selected
                ? `Starts with your "${selected.name}" handouts, then fills the gaps with wider knowledge and the web. Tap the name above to switch.`
                : 'Add a classroom first, then come back to ask questions.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          item.role === 'user' ? (
            <View style={[styles.bubbleRow, styles.rowRight]}>
              <View style={[styles.bubble, styles.userBubble]}>
                <Text style={styles.userText}>{item.text}</Text>
              </View>
            </View>
          ) : (
            <View style={[styles.bubbleRow, styles.rowLeft]}>
              <View style={styles.aiAvatar}><Text style={styles.aiAvatarText}>🧠</Text></View>
              <View style={[styles.bubble, styles.aiBubble]}>
                <Text style={styles.aiText}>{item.text}</Text>
                {item.web && item.web.length ? (
                  <View style={styles.sources}>
                    <Text style={styles.sourcesLabel}>🌐 From the web</Text>
                    {item.web.slice(0, 3).map((s, i) => (
                      <TouchableOpacity key={i} onPress={() => Linking.openURL(s.url)} activeOpacity={0.7}>
                        <Text style={styles.sourceLink} numberOfLines={1}>• {s.title}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}
              </View>
            </View>
          )
        )}
      />

      {/* Input bar */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inputBar}>
          <TextInput
            style={styles.textInput}
            placeholder={selected ? 'Type your question…' : 'Add a classroom first'}
            placeholderTextColor={palette.hint}
            value={input}
            onChangeText={setInput}
            editable={!!selected}
            multiline
          />
          <TouchableOpacity style={[styles.sendButton, !input.trim() && styles.sendDisabled]} onPress={send}>
            <Ionicons name="arrow-up" size={22} color={palette.white} />
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
                    <Ionicons name="book-outline" size={20} color={palette.blueDark} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.optionName}>{c.name}</Text>
                      <Text style={styles.optionSem}>{c.semester}</Text>
                    </View>
                    {selected?.id === c.id && <Ionicons name="checkmark-circle" size={22} color={palette.green} />}
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
  container: { flex: 1, backgroundColor: palette.bgSoft },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 1, borderBottomColor: palette.lineSoft, backgroundColor: palette.bg },
  classPicker: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.blueSoft,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill, flexShrink: 1, maxWidth: '65%' },
  classPickerText: { fontSize: 15, fontWeight: '800', color: palette.blueDark, flexShrink: 1 },
  modelBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: palette.purpleSoft,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  modelText: { fontSize: 13, fontWeight: '800', color: palette.purpleDark },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  emptyEmoji: { fontSize: 56, marginBottom: space.md },
  emptyText: { fontSize: 19, fontWeight: '800', color: palette.ink },
  emptySub: { fontSize: 14, color: palette.inkSoft, textAlign: 'center', marginTop: space.sm, lineHeight: 20, fontWeight: '500' },

  bubbleRow: { marginBottom: space.md, flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  rowRight: { justifyContent: 'flex-end' },
  rowLeft: { justifyContent: 'flex-start' },
  aiAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: palette.purpleSoft, justifyContent: 'center', alignItems: 'center' },
  aiAvatarText: { fontSize: 16 },
  bubble: { maxWidth: '78%', paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.lg },
  userBubble: { backgroundColor: palette.blue, borderBottomRightRadius: 4 },
  aiBubble: { backgroundColor: palette.bg, borderBottomLeftRadius: 4, ...shadow.card },
  userText: { color: palette.white, fontSize: 15, lineHeight: 21, fontWeight: '500' },
  aiText: { color: palette.ink, fontSize: 15, lineHeight: 21, fontWeight: '500' },
  sources: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: palette.lineSoft, gap: 3 },
  sourcesLabel: { fontSize: 11, fontWeight: '800', color: palette.inkSoft, letterSpacing: 0.4, marginBottom: 2 },
  sourceLink: { fontSize: 12, fontWeight: '600', color: palette.blue },

  inputBar: { flexDirection: 'row', alignItems: 'flex-end', padding: space.md, gap: space.sm,
    borderTopWidth: 1, borderTopColor: palette.lineSoft, backgroundColor: palette.bg },
  textInput: { flex: 1, backgroundColor: palette.bgSoft, borderRadius: radius.xl, paddingHorizontal: 16,
    paddingTop: 12, paddingBottom: 12, fontSize: 15, maxHeight: 120, color: palette.ink },
  sendButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: palette.green,
    borderBottomWidth: 3, borderBottomColor: palette.greenDark, justifyContent: 'center', alignItems: 'center' },
  sendDisabled: { backgroundColor: '#c0e8a0', borderBottomColor: '#a9d98a' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  sheet: { width: '100%', maxHeight: '60%', backgroundColor: palette.bg, borderRadius: radius.lg, paddingVertical: space.sm },
  sheetTitle: { fontSize: 13, fontWeight: '700', color: palette.inkSoft, paddingHorizontal: 18, paddingVertical: 10 },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 18,
    borderTopWidth: 1, borderTopColor: palette.lineSoft },
  optionName: { fontSize: 16, fontWeight: '700', color: palette.ink },
  optionSem: { fontSize: 12, color: palette.inkSoft, marginTop: 2 },
  noClass: { padding: 20, textAlign: 'center', color: palette.inkSoft, fontSize: 15 },
});

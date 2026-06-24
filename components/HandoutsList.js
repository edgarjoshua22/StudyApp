import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
  Animated, PanResponder, Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../lib/supabase';
import { API_BASE } from '../lib/api';

const ACTION_W = 84;

export default function HandoutsList({ classroomId }) {
  const [docs, setDocs] = useState([]);
  const [adding, setAdding] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [busyId, setBusyId] = useState(null);

  const [renameDoc, setRenameDoc] = useState(null);
  const [renameText, setRenameText] = useState('');

  const [notesDoc, setNotesDoc] = useState(null);
  const [notesText, setNotesText] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);

  useFocusEffect(useCallback(() => { fetchDocs(); }, []));

  async function fetchDocs() {
    const { data } = await supabase
      .from('documents').select('*')
      .eq('classroom_id', classroomId)
      .order('created_at', { ascending: false });
    setDocs(data || []);
  }

  // Pick a PDF and run the upload -> process -> brain pipeline
  async function pickPdf() {
    const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (result.canceled) return null;
    return result.assets[0];
  }

  async function uploadToStorage(file) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('You are not logged in.');
    const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: 'base64' });
    const arrayBuffer = decode(base64);
    const path = `${user.id}/${classroomId}/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from('handouts').upload(path, arrayBuffer, { contentType: 'application/pdf' });
    if (error) throw error;
    return { user, path };
  }

  async function addHandout() {
    try {
      const file = await pickPdf();
      if (!file) return;
      setAdding(true);
      setStatusMsg(`Uploading ${file.name}...`);
      const { user, path } = await uploadToStorage(file);

      const { data: doc, error: docError } = await supabase
        .from('documents')
        .insert({ classroom_id: classroomId, user_id: user.id, file_name: file.name, storage_path: path, status: 'pending', notes: '' })
        .select().single();
      if (docError) throw docError;

      setStatusMsg('Reading and learning your handout...');
      const res = await fetch(`${API_BASE}/process-pdf?document_id=${doc.id}`, { method: 'POST' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      try {
        setStatusMsg('Mapping concepts to your brain...');
        await fetch(`${API_BASE}/build-brain?classroom_id=${classroomId}&document_id=${doc.id}`, { method: 'POST' });
      } catch (_) { /* brain is secondary */ }

      await fetchDocs();
    } catch (e) {
      Alert.alert('Upload failed', e.message || 'Something went wrong.');
    } finally {
      setAdding(false);
      setStatusMsg('');
    }
  }

  // Replace a handout's content with a newer PDF, keeping its name and notes
  async function newVersion(doc) {
    try {
      const file = await pickPdf();
      if (!file) return;
      setBusyId(doc.id);
      const { path } = await uploadToStorage(file);
      try { await supabase.storage.from('handouts').remove([doc.storage_path]); } catch (_) { /* ignore */ }

      const { error } = await supabase.from('documents')
        .update({ storage_path: path, status: 'pending' }).eq('id', doc.id);
      if (error) throw error;

      const res = await fetch(`${API_BASE}/process-pdf?document_id=${doc.id}`, { method: 'POST' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      try { await fetch(`${API_BASE}/build-brain?classroom_id=${classroomId}&document_id=${doc.id}&force=true`, { method: 'POST' }); } catch (_) {}

      await fetchDocs();
    } catch (e) {
      Alert.alert('Update failed', e.message || 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  }

  function deleteHandout(doc) {
    Alert.alert(
      'Delete handout?',
      `"${doc.file_name}" and its notes will be removed. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive', onPress: async () => {
            setBusyId(doc.id);
            try {
              const res = await fetch(`${API_BASE}/delete-document?document_id=${doc.id}`, { method: 'POST' });
              const data = await res.json();
              if (data.error) throw new Error(data.error);
              await fetchDocs();
            } catch (e) {
              Alert.alert('Could not delete', e.message);
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  }

  function openRename(doc) { setRenameDoc(doc); setRenameText(doc.file_name); }
  async function saveRename() {
    const name = renameText.trim();
    if (!name) return;
    await supabase.from('documents').update({ file_name: name }).eq('id', renameDoc.id);
    setRenameDoc(null);
    fetchDocs();
  }

  function openNotes(doc) { setNotesDoc(doc); setNotesText(doc.notes || ''); }
  async function saveNotes() {
    setSavingNotes(true);
    await supabase.from('documents').update({ notes: notesText }).eq('id', notesDoc.id);
    setSavingNotes(false);
    setNotesDoc(null);
    fetchDocs();
  }

  return (
    <View style={{ marginBottom: 24 }}>
      <View style={styles.sectionHeader}>
        <Ionicons name="document-text" size={22} color="#1cb0f6" />
        <Text style={styles.sectionTitle}>Handouts</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={styles.addBtn} onPress={addHandout} disabled={adding} activeOpacity={0.8}>
          {adding ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="add" size={26} color="#fff" />}
        </TouchableOpacity>
      </View>

      {adding && statusMsg ? <Text style={styles.addingMsg}>{statusMsg}</Text> : null}

      {docs.length === 0 ? (
        <Text style={styles.empty}>No handouts yet. Tap + to add a PDF.</Text>
      ) : (
        <>
          <Text style={styles.swipeHint}>Tap to rename · swipe ▸ for delete/update · swipe ◂ for notes</Text>
          {docs.map((doc) => (
            <SwipeableRow
              key={doc.id}
              leftActions={[
                { label: 'Delete', icon: 'trash', color: '#ff4b4b', onPress: () => deleteHandout(doc) },
                { label: 'Update', icon: 'cloud-upload', color: '#1cb0f6', onPress: () => newVersion(doc) },
              ]}
              rightActions={[
                { label: 'Notes', icon: 'create', color: '#ce82ff', onPress: () => openNotes(doc) },
              ]}
              onPressRow={() => openRename(doc)}
            >
              <View style={styles.docCard}>
                <View style={styles.docIcon}><Text style={{ fontSize: 20 }}>📄</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.docName} numberOfLines={1}>{doc.file_name}</Text>
                  <View style={styles.metaRow}>
                    <StatusBadge status={doc.status} />
                    {doc.notes ? <Text style={styles.notesTag}>· 📝 notes</Text> : null}
                  </View>
                </View>
                {busyId === doc.id
                  ? <ActivityIndicator color="#1cb0f6" />
                  : <Ionicons name="pencil" size={16} color="#ccc" />}
              </View>
            </SwipeableRow>
          ))}
        </>
      )}

      {/* Rename modal */}
      <Modal visible={!!renameDoc} transparent animationType="fade" onRequestClose={() => setRenameDoc(null)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>Rename handout</Text>
            <TextInput
              style={styles.dialogInput}
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              placeholder="Handout name"
              placeholderTextColor="#aaa"
            />
            <View style={styles.dialogButtons}>
              <TouchableOpacity onPress={() => setRenameDoc(null)}><Text style={styles.dialogCancel}>CANCEL</Text></TouchableOpacity>
              <TouchableOpacity onPress={saveRename}><Text style={styles.dialogSave}>SAVE</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Notes editor */}
      <Modal visible={!!notesDoc} transparent animationType="slide" onRequestClose={() => setNotesDoc(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.notesWrap}>
          <View style={styles.notesSheet}>
            <View style={styles.notesHeader}>
              <Text style={styles.notesTitle} numberOfLines={1}>{notesDoc?.file_name}</Text>
              <TouchableOpacity onPress={() => setNotesDoc(null)}><Ionicons name="close" size={26} color="#999" /></TouchableOpacity>
            </View>
            <TextInput
              style={styles.notesInput}
              value={notesText}
              onChangeText={setNotesText}
              multiline
              autoFocus
              textAlignVertical="top"
              placeholder="Jot down notes during class discussion…"
              placeholderTextColor="#bbb"
            />
            <TouchableOpacity style={styles.notesSave} onPress={saveNotes} disabled={savingNotes} activeOpacity={0.8}>
              {savingNotes ? <ActivityIndicator color="#fff" /> : <Text style={styles.notesSaveText}>SAVE NOTES</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function StatusBadge({ status }) {
  if (status === 'ready') return <Text style={[styles.badge, { color: '#58a700' }]}>● Ready</Text>;
  if (status === 'error') return <Text style={[styles.badge, { color: '#ff4b4b' }]}>● Error</Text>;
  return <Text style={[styles.badge, { color: '#999' }]}>● Processing…</Text>;
}

function SwipeableRow({ leftActions = [], rightActions = [], onPressRow, children }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const offset = useRef(0);
  const leftW = leftActions.length * ACTION_W;
  const rightW = rightActions.length * ACTION_W;

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderMove: (_, g) => {
        let next = offset.current + g.dx;
        if (next > leftW) next = leftW;
        if (next < -rightW) next = -rightW;
        translateX.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const next = offset.current + g.dx;
        let target = 0;
        if (next > leftW / 2 && leftW > 0) target = leftW;
        else if (next < -rightW / 2 && rightW > 0) target = -rightW;
        offset.current = target;
        Animated.spring(translateX, { toValue: target, useNativeDriver: true, bounciness: 0 }).start();
      },
    })
  ).current;

  function close() {
    offset.current = 0;
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
  }
  function handlePress() {
    if (offset.current !== 0) { close(); return; }
    onPressRow && onPressRow();
  }
  function runAction(fn) { close(); setTimeout(fn, 120); }

  return (
    <View style={styles.swipeWrap}>
      {leftW > 0 && (
        <View style={[styles.actionsLeft, { width: leftW }]}>
          {leftActions.map((a, i) => (
            <TouchableOpacity key={i} style={[styles.action, { width: ACTION_W, backgroundColor: a.color }]}
              onPress={() => runAction(a.onPress)} activeOpacity={0.8}>
              <Ionicons name={a.icon} size={20} color="#fff" />
              <Text style={styles.actionText}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {rightW > 0 && (
        <View style={[styles.actionsRight, { width: rightW }]}>
          {rightActions.map((a, i) => (
            <TouchableOpacity key={i} style={[styles.action, { width: ACTION_W, backgroundColor: a.color }]}
              onPress={() => runAction(a.onPress)} activeOpacity={0.8}>
              <Ionicons name={a.icon} size={20} color="#fff" />
              <Text style={styles.actionText}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <Animated.View style={[styles.swipeContent, { transform: [{ translateX }] }]} {...pan.panHandlers}>
        <TouchableOpacity activeOpacity={0.8} onPress={handlePress}>
          {children}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#3c3c3c' },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#1cb0f6',
    borderBottomWidth: 3, borderBottomColor: '#1899d6', justifyContent: 'center', alignItems: 'center' },
  addingMsg: { fontSize: 13, color: '#1cb0f6', marginBottom: 10, fontWeight: '600' },
  empty: { fontSize: 14, color: '#999', textAlign: 'center', paddingVertical: 16, lineHeight: 20 },
  swipeHint: { fontSize: 11, color: '#bbb', marginBottom: 8, textAlign: 'center' },

  swipeWrap: { borderRadius: 16, overflow: 'hidden', marginBottom: 10, backgroundColor: '#fff' },
  swipeContent: { backgroundColor: '#fff' },
  actionsLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, flexDirection: 'row' },
  actionsRight: { position: 'absolute', right: 0, top: 0, bottom: 0, flexDirection: 'row' },
  action: { justifyContent: 'center', alignItems: 'center', gap: 3 },
  actionText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },

  docCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    borderRadius: 16, padding: 14, borderWidth: 2, borderColor: '#e5e5e5' },
  docIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#eaf6ff',
    justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  docName: { fontSize: 16, fontWeight: 'bold', color: '#3c3c3c' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  badge: { fontSize: 12, fontWeight: '600' },
  notesTag: { fontSize: 12, color: '#ce82ff', fontWeight: '600' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: 28 },
  dialog: { backgroundColor: '#fff', borderRadius: 20, padding: 22 },
  dialogTitle: { fontSize: 18, fontWeight: 'bold', color: '#3c3c3c', marginBottom: 16 },
  dialogInput: { borderWidth: 2, borderColor: '#e5e5e5', borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 12, fontSize: 16, color: '#3c3c3c' },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24, marginTop: 20 },
  dialogCancel: { color: '#aaa', fontWeight: 'bold', letterSpacing: 0.5 },
  dialogSave: { color: '#58cc02', fontWeight: 'bold', letterSpacing: 0.5 },

  notesWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  notesSheet: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 28, maxHeight: '85%' },
  notesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  notesTitle: { fontSize: 18, fontWeight: 'bold', color: '#3c3c3c', flex: 1, marginRight: 12 },
  notesInput: { minHeight: 200, maxHeight: 360, borderWidth: 2, borderColor: '#e5e5e5', borderRadius: 14,
    padding: 14, fontSize: 15, color: '#3c3c3c', lineHeight: 22 },
  notesSave: { backgroundColor: '#58cc02', borderBottomWidth: 4, borderBottomColor: '#58a700',
    paddingVertical: 15, borderRadius: 14, alignItems: 'center', marginTop: 16 },
  notesSaveText: { color: '#fff', fontWeight: 'bold', fontSize: 15, letterSpacing: 0.5 },
});

import React, { useState, useCallback, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert,
  Animated, PanResponder, Modal, TextInput, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../lib/supabase';
import { API_BASE } from '../lib/api';
import { palette } from '../lib/theme';

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

  // Reorder state
  const [reordering, setReordering] = useState(false);
  const [orderList, setOrderList] = useState([]);
  const [savingOrder, setSavingOrder] = useState(false);

  // Lesson plan state (5c)
  const [plan, setPlan] = useState(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planBusy, setPlanBusy] = useState(false);
  const [planMsg, setPlanMsg] = useState('');
  const [threshold, setThreshold] = useState('0.45');

  useFocusEffect(useCallback(() => { fetchDocs(); fetchPlan(); }, []));

  async function fetchDocs() {
    const { data } = await supabase
      .from('documents').select('*')
      .eq('classroom_id', classroomId)
      .order('sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true });
    setDocs(data || []);
  }

  // Poll a document row until processing finishes, then return the final row.
  // Light status-only reads; gives up after ~2 min and returns null.
  async function waitForProcessing(docId, tries = 60, intervalMs = 2000) {
    for (let i = 0; i < tries; i++) {
      const { data } = await supabase
        .from('documents').select('status, status_detail')
        .eq('id', docId).single();
      if (data && data.status !== 'processing' && data.status !== 'pending') return data;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return null;
  }

  // Background watcher: once a handout is ready, map its concepts and refresh.
  // Lets the rest of the app stay usable while embedding runs on the server.
  async function finishWhenReady(docId, force = false) {
    const final = await waitForProcessing(docId);
    if (!final) return; // timed out -> badge still shows Processing
    if (final.status === 'error') {
      await fetchDocs();
      Alert.alert('Processing failed', final.status_detail || 'Could not read this PDF.');
      return;
    }
    try {
      const url = `${API_BASE}/build-brain?classroom_id=${classroomId}&document_id=${docId}${force ? '&force=true' : ''}`;
      await fetch(url, { method: 'POST' });
    } catch (_) { /* brain is secondary */ }
    await fetchDocs();
  }

  // Next position in line for this classroom (max sort_order + 1)
  async function nextSortOrder() {
    const { data } = await supabase
      .from('documents')
      .select('sort_order')
      .eq('classroom_id', classroomId)
      .order('sort_order', { ascending: false, nullsFirst: false })
      .limit(1);
    const max = data && data.length && data[0].sort_order ? data[0].sort_order : 0;
    return max + 1;
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
    let docId = null;
    try {
      const file = await pickPdf();
      if (!file) return;
      setAdding(true);
      setStatusMsg(`Uploading ${file.name}...`);
      const { user, path } = await uploadToStorage(file);

      const nextOrder = await nextSortOrder();
      const { data: doc, error: docError } = await supabase
        .from('documents')
        .insert({ classroom_id: classroomId, user_id: user.id, file_name: file.name, storage_path: path, status: 'pending', notes: '', sort_order: nextOrder })
        .select().single();
      if (docError) throw docError;
      docId = doc.id;

      // Kick off processing; the backend returns immediately and works in the
      // background. We show the new row's "Processing…" badge and move on.
      const res = await fetch(`${API_BASE}/process-pdf?document_id=${doc.id}`, { method: 'POST' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      await fetchDocs();
    } catch (e) {
      Alert.alert('Upload failed', e.message || 'Something went wrong.');
      setAdding(false);
      setStatusMsg('');
      return;
    }
    // Free the UI, then watch for completion in the background.
    setAdding(false);
    setStatusMsg('');
    finishWhenReady(docId);
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

      await fetchDocs();
    } catch (e) {
      Alert.alert('Update failed', e.message || 'Something went wrong.');
      setBusyId(null);
      return;
    }
    setBusyId(null);
    // Rebuild this handout's brain once the new version finishes processing.
    finishWhenReady(doc.id, true);
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

  // Open the reorder sheet, seeded from the current (already path-ordered) list
  function openReorder() {
    setOrderList(docs.map((d) => ({ id: d.id, file_name: d.file_name })));
    setReordering(true);
  }

  // Swap an item with its neighbor in local state only (no DB write yet)
  function move(index, dir) {
    const target = index + dir;
    if (target < 0 || target >= orderList.length) return;
    const next = orderList.slice();
    const tmp = next[index];
    next[index] = next[target];
    next[target] = tmp;
    setOrderList(next);
  }

  // The write-path: renumber 1..N by visual position, persist, surface any error
  async function saveOrder() {
    setSavingOrder(true);
    try {
      for (let i = 0; i < orderList.length; i++) {
        const { error } = await supabase
          .from('documents')
          .update({ sort_order: i + 1 })
          .eq('id', orderList[i].id);
        if (error) throw new Error(error.message);
      }
      setReordering(false);
      await fetchDocs();
    } catch (e) {
      Alert.alert('Could not save order', e.message || 'Something went wrong.');
    } finally {
      setSavingOrder(false);
    }
  }

  // ----- Lesson plan (5c): upload a syllabus and auto-order handouts -----

  async function fetchPlan() {
    const { data } = await supabase
      .from('lesson_plans').select('*')
      .eq('classroom_id', classroomId)
      .limit(1);
    setPlan((data && data[0]) || null);
  }

  function openPlan() {
    setThreshold(plan?.match_threshold != null ? String(plan.match_threshold) : '0.45');
    setPlanOpen(true);
  }

  async function uploadPlanFile(file) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('You are not logged in.');
    const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: 'base64' });
    const arrayBuffer = decode(base64);
    // Kept under the user-id root (passes owner-scoped storage RLS), in a plans/ subfolder
    const path = `${user.id}/${classroomId}/plans/${Date.now()}_${file.name}`;
    const { error } = await supabase.storage.from('handouts').upload(path, arrayBuffer, { contentType: 'application/pdf' });
    if (error) throw error;
    return { user, path };
  }

  async function runOrder(planId) {
    const thr = parseFloat(threshold);
    const params = new URLSearchParams({ classroom_id: classroomId, plan_id: planId, dry_run: 'false' });
    if (!isNaN(thr)) params.append('match_threshold', String(thr));
    const res = await fetch(`${API_BASE}/order-from-plan?${params.toString()}`, { method: 'POST' });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`Server error ${res.status}: ${text.slice(0, 140) || 'no response body'}`); }
    if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
    if (data.error) throw new Error(data.error);
    return data;
  }

  function orderedAlert(result) {
    Alert.alert(
      'Handouts reordered',
      `Matched ${result.matched} handout${result.matched === 1 ? '' : 's'} across ${result.topics.length} topics` +
      (result.parked ? ` \u00b7 ${result.parked} parked at the end.` : '.') +
      '\n\nRebuild your Learning Path to apply the new order and checkpoints.'
    );
  }

  // Pick a new PDF, upload it, replace any existing plan, then order.
  async function handleUploadAndOrder() {
    try {
      const file = await pickPdf();
      if (!file) return;
      setPlanBusy(true);
      setPlanMsg(`Uploading ${file.name}...`);
      const { user, path } = await uploadPlanFile(file);

      if (plan?.storage_path && plan.storage_path !== path) {
        try { await supabase.storage.from('handouts').remove([plan.storage_path]); } catch (_) {}
      }

      const { data: row, error } = await supabase
        .from('lesson_plans')
        .upsert(
          { classroom_id: classroomId, user_id: user.id, file_name: file.name, storage_path: path },
          { onConflict: 'classroom_id' }
        )
        .select().single();
      if (error) throw error;

      setPlanMsg('Reading your lesson plan and reordering handouts...');
      const result = await runOrder(row.id);
      await fetchPlan();
      await fetchDocs();
      setPlanOpen(false);
      orderedAlert(result);
    } catch (e) {
      Alert.alert('Could not order from plan', e.message || 'Something went wrong.');
    } finally {
      setPlanBusy(false);
      setPlanMsg('');
    }
  }

  // Re-run ordering using the plan already uploaded (e.g. after adding handouts).
  async function handleReorder() {
    if (!plan) return;
    try {
      setPlanBusy(true);
      setPlanMsg('Reordering handouts from your lesson plan...');
      const result = await runOrder(plan.id);
      await fetchPlan();
      await fetchDocs();
      setPlanOpen(false);
      orderedAlert(result);
    } catch (e) {
      Alert.alert('Could not reorder', e.message || 'Something went wrong.');
    } finally {
      setPlanBusy(false);
      setPlanMsg('');
    }
  }

  function confirmRemovePlan() {
    Alert.alert(
      'Remove lesson plan?',
      'This deletes the stored plan. Your handouts keep their current order.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: removePlan },
      ]
    );
  }

  async function removePlan() {
    try {
      setPlanBusy(true);
      if (plan?.storage_path) { try { await supabase.storage.from('handouts').remove([plan.storage_path]); } catch (_) {} }
      await supabase.from('lesson_plans').delete().eq('id', plan.id);
      await fetchPlan();
      setPlanOpen(false);
    } catch (e) {
      Alert.alert('Could not remove plan', e.message);
    } finally {
      setPlanBusy(false);
    }
  }

  return (
    <View style={{ marginBottom: 24 }}>
      <View style={styles.sectionHeader}>
        <Ionicons name="document-text" size={22} color="#1cb0f6" />
        <Text style={styles.sectionTitle}>Handouts</Text>
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={styles.reorderBtn} onPress={openPlan} activeOpacity={0.8}>
          <Ionicons name="reader-outline" size={20} color="#1cb0f6" />
        </TouchableOpacity>
        {docs.length > 1 && (
          <TouchableOpacity style={styles.reorderBtn} onPress={openReorder} activeOpacity={0.8}>
            <Ionicons name="swap-vertical" size={22} color="#1cb0f6" />
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.addBtn} onPress={addHandout} disabled={adding} activeOpacity={0.8}>
          {adding ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="add" size={26} color="#fff" />}
        </TouchableOpacity>
      </View>

      {adding && statusMsg ? <Text style={styles.addingMsg}>{statusMsg}</Text> : null}
      {plan ? (
        <TouchableOpacity onPress={openPlan} activeOpacity={0.7}>
          <Text style={styles.planTag} numberOfLines={1}>
            📋 Ordered by {plan.file_name}{plan.topic_count ? ` \u00b7 ${plan.topic_count} topics` : ''}
          </Text>
        </TouchableOpacity>
      ) : null}

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

      {/* Reorder sheet */}
      <Modal visible={reordering} transparent animationType="slide" onRequestClose={() => setReordering(false)}>
        <View style={styles.notesWrap}>
          <View style={styles.reorderSheet}>
            <View style={styles.notesHeader}>
              <Text style={styles.notesTitle}>Reorder lessons</Text>
              <TouchableOpacity onPress={() => setReordering(false)}><Ionicons name="close" size={26} color="#999" /></TouchableOpacity>
            </View>
            <Text style={styles.reorderHint}>This is the order your learning path will follow. Use the arrows to move a handout up or down, then save.</Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {orderList.map((item, index) => (
                <View key={item.id} style={styles.reorderRow}>
                  <Text style={styles.reorderNum}>{index + 1}</Text>
                  <Text style={styles.reorderName} numberOfLines={1}>{item.file_name}</Text>
                  <TouchableOpacity
                    style={[styles.arrowBtn, index === 0 && styles.arrowDisabled]}
                    onPress={() => move(index, -1)}
                    disabled={index === 0}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="chevron-up" size={20} color={index === 0 ? '#ddd' : '#1cb0f6'} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.arrowBtn, index === orderList.length - 1 && styles.arrowDisabled]}
                    onPress={() => move(index, 1)}
                    disabled={index === orderList.length - 1}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="chevron-down" size={20} color={index === orderList.length - 1 ? '#ddd' : '#1cb0f6'} />
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.notesSave} onPress={saveOrder} disabled={savingOrder} activeOpacity={0.8}>
              {savingOrder ? <ActivityIndicator color="#fff" /> : <Text style={styles.notesSaveText}>SAVE ORDER</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Lesson plan sheet (5c) */}
      <Modal visible={planOpen} transparent animationType="slide" onRequestClose={() => setPlanOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.notesWrap}>
          <View style={styles.reorderSheet}>
            <View style={styles.notesHeader}>
              <Text style={styles.notesTitle}>Lesson plan</Text>
              <TouchableOpacity onPress={() => setPlanOpen(false)}><Ionicons name="close" size={26} color="#999" /></TouchableOpacity>
            </View>
            <Text style={styles.reorderHint}>
              Upload your course syllabus to auto-order handouts to match how the course is taught.
              It's used only for ordering — never quizzed or added to your brain.
            </Text>

            {plan ? (
              <View style={styles.planCard}>
                <Text style={styles.planCardName} numberOfLines={1}>📋 {plan.file_name}</Text>
                <Text style={styles.planCardMeta}>
                  {plan.topic_count ? `${plan.topic_count} topics` : 'Not ordered yet'}
                  {plan.last_ordered_at ? ` \u00b7 last run ${new Date(plan.last_ordered_at).toLocaleDateString()}` : ''}
                </Text>
              </View>
            ) : null}

            <Text style={styles.fieldLabel}>Match strength</Text>
            <Text style={styles.fieldHint}>0–1. Higher is stricter. 0.45 is a good start.</Text>
            <TextInput
              style={styles.thresholdInput}
              value={threshold}
              onChangeText={setThreshold}
              keyboardType="decimal-pad"
              placeholder="0.45"
              placeholderTextColor="#aaa"
            />

            {planBusy && planMsg ? <Text style={[styles.addingMsg, { marginTop: 12 }]}>{planMsg}</Text> : null}

            <TouchableOpacity style={styles.notesSave} onPress={handleUploadAndOrder} disabled={planBusy} activeOpacity={0.8}>
              {planBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.notesSaveText}>{plan ? 'REPLACE PLAN & ORDER' : 'UPLOAD PLAN & ORDER'}</Text>}
            </TouchableOpacity>

            {plan ? (
              <TouchableOpacity style={styles.planSecondary} onPress={handleReorder} disabled={planBusy} activeOpacity={0.8}>
                <Text style={styles.planSecondaryText}>Re-order with current plan</Text>
              </TouchableOpacity>
            ) : null}

            {plan ? (
              <TouchableOpacity style={styles.planRemove} onPress={confirmRemovePlan} disabled={planBusy}>
                <Text style={styles.planRemoveText}>Remove plan</Text>
              </TouchableOpacity>
            ) : null}
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
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: palette.ink },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.blue,
    borderBottomWidth: 3, borderBottomColor: palette.blueDark, justifyContent: 'center', alignItems: 'center' },
  reorderBtn: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: palette.line },
  addingMsg: { fontSize: 13, color: palette.blue, marginBottom: 10, fontWeight: '600' },
  empty: { fontSize: 14, color: palette.inkSoft, textAlign: 'center', paddingVertical: 16, lineHeight: 20 },
  swipeHint: { fontSize: 11, color: palette.hint, marginBottom: 8, textAlign: 'center' },

  swipeWrap: { borderRadius: 16, overflow: 'hidden', marginBottom: 10, backgroundColor: palette.bg },
  swipeContent: { backgroundColor: palette.bg },
  actionsLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, flexDirection: 'row' },
  actionsRight: { position: 'absolute', right: 0, top: 0, bottom: 0, flexDirection: 'row' },
  action: { justifyContent: 'center', alignItems: 'center', gap: 3 },
  actionText: { color: palette.white, fontSize: 11, fontWeight: 'bold' },

  docCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.bg,
    borderRadius: 16, padding: 14, borderWidth: 2, borderColor: palette.line },
  docIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: palette.blueSoft,
    justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  docName: { fontSize: 16, fontWeight: 'bold', color: palette.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  badge: { fontSize: 12, fontWeight: '600' },
  notesTag: { fontSize: 12, color: palette.purple, fontWeight: '600' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 28 },
  dialog: { backgroundColor: palette.bg, borderRadius: 20, padding: 22 },
  dialogTitle: { fontSize: 18, fontWeight: 'bold', color: palette.ink, marginBottom: 16 },
  dialogInput: { borderWidth: 2, borderColor: palette.line, borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 12, fontSize: 16, color: palette.ink },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 24, marginTop: 20 },
  dialogCancel: { color: palette.hint, fontWeight: 'bold', letterSpacing: 0.5 },
  dialogSave: { color: palette.green, fontWeight: 'bold', letterSpacing: 0.5 },

  notesWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  notesSheet: { backgroundColor: palette.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 28, maxHeight: '85%' },
  notesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  notesTitle: { fontSize: 18, fontWeight: 'bold', color: palette.ink, flex: 1, marginRight: 12 },
  notesInput: { minHeight: 200, maxHeight: 360, borderWidth: 2, borderColor: palette.line, borderRadius: 14,
    padding: 14, fontSize: 15, color: palette.ink, lineHeight: 22 },
  notesSave: { backgroundColor: palette.green, borderBottomWidth: 4, borderBottomColor: palette.greenDark,
    paddingVertical: 15, borderRadius: 14, alignItems: 'center', marginTop: 16 },
  notesSaveText: { color: palette.white, fontWeight: 'bold', fontSize: 15, letterSpacing: 0.5 },

  reorderSheet: { backgroundColor: palette.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: 28, maxHeight: '85%' },
  reorderHint: { fontSize: 13, color: palette.inkSoft, marginBottom: 14, lineHeight: 19 },
  reorderRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: palette.bgSoft,
    borderRadius: 12, padding: 12, marginBottom: 8 },
  reorderNum: { width: 26, fontSize: 15, fontWeight: 'bold', color: palette.blue },
  reorderName: { flex: 1, fontSize: 15, fontWeight: '600', color: palette.ink, marginRight: 8 },
  arrowBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 2, borderColor: palette.line,
    justifyContent: 'center', alignItems: 'center', marginLeft: 6 },
  arrowDisabled: { borderColor: palette.lineSoft },

  planTag: { fontSize: 12, color: palette.blue, fontWeight: '700', marginBottom: 10 },
  planCard: { backgroundColor: palette.blueSoft, borderWidth: 2, borderColor: palette.blueDark, borderRadius: 12, padding: 12, marginBottom: 14 },
  planCardName: { fontSize: 15, fontWeight: 'bold', color: palette.ink },
  planCardMeta: { fontSize: 12, color: palette.inkSoft, marginTop: 4 },
  fieldLabel: { fontSize: 14, fontWeight: 'bold', color: palette.ink, marginTop: 4 },
  fieldHint: { fontSize: 12, color: palette.inkSoft, marginBottom: 8 },
  thresholdInput: { borderWidth: 2, borderColor: palette.line, borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 10, fontSize: 16, color: palette.ink },
  planSecondary: { paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  planSecondaryText: { color: palette.blue, fontWeight: 'bold', fontSize: 14 },
  planRemove: { paddingVertical: 10, alignItems: 'center' },
  planRemoveText: { color: palette.red, fontWeight: 'bold', fontSize: 14 },
});
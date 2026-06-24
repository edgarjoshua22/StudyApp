import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import { supabase } from '../lib/supabase';
import { API_BASE } from '../lib/api';

export default function UploadHandout({ classroomId }) {
  const [status, setStatus] = useState('idle');   // idle | working | done | error
  const [message, setMessage] = useState('');

  async function handleUpload() {
    try {
      // 1. Let the student pick a PDF
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const file = result.assets[0];

      setStatus('working');
      setMessage(`Uploading ${file.name}...`);

      // 2. Who is logged in?
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('You are not logged in.');

      // 3. Read the file and convert it to the format Supabase needs
      const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: 'base64' });
      const arrayBuffer = decode(base64);

      // 4. Upload to storage, inside the user's own folder
      const path = `${user.id}/${classroomId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('handouts')
        .upload(path, arrayBuffer, { contentType: 'application/pdf' });
      if (uploadError) throw uploadError;

      // 5. Create the document row in the database
      const { data: doc, error: docError } = await supabase
        .from('documents')
        .insert({
          classroom_id: classroomId,
          user_id: user.id,
          file_name: file.name,
          storage_path: path,
          status: 'pending',
        })
        .select()
        .single();
      if (docError) throw docError;

      // 6. Tell the backend to read, chunk, and embed it
      setMessage('Reading and learning your handout...');
      const response = await fetch(`${API_BASE}/process-pdf?document_id=${doc.id}`, {
        method: 'POST',
      });
      const data = await response.json();
      if (data.error) throw new Error(data.error);

      // 7. Map the new concepts into the second brain (optional — don't fail upload if this errors)
      try {
        setMessage('Mapping concepts to your brain...');
        await fetch(`${API_BASE}/build-brain?classroom_id=${classroomId}`, { method: 'POST' });
      } catch (_) { /* brain is secondary; ignore */ }

      setStatus('done');
      setMessage(`Done! Learned ${data.chunks_saved} sections from ${file.name}.`);
    } catch (e) {
      setStatus('error');
      setMessage(e.message || 'Something went wrong.');
    }
  }

  const busy = status === 'working';

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.button, busy && styles.buttonDisabled]}
        onPress={handleUpload}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="cloud-upload-outline" size={22} color="#fff" />
            <Text style={styles.buttonText}>Upload a handout (PDF)</Text>
          </>
        )}
      </TouchableOpacity>

      {message ? (
        <Text style={[
          styles.message,
          status === 'error' && styles.errorText,
          status === 'done' && styles.doneText,
        ]}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginVertical: 16 },
  button: {
    backgroundColor: '#1cb0f6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    borderRadius: 16,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  message: { marginTop: 12, textAlign: 'center', color: '#555' },
  errorText: { color: '#ff4b4b' },
  doneText: { color: '#58cc02', fontWeight: '600' },
});
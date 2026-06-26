import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { supabase } from '../lib/supabase';
import { palette } from '../lib/theme';

export default function Auth() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) Alert.alert('Login failed', error.message);
    setLoading(false);
  }

  async function signUp() {
    setLoading(true);
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) Alert.alert('Sign up failed', error.message);
    else Alert.alert('Success', 'Account created — you can log in now.');
    setLoading(false);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>StudyApp</Text>
      <Text style={styles.subtitle}>Log in or create an account</Text>

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={palette.hint}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={palette.hint}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
      />

      {loading ? (
        <ActivityIndicator style={{ marginTop: 20 }} />
      ) : (
        <>
          <TouchableOpacity style={styles.button} onPress={signIn}>
            <Text style={styles.buttonText}>Log In</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.outline]} onPress={signUp}>
            <Text style={[styles.buttonText, styles.outlineText]}>Sign Up</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: palette.bgSoft },
  title: { fontSize: 36, fontWeight: 'bold', textAlign: 'center', color: palette.blue },
  subtitle: { fontSize: 16, textAlign: 'center', color: palette.inkSoft, marginBottom: 30 },
  input: { borderWidth: 2, borderColor: palette.line, borderRadius: 10, padding: 14, marginBottom: 12,
    fontSize: 16, backgroundColor: palette.bg, color: palette.ink },
  button: { backgroundColor: palette.blue, padding: 16, borderRadius: 10, marginTop: 8 },
  buttonText: { color: palette.white, fontSize: 16, fontWeight: 'bold', textAlign: 'center' },
  outline: { backgroundColor: 'transparent', borderWidth: 2, borderColor: palette.blue },
  outlineText: { color: palette.blue },
});
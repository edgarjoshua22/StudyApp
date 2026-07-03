import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from '../lib/supabase';
import { palette } from '../lib/theme';
import { GradientButton, Mascot } from './ui';

// Lets the in-app browser dismiss cleanly after the OAuth redirect.
WebBrowser.maybeCompleteAuthSession();

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

  // Google (Gmail) sign-in via Supabase OAuth + an in-app browser. We open the
  // provider URL ourselves, then exchange the returned PKCE code for a session.
  async function signInWithGoogle() {
    setLoading(true);
    try {
      const redirectTo = Linking.createURL('auth-callback');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type !== 'success') return; // user dismissed/cancelled

      const { queryParams } = Linking.parse(result.url);
      const code = queryParams?.code;
      if (!code) throw new Error('No authorization code returned.');
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(String(code));
      if (exchangeError) throw exchangeError;
      // onAuthStateChange in App.js picks up the new session from here.
    } catch (e) {
      Alert.alert('Google sign-in failed', e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Mascot size={84} style={{ alignSelf: 'center', marginBottom: 16 }} />
      <Text style={styles.title}>StudyApp</Text>
      <Text style={styles.subtitle}>Learn anything, your way</Text>

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
        <ActivityIndicator style={{ marginTop: 20 }} color={palette.green} />
      ) : (
        <>
          <GradientButton title="Log In" onPress={signIn} style={{ marginTop: 8 }} />
          <TouchableOpacity style={[styles.button, styles.outline]} onPress={signUp}>
            <Text style={[styles.buttonText, styles.outlineText]}>Sign Up</Text>
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.divider} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.divider} />
          </View>

          <TouchableOpacity style={styles.googleButton} onPress={signInWithGoogle} activeOpacity={0.85}>
            <Ionicons name="logo-google" size={20} color="#ea4335" />
            <Text style={styles.googleText}>Continue with Google</Text>
          </TouchableOpacity>
        </>
      )}
    </SafeAreaView>
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

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 18, gap: 12 },
  divider: { flex: 1, height: 1, backgroundColor: palette.line },
  dividerText: { color: palette.hint, fontSize: 13, fontWeight: '700' },

  googleButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: palette.white, borderRadius: 10, padding: 14,
  },
  googleText: { color: '#1f1f1f', fontSize: 16, fontWeight: '700' },
});

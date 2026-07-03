import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, ScrollView, Platform, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { palette, space, radius, type, shadow, solid } from '../lib/theme';
import { PRIVACY_POLICY_URL, TERMS_URL, LEGAL_VERSION } from '../lib/legal';

const MIN_AGE = 13;

function ageFrom(date) {
  const now = new Date();
  let age = now.getFullYear() - date.getFullYear();
  const m = now.getMonth() - date.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < date.getDate())) age--;
  return age;
}
function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// First-launch gate: legal consent -> name + birthdate (13+) -> learner type.
// On finish, upserts the profile with onboarding_completed=true and calls onDone.
export default function Onboarding({ session, onDone }) {
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState('');
  const [birthdate, setBirthdate] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [userType, setUserType] = useState(null);
  const [saving, setSaving] = useState(false);

  function onPickDate(event, date) {
    setShowPicker(Platform.OS === 'ios');
    if (event.type === 'set' && date) setBirthdate(date);
  }

  function nextFromProfile() {
    if (!fullName.trim()) return Alert.alert('Your name?', 'Please enter your name so we can personalize things.');
    if (!birthdate) return Alert.alert('Birthdate?', 'Please select your birthdate.');
    if (ageFrom(birthdate) < MIN_AGE) {
      Alert.alert(
        'Sorry — you must be 13 or older',
        'StudyApp is only available to users aged 13 and up. You’ll be signed out.',
        [{ text: 'OK', onPress: () => supabase.auth.signOut() }]
      );
      return;
    }
    setStep(2);
  }

  async function finish(type) {
    setUserType(type);
    setSaving(true);
    const { error } = await supabase.from('profiles').upsert({
      id: session.user.id,
      full_name: fullName.trim(),
      birthdate: isoDate(birthdate),
      user_type: type,
      onboarding_completed: true,
      privacy_accepted_at: new Date().toISOString(),
      legal_version: LEGAL_VERSION,
    }, { onConflict: 'id' });
    setSaving(false);
    if (error) { Alert.alert('Could not save', error.message); return; }
    onDone?.();
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.mascot}>🧠</Text>

        {step === 0 && (
          <>
            <Text style={styles.title}>Welcome to StudyApp</Text>
            <Text style={styles.sub}>
              Turn your handouts into a fun, Duolingo-style path — with an AI tutor that learns from your
              own materials.
            </Text>
            <View style={styles.legalCard}>
              <Text style={styles.legalText}>
                Before we start, please review how we handle your data. By continuing you agree to our
                Privacy Policy and Terms.
              </Text>
              <View style={styles.legalLinks}>
                <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
                  <Text style={styles.link}>Privacy Policy</Text>
                </TouchableOpacity>
                <Text style={styles.dot}>•</Text>
                <TouchableOpacity onPress={() => Linking.openURL(TERMS_URL)}>
                  <Text style={styles.link}>Terms of Service</Text>
                </TouchableOpacity>
              </View>
            </View>
            <TouchableOpacity style={styles.primary} onPress={() => setStep(1)} activeOpacity={0.85}>
              <Text style={styles.primaryText}>I AGREE & CONTINUE</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 1 && (
          <>
            <Text style={styles.title}>Tell us about you</Text>
            <Text style={styles.sub}>StudyApp is for ages {MIN_AGE}+. We use your birthdate only to confirm this.</Text>

            <Text style={styles.label}>YOUR NAME</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Alex"
              placeholderTextColor={palette.hint}
              value={fullName}
              onChangeText={setFullName}
            />

            <Text style={styles.label}>BIRTHDATE</Text>
            <TouchableOpacity style={styles.input} onPress={() => setShowPicker(true)} activeOpacity={0.7}>
              <Text style={birthdate ? styles.inputText : styles.placeholder}>
                {birthdate ? isoDate(birthdate) : 'Select your birthdate'}
              </Text>
              <Ionicons name="calendar-outline" size={20} color={palette.hint} />
            </TouchableOpacity>
            {showPicker && (
              <DateTimePicker
                value={birthdate || new Date(2005, 0, 1)}
                mode="date"
                display="spinner"
                maximumDate={new Date()}
                onChange={onPickDate}
              />
            )}

            <TouchableOpacity style={styles.primary} onPress={nextFromProfile} activeOpacity={0.85}>
              <Text style={styles.primaryText}>CONTINUE</Text>
            </TouchableOpacity>
          </>
        )}

        {step === 2 && (
          <>
            <Text style={styles.title}>How will you use StudyApp?</Text>
            <Text style={styles.sub}>This helps us tailor your experience. You can change it later.</Text>

            {saving ? (
              <ActivityIndicator style={{ marginTop: 30 }} color={palette.green} />
            ) : (
              <>
                <TouchableOpacity style={styles.choiceCard} activeOpacity={0.85} onPress={() => finish('student')}>
                  <Text style={styles.choiceEmoji}>🎓</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.choiceTitle}>I'm a student</Text>
                    <Text style={styles.choiceSub}>Studying subjects for school, with semesters and exams.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={22} color={palette.hint} />
                </TouchableOpacity>

                <TouchableOpacity style={styles.choiceCard} activeOpacity={0.85} onPress={() => finish('pathfinder')}>
                  <Text style={styles.choiceEmoji}>🧭</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.choiceTitle}>I'm pathfinding</Text>
                    <Text style={styles.choiceSub}>Learning new things for myself, at my own pace.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={22} color={palette.hint} />
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bgSoft },
  body: { padding: space.xl, flexGrow: 1, justifyContent: 'center' },
  mascot: { fontSize: 64, textAlign: 'center', marginBottom: space.md },
  title: { ...type.h1, textAlign: 'center' },
  sub: { fontSize: 15, color: palette.inkSoft, textAlign: 'center', marginTop: space.sm, marginBottom: space.xl, lineHeight: 21, fontWeight: '500' },

  legalCard: { backgroundColor: palette.bg, borderRadius: radius.lg, padding: space.lg, marginBottom: space.xl, ...shadow.card },
  legalText: { fontSize: 14, color: palette.ink, lineHeight: 20, fontWeight: '500' },
  legalLinks: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: space.md },
  link: { fontSize: 14, color: palette.blue, fontWeight: '800' },
  dot: { color: palette.hint },

  label: { ...type.tiny, letterSpacing: 1, marginBottom: space.sm, marginLeft: space.xs },
  input: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 2, borderColor: palette.line, borderRadius: radius.md,
    paddingHorizontal: space.lg, minHeight: 56, marginBottom: space.lg, backgroundColor: palette.bg,
  },
  inputText: { fontSize: 16, color: palette.ink, flex: 1 },
  placeholder: { fontSize: 16, color: palette.hint, flex: 1 },

  primary: { ...solid(palette.green, palette.greenDark, radius.lg), paddingVertical: 16, marginTop: space.sm },
  primaryText: { color: palette.white, fontSize: 16, fontWeight: '800', textAlign: 'center', letterSpacing: 0.5 },

  choiceCard: {
    flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: palette.bg,
    borderRadius: radius.lg, padding: space.lg, marginBottom: space.md, borderWidth: 2, borderColor: palette.line,
  },
  choiceEmoji: { fontSize: 34 },
  choiceTitle: { fontSize: 17, fontWeight: '800', color: palette.ink },
  choiceSub: { fontSize: 13, color: palette.inkSoft, marginTop: 3, fontWeight: '500', lineHeight: 18 },
});

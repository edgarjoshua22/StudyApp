import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { palette, space, radius, solid } from '../lib/theme';

export default function SettingsScreen({ session, navigation }) {
  const insets = useSafeAreaInsets();
  const email = session?.user?.email || '';
  const [busy, setBusy] = useState(false);

  function confirmLogout() {
    Alert.alert('Log out?', 'You can log back in anytime.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out',
        style: 'destructive',
        onPress: async () => { setBusy(true); await supabase.auth.signOut(); },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="close" size={28} color={palette.inkSoft} />
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <View style={styles.card}>
          <View style={styles.rowStatic}>
            <Ionicons name="mail-outline" size={20} color={palette.inkSoft} />
            <Text style={styles.rowText} numberOfLines={1}>{email}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>PREFERENCES</Text>
        <View style={styles.card}>
          <Row icon="notifications-outline" label="Notifications" onPress={() => navigation.goBack()} />
          <View style={styles.divider} />
          <Row icon="moon-outline" label="Dark theme" value="On" />
        </View>

        <TouchableOpacity
          style={[styles.logoutBtn, solid(palette.red, palette.redDark, radius.lg), busy && { opacity: 0.7 }]}
          onPress={confirmLogout}
          disabled={busy}
          activeOpacity={0.85}
        >
          {busy ? <ActivityIndicator color={palette.white} />
            : <><Ionicons name="log-out-outline" size={20} color={palette.white} />
                <Text style={styles.logoutText}>LOG OUT</Text></>}
        </TouchableOpacity>

        <Text style={styles.version}>StudyApp · v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

function Row({ icon, label, value, onPress }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={!onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={20} color={palette.inkSoft} />
      <Text style={[styles.rowText, { flex: 1 }]}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={palette.hint} /> : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bgSoft },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingBottom: 10 },
  title: { fontSize: 18, fontWeight: '800', color: palette.ink },

  sectionLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 1, color: palette.inkSoft,
    marginBottom: 8, marginLeft: 4, marginTop: 8 },
  card: { backgroundColor: palette.bg, borderRadius: radius.lg, borderWidth: 2, borderColor: palette.line,
    marginBottom: 20, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  rowStatic: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  rowText: { fontSize: 16, color: palette.ink, fontWeight: '600' },
  rowValue: { fontSize: 14, color: palette.inkSoft, fontWeight: '700' },
  divider: { height: 1, backgroundColor: palette.lineSoft, marginLeft: 48 },

  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 16, marginTop: 8 },
  logoutText: { color: palette.white, fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  version: { textAlign: 'center', color: palette.hint, fontSize: 12, fontWeight: '600', marginTop: 20 },
});

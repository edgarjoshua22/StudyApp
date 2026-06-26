import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { palette, radius } from '../lib/theme';

export default function MoreScreen({ session, navigation }) {
  const insets = useSafeAreaInsets();
  const email = session?.user?.email || '';
  const initial = (email[0] || '?').toUpperCase();

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
        <Text style={styles.name} numberOfLines={1}>{email.split('@')[0] || 'You'}</Text>
        <Text style={styles.email} numberOfLines={1}>{email}</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}>
        <View style={styles.card}>
          <MenuRow icon="person-circle-outline" color={palette.purple} label="Profile"
            onPress={() => navigation.navigate('Profile')} />
          <View style={styles.divider} />
          <MenuRow icon="settings-outline" color={palette.blue} label="Settings"
            onPress={() => navigation.navigate('Settings')} />
        </View>
      </ScrollView>
    </View>
  );
}

function MenuRow({ icon, color, label, onPress }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.rowIcon, { backgroundColor: color }]}>
        <Ionicons name={icon} size={22} color={palette.white} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={20} color={palette.hint} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bgSoft },
  header: { alignItems: 'center', paddingBottom: 20, paddingHorizontal: 20,
    backgroundColor: palette.bg, borderBottomWidth: 2, borderBottomColor: palette.line },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: palette.purple,
    alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  avatarText: { fontSize: 30, fontWeight: '800', color: palette.white },
  name: { fontSize: 20, fontWeight: '800', color: palette.ink },
  email: { fontSize: 13, fontWeight: '600', color: palette.inkSoft, marginTop: 2 },

  card: { backgroundColor: palette.bg, borderRadius: radius.lg, borderWidth: 2, borderColor: palette.line,
    overflow: 'hidden', marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 16 },
  rowIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontSize: 17, fontWeight: '700', color: palette.ink },
  divider: { height: 1, backgroundColor: palette.lineSoft, marginLeft: 70 },
});

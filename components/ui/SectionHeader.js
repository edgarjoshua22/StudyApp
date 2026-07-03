import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { palette, radius, space } from '../../lib/theme';

// Section title with an optional emoji chip and a right-aligned action.
export default function SectionHeader({ title, emoji, right, color = palette.primarySoft, style }) {
  return (
    <View style={[styles.row, style]}>
      {emoji ? (
        <View style={[styles.dot, { backgroundColor: color }]}>
          <Text style={{ fontSize: 16 }}>{emoji}</Text>
        </View>
      ) : null}
      <Text style={styles.title}>{title}</Text>
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  dot: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 19, fontWeight: '800', color: palette.ink },
});

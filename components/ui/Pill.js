import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { palette, radius } from '../../lib/theme';

// Small rounded chip. Solid accent when active, soft tint when not.
export default function Pill({ label, active, color = palette.primary, soft = palette.primarySoft, onPress, style }) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      disabled={!onPress}
      style={[styles.pill, { backgroundColor: active ? color : soft }, style]}
    >
      <Text style={[styles.text, { color: active ? palette.white : color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pill: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: radius.pill, alignSelf: 'flex-start' },
  text: { fontSize: 14, fontWeight: '800' },
});

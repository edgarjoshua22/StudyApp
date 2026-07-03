import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { gradient as g } from '../../lib/theme';

// Friendly study buddy in a gradient blob — deliberately NOT an owl (that's the
// Duolingo tell). Emoji placeholder until custom art; swap the glyph app-wide
// by changing MASCOT.
export const MASCOT = '🦊';

export default function Mascot({ size = 56, grad = 'primary', glyph = MASCOT, style }) {
  return (
    <LinearGradient
      colors={g(grad)}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[styles.wrap, { width: size, height: size, borderRadius: size / 2 }, style]}
    >
      <Text style={{ fontSize: size * 0.52 }}>{glyph}</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});

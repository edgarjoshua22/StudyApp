import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { gradient as g, palette } from '../../lib/theme';

// Rounded track with a gradient fill. progress is 0..1.
export default function ProgressBar({ progress = 0, grad = 'primary', height = 12, style }) {
  const p = Math.max(0, Math.min(1, progress));
  return (
    <View style={[styles.track, { height, borderRadius: height }, style]}>
      <LinearGradient
        colors={Array.isArray(grad) ? grad : g(grad)}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={{ width: `${p * 100}%`, height, borderRadius: height }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { backgroundColor: palette.track, overflow: 'hidden', width: '100%' },
});

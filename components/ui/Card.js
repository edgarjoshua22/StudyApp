import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { palette, radius, shadow, space } from '../../lib/theme';

// Rounded "blob" surface with soft violet-tinted shadow. Pass onPress to make it
// tappable. `tint` sets a soft colored background instead of white.
export default function Card({ children, onPress, style, padded = true, tint }) {
  const content = (
    <View style={[styles.card, tint && { backgroundColor: tint }, padded && { padding: space.lg }, style]}>
      {children}
    </View>
  );
  if (onPress) {
    return <TouchableOpacity activeOpacity={0.9} onPress={onPress}>{content}</TouchableOpacity>;
  }
  return content;
}

const styles = StyleSheet.create({
  card: { backgroundColor: palette.bg, borderRadius: radius.lg, ...shadow.card },
});

import React from 'react';
import { Text, TouchableOpacity, ActivityIndicator, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { gradient as g, radius, palette, shadow } from '../../lib/theme';

// The signature CTA of the new identity: a flat rounded pill with a vivid
// gradient fill (no 3D edge). `grad` is a gradient name ('primary','mint',…)
// or a raw colors array.
export default function GradientButton({
  title, children, onPress, grad = 'primary', disabled, loading,
  style, textStyle, icon, r = radius.pill, height = 54,
}) {
  const colors = Array.isArray(grad) ? grad : g(grad);
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.88}
      style={[{ borderRadius: r }, !disabled && shadow.card, style]}
    >
      <LinearGradient
        colors={disabled ? ['#ded8ea', '#ded8ea'] : colors}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        style={[styles.grad, { borderRadius: r, minHeight: height }]}
      >
        {loading ? (
          <ActivityIndicator color={palette.white} />
        ) : (
          <View style={styles.row}>
            {icon}
            {title ? <Text style={[styles.text, textStyle]}>{title}</Text> : children}
          </View>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  grad: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, flexDirection: 'row' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: { color: palette.white, fontSize: 16, fontWeight: '800', letterSpacing: 0.3 },
});

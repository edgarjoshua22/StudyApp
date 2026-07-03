// lib/theme.js
// Single source of truth for StudyApp's look. Import what you need:
//   import { palette, gradients, unitColor, subjectEmoji, space, radius, type, shadow, solid } from '../lib/theme';
//
// IDENTITY: "vibrant & playful, but distinct" — a warm LIGHT canvas, friendly
// rounded blobs, soft shadows, and vivid GRADIENT accents (violet-led). No 3D
// button edges and no hexagons (the old Duolingo tells). Token NAMES are kept
// stable so every screen adapts automatically; only the values changed.

// ---------------------------------------------------------------------------
// Brand palette. Each accent has main / dark / soft (a LIGHT pastel tint now,
// meant to sit on the light canvas — the opposite of the old dark tints).
// ---------------------------------------------------------------------------
export const palette = {
  // Brand primary — vivid violet (replaces Duolingo green as the hero color).
  primary:     '#7c5cff', primaryDark:  '#6440e6', primarySoft: '#ece6ff',

  // Accents (retuned vivid, pastel *Soft for light surfaces).
  green:  '#22c58b', greenDark:  '#12a273', greenSoft:  '#dcf7ec',  // fresh mint
  blue:   '#3ba7ff', blueDark:   '#2b86e0', blueSoft:   '#e2f0ff',
  purple: '#8b5cf6', purpleDark: '#6d3fe0', purpleSoft: '#efe7ff',
  orange: '#ff9a3d', orangeDark: '#ec7d1a', orangeSoft: '#ffeed9',
  red:    '#ff5d73', redDark:    '#e6455f', redSoft:    '#ffe3e7',  // coral
  teal:   '#22c4c4', tealDark:   '#12a3a3', tealSoft:   '#d8f6f6',
  pink:   '#ff6fbf', pinkDark:   '#e64ea6', pinkSoft:   '#ffe1f2',
  gold:   '#ffc23d', goldDark:   '#e6a412',

  // Neutrals — warm LIGHT canvas.
  ink:      '#2b2540',  // primary text (deep plum-ink)
  inkSoft:  '#6d6683',  // secondary text
  hint:     '#a7a1b6',  // placeholder / hint
  line:     '#ece7f2',  // borders
  lineSoft: '#f4f0f9',  // hairlines
  bg:       '#ffffff',  // surfaces (cards)
  bgSoft:   '#faf7fd',  // page background (soft warm lavender-white)
  white:    '#ffffff',  // literal white: text on colored/gradient fills

  // States.
  track:        '#eee9f4',  // progress-bar track
  lockedNode:   '#eae5f1',  // a locked path node
  lockedNodeDk: '#ddd6e8',  // its edge
  lockedText:   '#b3adc2',  // text/icons on locked elements
};

// ---------------------------------------------------------------------------
// Gradients — 2-stop arrays for <LinearGradient colors={gradients.primary}>.
// The playful heart of the new identity. `gradient(name)` is a safe accessor.
// ---------------------------------------------------------------------------
export const gradients = {
  primary: ['#8b5cff', '#b18bff'],  // violet — hero CTAs
  grape:   ['#a06bff', '#6a8bff'],  // violet → blue
  sky:     ['#4db8ff', '#6a8bff'],
  mint:    ['#2fd6a6', '#1fb6c9'],
  sunset:  ['#ff9a5b', '#ff5e8a'],
  coral:   ['#ff7e6b', '#ff5e9c'],
  gold:    ['#ffcf5b', '#ff9e4d'],
};
export const gradient = (name) => gradients[name] || gradients.primary;

// ---------------------------------------------------------------------------
// Unit identity colors + matching gradient. Cycle for classrooms/units/chapters.
// ---------------------------------------------------------------------------
export const unitColors = [
  { main: palette.primary, dark: palette.primaryDark, soft: palette.primarySoft, grad: gradients.primary },
  { main: palette.blue,    dark: palette.blueDark,    soft: palette.blueSoft,    grad: gradients.sky },
  { main: palette.green,   dark: palette.greenDark,   soft: palette.greenSoft,   grad: gradients.mint },
  { main: palette.orange,  dark: palette.orangeDark,  soft: palette.orangeSoft,  grad: gradients.sunset },
  { main: palette.pink,    dark: palette.pinkDark,    soft: palette.pinkSoft,    grad: gradients.coral },
  { main: palette.teal,    dark: palette.tealDark,    soft: palette.tealSoft,    grad: gradients.mint },
  { main: palette.red,     dark: palette.redDark,     soft: palette.redSoft,     grad: gradients.coral },
];
export const unitColor = (i) => {
  const n = unitColors.length;
  return unitColors[((i % n) + n) % n];
};

// ---------------------------------------------------------------------------
// Subject -> emoji. Makes classroom/topic cards instantly readable & friendly.
// ---------------------------------------------------------------------------
const SUBJECT_EMOJI = [
  [/\b(math|calc|algebra|geometr|trig|stat)/i, '🔢'],
  [/\b(phys)/i,                                '🪐'],
  [/\b(chem)/i,                                '🧪'],
  [/\b(bio|anatom|life sci)/i,                 '🧬'],
  [/\b(comp|cs|program|coding|code|software|data)/i, '💻'],
  [/\b(elec|circuit|signal|ee\b|eng'g|engineer)/i,   '⚡'],
  [/\b(eng|english|lit|writ|read|grammar)/i,   '📖'],
  [/\b(hist|social|civic)/i,                   '🏛️'],
  [/\b(geo)/i,                                 '🌍'],
  [/\b(econ|account|finance|business|market)/i,'📈'],
  [/\b(art|design|draw|paint)/i,               '🎨'],
  [/\b(music)/i,                               '🎵'],
  [/\b(law|legal)/i,                           '⚖️'],
  [/\b(med|health|nurs|pharma)/i,              '🩺'],
  [/\b(psych)/i,                               '🧠'],
  [/\b(lang|spanish|french|nihongo|filipino|tagalog)/i, '🗣️'],
];
export function subjectEmoji(name = '') {
  for (const [re, emoji] of SUBJECT_EMOJI) if (re.test(name)) return emoji;
  return '📘';
}

// ---------------------------------------------------------------------------
// Spacing (4px base), radii (rounder now), type scale, elevation.
// ---------------------------------------------------------------------------
export const space  = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40 };
export const radius = { sm: 12, md: 16, lg: 20, xl: 26, blob: 34, pill: 999 };

export const type = {
  display: { fontSize: 32, fontWeight: '800', color: palette.ink },
  h1:      { fontSize: 25, fontWeight: '800', color: palette.ink },
  h2:      { fontSize: 20, fontWeight: '800', color: palette.ink },
  h3:      { fontSize: 17, fontWeight: '700', color: palette.ink },
  body:    { fontSize: 16, fontWeight: '500', color: palette.ink },
  label:   { fontSize: 14, fontWeight: '700', color: palette.inkSoft },
  caption: { fontSize: 13, fontWeight: '600', color: palette.inkSoft },
  tiny:    { fontSize: 11, fontWeight: '700', color: palette.hint },
};

// Soft, slightly violet-tinted ambient elevation (fits the light canvas).
export const shadow = {
  card: {
    shadowColor: '#6a4bd8', shadowOpacity: 0.10, shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 }, elevation: 3,
  },
  lift: {
    shadowColor: '#6a4bd8', shadowOpacity: 0.16, shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 }, elevation: 6,
  },
};

// DEPRECATED 3D edge — now returns a FLAT rounded surface so every legacy screen
// that still calls solid() instantly loses the Duolingo "chunky" edge. New code
// should prefer <GradientButton> / <Card>. `dark` is ignored (kept for arity).
export const solid = (main, _dark, r = radius.md) => ({
  backgroundColor: main,
  borderRadius: r,
});

export default {
  palette, gradients, gradient, unitColors, unitColor, subjectEmoji,
  space, radius, type, shadow, solid,
};

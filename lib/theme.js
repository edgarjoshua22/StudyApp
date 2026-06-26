// lib/theme.js
// Single source of truth for StudyApp's look. Import what you need:
//   import { palette, unitColor, subjectEmoji, space, radius, type, shadow, solid } from '../lib/theme';
// Duolingo-flavored DARK theme: bright solid accents on a charcoal canvas,
// chunky rounding, a "3D" bottom edge on buttons.

// ---------------------------------------------------------------------------
// Brand palette. Each accent has main / dark (the 3D edge) / soft (tint bg).
// Accents stay vivid (they pop on dark). `*Soft` are now DARK, desaturated
// tints meant to sit as subtle tinted surfaces on the dark canvas — not pastels.
// ---------------------------------------------------------------------------
export const palette = {
  green:  '#58cc02', greenDark:  '#46a302', greenSoft:  '#1e3a16',
  blue:   '#1cb0f6', blueDark:   '#1899d6', blueSoft:   '#102f3d',
  purple: '#ce82ff', purpleDark: '#a568cc', purpleSoft: '#2c2139',
  orange: '#ff9600', orangeDark: '#e08600', orangeSoft: '#3a2912',
  red:    '#ff4b4b', redDark:    '#e63946', redSoft:    '#3a1c1c',
  teal:   '#2ec4b6', tealDark:   '#21a195', tealSoft:   '#0f2f2b',
  pink:   '#ff86d0', pinkDark:   '#e05fb0', pinkSoft:   '#381f30',
  gold:   '#ffc800', goldDark:   '#e6a700',

  // Neutrals — dark canvas (Duolingo "Dark Eel" family).
  ink:      '#f4f8fb',  // primary text (near-white)
  inkSoft:  '#9fb3bf',  // secondary text
  hint:     '#62737c',  // placeholder / hint
  line:     '#38474f',  // borders
  lineSoft: '#2a3840',  // hairlines
  bg:       '#1f2c34',  // surfaces (cards) — lighter than the page
  bgSoft:   '#131f24',  // page background — cards lift above it
  white:    '#ffffff',  // literal white: text on colored fills, etc.

  // Dark-specific extras.
  track:        '#37464f',  // progress-bar track on dark
  lockedNode:   '#37464f',  // a locked path node
  lockedNodeDk: '#293841',  // its 3D edge
  lockedText:   '#5a6b75',  // text/icons on locked elements
};

// ---------------------------------------------------------------------------
// Unit identity colors. Cycle these for classrooms, chapters, etc. so each
// "unit" keeps a stable, recognizable color. (Matches LessonPath's palette.)
// ---------------------------------------------------------------------------
export const unitColors = [
  { main: palette.green,  dark: palette.greenDark,  soft: palette.greenSoft  },
  { main: palette.blue,   dark: palette.blueDark,   soft: palette.blueSoft   },
  { main: palette.purple, dark: palette.purpleDark, soft: palette.purpleSoft },
  { main: palette.orange, dark: palette.orangeDark, soft: palette.orangeSoft },
  { main: palette.red,    dark: palette.redDark,    soft: palette.redSoft    },
  { main: palette.teal,   dark: palette.tealDark,   soft: palette.tealSoft   },
  { main: palette.pink,   dark: palette.pinkDark,   soft: palette.pinkSoft   },
];
export const unitColor = (i) => {
  const n = unitColors.length;
  return unitColors[((i % n) + n) % n];
};

// ---------------------------------------------------------------------------
// Subject -> emoji. Makes classroom cards instantly readable & friendly.
// Falls back to a book. Keep literal emoji characters (JSX-safe).
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
// Spacing (4px base), radii, type scale, elevation.
// ---------------------------------------------------------------------------
export const space  = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40 };
export const radius = { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 };

export const type = {
  display: { fontSize: 30, fontWeight: '800', color: palette.ink },
  h1:      { fontSize: 24, fontWeight: '800', color: palette.ink },
  h2:      { fontSize: 20, fontWeight: '800', color: palette.ink },
  h3:      { fontSize: 17, fontWeight: '700', color: palette.ink },
  body:    { fontSize: 16, fontWeight: '500', color: palette.ink },
  label:   { fontSize: 14, fontWeight: '700', color: palette.inkSoft },
  caption: { fontSize: 13, fontWeight: '600', color: palette.inkSoft },
  tiny:    { fontSize: 11, fontWeight: '700', color: palette.hint },
};

// Soft ambient elevation (different from the 3D button edge below).
export const shadow = {
  card: {
    shadowColor: '#1c1c1c', shadowOpacity: 0.06, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  lift: {
    shadowColor: '#1c1c1c', shadowOpacity: 0.10, shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 }, elevation: 5,
  },
};

// The signature Duolingo "chunky 3D" pressable edge.
// Usage: style={[styles.btn, solid(palette.green, palette.greenDark)]}
export const solid = (main, dark, r = radius.md) => ({
  backgroundColor: main,
  borderBottomWidth: 4,
  borderBottomColor: dark,
  borderRadius: r,
});

export default {
  palette, unitColors, unitColor, subjectEmoji,
  space, radius, type, shadow, solid,
};

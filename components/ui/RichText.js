import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { palette, space } from '../../lib/theme';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// Lightweight markdown renderer for AI replies. Supports a deliberately small,
// robust subset — what the tutor actually emits — with no native dependency:
//   **bold**  __bold__   *italic*  _italic_   `code`
//   - bullet / * bullet / • bullet      1. numbered list
//   # heading … ###### heading
// Anything else renders as a normal paragraph. Inline markers work inside list
// items and headings too.

// Split one line of text into styled inline segments.
function parseInline(text) {
  const out = [];
  // Order matters: two-char markers (**, __) before the one-char one. Single-
  // underscore italics are intentionally NOT supported so terms like snake_case
  // and file_name aren't mangled; the model is told to use *asterisks* for italics.
  const re = /(\*\*|__)([\s\S]+?)\1|(\*)([\s\S]+?)\3|`([^`]+)`/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ text: m[2], bold: true });
    else if (m[4] !== undefined) out.push({ text: m[4], italic: true });
    else if (m[5] !== undefined) out.push({ text: m[5], code: true });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

function Inline({ text, baseStyle }) {
  return (
    <Text style={baseStyle}>
      {parseInline(text).map((seg, i) => {
        if (seg.code) return <Text key={i} style={styles.code}>{seg.text}</Text>;
        const s = [];
        if (seg.bold) s.push(styles.bold);
        if (seg.italic) s.push(styles.italic);
        return s.length ? <Text key={i} style={s}>{seg.text}</Text> : <Text key={i}>{seg.text}</Text>;
      })}
    </Text>
  );
}

// Turn raw text into an ordered list of block descriptors.
function parseBlocks(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { blocks.push({ type: 'space' }); continue; }

    let mm;
    if ((mm = line.match(/^\s*(#{1,6})\s+(.*)$/))) {
      blocks.push({ type: 'heading', level: mm[1].length, text: mm[2] });
    } else if ((mm = line.match(/^\s*[-*•]\s+(.*)$/))) {
      blocks.push({ type: 'bullet', text: mm[1] });
    } else if ((mm = line.match(/^\s*(\d+)\.\s+(.*)$/))) {
      blocks.push({ type: 'number', num: mm[1], text: mm[2] });
    } else {
      blocks.push({ type: 'para', text: line });
    }
  }
  return blocks;
}

export default function RichText({ text, style }) {
  const blocks = parseBlocks(text);
  return (
    <View>
      {blocks.map((b, i) => {
        // Collapse blank lines into a small gap rather than an empty row.
        if (b.type === 'space') return <View key={i} style={{ height: space.xs }} />;

        const topGap = i > 0 && blocks[i - 1].type !== 'space' ? styles.blockGap : null;

        if (b.type === 'heading') {
          return (
            <View key={i} style={topGap}>
              <Inline text={b.text} baseStyle={[style, styles.heading, b.level <= 2 && styles.headingLg]} />
            </View>
          );
        }
        if (b.type === 'bullet') {
          return (
            <View key={i} style={[styles.listRow, topGap]}>
              <Text style={[style, styles.marker]}>•</Text>
              <View style={styles.listBody}><Inline text={b.text} baseStyle={style} /></View>
            </View>
          );
        }
        if (b.type === 'number') {
          return (
            <View key={i} style={[styles.listRow, topGap]}>
              <Text style={[style, styles.marker, styles.numMarker]}>{b.num}.</Text>
              <View style={styles.listBody}><Inline text={b.text} baseStyle={style} /></View>
            </View>
          );
        }
        return (
          <View key={i} style={topGap}>
            <Inline text={b.text} baseStyle={style} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bold: { fontWeight: '800' },
  italic: { fontStyle: 'italic' },
  code: {
    fontFamily: MONO,
    backgroundColor: palette.lineSoft,
    color: palette.ink,
    borderRadius: 4,
    paddingHorizontal: 4,
  },
  heading: { fontWeight: '800' },
  headingLg: { fontSize: 17 },
  blockGap: { marginTop: space.xs },
  listRow: { flexDirection: 'row', alignItems: 'flex-start' },
  marker: { fontWeight: '800', marginRight: space.sm, lineHeight: 21 },
  numMarker: { minWidth: 18 },
  listBody: { flex: 1 },
});

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { apiFetch } from '../lib/api';
import { palette, space, radius, shadow } from '../lib/theme';

// Matching mini-game built from a classroom's flashcards. Deliberately READ-ONLY:
// a game outcome must never touch SM-2 scheduling, so we never write card state.
// Cards are pulled ignoring due_at (all cards are fair game to play with).
const PAIRS = 5;                 // cards per round -> 2 * PAIRS tiles
const MIN_CARDS = 4;

function shuffle(a) {
  const arr = [...a];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildTiles(cards) {
  const chosen = shuffle(cards).slice(0, PAIRS);
  const tiles = [];
  chosen.forEach((c) => {
    tiles.push({ key: `${c.id}-f`, cardId: c.id, text: c.front, side: 'f' });
    tiles.push({ key: `${c.id}-b`, cardId: c.id, text: c.back, side: 'b' });
  });
  return shuffle(tiles);
}

export default function MatchGame({ route, navigation }) {
  const classroom = route.params?.classroom || null;

  const [loading, setLoading] = useState(true);
  const [pool, setPool] = useState([]);        // all fetched cards
  const [tiles, setTiles] = useState([]);
  const [selected, setSelected] = useState(null);   // tile key
  const [matched, setMatched] = useState({});       // { cardId: true }
  const [wrong, setWrong] = useState([]);           // [key, key] briefly
  const [moves, setMoves] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [genMsg, setGenMsg] = useState('');
  const startRef = useRef(null);
  const busyRef = useRef(false);

  const matchedCount = Object.keys(matched).length;
  const roundPairs = tiles.length / 2;
  const won = tiles.length > 0 && matchedCount === roundPairs;

  useEffect(() => { load(); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('flashcards').select('id,front,back').limit(40);
    if (classroom) q = q.eq('classroom_id', classroom.id);
    const { data } = await q;
    const cards = data || [];
    setPool(cards);
    if (cards.length >= MIN_CARDS) newRound(cards);
    setLoading(false);
  }, [classroom]);

  function newRound(cards = pool) {
    setTiles(buildTiles(cards));
    setSelected(null);
    setMatched({});
    setWrong([]);
    setMoves(0);
    setElapsed(0);
    startRef.current = Date.now();
  }

  // Simple elapsed timer while a round is in progress.
  useEffect(() => {
    if (loading || won || tiles.length === 0) return;
    const t = setInterval(() => {
      if (startRef.current) setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(t);
  }, [loading, won, tiles.length]);

  // Award a little XP once per win (read-only reward — no SM-2 impact).
  useEffect(() => {
    if (!won) return;
    (async () => { try { await supabase.rpc('award_xp', { amount: 15 }); } catch (_) {} })();
  }, [won]);

  function onTile(tile) {
    if (busyRef.current || matched[tile.cardId] || tile.key === selected) return;
    if (!selected) { setSelected(tile.key); return; }

    const first = tiles.find((t) => t.key === selected);
    setMoves((m) => m + 1);
    if (first && first.cardId === tile.cardId && first.side !== tile.side) {
      setMatched((prev) => ({ ...prev, [tile.cardId]: true }));
      setSelected(null);
    } else {
      // Wrong: flash both red briefly, then clear.
      busyRef.current = true;
      setWrong([selected, tile.key]);
      setTimeout(() => {
        setWrong([]);
        setSelected(null);
        busyRef.current = false;
      }, 650);
    }
  }

  async function generateDeck() {
    if (!classroom || generating) return;
    setGenerating(true);
    setGenMsg('Reading your handouts and writing cards…');
    try {
      const res = await apiFetch(`/generate-flashcards?classroom_id=${classroom.id}&count=12`, { method: 'POST' });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setGenMsg('');
      await load();
    } catch (e) {
      setGenMsg(e.message || 'Could not generate flashcards.');
    } finally {
      setGenerating(false);
    }
  }

  const notEnough = !loading && pool.length < MIN_CARDS;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topbar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={26} color={palette.ink} />
        </TouchableOpacity>
        <Text style={styles.topTitle} numberOfLines={1}>Match-up</Text>
        {!loading && !notEnough && !won ? (
          <Text style={styles.counter}>{matchedCount}/{roundPairs} · {elapsed}s</Text>
        ) : <View style={{ width: 40 }} />}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={palette.primary} size="large" /></View>
      ) : notEnough ? (
        <View style={styles.center}>
          <Text style={styles.bigEmoji}>🃏</Text>
          <Text style={styles.doneTitle}>Not enough cards yet</Text>
          <Text style={styles.doneSub}>Match-up needs at least {MIN_CARDS} flashcards in this subject.</Text>
          {genMsg ? <Text style={styles.genMsg}>{genMsg}</Text> : null}
          {classroom ? (
            <TouchableOpacity style={[styles.cta, generating && styles.dim]} onPress={generateDeck} disabled={generating} activeOpacity={0.85}>
              {generating ? <ActivityIndicator color={palette.white} /> : <Text style={styles.ctaText}>✨ Generate flashcards</Text>}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.cta} onPress={() => navigation.goBack()} activeOpacity={0.85}>
              <Text style={styles.ctaText}>Back</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : won ? (
        <View style={styles.center}>
          <Text style={styles.bigEmoji}>🎉</Text>
          <Text style={styles.doneTitle}>Matched them all!</Text>
          <Text style={styles.doneSub}>{roundPairs} pairs in {moves} taps · {elapsed}s</Text>
          <TouchableOpacity style={styles.cta} onPress={() => newRound()} activeOpacity={0.85}>
            <Text style={styles.ctaText}>Play again</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={styles.secondaryText}>Done</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>
          {tiles.map((t) => {
            const isMatched = !!matched[t.cardId];
            const isSel = selected === t.key;
            const isWrong = wrong.includes(t.key);
            return (
              <TouchableOpacity
                key={t.key}
                style={[
                  styles.tile,
                  t.side === 'f' ? styles.tileFront : styles.tileBack,
                  isSel && styles.tileSel,
                  isWrong && styles.tileWrong,
                  isMatched && styles.tileMatched,
                ]}
                onPress={() => onTile(t)}
                disabled={isMatched}
                activeOpacity={0.85}
              >
                <Text style={[styles.tileText, isMatched && styles.tileTextMatched]} numberOfLines={5}>
                  {isMatched ? '✓' : t.text}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bgSoft },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: space.xxl },

  topbar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.sm },
  backBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  topTitle: { flex: 1, fontSize: 17, fontWeight: '800', color: palette.ink },
  counter: { fontSize: 14, fontWeight: '800', color: palette.inkSoft, textAlign: 'right' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', padding: space.lg, gap: space.md },
  tile: {
    width: '47%', minHeight: 96, borderRadius: radius.lg, padding: space.md,
    justifyContent: 'center', alignItems: 'center', ...shadow.card, borderWidth: 2, borderColor: 'transparent',
  },
  tileFront: { backgroundColor: palette.primarySoft },
  tileBack: { backgroundColor: palette.bg },
  tileSel: { borderColor: palette.primary },
  tileWrong: { borderColor: palette.red, backgroundColor: palette.redSoft },
  tileMatched: { backgroundColor: palette.greenSoft, borderColor: palette.greenSoft },
  tileText: { fontSize: 14, fontWeight: '700', color: palette.ink, textAlign: 'center', lineHeight: 19 },
  tileTextMatched: { color: palette.greenDark, fontSize: 28 },

  bigEmoji: { fontSize: 60, marginBottom: space.md },
  doneTitle: { fontSize: 24, fontWeight: '800', color: palette.ink },
  doneSub: { fontSize: 15, color: palette.inkSoft, textAlign: 'center', marginTop: space.sm, lineHeight: 22 },
  genMsg: { marginTop: space.lg, fontSize: 13, color: palette.inkSoft, textAlign: 'center', fontWeight: '600' },
  cta: { marginTop: space.xl, backgroundColor: palette.primary, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: 40, minHeight: 52, justifyContent: 'center', ...shadow.card },
  ctaText: { color: palette.white, fontSize: 16, fontWeight: '800' },
  secondary: { marginTop: space.md, paddingVertical: 10 },
  secondaryText: { color: palette.inkSoft, fontSize: 15, fontWeight: '800' },
  dim: { opacity: 0.6 },
});

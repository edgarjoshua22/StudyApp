import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Alert, Animated, Easing, Modal, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { API_BASE } from '../lib/api';
import { palette, radius, subjectEmoji } from '../lib/theme';

// One palette per chapter, cycled. (main = header fill, dark = 3D edge, hex = tile art)
const UNIT_COLORS = [
  { main: '#58cc02', dark: '#46a302', hex: 'green' },
  { main: '#1cb0f6', dark: '#1899d6', hex: 'blue' },
  { main: '#ce82ff', dark: '#a568cc', hex: 'purple' },
  { main: '#ff9600', dark: '#e08600', hex: 'orange' },
  { main: '#ff4b4b', dark: '#d63a3a', hex: 'red' },
  { main: '#2ec4b6', dark: '#21a195', hex: 'teal' },
];

// Custom hexagon-tile + icon art (sliced from the Nano Banana sheets).
const HEX = {
  green:  require('../assets/icons/hex_green.png'),
  blue:   require('../assets/icons/hex_blue.png'),
  purple: require('../assets/icons/hex_purple.png'),
  orange: require('../assets/icons/hex_orange.png'),
  red:    require('../assets/icons/hex_red.png'),
  teal:   require('../assets/icons/hex_teal.png'),
  locked: require('../assets/icons/hex_locked.png'),
};
const STATE_ICON = {
  play:   require('../assets/icons/icon_play.png'),
  star:   require('../assets/icons/icon_star.png'),
  check:  require('../assets/icons/icon_check.png'),
  trophy: require('../assets/icons/icon_trophy.png'),
  lock:   require('../assets/icons/icon_lock.png'),
  crown:  require('../assets/icons/icon_crown.png'),
};
const PROP_ICON = {
  chest: require('../assets/icons/prop_chest.png'),
  door:  require('../assets/icons/prop_door.png'),
  char:  require('../assets/icons/prop_mascot.png'),
  flag:  require('../assets/icons/prop_flag.png'),
};
const STAT_ICON = {
  streak: require('../assets/icons/stat_streak.png'),
  xp:     require('../assets/icons/stat_xp.png'),
  goal:   require('../assets/icons/stat_goal.png'),
};
const COURSE_ICON = require('../assets/icons/top_course.png');
// Gentle winding so the trail reads as a path. Amplitude kept modest so nodes,
// rings and side-props never clip on narrow (~340px) phones.
const ZIGZAG = [0, 34, 48, 34, 0, -34, -48, -34];

const CHEERS = [
  "You're on a roll — keep mapping it out!",
  'Nice momentum! Each node makes the picture clearer.',
  'One step at a time. You’ve got this!',
  'Your brain map is growing 🧠',
];

function daysUntil(iso) {
  return Math.floor((new Date(iso).getTime() - Date.now()) / 86400000);
}
function countdownLabel(iso) {
  const d = daysUntil(iso);
  if (d < 0) return 'past';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  return `in ${d} days`;
}

export default function LessonPath({ route, navigation }) {
  const { classroom } = route.params;
  const insets = useSafeAreaInsets();
  const [units, setUnits] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [progress, setProgress] = useState({});
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [openingId, setOpeningId] = useState(null);
  const [activeUnit, setActiveUnit] = useState(0);
  const [classrooms, setClassrooms] = useState([]);   // for the course switcher
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const offsetsRef = useRef({});      // unit index -> y position of its header

  useFocusEffect(useCallback(() => {
    navigation.setOptions({ title: `${classroom.name} · Path` });
    load();
  }, []));

  async function load() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // All the student's classrooms — powers the top course switcher.
      const { data: cls } = await supabase
        .from('classrooms').select('*').order('created_at', { ascending: true });
      setClassrooms(cls || []);

      const { data: lessons } = await supabase
        .from('lessons').select('*')
        .eq('classroom_id', classroom.id)
        .order('unit_order', { ascending: true })
        .order('lesson_order', { ascending: true });

      const { data: prog } = await supabase
        .from('lesson_progress').select('lesson_id,best_score,total')
        .eq('user_id', user?.id);
      const pmap = {};
      (prog || []).forEach((p) => { pmap[p.lesson_id] = p; });
      setProgress(pmap);

      // Gamification stats for the top bar — same source as Profile.
      const { data: prof } = await supabase
        .from('profiles')
        .select('xp,daily_xp,daily_xp_date,daily_goal,current_streak,longest_streak,last_active_date')
        .eq('id', user?.id).maybeSingle();
      const todayStr = new Date().toLocaleDateString('en-CA');
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      const yStr = yesterday.toLocaleDateString('en-CA');
      const dailyGoal = prof?.daily_goal ?? 50;
      const dailyXp = prof?.daily_xp_date === todayStr ? (prof?.daily_xp ?? 0) : 0;
      const alive = prof?.last_active_date === todayStr || prof?.last_active_date === yStr;
      setStats({
        streak: alive ? (prof?.current_streak ?? 0) : 0,
        totalXp: prof?.xp ?? 0,
        dailyXp, dailyGoal,
      });

      // Group lessons into units by unit_order
      const byUnit = [];
      let curKey = null, cur = null;
      (lessons || []).forEach((l) => {
        if (l.unit_order !== curKey) {
          curKey = l.unit_order;
          cur = { unit_order: l.unit_order, document_id: l.document_id, topic_id: l.topic_id, lessons: [] };
          byUnit.push(cur);
        }
        cur.lessons.push(l);
      });

      // Every handout referenced by any lesson (a topic's chunks can span several)
      const docIds = [...new Set((lessons || []).map((l) => l.document_id).filter(Boolean))];
      const names = {};
      const docExamId = {};
      if (docIds.length) {
        const { data: docs } = await supabase
          .from('documents').select('id,file_name,exam_id').in('id', docIds);
        (docs || []).forEach((d) => {
          names[d.id] = (d.file_name || 'Handout').replace(/\.pdf$/i, '');
          docExamId[d.id] = d.exam_id || null;
        });
      }

      // Topic names + AI intros drive the chapter cards
      const topicIds = [...new Set(byUnit.map((u) => u.topic_id).filter(Boolean))];
      const topicMeta = {};
      if (topicIds.length) {
        const { data: tps } = await supabase
          .from('topics').select('id,name,intro,is_bridge').in('id', topicIds);
        (tps || []).forEach((t) => { topicMeta[t.id] = t; });
      }

      const { data: examRows } = await supabase
        .from('exams').select('id,name,exam_date').eq('classroom_id', classroom.id);
      const examById = {};
      (examRows || []).forEach((e) => { examById[e.id] = e; });

      let tnum = 0;
      byUnit.forEach((u, i) => {
        const first = u.lessons[0] || {};
        u.kind = first.kind === 'exam' ? 'exam' : (u.topic_id ? 'topic' : 'extra');
        const meta = topicMeta[u.topic_id];
        if (u.kind === 'exam') {
          u.title = first.title || 'Exam';
          u.kicker = 'EXAM';
        } else if (u.kind === 'topic') {
          u.isBridge = !!(meta && meta.is_bridge);
          if (!u.isBridge) { tnum += 1; u.topicNumber = tnum; }
          u.title = (meta && meta.name) || (u.isBridge ? 'Foundation' : `Topic ${tnum}`);
          u.intro = meta && meta.intro;
          u.kicker = u.isBridge ? '✨ AI FOUNDATION' : `CHAPTER ${tnum}`;
        } else {
          u.title = 'Additional material';
          u.kicker = 'BONUS';
        }
        u.color = UNIT_COLORS[i % UNIT_COLORS.length];
        u.exam = examById[docExamId[u.document_id]] || null;
        u.handouts = [...new Set(u.lessons.map((l) => names[l.document_id]).filter(Boolean))];
      });

      // Pace, from the actual lesson nodes on the path (stays true across reloads)
      const lessonsByExam = {};
      byUnit.forEach((u) => {
        if (!u.exam) return;
        const c = u.lessons.filter((l) => l.kind === 'lesson').length;
        lessonsByExam[u.exam.id] = (lessonsByExam[u.exam.id] || 0) + c;
      });
      const sched = (examRows || [])
        .filter((e) => e.exam_date && lessonsByExam[e.id])
        .map((e) => {
          const du = daysUntil(e.exam_date);
          const studyDays = Math.max(1, du - 3);
          const totalLessons = lessonsByExam[e.id];
          const perDay = Math.ceil(totalLessons / studyDays);
          return {
            id: e.id, name: e.name, exam_date: e.exam_date, totalLessons, perDay,
            pace: perDay > 1 ? `≈${perDay} lessons/day to finish on time` : null,
          };
        })
        .sort((a, b) => new Date(a.exam_date) - new Date(b.exam_date));

      setUnits(byUnit);
      setSchedule(sched);
      setActiveUnit(0);
      offsetsRef.current = {};

      // Warm the next couple of tiles in the background so they open instantly.
      if ((lessons || []).length) {
        fetch(`${API_BASE}/prewarm-lessons?classroom_id=${classroom.id}&count=2`, { method: 'POST' })
          .catch(() => {});
      }
    } catch (e) {
      Alert.alert('Could not load your path', e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function postBuild(rebuild) {
    setBuilding(true);
    try {
      const res = await fetch(
        `${API_BASE}/build-path?classroom_id=${classroom.id}${rebuild ? '&rebuild=true' : ''}`,
        { method: 'POST' }
      );
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error(`Server error ${res.status}: ${text.slice(0, 140) || 'no response body'}`); }
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
      if (data.error) throw new Error(data.error);
      await load();
    } catch (e) {
      Alert.alert(
        rebuild ? 'Could not rebuild the path' : 'Could not build the path',
        e.message || "Make sure Docker is running and lib/api.js has your PC's current IPv4."
      );
    } finally {
      setBuilding(false);
    }
  }
  const buildPath = () => postBuild(false);
  const rebuildPath = () => postBuild(true);

  function confirmRebuild() {
    Alert.alert(
      'Rebuild path?',
      'This regenerates every chapter from your topics using the latest settings. It resets your lesson progress for THIS classroom (your XP and streak are not affected).',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Rebuild', style: 'destructive', onPress: rebuildPath },
      ]
    );
  }

  async function openLesson(lesson) {
    setOpeningId(lesson.id);
    try {
      const res = await fetch(`${API_BASE}/lesson-quiz?lesson_id=${lesson.id}`, { method: 'POST' });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch { throw new Error(`Server error ${res.status}: ${text.slice(0, 140) || 'no response body'}`); }
      if (!res.ok) throw new Error(data.error || `Server error ${res.status}`);
      if (data.error) throw new Error(data.error);
      navigation.navigate('Quiz', { quiz: data, lesson: { id: lesson.id } });
    } catch (e) {
      Alert.alert(
        'Could not start the lesson',
        e.message || "Make sure Docker is running and lib/api.js has your PC's current IPv4."
      );
    } finally {
      setOpeningId(null);
    }
  }

  // Unlock logic: walk every node in order. Completed ones are done; the FIRST
  // not-yet-completed node is "current"; everything after stays locked.
  const flat = units.flatMap((u) => u.lessons.filter((l) => l.kind !== 'checkpoint'));
  const firstOpen = flat.find((l) => !progress[l.id]);
  const currentId = firstOpen ? firstOpen.id : null;
  const allDone = flat.length > 0 && currentId === null;
  const doneCount = flat.filter((l) => progress[l.id]).length;

  function stateOf(lesson) {
    if (progress[lesson.id]) return 'done';
    if (lesson.id === currentId) return 'current';
    return 'locked';
  }

  function mascotLine() {
    if (allDone) return "You've mapped the whole course. Incredible! 🎉";
    const soon = schedule.find((s) => daysUntil(s.exam_date) >= 0 && daysUntil(s.exam_date) <= 5);
    if (soon) return `${soon.name} is ${countdownLabel(soon.exam_date)} — let's get you ready!`;
    if (doneCount === 0) return 'Ready to dive in? Tap START to begin your first lesson!';
    return CHEERS[doneCount % CHEERS.length];
  }

  // Which unit's header should the pinned banner mirror? (scroll-spy)
  function onScroll(e) {
    const y = e.nativeEvent.contentOffset.y;
    let best = 0, bestY = -1;
    for (const [i, oy] of Object.entries(offsetsRef.current)) {
      if (oy <= y + 12 && oy > bestY) { bestY = oy; best = Number(i); }
    }
    if (best !== activeUnit) setActiveUnit(best);
  }

  // ---------- Loading ----------
  if (loading) {
    return (
      <View style={[styles.container, styles.center]}>
        <ActivityIndicator size="large" color={palette.green} />
      </View>
    );
  }

  // ---------- Empty ----------
  if (units.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['bottom']}>
        <View style={styles.center}>
          <Text style={styles.emptyEmoji}>🗺️</Text>
          <Text style={styles.emptyTitle}>No learning path yet</Text>
          <Text style={styles.emptyText}>
            Build a path from your topics. Each topic becomes a chapter of short lessons,
            with a quiz after each and exam milestones along the way.
          </Text>
          <TouchableOpacity
            style={[styles.bigBtn, building && styles.bigBtnDisabled]}
            onPress={buildPath} disabled={building} activeOpacity={0.8}
          >
            {building ? <ActivityIndicator color="#fff" /> : <Text style={styles.bigBtnText}>BUILD MY PATH</Text>}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ---------- Path ----------
  const active = units[activeUnit] || units[0];
  let nodeCounter = -1;

  return (
    <View style={styles.container}>
      {/* Sticky top stats bar (streak / XP / daily goal) */}
      <StatsBar stats={stats} insetTop={insets.top} nav={(s) => navigation.navigate(s)} />

      {/* Back affordance (header is hidden for a full-bleed, Duolingo-style top) */}
      <TouchableOpacity
        style={[styles.backBtn, { top: insets.top + 6 }]}
        onPress={() => navigation.goBack()}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        activeOpacity={0.7}
      >
        <Ionicons name="chevron-back" size={26} color={palette.inkSoft} />
      </TouchableOpacity>

      {/* Course switcher — jump straight to another classroom's path */}
      <TouchableOpacity
        style={[styles.switchBtn, { top: insets.top + 6 }]}
        onPress={() => setSwitcherOpen(true)}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        activeOpacity={0.7}
      >
        <Image source={COURSE_ICON} style={styles.switchImg} resizeMode="contain" />
      </TouchableOpacity>

      {/* Sticky unit banner — mirrors whichever chapter you're scrolled to */}
      <PinnedBanner unit={active} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 72 }}
        onScroll={onScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topStrip}>
          <Mascot line={mascotLine()} />
          <ProgressBar done={doneCount} total={flat.length} />
        </View>

        {schedule.length > 0 && (
          <View style={styles.scheduleWrap}>
            {schedule.map((s) => (
              <View key={s.id} style={[styles.scheduleCard, s.pace ? styles.scheduleCardWarn : styles.scheduleCardOk]}>
                <View style={styles.scheduleTop}>
                  <Ionicons name="calendar" size={20} color={s.pace ? palette.orange : palette.blue} />
                  <Text style={styles.scheduleName} numberOfLines={1}>{s.name}</Text>
                  <Text style={styles.scheduleCountdown}>{countdownLabel(s.exam_date)}</Text>
                </View>
                <Text style={[styles.schedulePace, s.pace ? styles.schedulePaceWarn : styles.schedulePaceOk]}>
                  {s.pace ? `⚡ ${s.pace}` : '✓ On track · about 1 lesson/day'}
                </Text>
              </View>
            ))}
          </View>
        )}

        {allDone && (
          <View style={styles.doneBanner}>
            <Text style={styles.doneBannerEmoji}>🎉</Text>
            <Text style={styles.doneBannerText}>You've finished every lesson — review any node to keep your streak alive!</Text>
          </View>
        )}

        {units.map((unit, ui) => {
          if (unit.kind === 'exam') {
            const node = unit.lessons[0];
            return (
              <View
                key={unit.unit_order}
                onLayout={(e) => { offsetsRef.current[ui] = e.nativeEvent.layout.y; }}
              >
                <ExamTile
                  unit={unit}
                  node={node}
                  state={stateOf(node)}
                  busy={openingId === node.id}
                  onPress={() => {
                    if (stateOf(node) === 'locked') {
                      Alert.alert('Locked', 'Finish the topics this exam covers first.');
                      return;
                    }
                    openLesson(node);
                  }}
                />
              </View>
            );
          }
          const quizNodes = unit.lessons.filter((l) => l.kind !== 'checkpoint');
          const uDone = quizNodes.filter((l) => progress[l.id]).length;
          return (
            <View
              key={unit.unit_order}
              style={styles.section}
              onLayout={(e) => { offsetsRef.current[ui] = e.nativeEvent.layout.y; }}
            >
              <SectionHeader unit={unit} done={uDone} total={quizNodes.length} />
              <View style={styles.trail}>
                <View style={styles.spine} />
                {unit.lessons.map((lesson, li) => {
                  if (lesson.kind === 'checkpoint') {
                    return <CheckpointMarker key={lesson.id} title={lesson.title} color={unit.color} />;
                  }
                  nodeCounter += 1;
                  const offset = ZIGZAG[nodeCounter % ZIGZAG.length];
                  const isReview = lesson.kind === 'review';
                  return (
                    <React.Fragment key={lesson.id}>
                      <LessonNode
                        lesson={lesson}
                        state={stateOf(lesson)}
                        color={unit.color}
                        offset={offset}
                        busy={openingId === lesson.id}
                        onPress={() => {
                          if (stateOf(lesson) === 'locked') {
                            Alert.alert('Locked', 'Finish the lesson before this one first.');
                            return;
                          }
                          openLesson(lesson);
                        }}
                      />
                      {/* Decorative props sprinkled along the trail */}
                      {isReview && (
                        <TrailProp kind="chest" color={unit.color} side={offset >= 0 ? -1 : 1} />
                      )}
                      {!isReview && li === 0 && unit.isBridge && (
                        <TrailProp kind="door" color={unit.color} side={offset >= 0 ? -1 : 1} />
                      )}
                      {!isReview && li === 1 && (
                        <TrailProp kind="char" color={unit.color} side={offset >= 0 ? -1 : 1} />
                      )}
                    </React.Fragment>
                  );
                })}
              </View>
            </View>
          );
        })}

        <TouchableOpacity
          style={[styles.refreshBtn, building && styles.bigBtnDisabled]}
          onPress={buildPath} disabled={building} activeOpacity={0.8}
        >
          {building ? <ActivityIndicator color={palette.inkSoft} />
            : <><Ionicons name="add-circle-outline" size={18} color={palette.inkSoft} />
                <Text style={styles.refreshText}>Add new topics to the path</Text></>}
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.rebuildBtn, building && styles.bigBtnDisabled]}
          onPress={confirmRebuild} disabled={building} activeOpacity={0.8}
        >
          <Ionicons name="refresh" size={16} color={palette.red} />
          <Text style={styles.rebuildText}>Rebuild path from scratch</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Classroom switcher sheet */}
      <Modal visible={switcherOpen} transparent animationType="fade" onRequestClose={() => setSwitcherOpen(false)}>
        <TouchableOpacity style={styles.switchBackdrop} activeOpacity={1} onPress={() => setSwitcherOpen(false)}>
          <View style={styles.switchSheet}>
            <Text style={styles.switchTitle}>Your classrooms</Text>
            <ScrollView>
              {classrooms.map((c) => {
                const isCurrent = c.id === classroom.id;
                return (
                  <TouchableOpacity
                    key={c.id}
                    style={styles.switchRow}
                    activeOpacity={0.7}
                    onPress={() => {
                      setSwitcherOpen(false);
                      if (!isCurrent) navigation.push('LessonPath', { classroom: c });
                    }}
                  >
                    <Text style={styles.switchEmoji}>{subjectEmoji(c.name)}</Text>
                    <Text style={styles.switchName} numberOfLines={1}>{c.name}</Text>
                    {isCurrent
                      ? <Ionicons name="checkmark-circle" size={20} color={palette.green} />
                      : <Ionicons name="chevron-forward" size={18} color={palette.hint} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

// ---------- Top stats bar ----------
function Stat({ src, color, value, onPress }) {
  return (
    <TouchableOpacity style={styles.statPill} activeOpacity={0.7} onPress={onPress}>
      <Image source={src} style={styles.statImg} resizeMode="contain" />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
    </TouchableOpacity>
  );
}
function StatsBar({ stats, insetTop, nav }) {
  const s = stats || {};
  return (
    <View style={[styles.statsBar, { paddingTop: insetTop + 8 }]}>
      <Stat src={STAT_ICON.streak} color={palette.orange} value={s.streak ?? 0} onPress={() => nav('Streak')} />
      <Stat src={STAT_ICON.xp} color={palette.gold} value={s.totalXp ?? 0} onPress={() => nav('Quests')} />
      <Stat src={STAT_ICON.goal} color={palette.green} value={`${s.dailyXp ?? 0}/${s.dailyGoal ?? 0}`} onPress={() => nav('Quests')} />
    </View>
  );
}

// ---------- Pinned chapter banner (mirrors the scrolled-to unit) ----------
function PinnedBanner({ unit }) {
  if (!unit) return null;
  return (
    <View style={[styles.pinned, { backgroundColor: unit.color.main, borderBottomColor: unit.color.dark }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.pinnedKicker} numberOfLines={1}>{unit.kicker}</Text>
        <Text style={styles.pinnedTitle} numberOfLines={1}>{unit.title}</Text>
      </View>
      <View style={styles.guidebook}>
        <Ionicons name="reader" size={22} color={palette.white} />
      </View>
    </View>
  );
}

// ---------- Mascot (a friendly brain that reacts to your progress) ----------
function Mascot({ line }) {
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: -5, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(bob, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <View style={styles.mascotRow}>
      <Animated.Text style={[styles.mascotFace, { transform: [{ translateY: bob }] }]}>🧠</Animated.Text>
      <View style={styles.mascotBubble}>
        <Text style={styles.mascotText}>{line}</Text>
        <View style={styles.mascotTail} />
      </View>
    </View>
  );
}

function ProgressBar({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <View style={styles.pbWrap}>
      <View style={styles.pbTrack}><View style={[styles.pbFill, { width: `${pct}%` }]} /></View>
      <Text style={styles.pbLabel}>{done}/{total} lessons · {pct}%</Text>
    </View>
  );
}

// ---------- Chapter header card (topic name + AI intro + handouts + progress) ----------
function SectionHeader({ unit, done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <View style={[styles.sectionHeader, { backgroundColor: unit.color.main, borderBottomColor: unit.color.dark }]}>
      <View style={styles.sectionHeaderTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionKicker}>{unit.kicker}</Text>
          <Text style={styles.sectionTitle} numberOfLines={2}>{unit.title}</Text>
        </View>
        <View style={styles.guidebook}>
          <Ionicons name="reader" size={22} color={palette.white} />
        </View>
      </View>
      {unit.isBridge
        ? <Text style={styles.sectionIntro}>Built by AI to fill a gap your handouts skip — upload material on this to replace it.</Text>
        : (unit.intro ? <Text style={styles.sectionIntro}>{unit.intro}</Text> : null)}
      {unit.handouts && unit.handouts.length ? (
        <View style={styles.chipRow}>
          {unit.handouts.slice(0, 4).map((h, i) => (
            <View key={i} style={styles.chip}>
              <Text style={styles.chipText} numberOfLines={1}>📄 {h}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.sectionPbTrack}>
        <View style={[styles.sectionPbFill, { width: `${pct}%` }]} />
      </View>
    </View>
  );
}

// ---------- A single hexagon tile on the winding beehive trail ----------
function LessonNode({ lesson, state, color, offset, busy, onPress }) {
  const isReview = lesson.kind === 'review';
  const done = state === 'done';
  const current = state === 'current';
  const locked = state === 'locked';

  const bounce = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!current) return;
    const b = Animated.loop(Animated.sequence([
      Animated.timing(bounce, { toValue: -6, duration: 600, useNativeDriver: true }),
      Animated.timing(bounce, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]));
    const p = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1.07, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
    ]));
    b.start(); p.start();
    return () => { b.stop(); p.stop(); };
  }, [current]);

  const hexSrc = locked ? HEX.locked : (HEX[color.hex] || HEX.green);
  let iconKey;
  if (locked) iconKey = 'lock';
  else if (isReview) iconKey = 'trophy';
  else if (done) iconKey = 'check';
  else if (current) iconKey = 'play';
  else iconKey = 'star';

  return (
    <View style={[styles.nodeRow, { transform: [{ translateX: offset }] }]}>
      {current && (
        <Animated.View style={[styles.startBubble, { transform: [{ translateY: bounce }] }]}>
          <Text style={styles.startText}>{done ? 'REVIEW' : 'START'}</Text>
          <View style={styles.startTail} />
        </Animated.View>
      )}
      <Animated.View style={{ transform: [{ scale: current ? pulse : 1 }] }}>
        <TouchableOpacity
          style={styles.hexWrap}
          activeOpacity={locked ? 1 : 0.85}
          onPress={onPress}
          disabled={busy}
        >
          <Image source={hexSrc} style={styles.hexImg} resizeMode="contain" />
          <View style={styles.hexIconWrap}>
            {busy
              ? <ActivityIndicator color={locked ? palette.lockedText : '#fff'} />
              : <Image source={STATE_ICON[iconKey]} style={styles.hexIcon} resizeMode="contain" />}
          </View>
        </TouchableOpacity>
      </Animated.View>
      <Text style={[styles.nodeLabel, locked && styles.nodeLabelLocked]} numberOfLines={1}>
        {isReview ? 'Topic quiz' : lesson.title}
      </Text>
    </View>
  );
}

// ---------- Decorative trail props (chest / character / milestone door) ----------
function TrailProp({ kind, side }) {
  const shift = 96 * side;
  const src = PROP_ICON[kind] || PROP_ICON.char;
  return (
    <View style={[styles.prop, { transform: [{ translateX: shift }] }]}>
      <Image source={src} style={styles.propImg} resizeMode="contain" />
    </View>
  );
}

// ---------- A passive checkpoint signpost (legacy lesson-plan markers) ----------
function CheckpointMarker({ title, color }) {
  return (
    <View style={styles.checkpointRow}>
      <View style={[styles.checkpointPill, { backgroundColor: color.main, borderColor: color.dark }]}>
        <Ionicons name="flag" size={15} color="#fff" />
        <Text style={styles.checkpointText} numberOfLines={2}>{title}</Text>
      </View>
    </View>
  );
}

// ---------- Exam milestone tile (gated, opens a broader exam quiz) ----------
function ExamTile({ unit, node, state, busy, onPress }) {
  const done = state === 'done';
  const locked = state === 'locked';
  const exam = unit.exam;
  return (
    <View style={styles.examWrap}>
      <View style={styles.examDivider} />
      <TouchableOpacity
        style={[styles.examTile, locked && styles.examTileLocked]}
        activeOpacity={locked ? 1 : 0.85}
        onPress={onPress}
        disabled={busy}
      >
        <View style={styles.examIcon}>
          {busy ? <ActivityIndicator color="#fff" />
            : <Ionicons name={done ? 'ribbon' : (locked ? 'lock-closed' : 'school')} size={26} color={locked ? palette.lockedText : '#fff'} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.examKicker, locked && { color: palette.lockedText }]}>EXAM</Text>
          <Text style={[styles.examName, locked && { color: palette.lockedText }]} numberOfLines={1}>{node.title}</Text>
          {exam && exam.exam_date ? (
            <Text style={[styles.examMeta, locked && { color: palette.lockedText }]}>{countdownLabel(exam.exam_date)}</Text>
          ) : null}
        </View>
        {!locked && !busy ? <Ionicons name="chevron-forward" size={22} color="#fff" /> : null}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.bgSoft },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },

  emptyEmoji: { fontSize: 64, marginBottom: 12 },
  emptyTitle: { fontSize: 22, fontWeight: 'bold', color: palette.ink, marginBottom: 10 },
  emptyText: { fontSize: 15, color: palette.inkSoft, textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  bigBtn: { alignSelf: 'stretch', backgroundColor: palette.green, borderBottomWidth: 4, borderBottomColor: palette.greenDark,
    paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  bigBtnDisabled: { opacity: 0.7 },
  bigBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold', letterSpacing: 0.5 },

  // Top stats bar
  statsBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingHorizontal: 56, paddingBottom: 10, backgroundColor: palette.bgSoft },
  statPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    backgroundColor: palette.bg, borderRadius: radius.pill, paddingVertical: 7, paddingHorizontal: 8 },
  statValue: { fontSize: 15, fontWeight: '800' },
  statImg: { width: 22, height: 22 },
  backBtn: { position: 'absolute', left: 8, zIndex: 20, width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center' },
  switchBtn: { position: 'absolute', right: 8, zIndex: 20, width: 36, height: 36,
    alignItems: 'center', justifyContent: 'center' },
  switchImg: { width: 26, height: 26 },
  switchBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: 28 },
  switchSheet: { backgroundColor: palette.bg, borderRadius: radius.xl, paddingVertical: 8, maxHeight: '70%' },
  switchTitle: { fontSize: 13, fontWeight: '800', color: palette.inkSoft, paddingHorizontal: 18, paddingVertical: 12, letterSpacing: 0.5 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 14, borderTopWidth: 1, borderTopColor: palette.lineSoft },
  switchEmoji: { fontSize: 22 },
  switchName: { flex: 1, fontSize: 16, fontWeight: '700', color: palette.ink },

  // Pinned chapter banner
  pinned: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16,
    paddingVertical: 12, borderBottomWidth: 4 },
  pinnedKicker: { fontSize: 11, fontWeight: 'bold', letterSpacing: 1.4, color: 'rgba(255,255,255,0.85)' },
  pinnedTitle: { fontSize: 18, fontWeight: '800', color: '#fff', marginTop: 1 },
  guidebook: { width: 44, height: 44, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center' },

  // Top strip: mascot + overall progress
  topStrip: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  mascotRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mascotFace: { fontSize: 40 },
  mascotBubble: { flex: 1, backgroundColor: palette.bg, borderRadius: 16, borderWidth: 2, borderColor: palette.line,
    paddingVertical: 10, paddingHorizontal: 14 },
  mascotText: { fontSize: 14, color: palette.ink, fontWeight: '600', lineHeight: 19 },
  mascotTail: { position: 'absolute', left: -8, top: 18, width: 14, height: 14, backgroundColor: palette.bg,
    borderLeftWidth: 2, borderBottomWidth: 2, borderColor: palette.line, transform: [{ rotate: '45deg' }] },
  pbWrap: { marginTop: 14 },
  pbTrack: { height: 14, backgroundColor: palette.track, borderRadius: 7, overflow: 'hidden' },
  pbFill: { height: '100%', backgroundColor: palette.gold, borderRadius: 7 },
  pbLabel: { fontSize: 12, color: palette.inkSoft, fontWeight: '700', marginTop: 5, textAlign: 'right' },

  // Exam schedule banner
  scheduleWrap: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  scheduleCard: { borderRadius: 14, padding: 14, borderWidth: 2 },
  scheduleCardOk: { backgroundColor: palette.blueSoft, borderColor: palette.blueDark },
  scheduleCardWarn: { backgroundColor: palette.orangeSoft, borderColor: palette.orangeDark },
  scheduleTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  scheduleName: { flex: 1, fontSize: 15, fontWeight: 'bold', color: palette.ink },
  scheduleCountdown: { fontSize: 12, fontWeight: '700', color: palette.inkSoft },
  schedulePace: { fontSize: 13, fontWeight: '600', marginTop: 6 },
  schedulePaceOk: { color: palette.blue },
  schedulePaceWarn: { color: palette.orange },

  doneBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.orangeSoft,
    borderBottomWidth: 1, borderBottomColor: palette.orangeDark, paddingVertical: 14, paddingHorizontal: 20, marginTop: 12 },
  doneBannerEmoji: { fontSize: 26 },
  doneBannerText: { flex: 1, color: palette.orange, fontSize: 13, fontWeight: '600' },

  // Chapter
  section: { marginTop: 22 },
  sectionHeader: { marginHorizontal: 16, borderRadius: 18, padding: 18, borderBottomWidth: 5 },
  sectionHeaderTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  sectionKicker: { fontSize: 12, fontWeight: 'bold', letterSpacing: 1.5, color: 'rgba(255,255,255,0.85)', marginBottom: 4 },
  sectionTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  sectionIntro: { fontSize: 14, color: 'rgba(255,255,255,0.95)', lineHeight: 20, marginTop: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  chip: { backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 10, paddingVertical: 4, paddingHorizontal: 9, maxWidth: 180 },
  chipText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  sectionPbTrack: { height: 8, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 4, overflow: 'hidden', marginTop: 14 },
  sectionPbFill: { height: '100%', backgroundColor: '#fff', borderRadius: 4 },

  // Trail
  trail: { position: 'relative', paddingVertical: 10 },
  spine: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 4, marginLeft: -2,
    backgroundColor: palette.lineSoft, borderRadius: 2 },

  nodeRow: { alignItems: 'center', marginVertical: 14 },
  hexWrap: { width: 104, height: 96, alignItems: 'center', justifyContent: 'center' },
  hexImg: { width: 104, height: 96 },
  hexIconWrap: { position: 'absolute', width: 104, height: 96, alignItems: 'center', justifyContent: 'center' },
  hexIcon: { width: 42, height: 42, marginTop: -3 },
  nodeLabel: { fontSize: 13, fontWeight: '700', color: palette.ink, marginTop: 8, maxWidth: 170, textAlign: 'center' },
  nodeLabelLocked: { color: palette.lockedText },

  startBubble: { backgroundColor: palette.bg, borderWidth: 2, borderColor: palette.line, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 7, marginBottom: 10 },
  startText: { color: palette.green, fontWeight: 'bold', fontSize: 13, letterSpacing: 1 },
  startTail: { position: 'absolute', bottom: -7, alignSelf: 'center', width: 12, height: 12, backgroundColor: palette.bg,
    borderRightWidth: 2, borderBottomWidth: 2, borderColor: palette.line, transform: [{ rotate: '45deg' }] },

  // Decorative props
  prop: { alignItems: 'center', justifyContent: 'center', marginVertical: 4, height: 62 },
  propImg: { width: 60, height: 60 },

  checkpointRow: { alignItems: 'center', marginVertical: 6, paddingHorizontal: 24 },
  checkpointPill: { flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 2, borderRadius: 20,
    paddingVertical: 7, paddingHorizontal: 14, maxWidth: 280 },
  checkpointText: { fontSize: 13, fontWeight: '700', color: '#fff', flexShrink: 1 },

  // Exam tile
  examWrap: { alignItems: 'center', marginTop: 18, marginBottom: 4, paddingHorizontal: 20 },
  examDivider: { width: 2, height: 18, backgroundColor: palette.line, marginBottom: 10 },
  examTile: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', backgroundColor: palette.orange,
    borderRadius: 18, padding: 16, borderBottomWidth: 5, borderBottomColor: palette.orangeDark },
  examTileLocked: { backgroundColor: palette.lockedNode, borderBottomColor: palette.lockedNodeDk },
  examIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(255,255,255,0.25)',
    alignItems: 'center', justifyContent: 'center' },
  examKicker: { color: '#fff', fontSize: 11, fontWeight: 'bold', letterSpacing: 1.5, opacity: 0.9 },
  examName: { color: '#fff', fontSize: 17, fontWeight: 'bold', marginTop: 1 },
  examMeta: { color: '#fff', fontSize: 12, fontWeight: '600', marginTop: 2, opacity: 0.95 },

  refreshBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 32,
    marginHorizontal: 40, paddingVertical: 12, borderRadius: 12, borderWidth: 2, borderColor: palette.line },
  refreshText: { color: palette.inkSoft, fontSize: 13, fontWeight: '600' },
  rebuildBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12,
    marginHorizontal: 40, paddingVertical: 12, borderRadius: 12, borderWidth: 2, borderColor: palette.redDark },
  rebuildText: { color: palette.red, fontSize: 13, fontWeight: '600' },
});

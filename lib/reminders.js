// lib/reminders.js
// Self-contained exam reminders + (dev-build-only) device-calendar drop.
//
// - LOCAL notifications work in Expo Go (SDK 54). This is the part that fires now.
// - expo-calendar is NOT in Expo Go, so it is loaded with an inline require()
//   inside a try/catch. In Expo Go the block throws and is skipped silently;
//   the SAME code starts working automatically once you make a dev build.
//
// Device-local mappings (exam -> scheduled notification id / calendar event id)
// are kept in AsyncStorage, because a reminder scheduled on this phone does not
// exist on any other device — so it does not belong in Supabase.

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ANDROID_CHANNEL = 'exam-reminders';

// ---- AsyncStorage keys ------------------------------------------------------
const notifKey = (examId) => `exam_reminder_notif:${examId}`;
const calKey = (examId) => `exam_reminder_cal:${examId}`;

// ---- Call once at app start (sets how notifications appear) ------------------
export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// ---- Ask for notification permission (only when actually needed) ------------
export async function ensureNotificationPermission() {
  let { granted } = await Notifications.getPermissionsAsync();
  if (!granted) {
    const res = await Notifications.requestPermissionsAsync();
    granted = res.granted;
  }
  if (granted && Platform.OS === 'android') {
    // Android 8+ needs a channel for the notification to show as a heads-up.
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: 'Exam reminders',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  return granted;
}

// ---- When should the reminder fire? -----------------------------------------
// Default: 9:00 AM the day before the exam.
// If that is already in the past (exam is <1 day away) but the exam itself is
// still ahead, fall back to ~1 minute from now so you still get a heads-up.
function computeReminderDate(examDate) {
  const exam = new Date(examDate);
  const now = new Date();

  const remind = new Date(exam);
  remind.setDate(remind.getDate() - 1);
  remind.setHours(9, 0, 0, 0);

  if (remind.getTime() > now.getTime()) return remind;
  if (exam.getTime() > now.getTime()) return new Date(now.getTime() + 60 * 1000);
  return null; // exam already passed
}

// ---- Schedule / reschedule the local reminder for one exam ------------------
export async function scheduleExamReminder(exam) {
  await cancelExamNotification(exam.id); // clear any previous one first

  if (!exam?.exam_date) return { scheduled: false, reason: 'no_date' };

  const when = computeReminderDate(exam.exam_date);
  if (!when) return { scheduled: false, reason: 'in_past' };

  const granted = await ensureNotificationPermission();
  if (!granted) return { scheduled: false, reason: 'permission_denied' };

  const examDateLabel = new Date(exam.exam_date).toLocaleDateString();

  const trigger = {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: when,
  };
  if (Platform.OS === 'android') trigger.channelId = ANDROID_CHANNEL;

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: '📚 Exam coming up',
      body: `${exam.name} is on ${examDateLabel}. Time to review!`,
    },
    trigger,
  });

  await AsyncStorage.setItem(notifKey(exam.id), id);
  return { scheduled: true, when, id };
}

// ---- Cancel a previously scheduled reminder ---------------------------------
export async function cancelExamNotification(examId) {
  try {
    const id = await AsyncStorage.getItem(notifKey(examId));
    if (id) {
      await Notifications.cancelScheduledNotificationAsync(id);
      await AsyncStorage.removeItem(notifKey(examId));
    }
  } catch (e) {
    console.log('[reminders] cancel notif failed:', e?.message);
  }
}

// ---- Add / update the exam on the device calendar ---------------------------
// Everything (including loading the module) is inside try/catch, so a missing
// native module in Expo Go simply returns { added:false } instead of crashing.
export async function addExamToCalendar(exam) {
  if (!exam?.exam_date) return { added: false, reason: 'no_date' };
  try {
    const Calendar = require('expo-calendar');

    const perm = await Calendar.requestCalendarPermissionsAsync();
    if (perm.status !== 'granted') return { added: false, reason: 'permission_denied' };

    await removeExamFromCalendar(exam.id); // drop older event for this exam, if any

    const calendarId = await getWritableCalendarId(Calendar);
    if (!calendarId) return { added: false, reason: 'no_calendar' };

    const start = new Date(exam.exam_date);
    const end = new Date(start.getTime() + 60 * 60 * 1000); // 1-hour block

    const eventId = await Calendar.createEventAsync(calendarId, {
      title: `Exam: ${exam.name}`,
      startDate: start,
      endDate: end,
      notes: 'Added by StudyApp',
      alarms: [{ relativeOffset: -60 * 24 }], // calendar's own alert: 1 day before
    });

    await AsyncStorage.setItem(calKey(exam.id), JSON.stringify({ eventId, calendarId }));
    return { added: true, eventId };
  } catch (e) {
    // Expected path in Expo Go (no native calendar module). Skip quietly.
    console.log('[reminders] calendar unavailable, skipped:', e?.message);
    return { added: false, reason: 'calendar_unavailable', detail: e?.message };
  }
}

// ---- Remove the calendar event for an exam ----------------------------------
export async function removeExamFromCalendar(examId) {
  try {
    const raw = await AsyncStorage.getItem(calKey(examId));
    if (!raw) return;
    const { eventId } = JSON.parse(raw);
    const Calendar = require('expo-calendar');
    await Calendar.deleteEventAsync(eventId);
    await AsyncStorage.removeItem(calKey(examId));
  } catch (e) {
    console.log('[reminders] remove calendar event skipped:', e?.message);
  }
}

// ---- Pick a calendar we are allowed to write to -----------------------------
async function getWritableCalendarId(Calendar) {
  if (Platform.OS === 'ios') {
    try {
      const def = await Calendar.getDefaultCalendarAsync();
      if (def?.id) return def.id;
    } catch {}
  }
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const writable =
    calendars.find(
      (c) => c.allowsModifications && c.accessLevel === Calendar.CalendarAccessLevel.OWNER
    ) || calendars.find((c) => c.allowsModifications);
  return writable?.id ?? null;
}

// ---- Public: call on exam create/edit ---------------------------------------
export async function syncExamReminders(exam) {
  const notif = await scheduleExamReminder(exam);
  const cal = await addExamToCalendar(exam);
  return { notif, cal };
}

// ---- Public: call on exam delete --------------------------------------------
export async function clearExamReminders(examId) {
  await cancelExamNotification(examId);
  await removeExamFromCalendar(examId);
}

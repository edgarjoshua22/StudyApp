import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from './lib/supabase';
import Auth from './components/Auth';
import ClassroomsScreen from './components/ClassroomsScreen';
import ClassroomDetail from './components/ClassroomDetail';
import ChatScreen from './components/ChatScreen';
import ProfileScreen from './components/ProfileScreen';
import QuizScreen from './components/QuizScreen';
import LessonPath from './components/LessonPath';
import StreakScreen from './components/StreakScreen';
import QuestsScreen from './components/QuestsScreen';
import SettingsScreen from './components/SettingsScreen';
import MoreScreen from './components/MoreScreen';
import * as Sentry from '@sentry/react-native';
import { configureNotificationHandler } from './lib/reminders';
import { palette } from './lib/theme';

// Crash/error monitoring. No-op unless EXPO_PUBLIC_SENTRY_DSN is set, so dev
// builds and anyone without a DSN are unaffected. DSN is safe to ship in a
// client app (it's write-only). Wrapped so a bad value never blocks startup.
if (process.env.EXPO_PUBLIC_SENTRY_DSN) {
  try {
    Sentry.init({
      dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
      tracesSampleRate: 0.1,
      environment: process.env.EXPO_PUBLIC_SENTRY_ENV || 'production',
    });
  } catch (_) {}
}

try { configureNotificationHandler(); } catch (_) {}

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function HomeStack({ session }) {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: palette.green },
        headerTintColor: palette.white,
        headerTitleStyle: { fontWeight: '800' },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: palette.bgSoft },
      }}>
      {/* Home is full-bleed: its own bright hero replaces the header bar. */}
      <Stack.Screen name="Classrooms" options={{ headerShown: false }}>
        {(props) => <ClassroomsScreen {...props} session={session} />}
      </Stack.Screen>
      <Stack.Screen name="ClassroomDetail" component={ClassroomDetail} options={{ title: '' }} />
      <Stack.Screen name="LessonPath" component={LessonPath} options={{ headerShown: false }} />
      <Stack.Screen name="Quiz" component={QuizScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Streak" component={StreakScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Quests" component={QuestsScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}

// The "More" tab: a menu page that opens Profile and Settings (Settings holds
// Log out). Presented as modal cards so they slide up over the menu.
function MoreStack({ session }) {
  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bgSoft } }}>
      <Stack.Screen name="MoreMenu">
        {(props) => <MoreScreen {...props} session={session} />}
      </Stack.Screen>
      <Stack.Screen name="Profile" options={{ presentation: 'modal' }}>
        {(props) => <ProfileScreen {...props} session={session} />}
      </Stack.Screen>
      <Stack.Screen name="Settings" options={{ presentation: 'modal' }}>
        {(props) => <SettingsScreen {...props} session={session} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}

// Duolingo-style bottom bar: custom colored icon art, no labels, and the active
// tab wrapped in a rounded cyan outline box.
const NAV_ICON = {
  Home: require('./assets/icons/nav_home.png'),
  Chat: require('./assets/icons/nav_chat.png'),
  More: require('./assets/icons/nav_more.png'),
};

function FunTabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[tabStyles.bar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };
        const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });
        const src = NAV_ICON[route.name];
        return (
          <TouchableOpacity
            key={route.key}
            style={tabStyles.item}
            onPress={onPress}
            onLongPress={onLongPress}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={route.name}
            accessibilityState={focused ? { selected: true } : {}}
          >
            <View style={[tabStyles.iconBox, focused && tabStyles.iconBoxActive]}>
              {src
                ? <Image source={src} style={tabStyles.icon} resizeMode="contain" />
                : <Ionicons name="ellipse" size={28} color={palette.hint} />}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function SafeApp() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  if (!session) {
    return (
      <SafeAreaProvider>
        <Auth />
        <StatusBar style="light" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{ headerShown: false }}
          tabBar={(props) => <FunTabBar {...props} />}
        >
          <Tab.Screen name="Home">{() => <HomeStack session={session} />}</Tab.Screen>
          <Tab.Screen name="Chat">{() => <ChatScreen session={session} />}</Tab.Screen>
          <Tab.Screen name="More">{() => <MoreStack session={session} />}</Tab.Screen>
        </Tab.Navigator>
      </NavigationContainer>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}

// Wrap the whole tree in an error boundary so any render/init crash is visible
// on-screen instead of leaving a blank gray view. This must be a class component.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    global.__CRASH_MSG__ = (error?.message || 'unknown') + '\n\n' + (error?.stack || '') + '\n\n' + (info?.componentStack || '');
    try { Sentry.captureException(error); } catch (_) {}
  }
  render() {
    const runtimeCrash = global.__CRASH_MSG__;
    const err = this.state.error;
    if (err || runtimeCrash) {
      const msg = err ? ((err.message || 'unknown') + '\n\n' + (err.stack || '')) : runtimeCrash;
      return (
        <View style={{ flex: 1, backgroundColor: '#000', padding: 24, paddingTop: 60 }}>
          <Text selectable style={{ color: '#f55', fontSize: 12 }}>APP CRASHED:{'\n\n'}{msg}</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

function App() {
  return (
    <ErrorBoundary>
      <SafeApp />
    </ErrorBoundary>
  );
}

// Sentry.wrap adds touch/navigation context to reports; it's a safe pass-through
// when Sentry isn't initialized (no DSN).
export default Sentry.wrap(App);

const tabStyles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: palette.bgSoft,
    borderTopWidth: 2,
    borderTopColor: palette.line,
    paddingTop: 8,
    paddingHorizontal: 6,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  iconBox: {
    width: 64, height: 44, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'transparent',
  },
  icon: { width: 34, height: 34 },
  iconBoxActive: {
    borderColor: '#5ccbf5',
    backgroundColor: 'rgba(92,203,245,0.14)',
  },
});

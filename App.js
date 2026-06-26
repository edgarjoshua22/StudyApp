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
import { configureNotificationHandler } from './lib/reminders';
import { palette } from './lib/theme';

// Set how local notifications appear (once, at module load).
configureNotificationHandler();

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

export default function App() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  if (!session) {
    return (<><Auth /><StatusBar style="auto" /></>);
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

import React, { useState, useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from './lib/supabase';
import Auth from './components/Auth';
import ClassroomsScreen from './components/ClassroomsScreen';
import ClassroomDetail from './components/ClassroomDetail';
import ChatScreen from './components/ChatScreen';
import ProfileScreen from './components/ProfileScreen';
import QuizScreen from './components/QuizScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function HomeStack({ session }) {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#58cc02' },
        headerTintColor: '#fff',
        headerTitleStyle: { fontWeight: 'bold' },
      }}>
      <Stack.Screen name="Classrooms" options={{ title: 'My Classrooms' }}>
        {(props) => <ClassroomsScreen {...props} session={session} />}
      </Stack.Screen>
      <Stack.Screen name="ClassroomDetail" component={ClassroomDetail} options={{ title: '' }} />
      <Stack.Screen name="Quiz" component={QuizScreen} options={{ title: 'Quiz' }} />
    </Stack.Navigator>
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
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarActiveTintColor: '#58cc02',
            tabBarInactiveTintColor: '#b0b0b0',
            tabBarLabelStyle: { fontWeight: 'bold', fontSize: 12 },
            tabBarStyle: { height: 64, paddingBottom: 10, paddingTop: 8 },
            tabBarIcon: ({ color, size }) => {
              const icons = { Home: 'home', Chat: 'chatbubble-ellipses', Profile: 'person' };
              return <Ionicons name={icons[route.name]} size={size} color={color} />;
            },
          })}>
          <Tab.Screen name="Home">{() => <HomeStack session={session} />}</Tab.Screen>
          <Tab.Screen name="Chat">{() => <ChatScreen session={session} />}</Tab.Screen>
          <Tab.Screen name="Profile">{() => <ProfileScreen session={session} />}</Tab.Screen>
        </Tab.Navigator>
      </NavigationContainer>
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
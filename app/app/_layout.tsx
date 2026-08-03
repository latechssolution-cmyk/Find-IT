import React from 'react';
import { View } from 'react-native';
import { Stack } from 'expo-router';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold,
} from '@expo-google-fonts/geist';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif';

import { colors } from '../src/theme';
import { useScheme, useThemeBootstrap } from '../src/ui/useScheme';

export default function RootLayout() {
  // Load the saved light/dark preference before first paint, so the app never
  // flashes the wrong theme on launch.
  const themeReady = useThemeBootstrap();
  const sch = useScheme();
  const c = colors(sch);
  const [fontsReady] = useFonts({
    Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold,
    InstrumentSerif_400Regular,
  });

  // Hold on the background colour rather than flashing system-font text and
  // reflowing — a visible font swap is worse than a beat of nothing.
  if (!fontsReady || !themeReady) {
    return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar style={sch === 'dark' ? 'light' : 'dark'} />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: c.bg },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
          <Stack.Screen name="search" options={{ animation: 'fade_from_bottom' }} />
          <Stack.Screen name="location" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="place/[id]" />
          <Stack.Screen name="review/[id]" options={{ animation: 'slide_from_bottom' }} />
          <Stack.Screen name="saved" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

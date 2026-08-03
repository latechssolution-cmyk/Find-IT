/**
 * Entry route: send first-run users through onboarding, everyone else
 * straight to Explore. Kept in the route (not the screen) so Explore never
 * flashes before redirecting.
 */

import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

import ExploreScreen from '../src/screens/ExploreScreen';
import { ONBOARDED_KEY } from '../src/screens/OnboardingScreen';

export default function Index() {
  const [state, setState] = useState<'checking' | 'onboard' | 'app'>('checking');

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDED_KEY)
      .then((v) => setState(v ? 'app' : 'onboard'))
      .catch(() => setState('app'));      // storage failure must not block the app
  }, []);

  if (state === 'checking') return <View style={{ flex: 1 }} />;
  if (state === 'onboard') return <Redirect href="/onboarding" />;
  return <ExploreScreen />;
}

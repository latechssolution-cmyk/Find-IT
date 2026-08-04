/** Compose route — same flag guard as /feed. */
import { Redirect } from 'expo-router';

import { enabled } from '../../src/features';
import ComposeScreen from '../../src/screens/ComposeScreen';

export default function ComposeRoute() {
  if (!enabled('FEED')) return <Redirect href="/" />;
  return <ComposeScreen />;
}

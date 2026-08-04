/**
 * Feed route — exists, but the flag decides whether it goes anywhere.
 * With FEATURES.FEED off this redirects home, so the screen is shippable
 * in the binary without being reachable.
 */
import { Redirect } from 'expo-router';

import { enabled } from '../src/features';
import FeedScreen from '../src/screens/FeedScreen';

export default function FeedRoute() {
  if (!enabled('FEED')) return <Redirect href="/" />;
  return <FeedScreen />;
}

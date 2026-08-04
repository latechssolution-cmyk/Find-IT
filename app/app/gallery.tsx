/** My-photos route — same flag guard as /feed. */
import { Redirect } from 'expo-router';

import { enabled } from '../src/features';
import GalleryScreen from '../src/screens/GalleryScreen';

export default function GalleryRoute() {
  if (!enabled('FEED')) return <Redirect href="/" />;
  return <GalleryScreen />;
}

/** Recent searches. Only queries the user actually ran are stored, capped at
 *  5 (Baymard: don't show recents that were never executed). */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'findit.recents.v1';
const MAX = 5;

export async function getRecents(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

export async function addRecent(q: string): Promise<void> {
  const term = q.trim();
  if (term.length < 2) return;
  try {
    const cur = await getRecents();
    const next = [term, ...cur.filter((r) => r.toLowerCase() !== term.toLowerCase())].slice(0, MAX);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* recents are a convenience; never surface a failure */ }
}

export async function clearRecent(): Promise<void> {
  try { await AsyncStorage.removeItem(KEY); } catch { /* ignore */ }
}

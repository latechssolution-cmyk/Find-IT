/**
 * User corrections — "this place has closed", "the hours are wrong".
 *
 * A scraped dataset with no correction path rots visibly: businesses here
 * churn fast, and a user who walks to two closed shops uninstalls. This is
 * also the cheapest possible UGC hook — reporting a closure takes one tap and
 * needs no account.
 *
 * Queued locally and synced when a backend exists. Reports are also applied
 * OPTIMISTICALLY on-device, so the person who took the trouble to report a
 * closure immediately sees the app believe them — otherwise reporting feels
 * like shouting into a void and nobody does it twice.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from './store';
import { track } from './analytics';

const KEY = 'findit.reports.v1';

export type ReportKind =
  | 'closed'          // permanently closed
  | 'hours'           // hours are wrong
  | 'phone'           // number is wrong
  | 'location'        // pin is in the wrong place
  | 'duplicate'       // same place listed twice
  | 'other';

export interface Report {
  placeId: string;
  kind: ReportKind;
  note?: string;
  at: number;
  synced?: boolean;
}

export const REPORT_LABELS: { kind: ReportKind; label: string; icon: string }[] = [
  { kind: 'closed', label: "It's permanently closed", icon: 'x-circle' },
  { kind: 'hours', label: 'Opening hours are wrong', icon: 'clock' },
  { kind: 'phone', label: 'Phone number is wrong', icon: 'phone-off' },
  { kind: 'location', label: 'Pin is in the wrong place', icon: 'map-pin' },
  { kind: 'duplicate', label: 'Listed twice', icon: 'copy' },
  { kind: 'other', label: 'Something else', icon: 'more-horizontal' },
];

interface ReportState {
  reports: Report[];
  hydrated: boolean;
  hydrate(): Promise<void>;
  submit(placeId: string, kind: ReportKind, note?: string): Promise<void>;
  /** Has this user already flagged this place as closed? */
  reportedClosed(placeId: string): boolean;
  forPlace(placeId: string): Report[];
}

export const useReportStore = create<ReportState>((set, get) => ({
  reports: [],
  hydrated: false,

  async hydrate() {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(KEY);
      set({ reports: raw ? JSON.parse(raw) : [], hydrated: true });
    } catch {
      set({ hydrated: true });
    }
  },

  async submit(placeId, kind, note) {
    track('place_report', { id: placeId, kind });
    const next = [
      ...get().reports.filter((r) => !(r.placeId === placeId && r.kind === kind)),
      { placeId, kind, note, at: Date.now(), synced: false },
    ].slice(-200);
    set({ reports: next });
    try { await AsyncStorage.setItem(KEY, JSON.stringify(next)); } catch { /* non-fatal */ }
  },

  reportedClosed: (placeId) =>
    get().reports.some((r) => r.placeId === placeId && r.kind === 'closed'),

  forPlace: (placeId) => get().reports.filter((r) => r.placeId === placeId),
}));

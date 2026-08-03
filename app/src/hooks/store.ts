/**
 * A ~40-line zustand-shaped store.
 *
 * The app needs exactly one piece of cross-screen state (location + radius),
 * so pulling in a state library would be more dependency than value —
 * especially on a connection where every install is a gamble.
 */

import { useSyncExternalStore } from 'react';

type Listener = () => void;
type SetState<T> = (partial: Partial<T> | ((s: T) => Partial<T>)) => void;
type GetState<T> = () => T;

export function create<T extends object>(
  init: (set: SetState<T>, get: GetState<T>) => T,
): () => T {
  let state: T;
  const listeners = new Set<Listener>();

  const set: SetState<T> = (partial) => {
    const next = typeof partial === 'function' ? (partial as (s: T) => Partial<T>)(state) : partial;
    let changed = false;
    for (const k of Object.keys(next) as (keyof T)[]) {
      if (!Object.is(state[k], next[k])) { changed = true; break; }
    }
    if (!changed) return;
    state = { ...state, ...next };
    listeners.forEach((l) => l());
  };

  const get: GetState<T> = () => state;
  state = init(set, get);

  const subscribe = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l); }; };
  const getSnapshot = () => state;

  return function useStore(): T {
    return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  };
}

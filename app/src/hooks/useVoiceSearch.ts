/**
 * Voice search, Urdu first.
 *
 * Typing is the real barrier here, not search quality. Roman Urdu on a phone
 * keyboard is slow and inconsistent even for confident typists, and a
 * meaningful share of this market reads and writes with difficulty while
 * speaking Urdu perfectly well. The app already understands Urdu SCRIPT
 * (urduToLatin); this closes the loop from the other side, so a user can say
 * "قریب کوئی اچھا نان چنے" and never touch a keyboard.
 *
 * Deliberate choices:
 *  - ur-PK first, en-PK as fallback. Pakistani English is heavily
 *    code-switched ("koi acha salon near me"), and the Urdu recogniser
 *    handles that mix better than en-US ever will.
 *  - the module is loaded LAZILY and every call is guarded. Speech
 *    recognition is missing on web, absent on some low-end Androids, and
 *    unavailable until a permission is granted — none of which may break
 *    the search box. If the mic can't run, there simply is no mic button.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

export type VoiceState = 'unavailable' | 'idle' | 'listening' | 'denied';

/**
 * Both languages, without asking the user to declare one.
 *
 * People here speak a continuous mix — "koi acha salon near me", "biryani
 * ka best place" — so a language PICKER would be the wrong question: the
 * honest answer is usually "both, in the same sentence". `ur-PK` is listed
 * first because Android's Urdu model transcribes code-switched English
 * inside an Urdu sentence far better than the English model handles Urdu
 * words; en-PK then en-US are fallbacks for devices with no Urdu pack
 * installed, which is common on cheaper handsets.
 *
 * Whatever comes back goes through the existing pipeline, which already
 * folds Urdu script to Latin and forgives Roman-Urdu spelling — so
 * "بریانی", "biryani" and "biryaani" all land on the same results.
 */
const LOCALES = ['ur-PK', 'en-PK', 'en-US'];

interface SpeechModule {
  ExpoSpeechRecognitionModule: any;
  useSpeechRecognitionEvent?: any;
}

let mod: SpeechModule | null | undefined;
function load(): SpeechModule | null {
  if (mod !== undefined) return mod;
  try {
    // Not a static import: on web this package has no native side, and a
    // hard import would take the whole bundle down with it.
    mod = require('expo-speech-recognition') as SpeechModule;
  } catch {
    mod = null;
  }
  return mod;
}

export function useVoiceSearch(onResult: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('unavailable');
  const heard = useRef('');

  useEffect(() => {
    // Web speech recognition exists but behaves differently enough that
    // shipping it unverified would be worse than not offering it.
    if (Platform.OS === 'web') { setState('unavailable'); return; }
    const m = load();
    setState(m?.ExpoSpeechRecognitionModule ? 'idle' : 'unavailable');
  }, []);

  useEffect(() => {
    const m = load();
    if (!m?.ExpoSpeechRecognitionModule) return;
    const api = m.ExpoSpeechRecognitionModule;

    const onEvt = (e: any) => {
      const text = e?.results?.[0]?.transcript;
      if (typeof text === 'string' && text.trim()) heard.current = text.trim();
    };
    const onEnd = () => {
      setState('idle');
      // Fire on END, not on every partial: acting on partials makes the
      // list thrash while someone is still speaking.
      if (heard.current) { onResult(heard.current); heard.current = ''; }
    };

    const subs = [
      api.addListener?.('result', onEvt),
      api.addListener?.('end', onEnd),
      api.addListener?.('error', () => setState('idle')),
    ].filter(Boolean);
    return () => subs.forEach((s: any) => s?.remove?.());
  }, [onResult]);

  const start = useCallback(async () => {
    const m = load();
    const api = m?.ExpoSpeechRecognitionModule;
    if (!api) return;
    try {
      const perm = await api.requestPermissionsAsync?.();
      if (perm && perm.granted === false) { setState('denied'); return; }
      heard.current = '';
      setState('listening');
      // Pick the first locale the device actually has a pack for. Asking for
      // ur-PK on a handset without it silently yields nothing on some
      // Androids, which reads to the user as "the mic is broken".
      let lang = LOCALES[LOCALES.length - 1];
      try {
        const supported: string[] = (await api.getSupportedLocales?.())?.locales ?? [];
        lang = LOCALES.find((l) => supported.includes(l)) ?? lang;
      } catch { /* older module build — fall through to en-US */ }
      api.start({
        lang,
        interimResults: true,
        continuous: false,
        // Keep it on-device where possible: faster, works on a bad
        // connection, and the audio never leaves the phone.
        requiresOnDeviceRecognition: false,
        addsPunctuation: false,
      });
    } catch {
      setState('idle');
    }
  }, []);

  const stop = useCallback(() => {
    try { load()?.ExpoSpeechRecognitionModule?.stop?.(); } catch { /* already stopped */ }
    setState('idle');
  }, []);

  return { state, start, stop, available: state !== 'unavailable' };
}

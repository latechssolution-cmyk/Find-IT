/**
 * Search (PRD §5.4) — forgiving by construction.
 *
 * Zero state: recents, category shortcuts, trending.
 * Typing:     debounced suggestions, place hits go straight to detail.
 * Submit:     typo-tolerant + synonym-expanded, and when nothing matches the
 *             rescue ladder ALWAYS offers a next step (never a dead end).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { useRouter } from 'expo-router';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { enter } from '../ui/enter';

import { colors, curve, radius, space, categoryMeta } from '../theme';
import {
  completeTerm, getDataSource, guessCategory,
  type CategoryBucket, type Place, type SearchResult, type Suggestion,
} from '../data';
import { PlaceCard, formatDistance } from '../ui/PlaceCard';
import { Icon, Star, categoryIcon } from '../ui/Icon';
import { Button, Chip, EmptyState, PlaceCardSkeleton, Tap, Txt } from '../ui/primitives';
import { useScheme } from '../ui/useScheme';
import { useBack } from '../hooks/useBack';
import { useLocationStore } from '../hooks/useLocation';
import { askOrSearch, type AskResult } from '../data/ask';
import { useVoiceSearch } from '../hooks/useVoiceSearch';
import { addRecent, getRecents, clearRecent } from '../hooks/recents';
import { track } from '../hooks/analytics';

/**
 * The placeholder is the only place we can teach what the box accepts.
 *
 * It used to read "Try 'biryani', 'chai', 'pharmacy'…", which trains people
 * to type single keywords — so the question-answering path would almost
 * never fire and nobody would learn it existed. These rotate slowly through
 * real questions instead, mixing the two kinds so neither is hidden.
 */
const PLACEHOLDERS = [
  'cheap biryani that delivers',
  'chemist open now',
  'salon with parking',
  'best karahi near me',
  'kiryana store open late',
  'family restaurant with parking',
];

/** What people here actually search for, not what a category tree thinks. */
const POPULAR = [
  'biryani', 'karahi', 'chai', 'pizza', 'ice cream',
  'salon', 'gym', 'pharmacy', 'car wash', 'tailor',
];

/**
 * Is this a question or a keyword?
 *
 * Keywords are the overwhelming majority and the existing search answers
 * them better than a model would — instantly, offline, and free. Only send
 * the ones where understanding is actually the hard part: several words, or
 * an explicit ask ("where", "cheap", "that delivers", "open now").
 */
const QUESTION_WORDS = /\b(where|which|what|who|nearest|closest|cheap|cheapest|budget|sasta|best|good|top|open|late|halal|delivers?|delivery|family|kids|women|wheelchair|parking|wifi|near me|around here|can i|is there|looking for|need a|want a)\b/i;

export function looksLikeQuestion(q: string): boolean {
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 4) return true;                 // "cheap biryani that delivers"
  return words.length >= 2 && QUESTION_WORDS.test(q); // "cheap biryani"
}

const QUICK: { key: CategoryBucket; label: string }[] = [
  { key: 'food_drink', label: 'Food & Drink' },
  { key: 'shopping', label: 'Shopping' },
  { key: 'health', label: 'Pharmacy & Clinics' },
  { key: 'beauty', label: 'Salons' },
  { key: 'education', label: 'Schools' },
  { key: 'services', label: 'Services' },
];

export default function SearchScreen() {
  const sch = useScheme();
  const c = colors(sch);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const goBack = useBack('/');
  const { coords, radiusM, setRadius } = useLocationStore();

  const [q, setQ] = useState('');
  const [sugs, setSugs] = useState<Suggestion[]>([]);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const [asked, setAsked] = useState<AskResult | null>(null);
  /** Speaking beats typing Roman Urdu; the button hides itself where the
   *  recogniser doesn't exist. Runs the query straight through. */
  const voice = useVoiceSearch(useCallback((text: string) => {
    setQ(text);
    run(text);
  }, []));

  /** Rotates only while the box is EMPTY — a placeholder changing under
   *  someone mid-thought is a distraction, not a hint. */
  /**
   * One example per visit, chosen at random — deliberately NOT animated.
   *
   * A rotating hint was the first instinct, but it earns nothing: the user
   * reads the placeholder once, in the second before they start typing, so
   * only the FIRST value ever teaches anything. Cycling afterwards is motion
   * next to a text cursor, which is a distraction. Random-per-mount gives the
   * same coverage of examples across sessions with no timer to leak, no
   * re-render every 3s, and nothing to go wrong.
   */
  const hint = useRef(PLACEHOLDERS[Math.floor(Math.random() * PLACEHOLDERS.length)]).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Chip taps do setQ + run together; without this the 150 ms suggest
   *  debounce fires AFTER run() clears it and buries the results under
   *  autocomplete for the query the user already submitted. */
  const submitted = useRef<string | null>(null);

  /** Query completions ("bir" → "biryani") — local, instant, no round trip.
   *  Hidden once the term has been submitted, same rule as suggestions. */
  const terms = (q.trim().length >= 2 && q !== submitted.current) ? completeTerm(q) : [];

  useEffect(() => { getRecents().then(setRecents); }, []);

  /* --- debounced suggest (150 ms, per PRD) --- */
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2 || q === submitted.current) { setSugs([]); return; }
    timer.current = setTimeout(async () => {
      const s = await getDataSource().suggest(q, coords?.lat, coords?.lng);
      // Re-check: run() may have fired while the suggest was in flight.
      if (q !== submitted.current) setSugs(s);
    }, 150);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q, coords?.lat, coords?.lng]);

  const run = useCallback(async (term: string, cats?: CategoryBucket[], rM?: number) => {
    const query = term.trim();
    submitted.current = term;
    setBusy(true);
    setSugs([]);
    setAsked(null);
    try {
      /**
       * A QUESTION goes to the AI; a KEYWORD does not.
       *
       * "pharmacy" is answered better, faster and for free by the existing
       * ranked search — routing it through a model would add a second of
       * latency and a token bill to make the same result worse. The AI earns
       * its place on "somewhere cheap for biryani that delivers", where the
       * constraints are the point. So: only ask when the query actually
       * looks like a question.
       */
      if (!cats && looksLikeQuestion(query)) {
        const a = await askOrSearch(query, {
          lat: coords?.lat, lng: coords?.lng, radiusM: rM ?? radiusM, limit: 24,
        });
        if (a.places.length) {
          setAsked(a);
          setResult({ places: a.places, total: a.places.length } as SearchResult);
          track(a.degraded ? 'search_run' : 'ask_run', { len: query.length, n: a.places.length });
          if (query) { await addRecent(query); getRecents().then(setRecents); }
          return;
        }
      }

      const res = await getDataSource().search({
        q: query || null,
        lat: coords?.lat, lng: coords?.lng,
        radiusM: rM ?? radiusM,
        cats: cats ?? null,
        limit: 50,
      });
      setResult(res);
      // Result count and query length only — query text is user content.
      track(res.places.length ? 'search_run' : 'search_zero',
        { len: query.length, n: res.places.length });
      // Only remember searches that FOUND something. A recent chip is a
      // one-tap suggestion, and re-offering a query we already know returns
      // nothing is a guaranteed dead end — the exact thing the rescue ladder
      // exists to prevent.
      if (query && res.places.length) {
        await addRecent(query);
        getRecents().then(setRecents);
      }
    } finally {
      setBusy(false);
    }
  }, [coords?.lat, coords?.lng, radiusM]);

  const openPlace = (id: string) => router.push({ pathname: '/place/[id]', params: { id } });

  const showZeroState = !q && !result && !busy;

  return (
    <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      {/* --------------------------------------------------------- search bar */}
      <View style={styles.barRow}>
        <View style={[styles.bar, curve, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Icon name="search" size={17} color={c.textMuted} />
          <TextInput
            autoFocus
            value={q}
            onChangeText={setQ}
            onSubmitEditing={() => run(q)}
            returnKeyType="search"
            placeholder={`Try “${hint}”`}
            placeholderTextColor={c.textFaint}
            style={[styles.input, { color: c.text }]}
          />
          {q ? (
            <Tap onPress={() => { setQ(''); setResult(null); }} haptic="selection" scaleTo={0.9}>
              <Icon name="x" size={16} color={c.textMuted} />
            </Tap>
          ) : voice.available ? (
            /* Only rendered where the mic can actually run — no dead button
               on web or on a device without a recogniser. */
            <Tap
              onPress={() => (voice.state === 'listening' ? voice.stop() : voice.start())}
              haptic="medium"
              scaleTo={0.9}
              accessibilityRole="button"
              accessibilityLabel={voice.state === 'listening' ? 'Stop listening' : 'Search by voice'}
            >
              <Icon
                name={voice.state === 'listening' ? 'square' : 'mic'}
                size={17}
                color={voice.state === 'listening' ? c.accentText : c.textMuted}
              />
            </Tap>
          ) : null}
        </View>
        <Tap onPress={goBack} haptic="light" scaleTo={0.94} style={{ paddingHorizontal: space.sm }}>
          <Txt variant="label" color={c.accentText}>Done</Txt>
        </Tap>
      </View>

      {/* ------------------------------------------------------------ content */}
      {busy ? (
        <View>{[0, 1, 2, 3].map((i) => <PlaceCardSkeleton key={i} />)}</View>
      ) : (sugs.length > 0 || terms.length > 0) ? (
        <FlashList
          data={sugs}
          keyExtractor={(s) => s.id}
          keyboardShouldPersistTaps="handled"
          /* Term completions sit ABOVE place hits: "did you mean this KIND
             of thing?" outranks "did you mean this shop?" while the query
             is still short, and each row saves a fistful of keystrokes. */
          ListHeaderComponent={
            terms.length ? (
              <View>
                {terms.map((t) => (
                  <Tap
                    key={t}
                    onPress={() => { setQ(t); run(t); }}
                    haptic="light"
                    scaleTo={0.99}
                    style={[styles.sugRow, { borderBottomColor: c.border }]}
                  >
                    <View style={[styles.sugIcon, curve, { backgroundColor: c.surfaceAlt }]}>
                      <Icon name="search" size={14} color={c.textMuted} muted />
                    </View>
                    <Txt variant="body" style={{ flex: 1 }} numberOfLines={1}>{t}</Txt>
                    <Icon name="arrow-up-left" size={15} color={c.textFaint} muted />
                  </Tap>
                ))}
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <Tap onPress={() => openPlace(item.id)} haptic="light" scaleTo={0.99} style={[styles.sugRow, { borderBottomColor: c.border }]}>
              <View style={[styles.sugIcon, curve, { backgroundColor: c.surfaceAlt }]}>
                <Icon
                  name={categoryIcon[item.categoryBucket ?? 'other']}
                  size={15}
                  color={categoryMeta[item.categoryBucket ?? 'other']?.tint ?? c.textMuted}
                  muted
                />
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="body" numberOfLines={1}>{item.name}</Txt>
                {/* Star as an icon, not a glyph — a bare ★ in a text run
                    falls through to the system font (see ui/Icon.tsx). */}
                <View style={styles.sugMeta}>
                  {item.rating ? <Star size={10} color={c.star} /> : null}
                  <Txt variant="caption" muted numberOfLines={1}>
                    {[item.rating ? item.rating.toFixed(1) : null, item.locality,
                      formatDistance(item.distanceM)].filter(Boolean).join(' · ')}
                  </Txt>
                </View>
              </View>
            </Tap>
          )}
        />
      ) : result ? (
        <>
          {asked?.answer ? (
            <Animated.View
              entering={enter(FadeInDown.duration(240))}
              style={[styles.answer, curve, { backgroundColor: c.accentWash }]}
            >
              <Icon name="zap" size={14} color={c.accentText} />
              <View style={{ flex: 1, gap: 3 }}>
                <Txt variant="body">{asked.answer}</Txt>
                {/* What it understood. Shown because a wrong reading is
                    otherwise invisible — the user just sees odd results and
                    blames the app rather than rephrasing. */}
                {asked.intent ? (
                  <Txt variant="caption" faint>
                    {[
                      asked.intent.q,
                      asked.intent.openOnly ? 'open now' : null,
                      asked.intent.minRating ? `${asked.intent.minRating}★+` : null,
                      asked.intent.priceHint,
                      ...(asked.intent.facets ?? []),
                      `${(asked.intent.radiusM / 1000).toFixed(0)} km`,
                    ].filter(Boolean).join(' · ')}
                  </Txt>
                ) : null}
              </View>
            </Animated.View>
          ) : null}
          <ResultList
          result={result}
          onOpen={openPlace}
          onWiden={(m) => { setRadius(m); run(q, undefined, m); }}
          onCategory={(cat) => run('', [cat])}
          onTerm={(t) => { setQ(t); run(t); }}
          query={q}
          />
        </>
      ) : showZeroState ? (
        <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }} keyboardShouldPersistTaps="handled">
          {recents.length > 0 ? (
            <View style={{ gap: space.sm }}>
              <View style={styles.sectionHead}>
                <Txt variant="label" muted>RECENT</Txt>
                <Tap onPress={() => { clearRecent(); setRecents([]); }} haptic="selection">
                  <Txt variant="caption" color={c.accent}>Clear</Txt>
                </Tap>
              </View>
              <View style={styles.wrap}>
                {recents.map((r) => (
                  <Chip key={r} label={r} onPress={() => { setQ(r); run(r); }} />
                ))}
              </View>
            </View>
          ) : null}

          {/* High-intent local staples. These do double duty: discovery for
              the blank-mind moment, and a zero-typing path into the smart
              search (each is one tap, typo-proof by construction). */}
          <View style={{ gap: space.sm }}>
            <Txt variant="label" muted>POPULAR</Txt>
            <View style={styles.wrap}>
              {POPULAR.map((p) => (
                <Chip key={p} label={p} onPress={() => { setQ(p); run(p); }} />
              ))}
            </View>
          </View>

          <View style={{ gap: space.sm }}>
            <Txt variant="label" muted>BROWSE</Txt>
            <View style={styles.wrap}>
              {QUICK.map((quick) => (
                <Chip
                  key={quick.key}
                  label={quick.label}
                  icon={categoryIcon[quick.key]}
                  tint={categoryMeta[quick.key].tint}
                  onPress={() => run('', [quick.key])}
                />
              ))}
            </View>
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}

/* ----------------------------------------------------- results + rescue ladder */

function ResultList({
  result, onOpen, onWiden, onCategory, onTerm, query,
}: {
  result: SearchResult; query: string;
  onOpen: (id: string) => void;
  onWiden: (m: number) => void;
  onCategory: (c: CategoryBucket) => void;
  onTerm: (t: string) => void;
}) {
  const c = colors(useScheme());

  if (result.places.length === 0) {
    const hasHelp = Boolean(
      result.relaxedTerm || result.widerRadii?.length || result.relatedCategories?.length,
    );
    return (
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <EmptyState
          icon="search"
          title={`No matches for “${query}” nearby`}
          body={hasHelp ? "Here's what might help:" : 'But there is plenty around you:'}
        />

        {/* rung 1 — a term from the query that DOES work */}
        {result.relaxedTerm ? (
          <View style={{ gap: space.sm }}>
            <Txt variant="label" muted>TRY A SIMPLER SEARCH</Txt>
            <Button
              label={`“${result.relaxedTerm.term}” · ${result.relaxedTerm.count} place${result.relaxedTerm.count === 1 ? '' : 's'}`}
              variant="tonal"
              onPress={() => onTerm(result.relaxedTerm!.term)}
            />
          </View>
        ) : null}

        {/* rung 2 — wider radius */}
        {result.widerRadii?.length ? (
          <View style={{ gap: space.sm }}>
            <Txt variant="label" muted>SEARCH WIDER</Txt>
            {result.widerRadii.slice(0, 3).map((w) => (
              <Button
                key={w.radiusM}
                label={`${w.count} place${w.count === 1 ? '' : 's'} within ${(w.radiusM / 1000).toFixed(0)} km`}
                variant="tonal"
                onPress={() => onWiden(w.radiusM)}
              />
            ))}
          </View>
        ) : null}

        {/* rung 3 — related / nearby categories */}
        {result.relatedCategories?.length ? (
          <View style={{ gap: space.sm }}>
            <Txt variant="label" muted>BROWSE INSTEAD</Txt>
            <View style={styles.wrap}>
              {result.relatedCategories.map((cat) => (
                <Chip
                  key={cat}
                  label={categoryMeta[cat]?.label ?? cat}
                  icon={categoryIcon[cat]}
                  onPress={() => onCategory(cat)}
                />
              ))}
            </View>
          </View>
        ) : null}

        {/* rung 4 — never a dead end */}
        {result.fallbackPlaces?.length ? (
          <View style={{ gap: space.sm, marginHorizontal: -space.lg }}>
            <Txt variant="label" muted style={{ paddingHorizontal: space.lg }}>
              WELL-RATED NEARBY
            </Txt>
            {result.fallbackPlaces.map((p, i) => (
              <PlaceCard key={p.id} place={p} index={i} onPress={() => onOpen(p.id)} />
            ))}
          </View>
        ) : null}
      </ScrollView>
    );
  }

  return (
    <FlashList
      data={result.places}
      keyExtractor={(p: Place) => p.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        result.correctedFrom ? (
          <Animated.View entering={enter(FadeIn)} style={[styles.corrected, { backgroundColor: c.accentWash }]}>
            <Txt variant="caption">
              Showing close matches for “{result.correctedFrom}”
            </Txt>
          </Animated.View>
        ) : null
      }
      renderItem={({ item, index }: { item: Place; index: number }) => (
        <PlaceCard place={item} index={index} onPress={() => onOpen(item.id)} />
      )}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  barRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.sm },
  bar: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm,
    paddingHorizontal: space.lg, borderRadius: radius.pill, borderWidth: 1, minHeight: 46,
  },
  input: { flex: 1, fontSize: 15, paddingVertical: space.md },
  sugRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingHorizontal: space.lg, paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sugMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  answer: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.sm,
    marginHorizontal: space.lg, marginBottom: space.sm,
    padding: space.md, borderRadius: radius.md,
  },
  sugIcon: {
    width: 34, height: 34, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  corrected: { margin: space.lg, padding: space.md, borderRadius: radius.md },
});

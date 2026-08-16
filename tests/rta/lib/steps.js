/**
 * Low-level RTA step primitives shared by navigation, functional tests, and the
 * screenshot orchestrator. These drive the device through remote keypresses
 * (ecp) and read Scene Graph state (odc). `waitFor` / `waitFocused` poll real
 * node state and THROW on timeout — so they double as assertions: in a Vitest
 * `it()` a thrown timeout fails the test with a descriptive message; don't wrap
 * them in `expect`.
 *
 * Node lookups use RTA's `#id` keyPath (a recursive findNode from the scene root).
 */
import { ecp, odc } from 'roku-test-automation';
import { diagnosedError, FAILURE_KINDS } from './diagnostics.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const press = (key) => ecp.sendKeypress(key);
export const hasChildren = (n) => typeof n === 'number' && n > 0;

/** Read a scene-rooted keyPath; returns the value or undefined if not present. */
export async function getVal(keyPath) {
  const res = await odc.getValue({ base: 'scene', keyPath }).catch(() => ({ found: false }));
  return res.found ? res.value : undefined;
}

/**
 * Like getVal, but scoped to the ACTIVE routed view (`m.global.activeRoutedView`)
 * rather than a recursive scene-root find. A view suspended under sgRouter's default
 * `suspendMode: "hide"` (Home, /settings, /photo, /audio) stays in the scene tree, so a
 * recursive `#id` lookup (getVal) can resolve to ITS node when ids aren't unique — e.g.
 * every ItemDetails has `#extrasGrid`, and several components declare `#options`.
 * Anchoring to activeRoutedView (the app's own "view the user is on", set on open/resume
 * by the JRScreen lifecycle) reads the node on the active screen. Use this for value
 * reads of ids that recur across views — it holds whichever suspendMode a route carries.
 */
export async function getActiveVal(keyPath) {
  const res = await odc
    .getValue({ base: 'global', keyPath: `activeRoutedView.${keyPath}` })
    .catch(() => ({ found: false }));
  return res.found ? res.value : undefined;
}

/**
 * `getActiveVal` for MANY keyPaths in one device round trip. Returns an array
 * positionally aligned with `keyPaths`; a keyPath that does not resolve is
 * `undefined`, exactly as the single-read form reports it.
 *
 * ## Why batch at all
 *
 * ODC's `getValues` is a real batch — the on-device component loops the requests
 * inside a SINGLE message (`processGetValuesRequest`), so N keyPaths cost one round
 * trip rather than N. `diagnostics.js` has used it since Phase 2; this is the same
 * mechanism made available to assertions.
 *
 * **Not for speed.** Measured on `.177`, 5 alternating rounds of 57 keyPaths: 57
 * sequential `getValue` calls take a median 303 ms and one batched `getValues` takes
 * 58 ms — so a round trip is ~5.4 ms and the whole saving is ~245 ms inside a ~20 s
 * test. End-to-end that is invisible, and the before/after suite runs confirmed it
 * (19.87 s vs 20.24 s mean, n=3 each — no change, the batched arm nominally slower).
 * Anyone reaching for this to make a suite faster is reading the wrong number.
 *
 * **For the observation WINDOW.** Those same figures say the thing that matters: a
 * one-shot assertion reading N fields sequentially is not one observation of the
 * device, it is N observations spread over 303 ms, and a screen that is still
 * settling can differ between the first and the last. The field read at position 50
 * need not describe the same frame as the field read at position 1. Batching collapses
 * that window to 58 ms — the same class of fix as the north-star rule, applied to
 * reads instead of to input. `assertGenreRowsOwnTheirItems` went from 57 reads to 3
 * on exactly this reasoning (1 + 14 row titles + 14 child counts + 28 item titles,
 * against the demo server's 14 genres / 28 filed items). It scales with the fixture,
 * so a richer library widens the sequential window and leaves the batched one alone.
 *
 * ## Failure semantics — a dead batch is not a screen full of missing fields
 *
 * The single-read form swallows to `undefined`, which is right for a POLL: callers
 * retry, and a persistent miss ends in a diagnosed timeout. It is wrong for a batch
 * feeding a one-shot assertion, because an ODC failure would make every keyPath read
 * `undefined` at once and the assertion would report "the screen has no rows" —
 * a confident false statement about the app, which is the same defect
 * `lib/jellyfin.js` exists to not repeat one layer up.
 *
 * So this THROWS when the batch itself fails, and reports `undefined` only for a
 * keyPath the device answered about and did not find. Those are genuinely different
 * on the wire: `processGetValueRequest` returns `found: false` for an unresolved
 * keyPath and only errors on an unresolvable `base` — and every request here shares
 * one `base: 'global'`, so a per-key miss cannot masquerade as a batch failure or
 * vice versa.
 */
export async function getActiveVals(keyPaths) {
  if (!keyPaths.length) return [];
  // Positional keys rather than the keyPaths themselves: a keyPath is not a safe AA
  // key (dots, `#`, indices) and duplicates in the input would silently collapse.
  const requests = Object.fromEntries(
    keyPaths.map((keyPath, i) => [
      `k${i}`,
      { base: 'global', keyPath: `activeRoutedView.${keyPath}` },
    ]),
  );
  const batch = await odc.getValues({ requests });
  const results = batch?.results;
  if (!results) {
    throw await diagnosedError(
      `batched read of ${keyPaths.length} keyPath(s) returned no results — the device answered, but not with a batch`,
      { kind: FAILURE_KINDS.BATCH_READ_FAILED, observed: { keyPaths: keyPaths.slice(0, 8) } },
    );
  }
  return keyPaths.map((_, i) => (results[`k${i}`]?.found ? results[`k${i}`].value : undefined));
}

/**
 * Poll `keyPath` until `predicate(value)` is true, optionally re-issuing
 * `action` (e.g. a key press) each tick. Throws on timeout so a broken nav/test
 * fails loudly instead of silently proceeding. `read` selects the reader (default
 * scene-rooted getVal); pass getActiveVal to scope the poll to the active routed view.
 *
 * A failing `action` is counted and named in the timeout message. It is still
 * swallowed per-tick (one dropped press should not fail a nav that recovers), but
 * it must not vanish: an action that never lands and a screen that never renders
 * produce the same "timed out waiting for X" otherwise, and telling those apart
 * after the fact costs hours.
 *
 * On timeout the throw carries a dump of what the device actually looked like
 * (see [`diagnostics.js`](diagnostics.js)) — the poll loop itself is untouched,
 * so this costs nothing on the success path.
 */
export async function waitFor(
  keyPath,
  predicate,
  { timeout = 30000, interval = 500, action, label, read = getVal } = {},
) {
  const start = Date.now();
  let last;
  let actionErrors = 0;
  while (Date.now() - start < timeout) {
    if (action) await action().catch(() => actionErrors++);
    last = await read(keyPath);
    if (predicate(last)) return last;
    await sleep(interval);
  }
  throw await diagnosedError(
    `nav timed out waiting for ${label || keyPath} (last=${JSON.stringify(last)})` +
      (actionErrors ? ` — ${actionErrors} action(s) threw; input may not have been delivered` : ''),
    {
      kind: FAILURE_KINDS.WAIT_FOR_TIMEOUT,
      label: label || keyPath,
      waitedMs: Date.now() - start,
      observed: { keyPath, last, actionErrors },
    },
  );
}

/**
 * Poll the focused node until `predicate({node, keyPath})` is true, optionally
 * re-issuing `action` (e.g. a keypress) each tick to walk focus toward a target.
 * Mirrors `waitFor`'s action hook; throws on timeout. Guard the action against
 * overshoot (only press while not yet on target) since focus has no index to clamp.
 */
export async function waitFocused(
  predicate,
  { timeout = 15000, interval = 500, action, label } = {},
) {
  const start = Date.now();
  let last;
  let actionErrors = 0;
  while (Date.now() - start < timeout) {
    if (action) await action().catch(() => actionErrors++);
    const f = await odc.getFocusedNode({ includeNode: true }).catch(() => null);
    last = `${f?.node?.subtype}@${f?.keyPath}`;
    if (f && predicate(f)) return f;
    await sleep(interval);
  }
  throw await diagnosedError(
    `nav timed out waiting for focus (${label || 'predicate'}); last=${last}` +
      (actionErrors ? ` — ${actionErrors} action(s) threw; input may not have been delivered` : ''),
    {
      kind: FAILURE_KINDS.WAIT_FOCUSED_TIMEOUT,
      label: label || 'predicate',
      waitedMs: Date.now() - start,
      observed: { last, actionErrors },
    },
  );
}

/**
 * Wait until focus is INSIDE the container with id `containerId` (e.g. `#itemGrid`).
 *
 * The precondition for walking any focus-driven list: `rowItemFocused` / `itemFocused`
 * RETAIN their last value while the list does not hold focus, so a walk started too
 * early reads a stale index forever and sends its presses to whatever does hold focus —
 * then times out blaming the list. "Loaded" is not "focused". Named rather than
 * hand-rolled at each call site so its ABSENCE is visible in review.
 *
 * No key presses on purpose: focus arrives on its own once the view settles, and
 * pressing at a component we have not located yet is the mistake this guards against.
 */
export async function waitFocusInside(containerId, { timeout = 12000, interval = 300 } = {}) {
  return waitFocused((f) => typeof f.keyPath === 'string' && f.keyPath.includes(containerId), {
    timeout,
    interval,
    label: `focus inside ${containerId}`,
  });
}

/**
 * An `action` for `waitFor` / `waitFocused` that RE-SENDS `key` when the previous press
 * was swallowed.
 *
 * ## The failure it exists for
 *
 * `sgrouter_showView`'s `finally` restores focus BEFORE it dispatches `NavigationEnd`, so
 * a key sent the instant focus lands can arrive while the router still reports itself
 * navigating — `_goBack` rejects it and `JRScene`'s back arbiter swallows it. The key is
 * then simply gone: no error, no retry, and whatever wait follows times out blaming the
 * component it was watching rather than the input that never arrived. Measured twice on
 * `.178` (2026-08-15): `focus.spec`'s second Back, and `navHomeReturn`'s OK on detail 1,
 * the latter at roughly 1 run in 6.
 *
 * ## How it detects a swallow
 *
 * Focus still being INSIDE `containerId` means nothing navigated away, so the press did
 * not take. That same test is what makes the retry safe against overshoot: once the press
 * lands, focus has left the container and this stops pressing, so it cannot double-press
 * into whatever just opened — the hazard `tests/rta/CLAUDE.md` warns about.
 *
 * ## Why it sits out the first tick
 *
 * `waitFor` / `waitFocused` invoke `action` BEFORE their first read, and any caller of
 * this has just pressed. Re-sending there would fire within milliseconds of the original,
 * before the app could possibly have answered — a double-press at exactly the moment a
 * screen is mounting. Sitting out one tick spends the poll interval as the "did it land?"
 * window instead.
 *
 * This is also why the skip lives HERE rather than in `waitFor`: an eager first action is
 * *correct* for the focus WALKS (`focusGridTile`, `findHomeLibraryTile`, `focusOverhangIcon`),
 * which want to start moving immediately. Only a resend needs to wait and see.
 *
 * @param {string} key - an `ecp.Key` value to re-send
 * @param {string} containerId - `#id` of the container the press should navigate AWAY from
 * @returns {() => Promise<void>} a fresh, single-use action (it carries per-wait state)
 */
export function resendIfSwallowed(key, containerId) {
  let ticked = false;
  return async () => {
    if (!ticked) {
      ticked = true;
      return;
    }
    const focused = await odc.getFocusedNode({ includeNode: true }).catch(() => null);
    if (typeof focused?.keyPath === 'string' && focused.keyPath.includes(containerId)) {
      await press(key);
    }
  };
}

/** Home is ready once HomeRows has rendered its content. */
export async function waitHome() {
  await waitFor('#homeRows.content.getChildCount()', hasChildren, {
    label: 'home rows',
    timeout: 20000,
  });
}

/**
 * Bring Home's active row list to row 0 — the precondition for leaving Home upward.
 *
 * ## Why anything has to do this
 *
 * `Home.onKeyEvent` escapes to the overhang only when the active list reports
 * `rowItemFocused[0] = 0`; at any other index it returns false, so the key bubbles away,
 * focus never moves, and whatever the caller does next spends its whole timeout pressing at
 * a list that is not listening. That presents as "the screen never loaded" — the north-star
 * failure this suite's rules open with.
 *
 * `waitHome()` is NOT this precondition: it gates on rows EXISTING, and `HomeRows` inserts
 * the latest-media rows MID-LIST (`insertLatestMediaSkeletons`) rather than appending them,
 * so the focused row index can still move after that gate passes.
 *
 * ## Why it walks rather than waits
 *
 * The index does not return to 0 on its own, so a passive wait would simply time out. The
 * walk reads off the FOCUSED node rather than `#homeRows`, for two reasons: Home's active
 * list is `m.activeContent`, which is the favorites list while that tab is selected; and
 * `rowItemFocused` RETAINS its last value while a list does not hold focus, so reading it
 * off a named container can report a stale index forever.
 *
 * It presses ONLY at a row index it can currently see above 0. An ABSENT field means focus
 * is not on a row list at all, where Up is not the right key — send nothing and let the wait
 * time out under its own name rather than pressing at an unidentified component. That guard
 * is also what stops a stale read pressing Up while already at row 0, which would escape
 * into the overhang early and leave the caller somewhere it did not ask to be.
 *
 * Returns the observation instead of reporting it: resting anywhere but row 0 after a
 * relaunch is an app-side surprise, and a harness that silently routes around one can mask
 * the very regression a run exists to catch — but WHICH caller should shout about it, and
 * how loudly, is the caller's call, not this helper's.
 *
 * @returns {Promise<{walked:number, from:number|null}>} how many Ups were sent, and the row
 *   it started on. `{ walked: 0, from: null }` is the healthy case.
 */
export async function walkHomeToFirstRow({ timeout = 10000, interval = 400 } = {}) {
  let walked = 0;
  let from = null;
  await waitFocused((f) => f?.node?.rowItemFocused?.[0] === 0, {
    timeout,
    interval,
    label: 'home row 0 focused (Up leaves Home only from the first row)',
    action: async () => {
      const f = await odc.getFocusedNode({ includeNode: true }).catch(() => null);
      const row = f?.node?.rowItemFocused?.[0];
      if (typeof row === 'number' && row > 0) {
        if (from === null) from = row;
        walked++;
        await press(ecp.Key.Up);
      }
    },
  });
  return { walked, from };
}

/** Roku media-player states that mean playback is live. Frozen — it is a shared registry now. */
export const PLAYING_STATES = Object.freeze(['startup', 'buffer', 'play', 'pause']);

/**
 * Poll the device media-player until it reaches an active playback state.
 *
 * Shared rather than copied per caller. The deep-link spec and the demo runner
 * drive the same player through the same states and each carried a byte-identical
 * copy of this — but only the spec's reported what it SAW on timeout, so a demo
 * take that failed at playback left no record at all. That is the failure worth
 * recording: it silently ruins footage that looks fine until playback.
 *
 * `label` prefixes the message and the record, because the two callers are labelled
 * differently by the harness — Vitest names the spec's test, and nothing names a
 * demo take (see `setFailureContext` in `diagnostics.js`).
 */
export async function waitMediaPlaying(label, timeout = 30000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    const mp = await ecp.getMediaPlayer().catch(() => null);
    last = mp?.state;
    if (mp && !mp.error && PLAYING_STATES.includes(mp.state)) return;
    await sleep(1000);
  }
  // A timeout, so it reports what it SAW — same rule as the waits above. "Never
  // started" alone cannot distinguish a stream that failed to open from a cast the
  // app never routed, and the shell fields answer that: `input=BLOCKED` or a live
  // spinner means the app was busy, not that playback died.
  throw await diagnosedError(`${label}: media player never started (last state=${last})`, {
    kind: FAILURE_KINDS.MEDIA_PLAYER_NOT_STARTED,
    label: `media player (${label})`,
    waitedMs: Date.now() - start,
    observed: { lastPlayerState: last, expected: PLAYING_STATES },
  });
}

/**
 * Stop playback so it cannot leak into whatever runs next. Back on the player stops
 * it (AudioPlayerView/PlayerHostView onKeyEvent "back" → control "stop") — necessary
 * because AUDIO keeps playing while you navigate away (correct music-app UX), so a
 * relaunch-to-Home alone won't silence it. Verify via media-player; retry Back.
 *
 * Deliberately does NOT throw when it gives up: this is cleanup, and both callers
 * run it on their way out of a step that already succeeded or already failed. A
 * throw here would replace a real failure with a teardown one.
 */
export async function stopPlayback() {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const mp = await ecp.getMediaPlayer().catch(() => null);
    if (!mp || !PLAYING_STATES.includes(mp.state)) return;
    await press(ecp.Key.Back);
    await sleep(1200);
  }
}

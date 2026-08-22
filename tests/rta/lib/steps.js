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

/**
 * Home is ready once HomeRows has rendered its content — but only once the app is PAST
 * its login flow, which is a separate question and has to be asked first.
 *
 * ## Why the two phases
 *
 * `JRScene.isRemoteDisabled` defaults to `true` in the XML, and the app mounts no routed
 * view until the login flow resolves the saved session. So between launch and Home there is
 * a window with no `#homeRows` anywhere in the tree, and reading for one during it reports
 * "home rows never appeared" — a statement about Home, produced by a login that simply had
 * not finished.
 *
 * That is not hypothetical either. `.177`, 2026-08-18, ~30 s after a `hardRelaunch`: no
 * routed view at all (`activeRoutedView.subtype()` unresolved), `isRemoteDisabled: true`
 * with `isLoading: false` — a pair NEITHER `startLoadingSpinner` nor `stopLoadingSpinner`
 * can produce, so JRScene was still sitting on its untouched defaults — while
 * `m.global.server` and `m.global.user` were already populated. The app was mid-login
 * against a demo server that had returned an outright auth failure earlier the same day.
 *
 * Gating on a view existing first means a slow login is WAITED for and, if it never
 * arrives, is reported as itself instead of as a missing Home. The login phase carries the
 * larger budget because it is the one bound by a remote server rather than by rendering.
 */
export async function waitHome() {
  await waitFor('subtype()', (v) => typeof v === 'string' && v !== '', {
    read: getActiveVal,
    label: 'app past the login flow (a routed view mounted)',
    timeout: 45000,
    interval: 500,
  });
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

/**
 * Subtypes Home uses for `m.activeContent`, its active row list (`components/home/Home.bs`).
 * Focus resting on one of these means the app is still inside Home's content.
 */
const HOME_ROW_LIST_SUBTYPES = Object.freeze(['HomeRows', 'FavoritesRows']);

/**
 * Which key advances the overhang walk, given where focus ACTUALLY is right now.
 *
 * ## The defect this exists to fix
 *
 * `focusOverhangIcon` pressed Up exactly ONCE and then spent its whole timeout pressing
 * Right. Right is the correct key only AFTER the escape succeeded — it walks the overhang's
 * TabBar -> Search -> Settings chain. While focus is still inside Home's rows, Right walks
 * the ROW instead, and no number of Rights can ever leave Home. So a single lost Up was
 * unrecoverable by construction, and it presented as "the screen never loaded".
 *
 * That is not hypothetical. Two failure records, `.176` 2026-08-16 and `.177` 2026-08-18
 * (this suite, current `main`), carry the same signature: focus still on `#homeRows`,
 * `rowItemFocused` at row 0 with the ITEM index moved off 0 — moved there by the Rights
 * themselves, wrapping around a short row via `wrapRowFocus`. The 2026-08-18 record also
 * shows `#homeRows.content.getChildCount()` at 2 where a settled Home on that fixture holds
 * 6, so the escape was attempted while Home was still inserting rows. `waitHome()` gates on
 * rows EXISTING, which is satisfied by the first one.
 *
 * ## Why re-pressing Up is safe
 *
 * Up is only ever returned while focus is inside a Home row list. At row 0 it is the escape;
 * at any higher row it walks toward row 0, which is the same precondition `walkHomeToFirstRow`
 * establishes. And a stray Up that arrives once focus HAS reached the overhang is inert by
 * design at every step of the chain it walks: `JRTabBar.onKeyEvent` and
 * `JROverhangIcon.onKeyEvent` both fall through on Up ("nothing above the tab bar"), and
 * `JRScene.onKeyEvent` does not handle it either.
 *
 * ## Why it reads `subtype`, and not the id or the keyPath
 *
 * `Home.xml` declares `<HomeRows id="homeRows" />`, so on a fresh launch the focused node
 * does carry that id. But `Home.onTabChanged` RE-CREATES both lists with `CreateObject` and
 * never assigns an id — and RTA builds a keyPath segment from `node.id` only while it is
 * non-empty, falling back to the child INDEX otherwise. So after one favorites round trip
 * an id/keyPath match silently stops matching and falls straight through to Right, which is
 * the exact defect above, reinstated and invisible. `subtype` is set by the component rather
 * than by the call site, so it holds across that path.
 *
 * The favorites half is future-proofing, not coverage: nothing in `specs/` selects a tab, so
 * `FavoritesRows` is unreachable from here today (see the `rta-home-active-list-hardcoded`
 * entry in `docs/architecture/tech-debt.md`, whose sibling call sites still match by name).
 * It is here because the predicate should agree with the app — `getActiveRows()` returns
 * `m.activeContent` — not because a test exercises it.
 *
 * Kept pure, and here rather than in `nav.js`, so it can be unit-tested directly: `nav.js`
 * IS importable under a mocked device, but its walk is wrapped in the unexported
 * `focusOverhangIcon`, and a test that drove it through `navSettings` would be asserting on
 * a nav rather than on this rule.
 *
 * @param {object|null} focused `odc.getFocusedNode({includeNode:true})`, or null if it failed.
 * @param {string} iconId the overhang icon the walk is trying to reach.
 * @returns {string|null} the key to send, or null when focus has arrived.
 */
export function overhangWalkKey(focused, iconId) {
  if (focused?.node?.id === iconId) return null;
  // Home's active list is `m.activeContent` — `HomeRows` or `FavoritesRows` depending on the
  // selected tab — so either subtype means "the escape has not happened yet".
  if (HOME_ROW_LIST_SUBTYPES.includes(focused?.node?.subtype)) return ecp.Key.Up;
  // Unknown focus (a failed read) keeps the pre-existing behaviour rather than inventing a
  // new one: Right is inert on most of the overhang chain, Up from it is inert by design.
  return ecp.Key.Right;
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

/**
 * How long to leave between the keypresses of a scripted scroll.
 *
 * Not a settle — a CADENCE. The behaviour the cell-load ledger exists to measure is what
 * happens while a list is scrolling fast: cells recycle, bind onto new items and re-issue
 * image requests, and the failure mode being hunted (a glyph wiped on a cell sitting still)
 * only shows up under pressure. Stepping one key per poll interval, the way the focus WALKS
 * in `nav.js` do, gives the texture manager ~400 ms of quiet between every move and measures
 * a workload no user produces. 150 ms is inside Roku's own key-repeat band for a held
 * direction key, so a burst at this cadence is what the app sees from a held remote.
 */
export const SCROLL_KEY_INTERVAL_MS = 150;

/**
 * Drive a focus INDEX to `target` by bursting keypresses at remote cadence, then gating on
 * the index actually arriving.
 *
 * ## Why a burst plus a gate, rather than one press per poll
 *
 * The two properties a measured workload needs pull in opposite directions. It must be
 * FAST, because a slow walk measures a screen that is never under load (see
 * `SCROLL_KEY_INTERVAL_MS`); and it must be EXACT, because the whole point of scripting the
 * workload is that two runs travel the same distance — a rate whose denominator moved
 * between runs cannot be compared, which is what retired the hand-driven method this
 * replaces. A burst alone is fast and inexact (a dropped key silently shortens the trip); a
 * per-poll walk is exact and slow. Bursting and then reconciling gets both: the common case
 * costs `steps * interval` ms and lands exactly, and only the dropped keys pay a poll.
 *
 * ## Why the reconciliation waits for the index to STOP moving
 *
 * The device is still working through the burst when the gate opens, so an index short of
 * `target` does NOT mean a key was lost — it usually means the queue has not drained. A
 * corrective press there is sent on top of one already in flight and overshoots, after which
 * the correction reverses and oscillates. So a press is only sent once the index has been
 * observed UNCHANGED across a tick: still-moving means wait, stuck-and-short means a key
 * really was dropped. Same shape as `resendIfSwallowed`, whose comment carries the recorded
 * cases of a swallowed key, and the same reason it sits out its first tick.
 *
 * **That rule has to be re-armed after every corrective press, not just the first.** A
 * correction is itself a key in flight, so the tick after one fires sees the index still
 * unchanged — and treating that as "stuck and short" presses again on top of it, which is
 * the overshoot this whole gate exists to avoid, just one step later. Clearing `lastSeen`
 * makes the next tick re-establish an unchanged observation before it may press again, so
 * each correction gets a full poll interval to land. Modelled in the unit tests by a device
 * that applies presses with LATENCY: without the reset, one dropped key out of three drew
 * two corrections and left the list one index past the target, with `scrollFocus` reporting
 * the target it had asked for — a denominator that moved after the walk said it had not.
 *
 * Returns what it actually did, because the caller has to be able to say so: a workload is
 * only "fixed" if the run can report the distance it travelled. `to` is the index READ at
 * the moment the gate opened, not the one that was requested — they are equal by the gate's
 * own predicate, and reporting the observed one keeps that an assertion rather than a claim.
 *
 * ## `stride` — one press is not always one index
 *
 * MEASURED on `.177`, 2026-08-20, because the first version of this assumed otherwise and
 * stalled: a library grid is a 2-D `MarkupGrid` (6 columns x 3 rows on that device), and its
 * flat `itemFocused` moves by **one** on Right and by **`numColumns`** on Down. Right does
 * NOT wrap at the end of a row — 8 Rights from index 0 land on 5 and every further Right is
 * inert, at every cadence tried (150 / 400 / 800 ms), so a sweep that treats the index as
 * one-per-press cannot cross the first row. `stride` is how far one press moves the index;
 * the target must be a whole number of strides from the start, which is also what keeps the
 * caller from asking for a position the list cannot stop on.
 *
 * @param {object} opts
 * @param {string} opts.keyPath      the index field, e.g. `#itemGrid.itemFocused`
 * @param {number} opts.target       the index to land on
 * @param {string} opts.forwardKey   `ecp.Key` value that increases the index
 * @param {string} [opts.backKey]    `ecp.Key` value that decreases it; required to walk back
 * @param {number} [opts.stride]     index units one press moves (default 1)
 * @param {(v:any)=>any} [opts.select] pull the index out of the field (`rowItemFocused` is a
 *                                     `[row, item]` pair, `itemFocused` is the index itself)
 * @param {(k:string)=>Promise<any>} [opts.read] `getVal` (default) or `getActiveVal`
 * @param {string} [opts.label]      what to call this walk in waits, warnings and the report
 * @param {number} [opts.keyIntervalMs] burst cadence; defaults to `SCROLL_KEY_INTERVAL_MS`
 * @param {number} [opts.timeout]    budget for the reconciliation, once the burst is sent
 * @param {number} [opts.interval]   poll interval of the reconciliation
 * @returns {Promise<{from:number, to:number, pressed:number, recovered:number}>}
 */
export async function scrollFocus({
  keyPath,
  target,
  forwardKey,
  backKey = null,
  stride = 1,
  select = (v) => v,
  read = getVal,
  label,
  keyIntervalMs = SCROLL_KEY_INTERVAL_MS,
  timeout = 25000,
  interval = 400,
}) {
  const name = label || `${keyPath} -> ${target}`;
  // The precondition, gated rather than assumed: `itemFocused` / `rowItemFocused` read as
  // their retained value (or as undefined) until the list holds focus, and a burst sent at
  // that moment goes to whatever does. This is `waitFocusInside`'s rule applied to the field
  // the walk actually reads — a caller that established focus pays one read for it.
  const from = await waitFor(keyPath, (v) => typeof select(v) === 'number', {
    read,
    timeout: 12000,
    interval: 300,
    label: `${name}: focus index readable`,
  }).then(select);

  const delta = target - from;
  const key = delta >= 0 ? forwardKey : backKey;
  if (delta !== 0 && !key) {
    // A fail-fast that already names its cause — the caller asked to walk backwards without
    // supplying the key for it. Waiting cannot fix it.
    // eslint-disable-next-line no-restricted-syntax -- fail-fast, cause already named
    throw new Error(`${name}: needs to move ${delta} but no key was given for that direction`);
  }
  if (delta % stride !== 0) {
    // Also a fail-fast: the list cannot stop between strides, so this walk would press
    // forever and time out reporting an index that was never reachable.
    // eslint-disable-next-line no-restricted-syntax -- fail-fast, cause already named
    throw new Error(
      `${name}: ${from} -> ${target} is ${delta}, which is not a whole number of ` +
        `${stride}-unit presses — the list cannot stop there`,
    );
  }
  for (let i = 0; i < Math.abs(delta) / stride; i++) {
    await press(key);
    await sleep(keyIntervalMs);
  }

  let recovered = 0;
  let lastSeen = null;
  const landed = await waitFor(keyPath, (v) => select(v) === target, {
    read,
    timeout,
    interval,
    label: `${name}: index settled at ${target}`,
    action: async () => {
      const cur = select(await read(keyPath));
      if (typeof cur !== 'number' || cur === target) return;
      // Still draining the burst — do not press on top of a key already in flight.
      if (cur !== lastSeen) {
        lastSeen = cur;
        return;
      }
      recovered++;
      await press(cur < target ? forwardKey : backKey);
      // Re-arm the "unchanged across a tick" rule: the press just sent is now itself in
      // flight, and the next tick will still read the pre-press index. Without this the
      // guard decays into "press every tick until it moves" — see the docblock.
      lastSeen = null;
    },
  });
  return { from, to: select(landed), pressed: Math.abs(delta) / stride, recovered };
}

/**
 * An axis a sweep intends to travel COMPLETELY: the last index there is, announced only
 * when there is nothing to travel.
 *
 * ## Why this is not `sweepBudget` with a big number
 *
 * The two look alike and mean opposite things, and conflating them is what made the clamp
 * warning worthless. A `MarkupGrid` row is `numColumns` wide — 6 on a Stick 4K — because
 * that is the LAYOUT, not because the fixture ran short. Asking `sweepBudget` for 12 columns
 * there warned on every single run, in the one channel that exists to say "this run did not
 * travel as far as the last one", which trains an operator to skip the line that matters.
 * Reaching the end of a bounded axis is the itinerary succeeding; say nothing about it.
 *
 * @returns {number} the last index, or 0 when the axis holds nothing to travel
 */
export function axisEnd(label, available) {
  if (typeof available !== 'number' || available < 1) {
    console.warn(`[nav] ${label}: read ${JSON.stringify(available)} entries — sweeping nothing.`);
    return 0;
  }
  return available - 1;
}

/**
 * A BUDGETED axis: travel `wanted` steps, or as far as the fixture allows, announcing any
 * shortfall.
 *
 * A clamp is not a failure — it is the fixture being smaller than the itinerary, and it is
 * still deterministic wherever the content itself is settled, so the run stays comparable to
 * other runs on the same fixture. What it must not be is SILENT: a run that swept 3 rows and
 * a run that swept 12 differ in every count the ledger publishes, and the operator comparing
 * them has only this line to tell them apart.
 *
 * Use this only where `wanted` is a genuine time budget the axis could exceed — the row
 * count of a RowList, the items in a shelf. For an axis whose length is a structural bound
 * the sweep always means to traverse, use `axisEnd`.
 *
 * @returns {number} the last index to travel to
 */
export function sweepBudget(label, wanted, available) {
  if (typeof available !== 'number' || available < 1) {
    console.warn(`[nav] ${label}: read ${JSON.stringify(available)} entries — sweeping nothing.`);
    return 0;
  }
  const target = Math.min(wanted, available - 1);
  if (target < wanted) {
    console.warn(
      `[nav] ${label}: fixture holds ${available} entries, so the sweep clamps to ${target} of ` +
        `${wanted} steps. Counts from this run are comparable only to other runs on a fixture ` +
        'this size.',
    );
  }
  return target;
}

/**
 * The cell-load counters a settle has to watch, as the `cellLoad<Name>` field suffix.
 *
 * Minimal and complete — the reasoning, and the emit sites it was checked against, are in
 * `waitCellsQuiet`'s docblock. Adding a counter to `source/utils/cellLoad.bs` only belongs
 * here if it can increment while `Binds` and `LoadsStarted` both sit still; everything that
 * shares a straight-line block with one of those is already covered.
 */
export const CELL_QUIET_COUNTERS = Object.freeze([
  'Binds',
  'LoadsStarted',
  'LoadsFailed',
  'LoadsSucceeded',
  'Unloads',
  // Qualifies under the rule above rather than by being new — a returning cell moves this
  // and nothing else. Reasoning and the emit sites it was checked against: `waitCellsQuiet`.
  'Appearances',
]);

/**
 * Counters the report LINE carries, which is a superset of the ones a settle watches.
 *
 * `PopIns` is here and NOT in `CELL_QUIET_COUNTERS`, by the same rule: it only ever
 * increments inside `loadSucceeded`, so it cannot move while `LoadsSucceeded` sits still
 * and adding it to the settle would buy nothing. It is on the line because it is the
 * number a reader most needs to SEE — the run that shipped the blind spot this counter
 * exists to close had `appearances` equal to `binds`, and nobody looked, because neither
 * value was printed anywhere.
 */
export const CELL_REPORT_COUNTERS = Object.freeze([...CELL_QUIET_COUNTERS, 'PopIns']);

/** The reported counters as one `name=value` run, for a warning or a report line. */
export const formatCellCounts = (counts) =>
  CELL_REPORT_COUNTERS.map((c) => `${c[0].toLowerCase()}${c.slice(1)}=${counts?.[c]}`).join(' ');

/**
 * Wait until a texture-managed list's cell-load counters stop moving.
 *
 * ## Why the workload has to end at a quiet point
 *
 * The counters are emitted when the screen is hidden or destroyed, so whatever is still in
 * flight at that instant is counted asymmetrically: an image request that has STARTED but
 * not yet failed contributes to `loadsStarted` and not to `loadsFailed`. Leaving the screen
 * a fixed wall-clock time after the last keypress would put that boundary in a different
 * place on every run — a slower device, a slower server or a colder cache each move it —
 * so the run-to-run variance of `loadsFailed` would be an artefact of when we pressed Back.
 * Ending on quiescence instead makes the boundary a property of the app.
 *
 * ## Why it reads the app's own counters rather than a proxy
 *
 * There is no "all textures resolved" signal to gate on, and a fixed `sleep` is the thing
 * this suite's rules forbid. But the counters themselves are ordinary node fields on the
 * content root, so they are readable over ODC — which `source/utils/cellLoad.bs` names as
 * one of the three reasons they live there. Gating the measurement's end on the measured
 * quantity is the closest thing available to an exact boundary.
 *
 * ## Which counters it watches, and why exactly these six
 *
 * `CELL_QUIET_COUNTERS` is minimal AND complete, and both halves are checked against the
 * emit sites in `source/utils/cellLoad.bs` rather than chosen by feel. A counter needs
 * watching only if it can move while `binds` and `loadsStarted` both sit still. Exactly
 * four can:
 *
 *   - **`cellLoadLoadsFailed`** — `JRRowItem.onPosterLoadStatusChanged` / `GridItem`'s
 *     equivalent, an ASYNCHRONOUS completion callback. It is the whole reason this function
 *     exists: a request that has started and not yet failed is counted by `loadsStarted` and
 *     not by `loadsFailed`, so a boundary drawn while one is outstanding splits a pair.
 *   - **`cellLoadLoadsSucceeded`** — the `ready` half of that same callback, and watched
 *     for the identical reason. It was added after a review asked how a "successful loads"
 *     figure was known, and the answer was that it was not: successes were inferred as
 *     `loadsStarted - loadsFailed`, which counts a request that never came back as a
 *     success. With it watched, the same quiescence that pairs a start with its failure
 *     pairs a start with its success, and `loadsStarted - (loadsFailed + loadsSucceeded)`
 *     becomes a residual the caller can assert is zero rather than a gap it cannot see.
 *   - **`cellLoadUnloads`** — `unloadTexture` bumps nothing else, so an off-screen cell
 *     releasing its texture is invisible to the others.
 *   - **`cellLoadAppearances`** — a cell that scrolls back into view with its texture still
 *     loaded bumps this and NOTHING else: it was never rebound, the buffer held the image
 *     so no load ran, and nothing unloaded. On `cellSweepGrid` that is 12 of the 18
 *     re-entries, so a settle blind to it could declare quiet while cells were still
 *     re-appearing and publish an `appearances` short by most of what the pop-in line
 *     exists to count.
 *
 * Every remaining counter is structurally PINNED to one of those two and needs no watch of
 * its own: `bindsFromContent` / `bindsFromSize` / `bindsRedundant` increment inside
 * `cellLoad.bind` itself; `wipesBind` fires in `renderItem()`, whose only two callers invoke
 * `cellLoad.bind` on the line above it; `reloads` and `wipesReload` sit in `reloadTexture`'s
 * same straight-line block as its `loadStarted`. None of them can move alone, so watching
 * them would cost reads and buy nothing.
 *
 * **What this does NOT fix, measured rather than hoped.** Across six `cellSweepExtras`
 * launches on `.177` the wobbling fields (`loadsFailed` 116–118, `reloads` 121–123,
 * `unloads` 7–8, `wipesBind` 32–34) all moved TOGETHER and in the same direction, while
 * `loadsStarted` held at exactly 140. Two things follow, and the second is easy to state
 * backwards. It is NOT a count truncated at the boundary — that would show the same
 * `reloads` with fewer `loadsFailed`, and instead the whole chain shifts. But it is not the
 * workload getting BIGGER or smaller either: 140 attempts every launch, with bind-path
 * loads (`loadsStarted - reloads`) falling 19 -> 17 exactly as `reloads` rises 121 -> 123.
 * The total work is fixed and its SPLIT drifts — the same cell taking the reload path
 * instead of the bind path — which is a timing-dependent choice in the app, not slack in
 * the harness. Only the +/-1 seen at CONSTANT `reloads` (one launch of nine) is a boundary
 * artefact this can remove. Widening the gate is still right, because the invariant it
 * buys — every field the sample publishes has stopped moving — is one the caller can rely
 * on; it is not a variance fix, and must not be sold as one.
 *
 * ## Why it warns instead of throwing
 *
 * A list that never goes quiet is a FINDING, not a harness failure — it is precisely the
 * runaway-rebind shape the ledger was built to catch — and every caller is a nav that also
 * runs as a functional test. Throwing would turn the discovery into a red screen-loads
 * test, in a suite whose reds are supposed to mean the screen did not load. It reports
 * instead, and the emitted line carries the evidence.
 *
 * A build with `perfTiming` off carries no counters at all; that reads as "nothing to wait
 * for" and returns immediately rather than warning, since it is the correct state for a
 * production build. **An unreadable keyPath looks identical from one read** — both come back
 * `undefined` — so the content root is read too, and the two are reported differently: an
 * uninstrumented build is a fact about the build, while a list that does not resolve at all
 * means this call is watching nothing and the caller's numbers have no settle behind them.
 * Collapsing them would print "perfTiming off" at an operator whose keyPath was simply wrong.
 *
 * @param {string} listId the list's `#id` — the counters hang off `<listId>.content`
 * @param {object} [opts]
 * @param {(k:string)=>Promise<any>} [opts.read] defaults to `getActiveVal`, which is what
 *   every cell-bearing list needs: `#itemGrid`, `#extrasGrid` and `#homeRows` all recur
 *   across suspended views, so a scene-rooted read can settle on the wrong screen's counters
 * @returns {Promise<{quiet:boolean, instrumented:boolean, resolved:boolean,
 *                    counts:Record<string, number|undefined>, waitedMs:number}>}
 */
export async function waitCellsQuiet(
  listId,
  { read = getActiveVal, quietMs = 1500, timeout = 15000, interval = 400 } = {},
) {
  const start = Date.now();
  const sample = async () => {
    const out = {};
    // Sequential single reads, not `getActiveVals`. The batch rule in `tests/rta/CLAUDE.md`
    // governs ONE-SHOT assertions, where a spread-out read window can straddle a settling
    // screen; a poll loop is explicitly carved out of it. It is also safe here for a reason
    // specific to these fields: the counters only ever increase, so a sample that straddles
    // an increment can delay quiescence but can never declare it early.
    // Reads the REPORT set; the quiet comparison below uses only `CELL_QUIET_COUNTERS`.
    // A report-only counter must not be able to hold a settle open.
    for (const c of CELL_REPORT_COUNTERS) out[c] = await read(`${listId}.content.cellLoad${c}`);
    return out;
  };

  let counts = await sample();
  if (typeof counts.Binds !== 'number') {
    const resolved = typeof (await read(`${listId}.content.getChildCount()`)) === 'number';
    if (!resolved) {
      console.warn(
        `[nav] ${listId}: neither the cell-load counters NOR the content root itself resolved — ` +
          'this settle watched nothing, so the counts that follow have no quiet point behind ' +
          'them. Check the keyPath and whether the list is still mounted.',
      );
    }
    // `quiet: false` when the list never resolved — this call observed no quiet point, and
    // saying otherwise would let a caller that reads only `.quiet` treat a watch of nothing
    // as a settle. `instrumented: false` with `resolved: true` is the genuinely quiet case:
    // a production build carries no counters, so there is nothing to wait for.
    return { quiet: resolved, instrumented: false, resolved, counts, waitedMs: 0 };
  }

  const changed = (a, b) => CELL_QUIET_COUNTERS.some((c) => a[c] !== b[c]);
  let lastChange = Date.now();
  while (Date.now() - start < timeout) {
    await sleep(interval);
    const next = await sample();
    if (changed(counts, next)) {
      counts = next;
      lastChange = Date.now();
      continue;
    }
    if (Date.now() - lastChange >= quietMs) {
      return {
        quiet: true,
        instrumented: true,
        resolved: true,
        counts,
        waitedMs: Date.now() - start,
      };
    }
  }
  console.warn(
    `[nav] ${listId}: cell-load counters never went quiet for ${quietMs} ms within ` +
      `${timeout} ms — last ${formatCellCounts(counts)}. The emitted sample still describes a ` +
      'real session, but its boundary falls inside ongoing work, so the fields that close ' +
      'asynchronously (loadsFailed, unloads) are undercounted relative to a run that settled.',
  );
  return { quiet: false, instrumented: true, resolved: true, counts, waitedMs: Date.now() - start };
}

/**
 * Wait until a list's ROW STRUCTURE stops changing — the precondition a scripted sweep of
 * an asynchronously-built screen needs before it reads its own bounds or presses a key.
 *
 * ## Why this exists, and why only Home needs it
 *
 * `waitCellsQuiet` closes the measured session at a quiet point; this is its missing
 * opening half. Home is the one cell screen whose sweep has never reproduced — three
 * campaigns on `.177` read `binds` 231/235/235, then 231/238/253, then 222/231/234, while
 * `cellSweepGrid`, `cellSweepExtras` and `cellSweepSearch` were exact on every field.
 *
 * ⚠️ **The hypothesis that built this — stated here because it was WRONG and the next
 * reader will have it too.** Home's rows arrive from `LoadLatestRowsTask` over the seconds
 * after `waitHome()` passes (that gate is satisfied by skeleton rows), and
 * `insertLatestMediaSkeletons` inserts them MID-LIST — so a sweep started too early would
 * read its row count and its widest row off a screen still being built, and travel over a
 * structure changing underneath it. Plausible, mechanically sound, and refuted on device:
 * see the measurement below. The rows are already there when the sweep starts.
 *
 * 🚨 **This gate does NOT reduce Home's variance, and it was built believing it would.**
 * Measured rather than assumed, by the protocol this project already requires for Home
 * (n=20 per arm, alternated in four blocks, `.177`, real server, same build `ad944494`):
 * `binds` 235–255 in BOTH arms, medians 242 and 242, IQR 13 against 11, and a
 * Brown-Forsythe-shaped rank test on |x − median| gives |z| < 1.7 on every field — the
 * largest, `appearances` at z = −1.62, pointing at the UNGATED arm being tighter. An n=5
 * pilot had looked like it pinned four fields (`appearances` 105×5, `popIns` 42×5); n=20
 * says that was noise, which is exactly what an n=5 range statistic is worth on a discrete,
 * clustered distribution. **Do not re-run this experiment.**
 *
 * ⚠️ **What it IS kept for: it turns a precondition nobody had checked into a fact printed
 * on every run.** On all 20 gated launches it reported the structure already stable at
 * gate-open (`settled in 1983–2048 ms`, i.e. the `quietMs` floor plus one poll), so Home's
 * rows are NOT still arriving when the sweep starts, and arrival timing is not the
 * mechanism behind the spread. Together with the itinerary line (identical on all 40
 * launches, zero corrective presses), `items` 128 on all 40, `unloads` 59 on all 40 and
 * `popInsCold` 29 on all 40, that pins the harness side of `cellSweepHome` completely — and
 * `binds` still spans 235–255. **The remaining variance is the app binding a different
 * number of cells over an identical, settled workload**, which is an app question and the
 * one Phase B should be spending itself on. A gate beats an eyeball: this is the durable
 * form of that refutation, so the next session inherits the null instead of re-deriving it.
 *
 * ⚠️ **More dwell is not the answer either** — inserting `waitCellsQuiet` BEFORE the sweep
 * as well (roughly doubling the wait) made things worse at n=5, not better: `binds` range 17
 * against the gated arm's 7 and `appearances` 105–126. Recorded so the obvious next knob is
 * known to have been tried.
 *
 * ⚠️ **The ledger's `items` is a weaker certificate than it looks, but it is not blind.**
 * `cell-load` publishes it from `countItems(contentRoot)` at EMIT time, when the screen is
 * hidden and everything has arrived — so it certifies the FINAL structure, not the one the
 * sweep travelled. It did catch the demo fixture drifting 24 -> 25 items mid-campaign, so do
 * not read it as useless; read it as unable to distinguish a sweep over a half-built screen
 * from one over a whole screen that ends the same way. That distinction is what this gate
 * adds, and on Home the answer turned out to be "the screen was whole all along".
 *
 * Extras and search are deliberately NOT gated on this, for the reason `navCellSweepGrid`'s
 * return leg was not folded into `sweepRowList`: their bounds are identical run to run, so a
 * settle can only be a no-op there, and their recorded baselines are the denominator real
 * comparisons were taken at. Cost with no benefit.
 *
 * ## What it watches
 *
 * The row count and every row's child count — the two things `sweepRowList` reads to choose
 * an itinerary, so the gate covers exactly what a moving structure would move. It sees ALL
 * of Home's asynchronous sections, not just latest media, because a skeleton row carries one
 * placeholder child and a populated one carries its items: a section filling in is a change
 * in this sample whichever task filled it.
 *
 * Single reads rather than `getActiveVals`, on the poll-loop carve-out in
 * `tests/rta/CLAUDE.md` and for the same reason `waitCellsQuiet` takes it: a sample that
 * straddles an arriving row reports a DIFFERENCE, which delays quiescence and cannot
 * declare it early.
 *
 * ## What it does NOT prove — state, do not discover later
 *
 * Quiescence is a heuristic, not the app's own "run complete" signal (`isLoadingLatestRows`
 * is an `m` local and reaches no interface). A gap between two rows arriving that exceeds
 * `quietMs` reads as settled. That is why the observed structure is RETURNED and printed on
 * the sweep line: a run whose settle fired early no longer looks like every other run, it
 * announces a different `rows`/`items` pair. The confound becomes visible instead of being
 * eliminated, which is what the ledger's `items` field failed to do.
 *
 * **The itinerary is deliberately NOT read from this gate's return value.** `sweepRowList`
 * takes its own look at the same two quantities, so the settle's pair and the swept pair are
 * two INDEPENDENT observations — and that is the only thing that can catch the failure named
 * directly above, because a gate cannot self-detect firing early. Thread the settled sample
 * into the sweep and it becomes authoritative and unfalsifiable: the itinerary would agree
 * with the settle BY CONSTRUCTION, on a mid-build lull exactly as readily as on a finished
 * screen. That is the same weakness that makes the ledger's `items` a poor certificate,
 * reintroduced one layer up. The second opinion is close to free — `sweepRowList` re-reads
 * the pair in TWO round trips, since `getActiveVals` batches the per-row widths, against the
 * ~2000 ms this gate already spends.
 *
 * Warns rather than throwing, exactly as `waitCellsQuiet` does: every caller is a nav that
 * also runs as a functional test, where a red means "the screen did not load".
 *
 * **Why the timeout is 20000 and not `waitCellsQuiet`'s 15000 — reasoning added at review,
 * and NOT the basis on which the number was originally picked.** `waitHome`'s rows gate
 * already allows 20000 for `#homeRows.content.getChildCount()` to become non-empty: the HEAD
 * of the latest-rows arrival process. This gate waits for the TAIL of that same process, so
 * the two belong on one budget and should move together when Home's arrival budget moves.
 * `waitCellsQuiet`'s 15000 covers a different situation — it runs AFTER the sweep, when the
 * screen is already settled and quiescence is imminent. No measurement prefers 20000 over
 * 15000: observed settles were ~2000 ms, so either is 7–10x headroom, and the timeout bites
 * only when the structure genuinely never stops moving, which warns and proceeds.
 *
 * **The two ways this gives up are different findings and warn differently**, on the same
 * split `waitCellsQuiet` draws between an uninstrumented build and an unreadable keyPath: a
 * structure that never held still means the screen was still being BUILT, while one that
 * stopped answering means the list went AWAY — replaced, unmounted, or swapped by a view
 * change — and telling an operator the second was the first sends them after the wrong bug.
 *
 * @param {string} listId the list's `#id` — rows hang off `<listId>.content`
 * @param {object} [opts]
 * @param {(k:string)=>Promise<any>} [opts.read] defaults to `getActiveVal`
 * @returns {Promise<{settled:boolean, resolved:boolean, rows:number|undefined,
 *                    items:number|undefined, widths:number[], waitedMs:number}>}
 *   `resolved` is answered at GATE-OPEN — false only when the list never answered at all.
 *   A list that answers once and then vanishes still reports `resolved: true`, because the
 *   structure it hands back is the real one it read before vanishing; the warning is what
 *   carries that it went away. `rows`/`items`/`widths` therefore always describe a structure
 *   this call actually observed, never a failed read.
 */
export async function waitRowsSettled(
  listId,
  { read = getActiveVal, quietMs = 1500, timeout = 20000, interval = 400 } = {},
) {
  const start = Date.now();
  const sample = async () => {
    const rows = await read(`${listId}.content.getChildCount()`);
    if (typeof rows !== 'number') return { rows: undefined, widths: [] };
    const widths = [];
    for (let r = 0; r < rows; r++) {
      const w = await read(`${listId}.content.${r}.getChildCount()`);
      widths.push(typeof w === 'number' ? w : 0);
    }
    return { rows, widths };
  };
  const total = (s) => s.widths.reduce((n, w) => n + w, 0);
  // Row COUNT is not compared: `widths` has one entry per row by construction, so a row
  // arriving or being removed already differs in length. What the `rows` check IS
  // load-bearing for is the unresolved sample — two consecutive failed reads both produce
  // `{ rows: undefined, widths: [] }`, which compares EQUAL and would otherwise declare a
  // list that stopped answering to be a settled one.
  const same = (a, b) =>
    typeof a.rows === 'number' &&
    typeof b.rows === 'number' &&
    a.widths.length === b.widths.length &&
    a.widths.every((w, i) => w === b.widths[i]);

  let shape = await sample();
  if (typeof shape.rows !== 'number') {
    console.warn(
      `[nav] ${listId}: the content root did not resolve, so the sweep that follows was not ` +
        'gated on a settled structure. Check the keyPath and whether the list is mounted.',
    );
    return {
      settled: false,
      resolved: false,
      rows: undefined,
      items: undefined,
      widths: [],
      waitedMs: 0,
    };
  }

  // The last sample whose reads SUCCEEDED, tracked separately from `shape` because the two
  // diverge in exactly the case worth reporting well: a list that goes away mid-poll answers
  // `{ rows: undefined, widths: [] }` for the rest of the timeout, so `shape` — which must
  // follow the live reading to keep the settle honest — stops describing anything. Reporting
  // it prints `last undefined row(s)` and blames a screen still being BUILT for a screen that
  // is no longer THERE. Those are two different findings with two different fixes, so the
  // structure this call reports is always one it actually observed.
  let lastGood = shape;
  let lastChange = Date.now();
  while (Date.now() - start < timeout) {
    await sleep(interval);
    const next = await sample();
    if (typeof next.rows === 'number') lastGood = next;
    if (!same(shape, next)) {
      shape = next;
      lastChange = Date.now();
      continue;
    }
    if (Date.now() - lastChange >= quietMs) {
      return {
        settled: true,
        resolved: true,
        rows: shape.rows,
        items: total(shape),
        widths: shape.widths,
        waitedMs: Date.now() - start,
      };
    }
  }
  console.warn(
    typeof shape.rows === 'number'
      ? `[nav] ${listId}: the row structure never held still for ${quietMs} ms within ` +
          `${timeout} ms — last ${lastGood.rows} row(s), ${total(lastGood)} item(s). The sweep ` +
          'still ran, but it read its bounds off a screen that was still being built, so its ' +
          'counts are comparable only to other runs that also failed to settle.'
      : `[nav] ${listId}: the list STOPPED ANSWERING mid-settle — the last structure it read was ` +
          `${lastGood.rows} row(s), ${total(lastGood)} item(s), and it read nothing for the rest ` +
          `of ${timeout} ms. The screen was replaced or unmounted underneath this call, so the ` +
          'structure reported here is the LAST ONE OBSERVED and NOT the one the sweep travelled.',
  );
  return {
    settled: false,
    resolved: true,
    rows: lastGood.rows,
    items: total(lastGood),
    widths: lastGood.widths,
    waitedMs: Date.now() - start,
  };
}

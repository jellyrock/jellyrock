/**
 * In-app navigation to each screen, driven from a seeded "home" state with
 * remote keypresses + odc node-waits (NOT fixed sleeps) so each step proceeds
 * the moment the UI is actually ready. The `waitFor` gates inside each nav ARE
 * the "screen loaded" assertions — if a screen fails to render, the nav throws.
 *
 * `ctx` carries { heroIndex, heroId } (from getHero) and `libraries` (from
 * getLibraries) — the latter is what lets a library nav resolve the SAME library
 * the seeding side picked, rather than the first tile of a matching type. Pass
 * ctx through every chained nav — omitting it now THROWS on any server with
 * several libraries of one type, rather than quietly picking the wrong one. The
 * osd backdrop injection
 * is intentionally NOT here — it's a screenshot-only concern handled by the
 * store orchestrator after nav, so the functional test for osd stays free of
 * ffmpeg/backdrop logic.
 */
import { ecp, odc } from 'roku-test-automation';
import { RTA_CONFIG } from '../config.js';
import { libraryIdFor } from './jellyfin.js';
import { diagnosedError, FAILURE_KINDS } from './diagnostics.js';
import {
  press,
  getVal,
  getActiveVal,
  waitFor,
  waitFocused,
  waitFocusInside,
  waitHome,
  walkHomeToFirstRow,
  overhangWalkKey,
  hasChildren,
  resendIfSwallowed,
  sleep,
} from './steps.js';

/**
 * From Home, move focus into the overhang and onto the icon with id `iconId`.
 *
 * Two preconditions, in order. Home's active list must be resting on row 0, or Up does not
 * leave Home at all (`walkHomeToFirstRow`). Only then does Up move focus into the overhang,
 * whose focus chain is TabBar -> Search -> Settings (left to right, see JROverhang.bs) with
 * a variable tab count, so we walk Right until the icon is focused. The action is guarded to
 * only press while NOT yet on the icon, so it can't overshoot onto the user dropdown.
 */
async function focusOverhangIcon(iconId) {
  await waitHome();
  // Up leaves Home ONLY from the first row — see `walkHomeToFirstRow`, which is where that
  // rule and its tests live. Announced rather than silently routed around: resting anywhere
  // but row 0 straight after a relaunch is an app-side surprise, and a harness that quietly
  // recovers from one can mask the very regression a run exists to catch.
  const { walked, from } = await walkHomeToFirstRow();
  if (walked > 0) {
    console.warn(
      `[nav] Home was resting on row ${from}, not row 0 — walked up ${walked} time(s) ` +
        'before reaching the overhang. Up cannot leave Home from any other row, so this ' +
        'would previously have failed as "screen never loaded". Worth investigating why ' +
        'the first row was not focused after a relaunch.',
    );
  }
  await press(ecp.Key.Up); // home content -> overhang
  // The key is chosen from where focus IS, not from where the walk assumes it got to: while
  // focus is still in Home's rows the escape has not happened and Right can only walk the row.
  // See `overhangWalkKey`, which carries the recorded failures this rule comes from.
  let escapeRetries = 0;
  await waitFocused((f) => f?.node?.id === iconId, {
    timeout: 15000,
    interval: 400,
    action: async () => {
      const f = await odc.getFocusedNode({ includeNode: true }).catch(() => null);
      const key = overhangWalkKey(f, iconId);
      if (key === ecp.Key.Up) escapeRetries++;
      if (key) await press(key);
    },
    label: `overhang ${iconId}`,
  });
  if (escapeRetries > 0) {
    // Announced, not swallowed. A retry that succeeds means the FIRST Up was lost while Home
    // was still settling — the open half of #789. This line is the only thing that says so,
    // and a run that prints it is the run worth capturing.
    console.warn(
      `[nav] overhang ${iconId}: the first Up did not leave Home — re-pressed ${escapeRetries} ` +
        "time(s) before the escape took. Focus was still inside Home's rows, where Right " +
        'cannot help. Worth investigating why Up was lost (see #789).',
    );
  }
}

/** home -> overhang settings icon -> Settings screen (version label is the gate). */
export async function navSettings() {
  await focusOverhangIcon('settingsIcon');
  await press(ecp.Key.Ok);
  await waitFor('#versionLabel.text', (t) => typeof t === 'string' && /^v/.test(t), {
    label: 'settings version label',
    timeout: 20000,
  });
  await sleep(1000); // let the settings menu + panels paint before capture
}

/**
 * home -> overhang search icon -> SearchResults -> type RTA_CONFIG.searchQuery.
 * The screen opens with the keyboard (#searchKey) focused + active (main.bs), so an
 * ECP text input both fills the visible search box AND triggers the search (the
 * keyboard's text change fans out to SearchTask). The grouped result rows render
 * into #searchSelect; its child count is the load gate. The query is tuned in config
 * to surface the richest spread of result-type rows on the demo server.
 */
export async function navSearch() {
  await focusOverhangIcon('searchIcon');
  await press(ecp.Key.Ok);
  await sleep(1500); // let SearchResults push + the keyboard take focus
  await ecp.sendText(RTA_CONFIG.searchQuery); // types into the focused search box
  await waitFor('#searchSelect.content.getChildCount()', hasChildren, {
    label: `search results for "${RTA_CONFIG.searchQuery}"`,
    timeout: 20000,
  });
  // Walk focus ALL THE WAY off the keyboard onto the result rows (#searchSelect):
  // this highlights the first result AND clears the voice-search / "scan QR to use
  // your phone keyboard" overlays, which appear intermittently while the search text
  // box is focused. The keyboard is a 6-column grid, so Right steps through its keys
  // then crosses to the results; the guard stops the instant focus reaches them (so
  // it lands on the first tile without over-scrolling the row).
  await waitFocused((f) => f?.node?.id === 'searchSelect', {
    timeout: 12000,
    interval: 350,
    action: async () => {
      const f = await odc.getFocusedNode({ includeNode: true }).catch(() => null);
      if (f?.node?.id !== 'searchSelect') await press(ecp.Key.Right);
    },
    label: 'search results (off keyboard)',
  });
  await sleep(1500); // let the focus settle + result posters paint before capture
}

const HOME_TILE_WAIT_MS = 15000;
const HOME_TILE_POLL_MS = 300;
const DETAIL_ROW_WAIT_MS = 15000;
const DETAIL_ROW_POLL_MS = 300;

/**
 * Locate a library tile on the Home screen. The Home layout is server-side
 * user-configurable (the "My Media" row's position AND its tile order can be
 * changed from any Jellyfin web client), so we resolve the tile by CONTENT,
 * never by a fixed index: find the row whose sectionId is "library", then match
 * a tile within it. Returns { row, col }.
 *
 * **Pass `libraryId` whenever you have one.** Matching on `collectionType` alone
 * is ambiguous the moment a server has more than one library of a type — and the
 * seeding side (`libraryIdFor`, which reads `/UserViews`) orders them differently
 * than Home does, so seed and nav silently disagree about WHICH library they mean.
 * That produced a valid-looking but wrong perf measurement (a 12-genre library
 * sampled where an 8-genre one was seeded). Verified on device: a Home tile's
 * `.id` IS the Jellyfin library GUID — 14/14 tiles matched `/UserViews` on a
 * 14-library server, four of them `movies`.
 *
 * The collectionType path stays as a fallback for callers with no id to hand
 * (`demos/`) and is exactly correct on a one-library-per-type server — but it
 * now THROWS when several libraries match, rather than silently picking the
 * first. That guard is self-limiting: it can only fire where the ambiguity is
 * real, so the demo server never trips it.
 *
 * **Polls rather than scanning once, because Home renders before its data arrives.**
 * `waitHome()` gates on `#homeRows.content.getChildCount() > 0`, and
 * `HomeRows.createSkeletonRows()` appends the `sectionId="library"` row — carrying a
 * single bare `ContentNode` placeholder — BEFORE the real tiles load. A placeholder
 * has no `.id` and no `.collectionType`, so a single scan landing in that window
 * matches nothing and throws `tile id="..." not found` on a Home that is perfectly
 * healthy a second later. Observed on device (Stick `3600X`, cold launch polled from
 * t=0): the gate passed at +3795 ms with 4 skeleton rows, the library row held 1
 * placeholder and 0 ids until +5141 ms — a **~1.35 s** window, twice reproduced. The
 * normal flow usually clears it because `hardRelaunch()` sleeps `bootMs` first, which
 * is why this surfaces as a rare flake rather than a constant failure: it only bites
 * when Home's data is slower than that fixed sleep.
 */
/**
 * One pass over Home's library row. Returns `{ tile }` on an id hit, otherwise the
 * `collectionType` matches collected so far. Never throws — the caller decides when
 * an empty result is "not there yet" versus "not there".
 *
 * `rows` retains the shape this pass actually saw (section ids and tile counts).
 * It is read from values the scan already fetched, so it adds no device calls —
 * and it is what turns a `tile not found` into "Home held 4 rows, the library row
 * had 1 tile", which is the difference between a skeleton-window race and a Home
 * that never populated.
 */
async function scanHomeLibraryTiles(collectionType, libraryId) {
  const rowCount = (await getVal('#homeRows.content.getChildCount()')) || 0;
  // Collected rather than returned on first hit, so the no-id path can tell
  // "one match" from "several" — see the ambiguity guard below.
  const matches = [];
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const sectionId = await getVal(`#homeRows.content.${r}.sectionId`);
    if (sectionId !== 'library') {
      rows.push(`${r}:${sectionId ?? '?'}`);
      continue;
    }
    const tiles = (await getVal(`#homeRows.content.${r}.getChildCount()`)) || 0;
    rows.push(`${r}:library(${tiles})`);
    for (let c = 0; c < tiles; c++) {
      if (libraryId) {
        if ((await getVal(`#homeRows.content.${r}.${c}.id`)) === libraryId)
          return { tile: { row: r, col: c }, matches, rows };
        continue;
      }
      const ct = await getVal(`#homeRows.content.${r}.${c}.collectionType`);
      if (ct === collectionType) matches.push({ row: r, col: c });
    }
  }
  return { tile: null, matches, rows };
}

async function findHomeLibraryTile(collectionType, libraryId = null) {
  const start = Date.now();
  let matches;
  let rows;
  for (;;) {
    const scan = await scanHomeLibraryTiles(collectionType, libraryId);
    if (scan.tile) return scan.tile;
    matches = scan.matches;
    rows = scan.rows;
    // One match is the answer; several is a real ambiguity that more waiting cannot
    // resolve (placeholders carry no collectionType, so a match means a real tile).
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) break;
    if (Date.now() - start >= HOME_TILE_WAIT_MS) break;
    await sleep(HOME_TILE_POLL_MS);
  }

  const waited = `after ${Math.round((Date.now() - start) / 1000)}s`;
  // `rows` is the LAST pass's view of Home, so the dump says what the scan gave up
  // against rather than only what it wanted.
  const diag = {
    kind: FAILURE_KINDS.HOME_LIBRARY_TILE_NOT_FOUND,
    label: `home library tile (${collectionType})`,
    waitedMs: Date.now() - start,
    observed: { collectionType, libraryId, rows },
  };
  if (libraryId) {
    throw await diagnosedError(
      `home library tile id="${libraryId}" (collectionType="${collectionType}") not found ${waited}`,
      diag,
    );
  }
  if (matches.length === 0) {
    throw await diagnosedError(
      `home library tile collectionType="${collectionType}" not found ${waited}`,
      diag,
    );
  }

  // AMBIGUOUS — refuse rather than silently pick the first tile. The seeding side
  // resolves via /UserViews order and this resolves via Home tile order, so "the
  // first one" means DIFFERENT libraries on each side. A caller that omits
  // libraryId has not chosen the first match, it has forgotten to pass one; a
  // comment saying so was not enough, hence a throw. Self-limiting: it can only
  // fire where the ambiguity is real, so a one-library-per-type server (the demo
  // server, `demos/`) never trips it.
  const named = [];
  for (const m of matches) {
    const id = await getVal(`#homeRows.content.${m.row}.${m.col}.id`);
    const title = await getVal(`#homeRows.content.${m.row}.${m.col}.title`);
    named.push(`${title} (${id})`);
  }
  // Not a timeout: a fail-fast that already names its own cause and lists the
  // ambiguous libraries. More waiting cannot resolve it, and a device-state dump
  // would add nothing to the diagnosis.
  // eslint-disable-next-line no-restricted-syntax -- fail-fast, cause already named
  throw new Error(
    `home library tile collectionType="${collectionType}" is AMBIGUOUS — ` +
      `${matches.length} libraries match: ${named.join(', ')}. ` +
      'Pass a libraryId (libraryIdFor(ctx.libraries, collectionType)) so the nav ' +
      'targets the same library the seed did.',
  );
}

/**
 * home -> focus the library tile of `collectionType` -> OK -> its library grid.
 * Drives the HomeRows RowList focus to the resolved [row, col] by reading
 * `rowItemFocused` and stepping Down/Up then Right/Left (guarded so it can't
 * overshoot), independent of how the demo account has arranged its Home screen.
 */
export async function navLibraryByType(collectionType, libraryId = null) {
  await openLibraryByType(collectionType, libraryId);
  await waitGridLoaded(`${collectionType} grid`);
  await sleep(1200); // let posters paint before capture
}

/**
 * The press-into-the-library half of navLibraryByType, WITHOUT the loaded wait.
 * Exists for specs that must interact with a view's intermediate stages (the Genres
 * skeleton window) — everything else should use navLibraryByType, which settles.
 */
export async function openLibraryByType(collectionType, libraryId = null) {
  await waitHome();
  const { row, col } = await findHomeLibraryTile(collectionType, libraryId);
  // Focus must be INSIDE the row list before walking it. `rowItemFocused` RETAINS its
  // last value when the RowList doesn't hold focus, so a walk started while focus is
  // still elsewhere reads a stale [0,0] forever, sends its presses to whatever does
  // hold focus, and then times out blaming the tile — which is what
  // `home library tile col N (...) (last=[0,0])` actually means. No action here on
  // purpose: focus lands in the rows on its own once Home is up, and pressing keys at
  // a component we have not located yet is how the OSD navs got this wrong.
  await waitFocusInside('#homeRows');
  // Vertical: step to the library row.
  await waitFor('#homeRows.rowItemFocused', (v) => Array.isArray(v) && v[0] === row, {
    timeout: 12000,
    interval: 350,
    action: async () => {
      const v = await getVal('#homeRows.rowItemFocused');
      if (!Array.isArray(v)) return;
      if (v[0] < row) await press(ecp.Key.Down);
      else if (v[0] > row) await press(ecp.Key.Up);
    },
    label: `home library row ${row} (${collectionType})`,
  });
  // Horizontal: step to the target tile within that row.
  await waitFor('#homeRows.rowItemFocused', (v) => Array.isArray(v) && v[1] === col, {
    timeout: 12000,
    interval: 350,
    action: async () => {
      const v = await getVal('#homeRows.rowItemFocused');
      if (!Array.isArray(v)) return;
      if (v[1] < col) await press(ecp.Key.Right);
      else if (v[1] > col) await press(ecp.Key.Left);
    },
    label: `home library tile col ${col} (${collectionType})`,
  });
  await press(ecp.Key.Ok);
}

/**
 * A library grid is "loaded" once BaseGridView says so: its `loadState` interface
 * field reaches "loaded" (usable content on screen) or "empty" (zero ITEMS). Accepting
 * the empty-state lets the same nav capture empty views instead of timing out on them.
 *
 * "empty" is two different screens, because both branches measure it in items:
 *  - grid path — the "No Items" message, a real capture-worthy screen (e.g. the
 *    Networks view on a server whose shows have no network);
 *  - genre RowList path — titled rows are drawn but every one is childless (all the
 *    per-genre sample fetches failed), so `emptyText` stays hidden and the screen
 *    reads as broken. Tracked as an open followup in `docs/progress.md`.
 * `assertGenreRowsOwnTheirItems` (screens.js) is what catches the second case for
 * `moviesLibraryGenres`; this wait deliberately does not, so a genre capture without
 * that assertion will pass through it.
 *
 * ONE atomic read of the app's own state, deliberately NOT inferred from content
 * internals: the previous shape (child counts + sniffing row 0's first cell type)
 * raced its two reads, re-declared the skeleton sentinel across the JS/BS boundary,
 * and assumed "row 0 filled" implies "all rows filled" — which the decision record
 * `genre-skeletons-batched-not-per-row` explicitly reserves the right to break
 * (per-row fill tripwire). The Genres view's intermediate "skeleton" stage never
 * satisfies this wait, so the genre-row assertion and the store screenshots (which
 * share this nav) only ever see real rows.
 *
 * Scoped to the active routed view (getActiveVal): `loadState` recurs on every
 * BaseGridView, and a suspended view can still be in the scene tree (see getActiveVal).
 */
async function waitGridLoaded(label, timeout = 20000) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeout) {
    last = await getActiveVal('loadState');
    if (last === 'loaded' || last === 'empty') return;
    await sleep(500);
  }
  throw await diagnosedError(
    `nav timed out waiting for ${label} (last loadState=${JSON.stringify(last)})`,
    {
      kind: FAILURE_KINDS.GRID_LOAD_TIMEOUT,
      label,
      waitedMs: Date.now() - start,
      observed: { lastLoadState: last },
    },
  );
}

/** home -> Movies library grid (hardened against Home-layout changes). */
export async function navLibraryGrid(ctx) {
  await navLibraryByType('movies', libraryIdFor(ctx?.libraries, 'movies'));
}

/** TV / Shows library grid. */
export async function navTvLibrary(ctx) {
  await navLibraryByType('tvshows', libraryIdFor(ctx?.libraries, 'tvshows'));
}

/** Music library grid (default view). */
export async function navMusicLibrary(ctx) {
  await navLibraryByType('music', libraryIdFor(ctx?.libraries, 'music'));
}

/** Playlists library grid. */
export async function navPlaylistsLibrary(ctx) {
  await navLibraryByType('playlists', libraryIdFor(ctx?.libraries, 'playlists'));
}

/**
 * Open the first tile of the currently-loaded grid and wait for its detail
 * screen. The grid focuses tile 0 on load, so a single OK opens a representative
 * item of that library's type (`#videoTitle` is the shared detail title node for
 * every item type). Used by the per-type detail screens that just need ONE example.
 */
async function openFirstGridTileDetail(label) {
  await press(ecp.Key.Ok);
  await waitFor('#videoTitle.text', (t) => typeof t === 'string' && t.length > 0, {
    label: `${label} detail title`,
    timeout: 20000,
  });
  await sleep(1500); // let backdrop + logo paint
}

/** Shows library -> first tile -> Series detail. */
export async function navSeriesDetails(ctx) {
  await navTvLibrary(ctx);
  await openFirstGridTileDetail('series');
}

/**
 * Music library -> first tile -> its detail. WHICH detail (MusicAlbum vs
 * MusicArtist) is decided by the seeded landing view: an Albums-view first tile
 * opens a MusicAlbum; an Artists/AlbumArtists-view first tile opens a MusicArtist.
 * Both share this nav; the screen entry's `view` selects the type.
 */
export async function navMusicDetail(ctx) {
  await navMusicLibrary(ctx);
  await openFirstGridTileDetail('music');
}

/** Playlists library -> first tile -> Playlist detail. */
export async function navPlaylistDetails(ctx) {
  await navPlaylistsLibrary(ctx);
  await openFirstGridTileDetail('playlist');
}

/**
 * Movies grid -> open the grid OPTIONS dialog (View / Sort / Filter). The `*`
 * button (ECP "Info" -> BrightScript "options") toggles the `#options`
 * ItemGridOptions overlay; we wait on its `visible` field.
 */
export async function navLibraryOptions(ctx) {
  await navLibraryGrid(ctx);
  await press(ecp.Key.Option); // '*' opens the grid options dialog
  // The dialog is shown AND focused on open, so assert focus ENTERS it rather than
  // reading `#options.visible`: a suspended Home stays in the tree (default "hide" mode)
  // whose own `#options` (an OptionsSlider, hidden) would win a recursive id lookup and
  // read visible=false. Focus is unambiguous (one focused node), so it's the robust
  // signal that the active grid's options dialog opened.
  await waitFocused((f) => typeof f.keyPath === 'string' && f.keyPath.includes('#options'), {
    label: 'grid options dialog',
    timeout: 8000,
  });
  await sleep(800); // let the dialog's menus paint
}

/**
 * From an ItemDetails screen, open the first tile of the detail row whose tiles are
 * of `tileType` (e.g. "Person" for Cast & Crew, "Season", "Episode", "Audio") ->
 * that child's ItemDetails.
 *
 * The detail rows (`#extrasGrid`) are NOT in a fixed order (Movie's first row is
 * often "Chapters") and can change, so — like the Home "My Media" row — we resolve
 * the target row by CONTENT (tile type), never by index. Moving between rows runs a
 * panel-slide animation; an OK pressed mid-animation is swallowed, so we settle
 * after each Down. Loaded gate: focus landing on the child detail's button row.
 * (`#videoTitle` is NOT used — with the parent ItemDetails still in the scene tree,
 * the recursive lookup can resolve to the PARENT's title; selecting a child instead
 * moves focus from the parent's `#extrasGrid` into the child's `#buttons`, which is
 * unambiguous.) Assumes the rows panel is already focusable (call straight after a
 * nav* that lands on the parent detail's buttons).
 */
async function openChildDetailByRowType(tileType) {
  await press(ecp.Key.Down); // buttons -> rows panel (lands on the first row)
  // Scope `#extrasGrid` reads to the active routed view: every ItemDetails has an
  // `#extrasGrid`, so a recursive scene-root lookup can read a suspended view's grid
  // instead of the active one's. getActiveVal anchors to m.global.activeRoutedView, which
  // is right whatever suspendMode the route carries (see steps.js).
  await waitFor('#extrasGrid.content.getChildCount()', hasChildren, {
    label: 'detail rows',
    timeout: 20000,
    read: getActiveVal,
  });
  // Poll for the row rather than scanning once, for the same reason `findHomeLibraryTile`
  // does: `ExtrasRowList.populateRow` APPENDS rows as its async load chain progresses, so
  // the count gate above can pass on the first row while the requested type has not landed
  // yet. A single pass then throws about a screen that is fine a moment later. (Seen once
  // during this work: `detail row with tile type "Season" not found` on a run whose other
  // 35 screens passed.) The old fixed `sleep(1200)` was papering over exactly this — a
  // bounded poll replaces it, and returns as soon as the row exists rather than always
  // paying the full delay.
  const rowsStart = Date.now();
  let targetRow = -1;
  let rowCount;
  // The types the LAST pass saw, retained from reads the loop already makes. This
  // is the #789 data point made structural: "2 row(s) present" said the rows had
  // not all landed but never which ones had, so "Season is late" and "Season is
  // absent" were indistinguishable after the fact.
  let seenTypes;
  for (;;) {
    rowCount = (await getActiveVal('#extrasGrid.content.getChildCount()')) || 0;
    seenTypes = [];
    for (let r = 0; r < rowCount; r++) {
      const type = await getActiveVal(`#extrasGrid.content.${r}.0.type`);
      seenTypes.push(type ?? '?');
      if (type === tileType) {
        targetRow = r;
        break;
      }
    }
    if (targetRow >= 0) break;
    if (Date.now() - rowsStart >= DETAIL_ROW_WAIT_MS) break;
    await sleep(DETAIL_ROW_POLL_MS);
  }
  if (targetRow < 0) {
    throw await diagnosedError(
      `detail row with tile type "${tileType}" not found after ` +
        `${Math.round((Date.now() - rowsStart) / 1000)}s (${rowCount} row(s) present)`,
      {
        kind: FAILURE_KINDS.DETAIL_ROW_NOT_FOUND,
        label: `detail row "${tileType}"`,
        waitedMs: Date.now() - rowsStart,
        observed: { wanted: tileType, rowTypes: seenTypes },
      },
    );
  }
  // Same precondition as the Home walk: `rowItemFocused` retains its last value when
  // the grid is unfocused, so confirm the Down press above actually landed focus in
  // the rows panel before stepping through it.
  await waitFocusInside('#extrasGrid');
  // Walk down to the target row; confirm focus moved, then let the slide animation
  // settle so the OK isn't swallowed.
  for (let r = 0; r < targetRow; r++) {
    await press(ecp.Key.Down);
    await waitFor('#extrasGrid.rowItemFocused', (v) => Array.isArray(v) && v[0] === r + 1, {
      timeout: 8000,
      interval: 300,
      label: `detail row ${r + 1}`,
      read: getActiveVal,
    });
    await sleep(1500); // panel slide animation
  }
  await press(ecp.Key.Ok); // Select the first tile -> child ItemDetails
  // Focus moves from the parent's #extrasGrid into the CHILD detail's #buttons.
  await waitFocused((f) => typeof f.keyPath === 'string' && f.keyPath.includes('#buttons'), {
    label: `${tileType} detail buttons`,
    timeout: 20000,
  });
  await sleep(1500); // let the child detail's backdrop + content paint
}

/** Movie detail -> Cast & Crew extras row -> first person -> Person detail. */
export async function navPersonDetails(ctx) {
  await navMovieDetails(ctx);
  await openChildDetailByRowType('Person');
}

/** Series detail -> Seasons row -> first season -> Season detail. */
export async function navSeasonDetails(ctx) {
  await navSeriesDetails(ctx);
  await openChildDetailByRowType('Season');
}

/** Series -> Season -> Episodes row -> first episode -> Episode detail. */
export async function navEpisodeDetails(ctx) {
  await navSeasonDetails(ctx);
  await openChildDetailByRowType('Episode');
}

/** MusicAlbum detail -> Songs row -> first song -> Audio detail. */
export async function navAudioDetails(ctx) {
  await navMusicDetail(ctx);
  await openChildDetailByRowType('Audio');
}

/**
 * Establish that focus is inside the loaded grid, then walk it rightward to tile
 * `target`. The walk is skipped for tile 0 (the grid focuses it on load); the focus
 * gate is NOT — every caller presses OK next, and "grid loaded" is not "grid focused",
 * so an OK sent before focus arrives goes to whatever does hold it. That gate used to
 * sit under the `target <= 0` return, which left exactly the tile-0 callers ungated.
 *
 * Extracted from `navMovieDetails` rather than copied for `navHomeReturn` below,
 * which walks the same grid to a different tile on every iteration: this file's own
 * rule is to put the retry in the SHARED helper so every caller inherits it, and a
 * second copy of a walk whose entire purpose is the stale-read guard is exactly the
 * drift that rule exists to prevent.
 */
async function focusGridTile(target) {
  // Grid LOADED is not grid FOCUSED, and `itemFocused` retains its last value while
  // the grid is unfocused — so without this the walk can read a stale 0 forever and
  // press Right at whatever actually holds focus. Same precondition as the Home walk.
  await waitFocusInside('#itemGrid');
  if (target <= 0) return;
  // Press Right until the grid reports the target tile focused (robust to a
  // dropped keypress — only presses while focus is still short of the target).
  await waitFor('#itemGrid.itemFocused', (v) => v === target, {
    timeout: 15000,
    interval: 500,
    action: async () => {
      const cur = await getVal('#itemGrid.itemFocused');
      if (typeof cur === 'number' && cur < target) await press(ecp.Key.Right);
    },
    label: `grid focus -> tile ${target}`,
  });
}

/** grid -> focus the hero tile (Right x heroIndex) -> OK -> ItemDetails. */
export async function navMovieDetails(ctx) {
  await navLibraryGrid(ctx);
  await focusGridTile(ctx?.heroIndex || 0);
  await press(ecp.Key.Ok);
  await waitFor('#videoTitle.text', (t) => typeof t === 'string' && t.length > 0, {
    label: 'details title',
    timeout: 20000,
  });
  await sleep(1500); // let backdrop + logo paint
}

/**
 * Home -> Movies grid -> open and back out of `detailCount` DISTINCT item details
 * -> back to Home. The measurement nav for the sgRouter retained-view investigation,
 * now also the walk `leaks.spec.js` gates on.
 *
 * ## What `detailCount` is for
 *
 * It is the INDEPENDENT VARIABLE, and the whole reason this nav exists. It sets how many
 * screens the walk opens and closes: `1 + detailCount`, one BaseGridView plus one
 * ItemDetails per distinct item. Under the `keepAlive` routes this nav was written to
 * measure, every one of those stayed retained for the session (the store is keyed by
 * `route.path` and `sgrouter_collectDetachedViewsToDestroy` skipped keepAlive views);
 * since ADR 0029 they are destroyed on pop, and the spec asserts exactly that.
 *
 * Comparing Home's RETURN load across two values of `detailCount` is what separates
 * retained views from Home's own `onScreenShown` -> `refresh()`, which re-runs the
 * latest-rows load on every non-first show. `refresh()` fires identically at every
 * `detailCount`, so any delta that TRACKS `detailCount` is the retained views and
 * nothing else. A before/after pair of arms cannot make that split, because both
 * arms carry `refresh()`.
 *
 * Read the `home-latest-rows` sample at `indexInLaunch: 1` — index 0 is the cold
 * first paint on the way out, index 1 is this nav's return.
 *
 * ## Why the tiles are walked FORWARD and never reopened
 *
 * The store is keyed by path, so reopening the same item RESUMES the cached view
 * instead of adding a second one. Reopening tile 0 `detailCount` times would leave
 * exactly one retained ItemDetails and the variable would not move at all.
 *
 * ## What this nav does NOT assert
 *
 * `waitHome()` gates on `#homeRows` having children, which is already true the
 * instant we come back — Home was suspended with its content intact, so that gate
 * cannot see the refresh, and it is a liveness check here rather than the "loaded"
 * assertion it is on a cold start. Nothing is added to make it one: `measure.js`
 * holds its watch window open until the console goes quiet after a complete sample,
 * so the refresh is bounded by the measurement rather than by this nav, and a settle
 * `sleep` here would only eat that window's budget.
 */
async function navHomeReturn(ctx, detailCount = 0) {
  await navLibraryGrid(ctx);

  if (detailCount > 0) {
    // Scoped to the ACTIVE routed view: `#itemGrid` recurs on every BaseGridView, and
    // this investigation is precisely about suspended views outliving their screen.
    const tiles = await getActiveVal('#itemGrid.content.getChildCount()');
    if (typeof tiles !== 'number' || tiles < detailCount) {
      // Not a timeout: a fail-fast that already names its own cause. More waiting will
      // not add tiles to the library, and a clamp here would silently measure a smaller
      // retained-view count than the name of the screen claims — which is the one
      // failure this experiment cannot afford, since the count IS the variable.
      // eslint-disable-next-line no-restricted-syntax -- fail-fast, cause already named
      throw new Error(
        `navHomeReturn needs ${detailCount} movie tiles to open distinct details, ` +
          `but the grid reports ${JSON.stringify(tiles)}. The demo library is too small ` +
          'for this measurement; lower detailCount or point at a fuller library.',
      );
    }
  }

  for (let i = 0; i < detailCount; i++) {
    await focusGridTile(i);
    // GUARDED press, not a bare one. `focusGridTile` ends on a focus gate, and focus is a
    // PROXY for "the router is idle": sgrouter_showView's finally restores focus BEFORE it
    // dispatches NavigationEnd, so an OK sent the instant the grid regains focus can land
    // mid-navigation, be rejected, and simply vanish — after which this wait times out with
    // `#videoTitle` never resolving (`last=undefined`). Observed on detail 1, 2026-08-15.
    //
    // Re-pressing only while the GRID still holds focus is what makes the retry safe: once
    // the detail opens, focus has left #itemGrid, so this cannot double-press into it.
    // Same mechanism and same idiom as the second back press in focus.spec.js.
    await press(ecp.Key.Ok);
    await waitFor('#videoTitle.text', (t) => typeof t === 'string' && t.length > 0, {
      label: `homeReturn detail ${i} title`,
      timeout: 20000,
      interval: 500,
      action: resendIfSwallowed(ecp.Key.Ok, '#itemGrid'),
    });
    await press(ecp.Key.Back);
    // Back on the grid. `loadState` is already "loaded" (the grid was suspended, not
    // destroyed) so it cannot gate this — focus returning INTO the grid is the state
    // that makes the next walk's `itemFocused` read meaningful.
    await waitFocusInside('#itemGrid');
  }

  await press(ecp.Key.Back);
  await waitHome();
}

/**
 * home -> Movies grid -> back to home. One screen opened and closed.
 * (Under the pre-ADR-0029 `keepAlive` routes this left 1 retained view; it now leaves none,
 * which is what `leaks.spec.js` asserts. The count is the measurement variable either way.)
 */
export async function navHomeReturnBare(ctx) {
  await navHomeReturn(ctx, 0);
}

/** home -> Movies grid -> 6 distinct details -> back to home. Seven screens opened and closed. */
export async function navHomeReturnAfterDetails(ctx) {
  await navHomeReturn(ctx, 6);
}

/**
 * home -> search -> type the configured query -> back to home. The search half of the
 * retained-view gate.
 *
 * Search is here because its teardown is the most consequential of the three routed screens
 * and, until ADR 0029, the least exercised: `/search` was `keepAlive`, so a popped
 * `SearchResults` was suspended rather than closed and `onDestroy` never ran in production —
 * including the part that releases the firmware's global voice route (only one node may hold
 * `voiceEnabled` at a time, so a leaked claim would deny it to the next screen that wants it).
 * `navSearch` already gates on rendered result rows, so the only thing added here is the exit.
 */
export async function navSearchReturn() {
  await navSearch();
  await press(ecp.Key.Back);
  await waitHome();
}

/** details -> OK on default Play/Resume button -> playback begins. */
export async function startPlayback(ctx) {
  await navMovieDetails(ctx);
  // The title label renders before the button row is interactive; wait until
  // focus actually lands inside the details button group (Play or Resume,
  // depending on watch state) before pressing OK, else the press lands too
  // early and playback never starts.
  await waitFocused((f) => typeof f.keyPath === 'string' && f.keyPath.includes('#buttons'), {
    label: 'details play/resume button',
  });
  await press(ecp.Key.Ok);
}

/**
 * Read a field on the player node. The player's `id` IS the item id (that is how
 * `navOsd` addresses its `seek`), so read it by id rather than via `focusedNode`:
 * focus is not guaranteed to be on the player at any given tick, and a focus-based
 * read silently returns another node's field (or `state="none"`) when it isn't.
 */
const readPlayer = (itemId) => async (keyPath) =>
  (
    await odc
      .getValue(
        itemId
          ? { base: 'scene', keyPath: `#${itemId}.${keyPath}` }
          : { base: 'focusedNode', keyPath },
      )
      .catch(() => ({}))
  ).value;

/**
 * Wait for the OSD to come up after playback starts.
 *
 * Found when `osd` + `trickplay` failed on a Roku Stick `3600X` (720p UI) while the
 * same build passed on a Roku Ultra. The app was never at fault — its `onKeyEvent`
 * behaved correctly on both:
 *
 * 1. **Don't send input while the player is still loading.** The app deliberately
 *    swallows Up until the video is playable (`stateAllowsOSD` excludes
 *    `buffering`), so the old loop spent that whole window pressing a player that
 *    is designed not to answer. Measured, the window is ~5-7 s on BOTH devices
 *    (stick 5.6/5.8 s, Ultra 7.2 s) — it is bound by stream start against a remote
 *    server, NOT by device speed, so this was never a slow-device-only hazard; the
 *    stick is just where it surfaced.
 * 2. **Don't keep pressing into an OSD that is already up.** Up only OPENS the
 *    OSD (it is not a toggle), and once open the key goes to the OSD itself,
 *    where it moves focus between controls — so a stray press perturbs the state
 *    the following steps assert on. Read first, press only while it is down —
 *    the same guard the focus-walk navs above use.
 * (A dropped key press masquerading as "the screen never loaded" was the third
 * hazard here; that one is fixed for every nav in `waitFor`/`waitFocused`, which
 * now count failing actions and name them in the timeout message.)
 */
async function waitOsdUp(label, ctx) {
  await waitFor('state', (v) => v === 'playing' || v === 'paused', {
    timeout: 90000,
    interval: 1000,
    label: 'player playable (pre-OSD)',
    read: readPlayer(ctx?.heroId),
  });
  await sleep(1500); // let the just-started player settle before sending any input

  await waitFor('#osd.visible', (v) => v === true, {
    timeout: 30000,
    interval: 2000,
    action: async () => {
      if ((await getVal('#osd.visible')) !== true) await press(ecp.Key.Up);
    },
    label,
  });
}

/**
 * Playback -> paused OSD overlay at the exact target position. OSD only appears
 * once the player reaches a playable state (`stateAllowsOSD`), so we retry Up
 * until it shows, then Play to PAUSE + re-show it (matches the reference's
 * play-button state and freezes the position so it never auto-hides), then seek
 * to the exact target. The store orchestrator injects the in-film backdrop after
 * this returns.
 */
export async function navOsd(ctx) {
  await startPlayback(ctx);
  // Confirm the player reached a playable state (OSD only shows when it has).
  await waitOsdUp('osd visible', ctx);
  // Hide the OSD (focus -> player), then Play to PAUSE + re-show the OSD.
  await press(ecp.Key.Back);
  await waitFor('#osd.visible', (v) => v === false, { timeout: 8000, label: 'osd hidden' });
  await press(ecp.Key.Play); // pause + show OSD
  await waitFor('#osd.visible', (v) => v === true, {
    timeout: 15000,
    interval: 500,
    label: 'osd visible (paused)',
  });
  // Seek the player (found by its id == the item id) to the exact target while
  // paused, so the OSD shows that exact timestamp with no playback drift.
  if (ctx?.heroId) {
    await odc
      .setValue({ base: 'scene', keyPath: `#${ctx.heroId}.seek`, value: ctx.seekSeconds })
      .catch(() => {});
  }
  await sleep(2500); // let the (paused) seek settle + frame render
}

/**
 * Playback -> trickplay seek strip on the target. The scrubber + position/remaining
 * times are Roku's built-in trickPlayBar (shown during a scrub), NOT the JellyRock
 * OSD — so we HIDE the OSD (Back) so the player, not the OSD, receives Right; seek
 * one trickplay interval (10s) before the target; then Right scrubs forward one
 * thumbnail onto the target, revealing the carousel + trickPlayBar. No in-film
 * backdrop is injected for this shot (it would render OVER Roku's built-in bar),
 * so the video plane reads black — the bar + filmstrip are what the shot shows.
 */
export async function navTrickplay(ctx) {
  await startPlayback(ctx);
  await waitOsdUp('playback ready (osd)', ctx);
  await press(ecp.Key.Back); // hide OSD so the player (not the OSD) receives Right
  await waitFor('#osd.visible', (v) => v === false, { timeout: 8000, label: 'osd hidden' });
  await odc
    .setValue({ base: 'focusedNode', keyPath: 'seek', value: ctx.seekSeconds - 10 })
    .catch(() => {});
  await sleep(3000); // let the seek settle
  await press(ecp.Key.Right); // scrub +10s -> target; reveals the carousel + trickPlayBar
  await waitFor('#trickplayCarousel.isVisible', (v) => v === true, {
    timeout: 15000,
    interval: 500,
    label: 'trickplay visible',
  });
  await sleep(2000); // let the filmstrip thumbnails load while the trickPlayBar is still up
}

/**
 * THE SCREEN REGISTRY — single source of truth for both the functional tests
 * (tests/rta/specs) and the store screenshot orchestrator
 * (scripts/capture-screenshots.js).
 *
 * Each screen declares:
 *  - state: 'home' (logged in) | 'userSelect' (signed out, server known) — the
 *           seed-to-land state reached by registry seed + relaunch.
 *  - nav:   optional async (ctx) => {} driving keypresses from the landed state.
 *           Its internal waitFor gates ARE the "loaded" assertion.
 *  - assert: optional async (ctx) => {} for seed-to-land screens with no nav,
 *           or to add explicit checks. Throwing = failure (don't wrap in expect).
 *  - capture: screenshot metadata, consumed ONLY by the store orchestrator /
 *           the RTA_CAPTURE flag:
 *      - eligible: include in screenshot capture (website gallery + RTA_CAPTURE).
 *      - store: ALSO part of the curated Roku-store / homepage set. The Roku store
 *           caps a listing at 6 screenshots, so this set is frozen at exactly those
 *           6 — `screenshots-store.js` bundles only these, and the website homepage
 *           renders them (in registry order) while the gallery page renders every
 *           `eligible` screen. New screens are `eligible` (gallery) but NOT `store`.
 *      - backdrop: inject the in-film frame behind the OSD (store only)
 *      - scope: 'shared' => language-agnostic; captured once, copied to all locales
 */
import { waitFor, waitHome, hasChildren, getActiveVal, getActiveVals } from './lib/steps.js';
import { diagnosedError, FAILURE_KINDS } from './lib/diagnostics.js';
import { genreItemNames, libraryIdFor } from './lib/jellyfin.js';
import {
  navLibraryGrid,
  navMovieDetails,
  navOsd,
  navTrickplay,
  navSettings,
  navTvLibrary,
  navMusicLibrary,
  navPlaylistsLibrary,
  navSeriesDetails,
  navMusicDetail,
  navPlaylistDetails,
  navLibraryOptions,
  navPersonDetails,
  navSeasonDetails,
  navEpisodeDetails,
  navAudioDetails,
  navSearch,
} from './lib/nav.js';

/** User-select screen is ready once the user row has rendered its users. */
async function assertUserSelect() {
  await waitFor('#userRow.content.getChildCount()', hasChildren, {
    label: 'user-select user row',
    timeout: 20000,
  });
}

/** Server-select screen is ready once the server picker has rendered its servers. */
async function assertServerSelect() {
  await waitFor('#serverPicker.content.getChildCount()', hasChildren, {
    label: 'server-select server picker',
    timeout: 20000,
  });
}

/**
 * Assert every genre row holds ITS OWN genre's items.
 *
 * `LoadItemsTask2` builds a Genres view in two passes: the row and its title come
 * from the library query, in the server's sort order, while the sampled items come
 * from a pipelined per-genre fetch that completes OUT of order and is written back
 * by slot index. Cross those indices and one genre's items land on another genre's
 * row — with nothing visibly wrong: every row is still present, still titled, still
 * in order. Only the pairing is broken, so only the pairing can catch it.
 *
 * Subset, not set-equality: the app samples at most 6 items with `SortBy=Random`, so
 * a large genre legitimately shows a random handful, and an item filed under two
 * genres legitimately appears under both. What must never happen is a row showing an
 * item the server does not file under that row's genre.
 *
 * Throws when it verified nothing, so a fixture that stops producing genre rows (or
 * a keyPath that silently reads `undefined`) fails loudly rather than passing empty.
 *
 * Reads via `getActiveVal`, not `getVal`: `BaseGridView` is registered keepAlive
 * (`/library/:id` in JRScene.bs), so a recursive scene-root `#genreList` lookup can
 * resolve to a SUSPENDED grid the moment anything navigates twice. Today's spec
 * relaunches before every screen so only one exists — a property of the harness, not
 * of the app. Anchoring to the active routed view also fails the right way: an
 * unresolvable node reads `undefined` and trips the guard below, where the scene-root
 * form would quietly assert against the wrong screen.
 */
async function assertGenreRowsOwnTheirItems(ctx) {
  const rowCount = await getActiveVal('#genreList.content.getChildCount()');
  if (typeof rowCount !== 'number' || rowCount < 1) {
    throw await diagnosedError(
      `genre rows: expected at least one row, read ${JSON.stringify(rowCount)}`,
      { kind: FAILURE_KINDS.GENRE_ROWS_NOT_READY, observed: { rowCount } },
    );
  }

  const libraryId = libraryIdFor(ctx.libraries, 'movies');
  const byGenre = await genreItemNames(ctx.session, libraryId, 'Movie');

  // TWO batches for the whole view, not two reads per row plus one per item.
  //
  // This used to issue one `getActiveVal` per field — 1 + rowCount×(title + count) +
  // one per item, which is 57 sequential round trips against the demo server's 14
  // genres and 28 filed items, and scales up with a richer library. Measured, that is
  // 303 ms of reads against 58 ms batched: NOT a meaningful saving inside a ~20 s
  // test, and the before/after runs showed no wall-clock change. What it buys is the
  // window — 57 looks at a still-settling screen spread over 303 ms, versus one look
  // over 58. Batch 1 takes the whole row structure in a single message; batch 2 takes
  // every item title across every row, and cannot merge into batch 1 because it needs
  // the child counts batch 1 returns.
  //
  // Reading every row's children and filtering afterwards — rather than skipping
  // unknown genres before the read, as the sequential form did — is more VALUES for
  // strictly fewer round trips, and it is what leaves the whole view in memory for
  // the failure record below.
  const rows = [...Array(rowCount).keys()];
  const structure = await getActiveVals(
    rows.flatMap((row) => [
      `#genreList.content.${row}.title`,
      `#genreList.content.${row}.getChildCount()`,
    ]),
  );
  const titles = rows.map((row) => structure[row * 2]);
  const counts = rows.map((row) => structure[row * 2 + 1]);

  const missingTitle = rows.find((row) => typeof titles[row] !== 'string' || !titles[row]);
  if (missingTitle !== undefined) {
    throw await diagnosedError(
      `genre row ${missingTitle} has no title (read ${JSON.stringify(titles[missingTitle])})`,
      {
        kind: FAILURE_KINDS.GENRE_ROWS_NOT_READY,
        // The whole view, not just the offending row — "row 7 is untitled" and "rows
        // 7-13 are all untitled" are different failures and the fix differs.
        observed: { rowCount, titles, counts },
      },
    );
  }

  // Address every item of every row in one batch, keeping a parallel map back to
  // (row, index) so a mismatch can still name where it was seen.
  const cells = rows.flatMap((row) =>
    [...Array(typeof counts[row] === 'number' ? counts[row] : 0).keys()].map((i) => ({ row, i })),
  );
  const cellTitles = await getActiveVals(
    cells.map(({ row, i }) => `#genreList.content.${row}.${i}.title`),
  );

  let verified = 0;
  for (const [cell, title] of cells.map((c, n) => [c, cellTitles[n]])) {
    const genre = titles[cell.row];
    // A genre the server no longer lists is fixture drift, not a regression.
    const expected = byGenre.get(genre);
    if (!expected) continue;
    if (typeof title !== 'string' || !title) continue;
    if (expected.has(title)) {
      verified++;
      continue;
    }
    // The optional leading child is a "View All <genre>" affordance, not an item.
    if (title.endsWith(genre)) continue;
    // Deliberately a plain throw: this is a fail-fast that already names its own
    // cause — the two-pass write-back crossed its slot indices — rather than a
    // timeout reporting that something did not show up. Same carve-out as the
    // ambiguous-library refusal in `lib/nav.js`.
    // eslint-disable-next-line no-restricted-syntax
    throw new Error(
      `genre row "${genre}" contains "${title}", which the server does not file under it — ` +
        "the two-pass write-back has put another genre's items on this row",
    );
  }

  if (!verified) {
    throw await diagnosedError(
      `genre rows: ${rowCount} row(s) read but not one item was checked against the server`,
      {
        kind: FAILURE_KINDS.GENRE_ROWS_UNVERIFIED,
        // Everything needed to tell the two live causes apart WITHOUT a re-run: rows
        // present but empty (`counts` all zero — the items never landed) versus rows
        // full of titles the server does not know (`serverGenres` disagreeing with
        // `titles` — fixture drift). The batches already read all of it, so this
        // costs nothing. Note what `verified === 0` no longer means: a swallowed
        // query. `genreItemNames` throws now, so an empty map cannot reach here.
        observed: {
          rowCount,
          titles,
          counts,
          serverGenres: [...byGenre.keys()],
          serverItemCounts: [...byGenre.values()].map((s) => s.size),
          sampleCellTitles: cellTitles.slice(0, 12),
        },
      },
    );
  }
  return verified;
}

/**
 * Build a view-seeded, home-state, website-gallery screen entry. `collectionType`
 * + `landing` are seeded as the library's deterministic landing view before launch
 * (see seedLibraryLanding); the library id is resolved at runtime, never hardcoded.
 * `assert` adds an explicit post-nav check on top of the nav's own load gate.
 */
const vw = (name, nav, collectionType, landing, assert) => ({
  name,
  state: 'home',
  nav,
  view: { collectionType, landing },
  capture: { eligible: true },
  ...(assert ? { assert } : {}),
});

export const SCREENS = [
  {
    name: 'userSelect',
    state: 'userSelect',
    assert: assertUserSelect,
    capture: { eligible: true, store: true },
  },
  { name: 'home', state: 'home', assert: waitHome, capture: { eligible: true, store: true } },
  {
    name: 'libraryGrid',
    state: 'home',
    nav: navLibraryGrid,
    capture: { eligible: true, store: true },
  },
  {
    name: 'movieDetails',
    state: 'home',
    nav: navMovieDetails,
    capture: { eligible: true, store: true },
  },
  {
    name: 'osd',
    state: 'home',
    nav: navOsd,
    capture: { eligible: true, store: true, backdrop: true },
  },
  {
    name: 'trickplay',
    state: 'home',
    nav: navTrickplay,
    // No backdrop injection: Roku's built-in trickPlayBar (the scrubber + position/
    // remaining times) renders BEHIND the Video node's children, so an injected
    // in-film frame would cover it. We accept the un-capturable video plane reading
    // black (realistic for an immediate scrub) and keep the REAL scrubber + times +
    // filmstrip. Movie + scrub position come from RTA_CONFIG (trickplayMovie /
    // trickplaySeekSeconds) so the bar's film + time match the reference.
    capture: { eligible: true, store: true, scope: 'shared' },
  },
  // --- Website-gallery screens (NOT in the frozen Roku-store 6) ----------------
  {
    name: 'serverSelect',
    state: 'serverSelect',
    assert: assertServerSelect,
    capture: { eligible: true },
  },
  { name: 'settings', state: 'home', nav: navSettings, capture: { eligible: true } },
  { name: 'search', state: 'home', nav: navSearch, capture: { eligible: true } },

  // --- Library grids: one screen per VIEW per library type --------------------
  // The landing view is seeded deterministically (display.<id>.landing) so the
  // capture never depends on whatever view is stickily persisted on the device.
  // `view.collectionType` is stable; the library id is resolved at runtime.
  // (Movies "Presentation" view == the store `libraryGrid`, so it isn't duplicated.)
  vw('moviesLibraryGrid', navLibraryGrid, 'movies', 'MoviesGrid'),
  vw('moviesLibraryStudios', navLibraryGrid, 'movies', 'Studios'),
  vw('moviesLibraryGenres', navLibraryGrid, 'movies', 'Genres', assertGenreRowsOwnTheirItems),
  vw('tvLibraryShows', navTvLibrary, 'tvshows', 'Shows'),
  // Networks view is empty on the demo (its single series has no network), but the
  // empty-state ("No Items") is itself a valid, capture-worthy screen.
  vw('tvLibraryNetworks', navTvLibrary, 'tvshows', 'Networks'),
  vw('tvLibraryGenres', navTvLibrary, 'tvshows', 'Genres'),
  vw('musicLibraryAlbumArtists', navMusicLibrary, 'music', 'AlbumArtistsGrid'),
  vw('musicLibraryAlbums', navMusicLibrary, 'music', 'Albums'),
  vw('musicLibraryArtists', navMusicLibrary, 'music', 'ArtistsGrid'),
  vw('musicLibraryGenres', navMusicLibrary, 'music', 'Genres'),
  vw('playlistsLibrary', navPlaylistsLibrary, 'playlists', 'default'),

  // --- Per-item-type detail screens (Movie detail is `movieDetails`, above) ----
  // Each opens the first tile of its (view-seeded) library as a representative.
  vw('seriesDetails', navSeriesDetails, 'tvshows', 'Shows'),
  vw('seasonDetails', navSeasonDetails, 'tvshows', 'Shows'),
  vw('episodeDetails', navEpisodeDetails, 'tvshows', 'Shows'),
  vw('musicAlbumDetails', navMusicDetail, 'music', 'Albums'),
  vw('musicArtistDetails', navMusicDetail, 'music', 'ArtistsGrid'),
  vw('audioDetails', navAudioDetails, 'music', 'Albums'),
  vw('playlistDetails', navPlaylistDetails, 'playlists', 'default'),
  // Person detail (movie -> Cast & Crew extras row -> first person) + the grid
  // options dialog (View / Sort / Filter). Both chain through the movie/grid navs.
  { name: 'personDetails', state: 'home', nav: navPersonDetails, capture: { eligible: true } },
  { name: 'libraryOptions', state: 'home', nav: navLibraryOptions, capture: { eligible: true } },
];

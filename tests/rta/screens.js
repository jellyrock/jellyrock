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
import { waitFor, waitHome, hasChildren } from './lib/steps.js';
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
 * Build a view-seeded, home-state, website-gallery screen entry. `collectionType`
 * + `landing` are seeded as the library's deterministic landing view before launch
 * (see seedLibraryLanding); the library id is resolved at runtime, never hardcoded.
 */
const vw = (name, nav, collectionType, landing) => ({
  name,
  state: 'home',
  nav,
  view: { collectionType, landing },
  capture: { eligible: true },
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

  // --- Library grids: one screen per VIEW per library type --------------------
  // The landing view is seeded deterministically (display.<id>.landing) so the
  // capture never depends on whatever view is stickily persisted on the device.
  // `view.collectionType` is stable; the library id is resolved at runtime.
  // (Movies "Presentation" view == the store `libraryGrid`, so it isn't duplicated.)
  vw('moviesLibraryGrid', navLibraryGrid, 'movies', 'MoviesGrid'),
  vw('moviesLibraryStudios', navLibraryGrid, 'movies', 'Studios'),
  vw('moviesLibraryGenres', navLibraryGrid, 'movies', 'Genres'),
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
  vw('musicAlbumDetails', navMusicDetail, 'music', 'Albums'),
  vw('musicArtistDetails', navMusicDetail, 'music', 'ArtistsGrid'),
  vw('playlistDetails', navPlaylistDetails, 'playlists', 'default'),
  // Grid options dialog (View / Sort / Filter). Chains through the movie grid nav.
  // NOTE: personDetails (movie -> Cast & Crew row -> Person) is built in nav.js
  // (navPersonDetails) but deferred — the demo server's Person detail hangs on a
  // perpetual loading spinner, so it can't be captured reliably yet.
  { name: 'libraryOptions', state: 'home', nav: navLibraryOptions, capture: { eligible: true } },
];

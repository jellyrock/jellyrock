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
 *      - eligible: include in screenshot capture
 *      - backdrop: inject the in-film frame behind the OSD (store only)
 *      - scope: 'shared' => language-agnostic; captured once, copied to all locales
 */
import { waitFor, waitHome, hasChildren } from './lib/steps.js';
import { navLibraryGrid, navMovieDetails, navOsd, navTrickplay } from './lib/nav.js';

/** User-select screen is ready once the user row has rendered its users. */
async function assertUserSelect() {
  await waitFor('#userRow.content.getChildCount()', hasChildren, {
    label: 'user-select user row',
    timeout: 20000,
  });
}

export const SCREENS = [
  {
    name: 'userSelect',
    state: 'userSelect',
    assert: assertUserSelect,
    capture: { eligible: true },
  },
  { name: 'home', state: 'home', assert: waitHome, capture: { eligible: true } },
  { name: 'libraryGrid', state: 'home', nav: navLibraryGrid, capture: { eligible: true } },
  { name: 'movieDetails', state: 'home', nav: navMovieDetails, capture: { eligible: true } },
  { name: 'osd', state: 'home', nav: navOsd, capture: { eligible: true, backdrop: true } },
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
    capture: { eligible: true, scope: 'shared' },
  },
];

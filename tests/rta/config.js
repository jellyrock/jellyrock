/**
 * Shared RTA configuration — consumed by both the functional tests
 * (tests/rta/specs) and the store-screenshot orchestrator
 * (scripts/capture-screenshots.js). Change a value once here and both paths pick
 * it up. The screenshot-only `outDir` lives in capture-screenshots.js.
 */
export const RTA_CONFIG = {
  // Demo Jellyfin server the screens are driven against. License-clear content
  // only (the screenshots ship in a public store listing). Easy to repoint.
  server: {
    url: 'https://demo.jellyfin.org/stable',
    username: 'demo',
    password: '',
  },
  // The movie used for movieDetails + osd. Reached in the Movies grid by its
  // SortName tile index, looked up at runtime (see findMovie), so this name is
  // the only knob to change.
  heroMovie: 'Dracula',
  // Playback position (seconds) for the osd paused frame — 28:44.
  seekSeconds: 1724,
  // trickplay uses its OWN film + position so the store frame matches the
  // long-standing reference screenshot. Change movie/timestamp here.
  trickplayMovie: 'The Boy in the Plastic Bubble',
  trickplaySeekSeconds: 1940, // 32:20
  // Time to let the app boot + the RTA on-device component come up after a
  // relaunch or a fresh deploy.
  bootMs: 10000,
  // Canonical locale set (folder name == the exact translationLocale value).
  // Functional tests exercise the first entry (en_US); the store orchestrator
  // captures the full matrix.
  languages: ['en_US', 'fr', 'de', 'pt', 'es'],
};

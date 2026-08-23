/**
 * Shared RTA configuration — consumed by both the functional tests
 * (tests/rta/specs) and the store-screenshot orchestrator
 * (scripts/capture-screenshots.js). Change a value once here and both paths pick
 * it up. The screenshot-only `outDir` lives in capture-screenshots.js.
 *
 * `import 'dotenv/config'` here rather than relying on an importer: this module
 * reads the environment at evaluation time, and several entry points import it
 * (rta-restore.js, capture-screenshots.js, measure.js) without loading .env
 * first. Loading it here makes the overrides work regardless of import order.
 */
import 'dotenv/config';

/**
 * The public Jellyfin demo, pinned and NEVER overridable.
 *
 * Separate from `RTA_CONFIG.server` on purpose. The video-capture demos
 * (`tests/rta/demos/run.mjs`) refuse to run against anything that is not this
 * host — that privacy guard is what stops a marketing recording from touching
 * someone's real library, and an env var that could move it would remove the
 * guarantee it exists to make.
 */
export const PUBLIC_DEMO_SERVER = Object.freeze({
  url: 'https://demo.jellyfin.org/stable',
  username: 'demo',
  password: '',
});

/**
 * The Jellyfin server the FUNCTIONAL tests drive against.
 *
 * Defaults to the public demo, and can be repointed with
 * `RTA_SERVER_URL` / `RTA_SERVER_USER` / `RTA_SERVER_PASS` in `.env`
 * (see `.env.example`). The public demo is shared infrastructure that resets
 * hourly and will not be here forever; when JellyRock stands up its own demo
 * server, that is a one-line `.env` change rather than a code edit — and in the
 * meantime a contributor can point the suite at a local server without dirtying
 * a tracked file.
 *
 * Content-dependent expectations (`heroMovie`, `trickplayMovie`, `searchQuery`)
 * are NOT derived from this and still describe the public demo's library, so a
 * repointed server needs those retuned too. The suite tells you which ones by
 * failing on the fixture, not silently.
 */
const server = Object.freeze({
  // `RTA_SERVER_*` rather than a second scheme of this branch's own: main shipped
  // these names independently while this branch was in flight, and two competing
  // override schemes for one value is worse than either. What this branch keeps is
  // the part main's version lacks — the dotenv import above (so the variables work
  // regardless of which entry point imports this first), `.env.example` documenting
  // them, and `PUBLIC_DEMO_SERVER` below keeping the demos pinned.
  //
  // `??` throughout, not `||`: an empty password is the demo's REAL password, so it
  // has to survive as an override rather than falling back.
  url: process.env.RTA_SERVER_URL ?? PUBLIC_DEMO_SERVER.url,
  username: process.env.RTA_SERVER_USER ?? PUBLIC_DEMO_SERVER.username,
  password: process.env.RTA_SERVER_PASS ?? PUBLIC_DEMO_SERVER.password,
});

export const RTA_CONFIG = {
  // Jellyfin server the screens are driven against. License-clear content only
  // (the screenshots ship in a public store listing). Repoint via `.env` — see
  // `server` above, which reads the same `RTA_SERVER_*` variables main introduced.
  //
  // The demo server is a CONTROL, not a substitute: ~3 libraries against a real
  // server's ~10, so anything that scales with library count reads LOW on it.
  server,
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
  // The search-screen query, typed into the search keyboard to populate results.
  // Chosen to surface the RICHEST spread of result-type rows on the demo server —
  // "a" returns 7 grouped rows (Movies / Episodes / People / Playlists / Artists /
  // Albums / Songs); see the probe in #621. Change to retune the shot.
  searchQuery: 'a',
  // Time to let the app boot + the RTA on-device component come up after a
  // relaunch or a fresh deploy.
  bootMs: 10000,
  // Time to let the channel fully EXIT after a Home keypress, before relaunching.
  // Only `hardRelaunch` uses this — the restore path needs a genuine cold start
  // so the app re-reads the registry instead of re-persisting its live session.
  exitMs: 4000,
  // Full capture matrix — folder name == the exact translationLocale value.
  // Functional tests exercise the first entry (en_US); the store orchestrator
  // captures every entry. (Planned to grow to ALL locale files to map the
  // default-font blast radius — see the docs/progress.md followup.)
  languages: ['en_US', 'fr', 'de', 'pt', 'es'],
  // The curated subset that actually ships in the Roku store listing — the ONE
  // hand-maintained "what's in the store" list (a subset of `languages`). Adding
  // a store language = add it here. `npm run screenshots:store` bundles just
  // these locales into out/store/<lang>/ for Developer Portal upload, so you
  // never hunt through the full capture set.
  storeLanguages: ['en_US', 'fr', 'de', 'pt', 'es'],
};

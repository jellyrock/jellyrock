/**
 * Shared RTA configuration — consumed by both the functional tests
 * (tests/rta/specs) and the store-screenshot orchestrator
 * (scripts/capture-screenshots.js). Change a value once here and both paths pick
 * it up. The screenshot-only `outDir` lives in capture-screenshots.js.
 *
 * The environment is loaded here rather than relying on an importer: this module
 * reads it at evaluation time, and several entry points import it (rta-restore.js,
 * capture-screenshots.js, measure.js) without loading it first. Loading it here
 * makes the overrides work regardless of import order. `load-env.cjs` reads the
 * checkout's `.env` and the per-user env file (see `scripts/lib/env-config.cjs`).
 */
import '../../scripts/lib/load-env.cjs';

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
/**
 * `undefined` for "not overridden", so a `??` chain does the falling back. Trims the
 * value it returns, not just the emptiness test: dotenv strips whitespace around an
 * unquoted value but preserves it inside a quoted one, so `KEY="  x  "` would
 * otherwise reach a consumer with its padding attached.
 *
 * Shared by `resolveServer` and `resolveContent` rather than duplicated — both face
 * the same `.env.example`-copied-verbatim hazard described above.
 */
const override = (value) => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

/**
 * Same rule for a NUMERIC knob: a seek position is meaningless unless it parses to a
 * finite, non-negative number, so anything else reads as unset rather than reaching
 * the player as `NaN`. `Number('')` is 0, which is a legitimate seek target and
 * therefore exactly the value a typo must not be able to produce silently — hence
 * `override` first, then a finiteness check.
 */
const overrideNumber = (value) => {
  const raw = override(value);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

/**
 * Resolve the functional-test server from an environment.
 *
 * `RTA_SERVER_*` rather than a second scheme of this repo's own: those names
 * arrived on `main` independently while this work was in flight, and two competing
 * override schemes for one value is worse than either. What this side adds is the
 * part `main`'s version lacked — the env import above (so the variables work
 * regardless of which entry point imports this first), `.env.example` documenting
 * them, and `PUBLIC_DEMO_SERVER` keeping the video demos pinned.
 *
 * EMPTY IS NOT AN OVERRIDE for the url or the username. `.env.example` ships
 * these keys, and a bare `RTA_SERVER_URL=` used to arrive as the empty STRING —
 * which `??` accepts, so a contributor who copied the example verbatim (the
 * documented onboarding step) got `url: ''` and a suite that drove nothing.
 * Neither field has a meaningful empty value, so empty reads as unset. The env
 * loader now skips empty values in files too, but an empty value can still come
 * from the shell, so this check stays. The VALUE
 * is trimmed as well as the test: dotenv strips whitespace around an unquoted
 * value but preserves it inside a quoted one, so `RTA_SERVER_URL="  http://x  "`
 * would otherwise reach the driver with its padding still attached.
 *
 * `password` deliberately keeps `??`: empty IS the public demo's real password,
 * so it has to survive as an override rather than falling back.
 *
 * Exported and parameterised so the resolution is unit-testable as a pure
 * function. Testing it through the module's own evaluation is not an option —
 * this file loads the environment on import, so such a test would read whatever
 * is in the developer's own env files and pass or fail per machine.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{url: string, username: string, password: string}} fallback
 */
export function resolveServer(env = process.env, fallback = PUBLIC_DEMO_SERVER) {
  return Object.freeze({
    url: override(env.RTA_SERVER_URL) ?? fallback.url,
    username: override(env.RTA_SERVER_USER) ?? fallback.username,
    // NOT `override`: empty is the public demo's real password, and surrounding
    // spaces can be part of a real one. This field takes the value verbatim.
    password: env.RTA_SERVER_PASS ?? fallback.password,
  });
}

/**
 * The public demo's content, and the fallback for every knob above. Frozen and
 * exported so a test can assert the fallback without restating the literals.
 */
export const DEMO_CONTENT = Object.freeze({
  // The movie used for movieDetails + osd. Reached in the Movies grid by its
  // SortName tile index, looked up at runtime (see findMovie).
  heroMovie: 'Dracula',
  // Playback position (seconds) for the osd paused frame — 28:44.
  seekSeconds: 1724,
  // trickplay uses its OWN film + position so the store frame matches the
  // long-standing reference screenshot.
  trickplayMovie: 'The Boy in the Plastic Bubble',
  trickplaySeekSeconds: 1940, // 32:20
  // The search-screen query, typed into the search keyboard to populate results.
  // Chosen to surface the RICHEST spread of result-type rows on the demo server —
  // "a" returns 7 grouped rows (Movies / Episodes / People / Playlists / Artists /
  // Albums / Songs); see the probe in #621.
  searchQuery: 'a',
});

/**
 * The CONTENT-dependent expectations, resolved from the environment the same way the
 * server is.
 *
 * ## Why these are overridable at all
 *
 * `server` was already repointable, but these were not — and they describe the PUBLIC
 * DEMO's library, not any library. So pointing the suite at a local server (the
 * documented way to test against a richer fixture) left `heroMovie` naming a film that
 * server does not have. Measured 2026-09-20 against the local 12.0 test server:
 * `Dracula` and `The Boy in the Plastic Bubble` both return ZERO matches.
 *
 * That did not go red. `findMovie` answers a miss with `{ index: 0, id: '' }`, so
 * `movieDetails` opens whatever sorts first, `navOsd`'s seek is skipped entirely (it is
 * guarded on `ctx.heroId`), and the suite reports a PASS for a screen it never drove to
 * the position it was asserting about. A hollow pass is worse than a red one: it is
 * indistinguishable from a real one in the record.
 *
 * Overriding these in `.env` alongside `RTA_SERVER_*` is what makes a local run mean
 * what it says. The visible skip in `screens.js` covers the other half — a configured
 * film that is not on the server now SAYS so instead of quietly testing a different one.
 *
 * Exported and parameterised for the same reason `resolveServer` is: this module loads
 * the environment on import, so testing it through the module's own evaluation would
 * read the running developer's env files and pass or fail per machine.
 *
 * @param {Record<string, string | undefined>} env
 */
export function resolveContent(env = process.env, fallback = DEMO_CONTENT) {
  return Object.freeze({
    heroMovie: override(env.RTA_HERO_MOVIE) ?? fallback.heroMovie,
    seekSeconds: overrideNumber(env.RTA_SEEK_SECONDS) ?? fallback.seekSeconds,
    trickplayMovie: override(env.RTA_TRICKPLAY_MOVIE) ?? fallback.trickplayMovie,
    trickplaySeekSeconds:
      overrideNumber(env.RTA_TRICKPLAY_SEEK_SECONDS) ?? fallback.trickplaySeekSeconds,
    searchQuery: override(env.RTA_SEARCH_QUERY) ?? fallback.searchQuery,
  });
}

const server = resolveServer();
const content = resolveContent();

export const RTA_CONFIG = {
  // Jellyfin server the screens are driven against. License-clear content only
  // (the screenshots ship in a public store listing). Repoint via `.env` — see
  // `server` above, which reads the same `RTA_SERVER_*` variables main introduced.
  //
  // The demo server is a CONTROL, not a substitute: ~3 libraries against a real
  // server's ~10, so anything that scales with library count reads LOW on it.
  server,
  // Content-dependent expectations. These describe the PUBLIC DEMO's library by
  // default and are overridable per-environment (`RTA_HERO_MOVIE`, `RTA_SEEK_SECONDS`,
  // `RTA_TRICKPLAY_MOVIE`, `RTA_TRICKPLAY_SEEK_SECONDS`, `RTA_SEARCH_QUERY`) so a run
  // repointed with `RTA_SERVER_*` can name films that server actually has. See
  // `resolveContent` for why a missing film used to pass rather than fail.
  ...content,
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

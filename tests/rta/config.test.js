/**
 * `resolveServer` — how `RTA_CONFIG.server` is derived from the environment.
 *
 * This exists because of a defect that shipped past every gate: `config.js` began
 * loading `.env` itself, `.env.example` shipped bare `RTA_SERVER_URL=` keys, and
 * the resolution used `??`. dotenv reads a bare key as the empty STRING, which
 * `??` accepts as an override — so a contributor who followed the documented
 * onboarding step (copy `.env.example` to `.env`) got `server.url === ''` and a
 * functional suite that drove nothing. Nothing asserted the resolution, so there
 * was nothing to go red.
 *
 * Tested through the exported pure function rather than the module's own
 * evaluation ON PURPOSE: `config.js` loads the environment on import, so a test
 * that re-imported the module would read whatever is in the running developer's env
 * files and pass or fail per machine. Passing `env` in keeps this deterministic.
 */
import { describe, expect, it } from 'vitest';
import { DEMO_CONTENT, PUBLIC_DEMO_SERVER, resolveContent, resolveServer } from './config.js';

describe('resolveServer', () => {
  it('falls back to the public demo when nothing is set', () => {
    expect(resolveServer({})).toEqual(PUBLIC_DEMO_SERVER);
  });

  // THE REGRESSION. A verbatim copy of `.env.example` produces exactly this.
  it('treats an empty url and username as unset, not as an override', () => {
    const resolved = resolveServer({ RTA_SERVER_URL: '', RTA_SERVER_USER: '' });
    expect(resolved.url).toBe(PUBLIC_DEMO_SERVER.url);
    expect(resolved.username).toBe(PUBLIC_DEMO_SERVER.username);
  });

  // Trailing whitespace in a `.env` line is invisible in a diff, so it must not
  // be the difference between a working suite and one pointed at nothing.
  it('treats a whitespace-only url as unset', () => {
    expect(resolveServer({ RTA_SERVER_URL: '   ' }).url).toBe(PUBLIC_DEMO_SERVER.url);
  });

  it('honours a real repoint', () => {
    const resolved = resolveServer({
      RTA_SERVER_URL: 'http://jellyfin.test:8096',
      RTA_SERVER_USER: 'charlie',
      RTA_SERVER_PASS: 'hunter2',
    });
    expect(resolved).toEqual({
      url: 'http://jellyfin.test:8096',
      username: 'charlie',
      password: 'hunter2',
    });
  });

  // The asymmetry that makes this more than a `||` sweep: an empty PASSWORD is a
  // real value — it is the public demo's actual password — so it has to survive
  // as an override while an empty url does not.
  it('keeps an explicitly empty password instead of falling back', () => {
    const resolved = resolveServer(
      { RTA_SERVER_URL: 'http://jellyfin.test:8096', RTA_SERVER_PASS: '' },
      { url: 'unused', username: 'unused', password: 'should-not-win' },
    );
    expect(resolved.password).toBe('');
  });

  it('falls back to the demo password when the key is absent entirely', () => {
    expect(resolveServer({}).password).toBe(PUBLIC_DEMO_SERVER.password);
  });

  // dotenv strips whitespace around an UNQUOTED value but preserves it inside a
  // QUOTED one, so `RTA_SERVER_URL="  http://x  "` is the shape that actually
  // arrives here still padded — and a padded url reaches the driver as a broken
  // one. Trimming the emptiness TEST without trimming the VALUE would leave that.
  it('trims a padded url and username rather than passing the padding through', () => {
    const resolved = resolveServer({
      RTA_SERVER_URL: '  http://jellyfin.test:8096  ',
      RTA_SERVER_USER: '  charlie  ',
    });
    expect(resolved.url).toBe('http://jellyfin.test:8096');
    expect(resolved.username).toBe('charlie');
  });

  // The other half of that asymmetry: surrounding spaces can be part of a real
  // password, so this field takes its value verbatim. Pinned so a later tidy-up
  // that "consistently" trims all three cannot quietly corrupt a credential.
  it('does NOT trim the password', () => {
    expect(resolveServer({ RTA_SERVER_PASS: '  s p a c e d  ' }).password).toBe('  s p a c e d  ');
  });

  // Callers hold this for a whole run (and `demos/run.mjs` compares against
  // PUBLIC_DEMO_SERVER for its privacy guard), so it must not be mutable.
  it('returns a frozen object', () => {
    expect(Object.isFrozen(resolveServer({}))).toBe(true);
  });
});

/**
 * `resolveContent` — the content-dependent knobs (`heroMovie`, the seek positions, the
 * search query) resolved from the environment.
 *
 * These were literals until 2026-09-20, which made a repointed suite quietly wrong: the
 * defaults name films in the PUBLIC DEMO's library, and `findMovie` answers a miss with
 * `{ index: 0, id: '' }` rather than throwing. Measured against the local 12.0 test
 * server, `Dracula` and `The Boy in the Plastic Bubble` both return ZERO matches and the
 * suite still went green — driving a different film and skipping the seek entirely.
 *
 * Same testing rationale as `resolveServer` above: through the exported pure function,
 * never the module's own evaluation, so the result cannot depend on the running
 * developer's env files.
 */
describe('resolveContent', () => {
  it('falls back to the public demo content when nothing is set', () => {
    expect(resolveContent({})).toEqual(DEMO_CONTENT);
  });

  it('honours a real retune of every knob', () => {
    expect(
      resolveContent({
        RTA_HERO_MOVIE: 'Sintel',
        RTA_SEEK_SECONDS: '300',
        RTA_TRICKPLAY_MOVIE: 'Big Buck Bunny',
        RTA_TRICKPLAY_SEEK_SECONDS: '120',
        RTA_SEARCH_QUERY: 'bun',
      }),
    ).toEqual({
      heroMovie: 'Sintel',
      seekSeconds: 300,
      trickplayMovie: 'Big Buck Bunny',
      trickplaySeekSeconds: 120,
      searchQuery: 'bun',
    });
  });

  // The `.env.example`-copied-verbatim hazard, one axis over from the server keys: a
  // bare `RTA_HERO_MOVIE=` arrives as the empty string, and no knob has a meaningful
  // empty value.
  it('treats empty and whitespace-only values as unset', () => {
    expect(
      resolveContent({
        RTA_HERO_MOVIE: '',
        RTA_TRICKPLAY_MOVIE: '   ',
        RTA_SEARCH_QUERY: '',
        RTA_SEEK_SECONDS: '',
      }),
    ).toEqual(DEMO_CONTENT);
  });

  it('trims a padded value rather than passing the padding through', () => {
    // dotenv preserves whitespace inside a QUOTED value, so this reaches us padded.
    expect(resolveContent({ RTA_HERO_MOVIE: '  Sintel  ' }).heroMovie).toBe('Sintel');
  });

  // A seek is fed to the player. `Number('abc')` is NaN and `Number('')` is 0 — and 0 is
  // a LEGITIMATE seek target, which is exactly why a typo must not be able to produce it
  // silently. Anything non-finite or negative reads as unset instead.
  it('rejects a non-numeric or negative seek instead of seeking to NaN', () => {
    expect(resolveContent({ RTA_SEEK_SECONDS: 'halfway' }).seekSeconds).toBe(
      DEMO_CONTENT.seekSeconds,
    );
    expect(resolveContent({ RTA_SEEK_SECONDS: '-5' }).seekSeconds).toBe(DEMO_CONTENT.seekSeconds);
    expect(resolveContent({ RTA_TRICKPLAY_SEEK_SECONDS: 'NaN' }).trickplaySeekSeconds).toBe(
      DEMO_CONTENT.trickplaySeekSeconds,
    );
  });

  // Zero IS a valid position (the very start of a film), so it must survive as an
  // override rather than being swallowed as falsy.
  it('keeps an explicit zero seek', () => {
    expect(resolveContent({ RTA_SEEK_SECONDS: '0' }).seekSeconds).toBe(0);
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(resolveContent({}))).toBe(true);
  });
});

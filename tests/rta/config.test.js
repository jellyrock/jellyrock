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
 * evaluation ON PURPOSE: `config.js` imports `dotenv/config`, so a test that
 * re-imported the module would read whatever is in the running developer's `.env`
 * and pass or fail per machine. Passing `env` in keeps this deterministic.
 */
import { describe, expect, it } from 'vitest';
import { PUBLIC_DEMO_SERVER, resolveServer } from './config.js';

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

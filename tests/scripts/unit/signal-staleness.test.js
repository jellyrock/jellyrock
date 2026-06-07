// Unit tests for scripts/lib/signal-staleness.cjs — the pure "does this signal
// row need attention?" decision used by the /catchup aggregator. The IO that
// feeds `ctx` (the live open-digest query) lives in catchup-state.js and is not
// exercised here; this covers the decision in isolation.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { signalStaleness, STABLE_SLUG } = require('../../../scripts/lib/signal-staleness.cjs');

describe('signalStaleness', () => {
  it('is never stale unless status is watching', () => {
    const row = {
      slug: 'roku-os',
      status: 'completed',
      latest_upstream: '15.2',
      latest_acknowledged: '15.1',
    };
    expect(signalStaleness(row)).toBe(false);
    expect(signalStaleness({ ...row, status: 'action_pending' })).toBe(false);
  });

  describe('jellyfin-server-stable — digest-driven', () => {
    const base = {
      slug: STABLE_SLUG,
      status: 'watching',
      latest_upstream: '10.11.11',
      latest_acknowledged: '10.11.8',
    };

    it('an open digest (object ctx) → stale, regardless of the version strings', () => {
      expect(signalStaleness(base, { stableDigest: { number: 632, triaging: false } })).toBe(true);
    });

    it('no open digest (null ctx) → NOT stale, even though upstream != acknowledged', () => {
      // This is the bug fix: a mechanically-clean release moved latest_upstream
      // but its digest auto-closed, so there is nothing to nag about.
      expect(signalStaleness(base, { stableDigest: null })).toBe(false);
    });

    it('offline (undefined ctx) → falls back to the string compare', () => {
      expect(signalStaleness(base, { stableDigest: undefined })).toBe(true);
      expect(signalStaleness({ ...base, latest_acknowledged: '10.11.11' }, {})).toBe(false);
    });
  });

  describe('other slugs — string compare regardless of ctx', () => {
    it('stale when upstream moved past acknowledged', () => {
      const row = {
        slug: 'jellyfin-server-rc',
        status: 'watching',
        latest_upstream: '10.12.0-rc2',
        latest_acknowledged: '10.12.0-rc1',
      };
      // ctx.stableDigest must be ignored for non-stable slugs.
      expect(signalStaleness(row, { stableDigest: null })).toBe(true);
    });

    it('not stale when equal, or when a field is missing/placeholder', () => {
      expect(
        signalStaleness({
          slug: 'roku-os',
          status: 'watching',
          latest_upstream: '15.2',
          latest_acknowledged: '15.2',
        }),
      ).toBe(false);
      expect(
        signalStaleness({
          slug: 'jellyfin-server-rc',
          status: 'watching',
          latest_upstream: '(no RC in flight)',
          latest_acknowledged: '(no RC in flight)',
        }),
      ).toBe(false);
      expect(signalStaleness({ slug: 'roku-os', status: 'watching' })).toBe(false);
    });
  });
});

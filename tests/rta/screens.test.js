/**
 * `firstUnmetRequirement` — how a screen's `requires` gates are resolved.
 *
 * This exists because the gate is honored by TWO consumers (the functional suite and the
 * store-screenshot orchestrator) and a screen gated in one but not the other is a silent
 * hole: the suite would skip while the orchestrator drove a nav whose button the fixture
 * never renders, burning a ~15-minute matrix run. Both now call this one resolver, so the
 * contract it implements is worth pinning rather than re-reading at each call site.
 *
 * The SHORT-CIRCUIT is the load-bearing part. `trickplay` carries two gates, and the
 * second (`TRICKPLAY_DATA`) issues a server request keyed on the item id the first
 * (`HERO_PRESENT`) exists to establish. Run out of order, or without stopping at the
 * first failure, it queries with an empty id — which answers "no trickplay" for a reason
 * that has nothing to do with trickplay.
 */
import { describe, expect, it, vi } from 'vitest';
import { firstUnmetRequirement } from './screens.js';

const met = (label) => ({ probe: vi.fn().mockResolvedValue(true), reason: `${label} unmet` });
const unmet = (label) => ({ probe: vi.fn().mockResolvedValue(false), reason: `${label} unmet` });

describe('firstUnmetRequirement', () => {
  it('returns null for a screen that declares no requirements', async () => {
    expect(await firstUnmetRequirement({ name: 'home' }, {})).toBeNull();
  });

  it('accepts a SINGLE gate object, not only a list', async () => {
    const gate = unmet('single');
    expect(await firstUnmetRequirement({ requires: gate }, {})).toBe(gate);
    expect(await firstUnmetRequirement({ requires: met('single') }, {})).toBeNull();
  });

  it('returns null when every gate in a list is met', async () => {
    expect(await firstUnmetRequirement({ requires: [met('a'), met('b')] }, {})).toBeNull();
  });

  // Returning the GATE rather than a boolean is what preserves each one's own `reason`.
  // "one of two preconditions failed" is not an actionable skip message.
  it('returns the FIRST unmet gate, so its own reason is the one reported', async () => {
    const second = unmet('second');
    const third = unmet('third');
    const found = await firstUnmetRequirement({ requires: [met('first'), second, third] }, {});
    expect(found).toBe(second);
    expect(found.reason).toBe('second unmet');
  });

  // THE REASON THIS IS TESTED. A later gate must not run once an earlier one has failed:
  // TRICKPLAY_DATA would query the server with an empty item id and report "no trickplay"
  // for a missing FILM.
  it('short-circuits — a gate after a failure never runs', async () => {
    const first = unmet('first');
    const second = met('second');
    await firstUnmetRequirement({ requires: [first, second] }, {});
    expect(first.probe).toHaveBeenCalledTimes(1);
    expect(second.probe).not.toHaveBeenCalled();
  });

  it('passes the nav ctx through to each probe', async () => {
    const gate = met('ctx');
    const ctx = { heroId: 'abc', session: { serverUrl: 'http://x' } };
    await firstUnmetRequirement({ requires: gate }, ctx);
    expect(gate.probe).toHaveBeenCalledWith(ctx);
  });

  // A probe may be a plain synchronous predicate (HERO_PRESENT is one — it only reads a
  // field), so the resolver must not require a promise.
  it('accepts a synchronous probe as well as an async one', async () => {
    const sync = { probe: (ctx) => Boolean(ctx.heroId), reason: 'no hero' };
    expect(await firstUnmetRequirement({ requires: sync }, { heroId: '' })).toBe(sync);
    expect(await firstUnmetRequirement({ requires: sync }, { heroId: 'x' })).toBeNull();
  });
});

/**
 * Structural invariants of the committed `settings/settings.json`.
 *
 * These are not tests of a script — they run against the shipped data file, the same shape
 * as `roku-hardware.test.js`'s invariant half. They exist because the declared-range
 * capability (`min` / `max`, enforced at SAVE in `components/settings/settings.bs`) is read
 * out of untyped JSON by BrightScript, where the failure mode for a malformed entry is a
 * RUNTIME CRASH on a user-facing screen rather than a build error.
 *
 * Measured on a Stick 4K, both against `settingRangeBounds` in `source/utils/config.bs`:
 *
 *   settingRangeBounds({ min: "1", max: "200" })  ->  Type Mismatch (crash)
 *   settingRangeBounds({ min: 1 })                ->  Type Mismatch (crash), before its guard
 *
 * `settingRangeBounds` now refuses both — a malformed entry degrades to "declares no range"
 * instead of taking the Settings screen down — but that is a floor, not enforcement: it
 * makes the bad entry SILENT (unbounded setting, no Range row in the generated docs, no
 * error anywhere). This file is what makes it loud, at PR time, on a gate that needs no
 * hardware. `npm run test:scripts` runs in CI on every push.
 *
 * The BrightScript side is covered separately in `tests/source/unit/utils/settingRange.spec.bs`,
 * which pins the runtime BEHAVIOR of those refusals on device. Two gates, two questions:
 * that file asks "does the app survive a bad entry", this one asks "is there a bad entry".
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SETTINGS = JSON.parse(readFileSync(join(ROOT, 'settings', 'settings.json'), 'utf8'));

/** Every node in the tree that names a setting, flattened, each tagged with its path. */
function collectSettings(nodes, trail = []) {
  const out = [];
  for (const node of nodes ?? []) {
    const here = [...trail, node.title ?? node.settingName ?? '(untitled)'];
    if (node.settingName) out.push({ node, path: here.join(' › ') });
    if (Array.isArray(node.children)) out.push(...collectSettings(node.children, here));
  }
  return out;
}

const ALL = collectSettings(SETTINGS);
const BOUNDED = ALL.filter(({ node }) => node.min !== undefined || node.max !== undefined);

describe('settings.json declared ranges', () => {
  it('finds settings to check at all', () => {
    // Guards the guard: a walk that silently returns nothing would make every `it.each`
    // below vacuously green, and this file's whole value is that it fails when it should.
    expect(ALL.length).toBeGreaterThan(0);
    expect(BOUNDED.length).toBeGreaterThan(0);
  });

  it.each(BOUNDED)('$path declares BOTH bounds', ({ node }) => {
    // `settingRangeBounds` refuses a half-declared range, so declaring one bound enforces
    // nothing and prints no Range row — the author's intent is dropped on the floor.
    expect(node.min, 'declares `max` but not `min`').toBeDefined();
    expect(node.max, 'declares `min` but not `max`').toBeDefined();
  });

  it.each(BOUNDED)('$path declares its bounds as NUMBERS, not strings', ({ node }) => {
    // The typo this exists for: `default` in the same entry is a string by convention
    // ("16"), so `"min": "1"` reads as consistent with its neighbor and is the one
    // spelling that used to crash the Settings screen.
    expect(typeof node.min, `min is ${typeof node.min}, expected number`).toBe('number');
    expect(typeof node.max, `max is ${typeof node.max}, expected number`).toBe('number');
  });

  it.each(BOUNDED)('$path declares min <= max', ({ node }) => {
    // Inverted bounds do not crash — they produce a clamp that returns a value OUTSIDE the
    // range it was asked to enforce (`clampToSettingRange` tests `< min` first), so the
    // confirm dialog offers to save an illegal number. Silent, and worse than a crash.
    expect(node.min).toBeLessThanOrEqual(node.max);
  });

  it.each(BOUNDED)('$path ships a default INSIDE its own range', ({ node }) => {
    // A default outside its declared range is unsavable from the UI: the user opens the
    // setting, submits the value already shown, and is asked to confirm a different one.
    expect(node.default, 'a bounded setting must ship a default').toBeDefined();
    const shipped = Number.parseInt(String(node.default), 10);
    expect(Number.isNaN(shipped), `default ${JSON.stringify(node.default)} is not a number`).toBe(
      false,
    );
    expect(shipped).toBeGreaterThanOrEqual(node.min);
    expect(shipped).toBeLessThanOrEqual(node.max);
  });

  it.each(BOUNDED)('$path declares its range on an `integer` setting', ({ node }) => {
    // The save-time check lives in `onKeyGridSubmit`, which is observed on the integer
    // keypad's `submit` field ONLY (`components/settings/settings.bs`). A range on a bool
    // or radio entry is inert — it would document a rule in the generated settings page
    // that nothing applies.
    expect(node.type).toBe('integer');
  });
});

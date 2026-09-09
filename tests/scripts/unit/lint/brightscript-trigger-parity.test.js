// Parity gate: CI's brightscript-lint job must trigger on everything that makes
// `.husky/pre-push` run `npm run validate`.
//
// WHY THIS EXISTS
// ---------------
// Both triggers are hand-maintained regexes in different files and different
// languages — a bash `grep -qE` in the hook, a `pattern:` input to the
// changed-paths action in the workflow. They have now drifted TWICE:
//
//   1. The workflow matched only `\.(brs|bs)$` while pre-push already covered
//      `.xml`. Several BSC plugins read a component's XML half, so an XML-only
//      edit could weaken a gate without ever re-running it.
//   2. Neither `bsconfig.json` nor `scripts/bsc-plugins/` was matched, so a PR
//      that removed a plugin from the plugin list — or edited a plugin into
//      producing false positives against the real tree — skipped the job that
//      would have caught it.
//
// `ci-parity-check.js` guards the layer above this (every `npm run lint` leaf has
// SOME CI home) but cannot see whether a job's path filter actually covers the
// inputs its checks read. This test does, for the one job where the divergence
// keeps happening.
//
// It samples representative paths rather than trying to prove one regex is a
// superset of another — that is not decidable in general, and the string surgery
// it would take on alternation branches would be more fragile than the drift it
// guards.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The regex pre-push uses to decide whether `npm run validate` runs. */
function prePushValidatePattern() {
  const hook = readFileSync(join(ROOT, '.husky/pre-push'), 'utf8');
  const match = hook.match(/HAS_VALIDATE_TRIGGERS=.*grep -qE '([^']+)'/);
  if (!match) throw new Error('Could not find HAS_VALIDATE_TRIGGERS in .husky/pre-push');
  return new RegExp(match[1]);
}

/** The `pattern:` the brightscript lint workflow hands to changed-paths. */
function ciPattern() {
  const wf = readFileSync(join(ROOT, '.github/workflows/_lint-brightscript.yml'), 'utf8');
  const match = wf.match(/^\s*pattern:\s*'([^']+)'/m);
  if (!match) throw new Error('Could not find pattern: in _lint-brightscript.yml');
  return new RegExp(match[1]);
}

// Paths that must run validate. Each names the reason it is here, so a future
// failure explains itself rather than looking like an arbitrary fixture.
const MUST_TRIGGER = [
  ['source/main.bs', 'BrightScript source'],
  ['components/ItemDetails.bs', 'component codebehind'],
  ['components/vendor/thing.brs', 'transpiled BrightScript'],
  ['components/ItemDetails.xml', 'component XML — half the input to three gates'],
  ['bsconfig.json', 'the plugin list itself: removing a gate here must re-run the gates'],
  ['bsconfig-tests-unit.json', 'a sibling bsconfig the hook also matches'],
  ['scripts/bsc-plugins/field-observer-wiring.cjs', 'a gate: editing it changes what CI enforces'],
  ['scripts/lib/bsc-rule.cjs', 'the diagnostic lifecycle all cross-file gates share'],
];

// Paths that legitimately skip the job — guards against "fix" it by matching
// everything, which would make the filter meaningless.
const MUST_NOT_TRIGGER = [
  'README.md',
  'docs/architecture/build-and-tooling.md',
  'locale/custom/en_US.json',
  'images/icons/play_fhd.png',
];

describe('brightscript lint job path filter', () => {
  const prePush = prePushValidatePattern();
  const ci = ciPattern();

  it.each(MUST_TRIGGER)('CI runs for %s (%s)', (path) => {
    expect(ci.test(path)).toBe(true);
  });

  it.each(MUST_NOT_TRIGGER)('CI skips %s', (path) => {
    expect(ci.test(path)).toBe(false);
  });

  // The actual parity claim: anything pre-push considers worth a local validate
  // must also be worth one in CI. CI may cover MORE (it also owns the ratchet and
  // the source-shape guards), never less.
  it('covers every path that makes pre-push run validate', () => {
    const missed = [...MUST_TRIGGER.map(([p]) => p), ...MUST_NOT_TRIGGER].filter(
      (path) => prePush.test(path) && !ci.test(path),
    );
    expect(missed).toEqual([]);
  });
});

// Parity gate: the language-coverage job and the pre-push step must both run
// when any file the script reads changes.
//
// WHY THIS EXISTS
// ---------------
// The script reads languages.bs, people.bs, en_US.json and the spec fingerprints.
// Both triggers are hand-written regexes, one in `.husky/pre-push` and one in the
// workflow. people.bs and the fingerprints were added to the script without
// widening either, so a change to only those files skipped the gate.
//
// The script's inputs now live in language-coverage-inputs.cjs. This test checks
// both triggers against that list, so a new input without a trigger fails here.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const inputs = createRequire(import.meta.url)(
  '../../../../scripts/lint/language-coverage-inputs.cjs',
);

/** The regex pre-push uses to decide whether the language-coverage check runs. */
function prePushPattern() {
  const hook = readFileSync(join(ROOT, '.husky/pre-push'), 'utf8');
  const match = hook.match(/HAS_LANGUAGE_TRIGGERS=.*grep -qE '([^']+)'/);
  if (!match) throw new Error('Could not find HAS_LANGUAGE_TRIGGERS in .husky/pre-push');
  return new RegExp(match[1]);
}

/** The `pattern:` the language-coverage workflow hands to changed-paths. */
function ciPattern() {
  const wf = readFileSync(join(ROOT, '.github/workflows/_lint-language-coverage.yml'), 'utf8');
  const match = wf.match(/^\s*pattern:\s*'([^']+)'/m);
  if (!match) throw new Error('Could not find pattern: in _lint-language-coverage.yml');
  return new RegExp(match[1]);
}

const MUST_TRIGGER = [
  [inputs.LANGS_BS, 'read by the script'],
  [inputs.PEOPLE_BS, 'read by the script'],
  [inputs.EN_US, 'read by the script'],
  [`${inputs.FINGERPRINT_DIR}/10.11.json`, 'a file inside the folder the script reads'],
  ['source/utils/mediaDisplayTitle.bs', 'a sibling source file the gate has always watched'],
  ['scripts/lint/language-coverage.cjs', 'the script itself'],
  ['scripts/lint/language-coverage-inputs.cjs', 'the list of inputs the script reads'],
];

const MUST_NOT_TRIGGER = ['README.md', 'components/ItemDetails.bs'];

describe.each([
  ['CI', ciPattern()],
  ['pre-push', prePushPattern()],
])('language-coverage %s trigger', (_name, pattern) => {
  it.each(MUST_TRIGGER)('runs for %s (%s)', (path) => {
    expect(pattern.test(path)).toBe(true);
  });

  it.each(MUST_NOT_TRIGGER)('skips %s', (path) => {
    expect(pattern.test(path)).toBe(false);
  });
});

// Gate: every CI job that runs on a machine declares `timeout-minutes`.
//
// Without it a job inherits GitHub's 6-hour default, so a wedged step holds the
// PR's checks for hours with nothing to stop it. It happened in run 31319845645
// (#791): `dev / build` hung on `npm ci` for about an hour until it was cancelled
// by hand, while the sibling `prod / build` in the same run finished in 41s.
//
// A job that calls a reusable workflow (`uses:`) is skipped: GitHub rejects
// `timeout-minutes` there, and the limit lives on the jobs inside the `_*.yml`
// it calls, which this scan covers like any other workflow.
//
// Hosted jobs use 15 minutes, well above the slowest one measured. The hardware
// jobs and `copilot-setup-steps` set their own value with a comment saying why.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');
const WORKFLOWS_DIR = join(REPO_ROOT, '.github', 'workflows');

/** Returns `<file> → <job>` for each machine job without a positive integer `timeout-minutes`. */
function jobsMissingTimeout(workflows) {
  const missing = [];
  for (const { name, text } of workflows) {
    const jobs = yaml.load(text)?.jobs ?? {};
    for (const [id, job] of Object.entries(jobs)) {
      if (job.uses) continue;
      const t = job['timeout-minutes'];
      if (!Number.isInteger(t) || t <= 0) missing.push(`${name} → ${id}`);
    }
  }
  return missing;
}

describe('jobsMissingTimeout', () => {
  it('flags a runner job without timeout-minutes and skips a reusable-workflow caller', () => {
    const text = `
jobs:
  bare:
    runs-on: ubuntu-latest
    steps: [{ run: echo }]
  capped:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps: [{ run: echo }]
  caller:
    uses: ./.github/workflows/_lint-fake.yml
`;
    expect(jobsMissingTimeout([{ name: 'fake.yml', text }])).toEqual(['fake.yml → bare']);
  });

  it('flags a non-numeric or zero value', () => {
    const text = `
jobs:
  expr:
    runs-on: ubuntu-latest
    timeout-minutes: \${{ inputs.t }}
  zero:
    runs-on: ubuntu-latest
    timeout-minutes: 0
`;
    expect(jobsMissingTimeout([{ name: 'fake.yml', text }])).toEqual([
      'fake.yml → expr',
      'fake.yml → zero',
    ]);
  });
});

describe('committed workflows', () => {
  it('every machine job declares timeout-minutes', () => {
    const workflows = readdirSync(WORKFLOWS_DIR)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((name) => ({ name, text: readFileSync(join(WORKFLOWS_DIR, name), 'utf8') }));
    expect(workflows.length).toBeGreaterThan(0);
    expect(jobsMissingTimeout(workflows)).toEqual([]);
  });
});

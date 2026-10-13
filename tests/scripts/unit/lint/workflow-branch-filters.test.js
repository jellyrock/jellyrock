// Gate: a workflow's literal branch filter must name the default branch.
//
// A filter such as `on.push.branches: [master]` on a repo whose default branch
// is `main` never matches, and GitHub gives no warning. `automations.yml` had
// exactly that: a merge to `main` never re-ran the merge-conflict labeling job
// across open PRs, and `gh run list --workflow automations.yml --event push`
// returned nothing.
//
// The scan reads `branches` under every event in `on`. It leaves out
// `branches-ignore`, because a stale name there ignores nothing and is harmless.
// A name with a glob character (`*`, `?`, `[`, `!`) is a pattern such as
// `release-*.*.*`, and the gate skips it. Every other name must be the default
// branch.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');
const WORKFLOWS_DIR = join(REPO_ROOT, '.github', 'workflows');

// Hard-coded because CI checkouts may not have origin/HEAD to read it from.
const DEFAULT_BRANCH = 'main';

const GLOB_CHARS = /[*?[!]/;

/** Returns `<file> → <event>: <name>` for each literal `branches` entry that is not the default branch. */
function wrongBranchFilters(workflows) {
  const wrong = [];
  for (const { name, text } of workflows) {
    const on = yaml.load(text)?.on ?? {};
    if (typeof on !== 'object') continue;
    for (const [event, config] of Object.entries(on)) {
      if (!config || typeof config !== 'object') continue;
      const names = [config.branches].flat().filter((n) => typeof n === 'string');
      for (const branch of names) {
        if (GLOB_CHARS.test(branch)) continue;
        if (branch !== DEFAULT_BRANCH) wrong.push(`${name} → ${event}: ${branch}`);
      }
    }
  }
  return wrong;
}

describe('wrongBranchFilters', () => {
  it('flags a literal branch that is not the default branch', () => {
    const text = `
on:
  push:
    branches:
      - master
  pull_request:
    branches: [main, develop]
`;
    expect(wrongBranchFilters([{ name: 'fake.yml', text }])).toEqual([
      'fake.yml → push: master',
      'fake.yml → pull_request: develop',
    ]);
  });

  it('does not flag branches-ignore', () => {
    const text = `
on:
  push:
    branches-ignore: [gh-pages]
`;
    expect(wrongBranchFilters([{ name: 'fake.yml', text }])).toEqual([]);
  });

  it('skips glob patterns, the default branch and events without a filter', () => {
    const text = `
on:
  push:
    branches: [main, 'release-*.*.*']
    tags: ['v*.*.*']
  workflow_dispatch:
  schedule:
    - cron: '0 0 * * *'
`;
    expect(wrongBranchFilters([{ name: 'fake.yml', text }])).toEqual([]);
  });

  it('handles a string or list form of on', () => {
    expect(wrongBranchFilters([{ name: 'a.yml', text: 'on: push\njobs: {}\n' }])).toEqual([]);
    expect(wrongBranchFilters([{ name: 'b.yml', text: 'on: [push, pull_request]\n' }])).toEqual([]);
  });
});

describe('committed workflows', () => {
  it('every literal branch filter names the default branch', () => {
    const workflows = readdirSync(WORKFLOWS_DIR)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((name) => ({ name, text: readFileSync(join(WORKFLOWS_DIR, name), 'utf8') }));
    expect(workflows.length).toBeGreaterThan(0);
    expect(wrongBranchFilters(workflows)).toEqual([]);
  });
});

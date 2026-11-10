// Gate: journal-sync.yml only runs for PRs merged into main.
//
// The job checks out and pushes main, so a PR merged into another branch (an
// integration branch) would add a Recently shipped line for code that is not
// on main. The `pull_request` trigger must filter `branches` to exactly main.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');
const WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'journal-sync.yml');

describe('journal-sync.yml trigger', () => {
  it('filters the pull_request trigger to the main branch only', () => {
    const doc = yaml.load(readFileSync(WORKFLOW, 'utf8'));
    expect(doc.on.pull_request.branches).toEqual(['main']);
  });
});

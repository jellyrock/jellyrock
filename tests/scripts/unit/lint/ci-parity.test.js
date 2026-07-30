// Tests for scripts/lint/ci-parity-check.js — the meta-gate asserting every
// check in the `npm run lint` aggregate is actually run by some CI workflow.
//
// Pure layer: hand-written package.json `scripts` maps + fake workflow texts.
// Plus a smoke pass over the REAL committed package.json + .github/workflows,
// so adding a check to the aggregate without wiring it into CI fails here.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, expandAggregate, LOCAL_ONLY } from '../../../../scripts/lint/ci-parity-check.js';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');

const wf = (text) => [{ name: '_lint-fake.yml', text }];

describe('expandAggregate', () => {
  it('resolves nested `npm run` chains down to leaf commands', () => {
    const scripts = {
      lint: 'npm run check-formatting && npm run lint:docs',
      'check-formatting': 'npm run check-formatting:bs && npm run check-formatting:js',
      'check-formatting:bs': 'npx bsfmt --check',
      'check-formatting:js': 'npx prettier --check .',
      'lint:docs': 'node scripts/lint/docs-check.cjs',
    };
    expect(
      expandAggregate(scripts)
        .map((l) => l.name)
        .sort(),
    ).toEqual(['check-formatting:bs', 'check-formatting:js', 'lint:docs']);
  });

  it('does not infinitely recurse on a self-referential script', () => {
    const scripts = { lint: 'npm run a', a: 'npm run a && echo hi' };
    expect(expandAggregate(scripts)).toEqual([]);
  });
});

describe('coverage detection', () => {
  const scripts = { lint: 'npm run lint:docs', 'lint:docs': 'node scripts/lint/docs-check.cjs' };

  it('accepts a workflow invoking the npm alias', () => {
    expect(check({ scripts, workflows: wf('run: npm run lint:docs') }).missing).toEqual([]);
  });

  // Several real workflows call the script path rather than the npm alias
  // (_lint-docs.yml runs `node scripts/lint/docs-check.cjs` directly).
  it('accepts a workflow invoking the underlying script path directly', () => {
    expect(
      check({ scripts, workflows: wf('run: node scripts/lint/docs-check.cjs') }).missing,
    ).toEqual([]);
  });

  it('flags a check no workflow runs', () => {
    const { missing } = check({ scripts, workflows: wf('run: npm run something-else') });
    expect(missing).toHaveLength(1);
    expect(missing[0].name).toBe('lint:docs');
  });

  // The bug that motivated this script: `npm run lint` appearing only inside a
  // COMMENT in a workflow must not count as CI running the aggregate.
  it('does not count a bare `npm run lint` mention as covering its members', () => {
    const { missing } = check({
      scripts,
      workflows: wf('# these also run in the `npm run lint` aggregate\nrun: npm run other'),
    });
    expect(missing.map((m) => m.name)).toEqual(['lint:docs']);
  });

  it('does not let a prefix match satisfy a longer script name', () => {
    const s = { lint: 'npm run lint:docs', 'lint:docs': 'echo x' };
    const { missing } = check({ scripts: s, workflows: wf('run: npm run lint:docs-extra') });
    expect(missing.map((m) => m.name)).toEqual(['lint:docs']);
  });
});

describe('the LOCAL_ONLY allowlist', () => {
  const scripts = { lint: 'npm run lint:bs', 'lint:bs': 'bslint' };

  it('exempts an allowlisted check from the CI requirement', () => {
    // lint:bs is the real allowlist entry — covered in substance by `validate`.
    expect(check({ scripts, workflows: wf('run: npm run validate') }).missing).toEqual([]);
  });

  it('every allowlist entry carries a non-empty reason', () => {
    for (const [name, reason] of Object.entries(LOCAL_ONLY)) {
      expect(reason, `${name} needs a reason`).toBeTruthy();
      expect(
        reason.length,
        `${name}'s reason is too terse to be a decision record`,
      ).toBeGreaterThan(30);
    }
  });

  it('flags an allowlist entry that is no longer in the aggregate as stale', () => {
    const { staleAllowlist } = check({ scripts: { lint: '' }, workflows: wf('') });
    expect(staleAllowlist).toContain('lint:bs');
  });
});

describe('the committed package.json + workflows', () => {
  it('every `npm run lint` check has a CI home (the live gate)', () => {
    const scripts = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')).scripts;
    const dir = resolve(REPO_ROOT, '.github/workflows');
    const workflows = readdirSync(dir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((f) => ({ name: f, text: readFileSync(resolve(dir, f), 'utf8') }));

    const { missing, staleAllowlist } = check({ scripts, workflows });
    expect(missing.map((m) => m.name)).toEqual([]);
    expect(staleAllowlist).toEqual([]);
  });
});

// Tests for scripts/lint/ci-parity-check.js — the meta-gate asserting every
// check in the `npm run lint` aggregate is actually run by some CI workflow.
//
// Pure layer: hand-written package.json `scripts` maps + fake workflow texts.
// Plus a smoke pass over the REAL committed package.json + .github/workflows,
// so adding a check to the aggregate without wiring it into CI fails here.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  check,
  expandAggregate,
  LOCAL_ONLY,
  COVERED_BY_TEST,
} from '../../../../scripts/lint/ci-parity-check.js';

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

  // A MENTION is not a RUN. Each of these was a real false-positive before the
  // comment-stripping pass — the same "it's referenced somewhere, so it must be
  // wired" confusion that let three checks sit uncovered in the first place.
  it.each([
    ['a YAML comment mentioning the check', '      # TODO: wire up npm run lint:docs someday'],
    ['a commented-out step', '      # - run: npm run lint:docs'],
    ['a shell comment inside a `run: |` block', '      run: |\n        # npm run lint:docs'],
  ])('does not accept %s as coverage', (_label, text) => {
    expect(check({ scripts, workflows: wf(text) }).missing.map((m) => m.name)).toEqual([
      'lint:docs',
    ]);
  });

  // Path coverage matches the INVOCATION, not the bare path. Workflows name
  // script paths in their `paths` filters too; one with an unescaped dot must
  // not satisfy its own coverage requirement.
  it('does not let a `paths` filter regex satisfy coverage for the script it names', () => {
    const { missing } = check({
      scripts,
      workflows: wf("          pattern: '^scripts/lint/docs-check.cjs$'"),
    });
    expect(missing.map((m) => m.name)).toEqual(['lint:docs']);
  });

  // Regression guard: comment stripping must stay LINE-based. This repo wires
  // plenty of commands inside multi-line `run: |` blocks, where the command
  // line carries no `run:` key — a matcher scoped to `run:` lines would report
  // a false MISSING here and red-fail CI for a check that is correctly wired.
  it('accepts a check invoked inside a multi-line `run: |` block', () => {
    expect(
      check({ scripts, workflows: wf('      - run: |\n          npm run lint:docs') }).missing,
    ).toEqual([]);
  });

  it('does not let a prefix match satisfy a longer script name', () => {
    const s = { lint: 'npm run lint:docs', 'lint:docs': 'echo x' };
    const { missing } = check({ scripts: s, workflows: wf('run: npm run lint:docs-extra') });
    expect(missing.map((m) => m.name)).toEqual(['lint:docs']);
  });
});

// The indirect CI home: a Vitest drift-gate test that shells the real check
// against the real repo, run in CI by `npm run test:scripts`. Every condition is
// verified, so each of these is a way the claim can go stale silently.
describe('the COVERED_BY_TEST indirection', () => {
  // Mirrors the real shape: icons:check has no `run:` line anywhere.
  const scripts = {
    lint: 'npm run icons:check',
    'icons:check': 'node scripts/generate/icons-build.js --check',
    'test:scripts': 'vitest run',
  };
  const TEST_FILE = 'tests/scripts/unit/generate/icons-build.test.js';
  const runnerWf = wf('run: npm run test:scripts');
  const gate = (text) => [{ name: TEST_FILE, text }];
  const REAL_GATE =
    "const SCRIPT = 'scripts/generate/icons-build.js';\nspawnScript(SCRIPT, ['--check']);";

  it('accepts a drift-gate test when the runner itself is wired into CI', () => {
    expect(check({ scripts, workflows: runnerWf, tests: gate(REAL_GATE) }).missing).toEqual([]);
  });

  it('flags the check when the cited test file is gone (renamed or deleted)', () => {
    const { missing } = check({ scripts, workflows: runnerWf, tests: [] });
    expect(missing.map((m) => m.name)).toEqual(['icons:check']);
  });

  // A test that only drives the generator against a temp fixture proves nothing
  // about the COMMITTED assets, which is exactly what the entry claims.
  it('flags the check when the test never invokes it in --check mode', () => {
    const { missing } = check({
      scripts,
      workflows: runnerWf,
      tests: gate("const SCRIPT = 'scripts/generate/icons-build.js';\nspawnScript(SCRIPT, [dir]);"),
    });
    expect(missing.map((m) => m.name)).toEqual(['icons:check']);
  });

  // The whole indirection hangs off this. If test:scripts loses its workflow,
  // every COVERED_BY_TEST entry silently stops gating.
  it('flags the check when the test runner has no workflow home', () => {
    const { missing } = check({
      scripts,
      workflows: wf('run: npm run something-else'),
      tests: gate(REAL_GATE),
    });
    expect(missing.map((m) => m.name)).toEqual(['icons:check']);
  });

  // Every test file in tests/scripts/ opens with `// Tests for scripts/<path>`.
  // Without JS comment stripping each would vacuously cover its own subject.
  it('does not let a `// Tests for scripts/...` header count as a gate', () => {
    const { missing } = check({
      scripts,
      workflows: runnerWf,
      tests: gate('// Tests for scripts/generate/icons-build.js --check\nit("x", () => {});'),
    });
    expect(missing.map((m) => m.name)).toEqual(['icons:check']);
  });

  it('reports an entry for a check no longer in the aggregate as stale', () => {
    const { staleTestCoverage } = check({ scripts: { lint: '' }, workflows: runnerWf, tests: [] });
    expect(staleTestCoverage).toEqual(expect.arrayContaining(['icons:check', 'gradients:check']));
  });

  it('every entry names a test file that exists', () => {
    for (const [name, rel] of Object.entries(COVERED_BY_TEST)) {
      expect(existsSync(resolve(REPO_ROOT, rel)), `${name} cites a missing test: ${rel}`).toBe(
        true,
      );
    }
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

    // Same inputs the CLI assembles, including the COVERED_BY_TEST files —
    // otherwise this gate would report the test-hosted checks as missing.
    const tests = [...new Set(Object.values(COVERED_BY_TEST))].map((rel) => ({
      name: rel,
      text: readFileSync(resolve(REPO_ROOT, rel), 'utf8'),
    }));

    const { missing, staleAllowlist, staleTestCoverage } = check({ scripts, workflows, tests });
    expect(missing.map((m) => m.name)).toEqual([]);
    expect(staleAllowlist).toEqual([]);
    expect(staleTestCoverage).toEqual([]);
  });
});

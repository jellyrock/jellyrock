// Tests for scripts/lint/promise-ratchet.cjs.
//
// The ratchet counts the observer-spaghetti signature — a literal
// `.observeField("isDone"` in app code (source/ + components/), excluding the
// pool engine (apiPool.bs) and the promise adapter (apiPromise.bs) — and gates
// it against a committed `.promise-ratchet-baseline` integer. Tests build a
// throwaway root dir with fixture .bs files and a baseline, then assert exit
// code + output. See the script header for the full fail policy.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';

const SCRIPT = 'scripts/lint/promise-ratchet.cjs';

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

// Build a root dir with the given files ({ relPath: contents }) and an optional
// baseline file. Returns the root path.
function setupRoot(files, baseline) {
  const root = mkdtempSync(join(tmpdir(), 'jellyrock-promise-ratchet-'));
  dirs.push(root);
  for (const [rel, contents] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  if (baseline !== undefined) {
    writeFileSync(join(root, '.promise-ratchet-baseline'), `${baseline}\n`);
  }
  return root;
}

// One observer-spaghetti call site.
const observeLine = '    m.resultNode.observeField("isDone", "onDone")\n';

function run(root) {
  return spawnScript(SCRIPT, ['--root', root]);
}

describe('promise-ratchet', () => {
  it('PASSes when count equals baseline', () => {
    const root = setupRoot({ 'components/Foo.bs': `sub init()\n${observeLine}end sub\n` }, 1);
    const { exitCode, stdout } = run(root);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/OK — 1 of 1 allowed/);
  });

  it('FAILs (exit 1) when count exceeds baseline, listing the sites', () => {
    const root = setupRoot(
      {
        'components/Foo.bs': `sub init()\n${observeLine}${observeLine}end sub\n`,
      },
      1,
    );
    const { exitCode, stderr } = run(root);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/rose to 2 \(baseline 1\)/);
    expect(stderr).toMatch(/components\/Foo\.bs:2/);
  });

  it('PASSes but advises lowering the baseline when count drops below it', () => {
    const root = setupRoot({ 'components/Foo.bs': `sub init()\n${observeLine}end sub\n` }, 3);
    const { exitCode, stdout } = run(root);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/dropped to 1 \(baseline 3\)/);
    expect(stdout).toMatch(/Lower .* to 1/);
  });

  it('acts as a hard grep-zero guard when baseline is 0', () => {
    const clean = setupRoot({ 'components/Foo.bs': 'sub init()\n  m.x = 1\nend sub\n' }, 0);
    const okRun = run(clean);
    expect(okRun.exitCode).toBe(0);
    expect(okRun.stdout).toMatch(/hard grep-zero guard active/);

    const dirty = setupRoot({ 'components/Foo.bs': `sub init()\n${observeLine}end sub\n` }, 0);
    expect(run(dirty).exitCode).toBe(1);
  });

  it('excludes the pool engine and the promise adapter', () => {
    const root = setupRoot(
      {
        'source/api/apiPool.bs': `sub a()\n${observeLine}end sub\n`,
        'source/api/apiPromise.bs': `sub b()\n${observeLine}end sub\n`,
        'components/Foo.bs': `sub init()\n${observeLine}end sub\n`,
      },
      1,
    );
    const { exitCode, stdout } = run(root);
    expect(exitCode).toBe(0); // only Foo.bs's one site counts, not the 2 excluded
    expect(stdout).toMatch(/OK — 1 of 1 allowed/);
  });

  it('does not count unobserveField or whole-line comments', () => {
    const root = setupRoot(
      {
        'components/Foo.bs':
          `sub init()\n` +
          `  m.resultNode.unobserveField("isDone")\n` + // not a match (.unobserveField)
          `  ' m.resultNode.observeField("isDone", "x") — documented, not a call\n` + // comment
          `end sub\n`,
      },
      0,
    );
    const { exitCode, stdout } = run(root);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/0 of 0/);
  });

  it('errors (exit 2) when the baseline file is missing', () => {
    const root = setupRoot({ 'components/Foo.bs': 'sub init()\nend sub\n' });
    const { exitCode, stderr } = run(root);
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/missing baseline file/);
  });

  it('errors (exit 2) when the baseline is not a non-negative integer', () => {
    const root = setupRoot({ 'components/Foo.bs': 'sub init()\nend sub\n' });
    writeFileSync(join(root, '.promise-ratchet-baseline'), 'not-a-number\n');
    const { exitCode, stderr } = run(root);
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/single non-negative integer/);
  });
});

// Tests for the line-number citation ratchet (scripts/lint/doc-citation-ratchet.js).
//
// The gate exists because a `file.bs:623` citation rots on ANY edit above line 623,
// faster than a review or a freshness gate can catch — see
// .claude/rules/derive-dont-duplicate.md. What the tests below actually pin is the
// set of judgment calls the regex and the walk encode, because each one is a place a
// naive implementation would either miss the problem or cry wolf:
//   - fenced code blocks are transcripts, not citations (rewriting one would falsify it)
//   - inline code IS the citation form these docs use, so it must count
//   - `localhost:8096` must not look like a citation
//   - gitignored, ephemeral prose is out of scope
//   - the ratchet is PER FILE, so a cleanup elsewhere cannot fund a new citation here
//
// Driven offline via spawnScript against a synthetic --root. No network, no hardware.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnScript } from './_helpers/spawn-script.js';

const LINT = 'scripts/lint/doc-citation-ratchet.js';

let root;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

/** Build a throwaway repo: `files` maps repo-relative path -> contents. */
function makeRoot(files, baseline) {
  root = mkdtempSync(join(tmpdir(), 'cite-ratchet-'));
  writeFileSync(join(root, '.doc-citation-baseline.json'), JSON.stringify(baseline ?? {}, null, 2));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

const run = (r, args = []) => spawnScript(LINT, [r, ...args]);

describe('doc-citation-ratchet — what counts as a citation', () => {
  it('fails on a new line-number citation in inline code', () => {
    const r = makeRoot({
      'docs/a.md': 'See `components/ItemDetails.bs:623` for the launch path.\n',
    });
    const res = run(r);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('docs/a.md');
    expect(res.stderr).toContain('ItemDetails.bs:623');
  });

  it('fails on a bare (un-backticked) citation and on a line RANGE', () => {
    const r = makeRoot({ 'docs/a.md': 'See source/utils/quickplay.bs:34-40 for the shape.\n' });
    expect(run(r).exitCode).toBe(1);
  });

  // A block showing what a compiler or a lint prints is a transcript. Rewriting it
  // would falsify the example, so it must not be gated.
  it('ignores citations inside a fenced code block', () => {
    const r = makeRoot({
      'docs/a.md': [
        'Example output:',
        '',
        '```',
        'components/ItemDetails.bs:623 - warning',
        '```',
        '',
      ].join('\n'),
    });
    const res = run(r);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('OK');
  });

  it('resumes counting after a fenced block closes', () => {
    const r = makeRoot({
      'docs/a.md': ['```', 'x.bs:1', '```', '', 'But `y.bs:2` is a real citation.', ''].join('\n'),
    });
    const res = run(r);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('y.bs:2');
    expect(res.stderr).not.toContain('x.bs:1');
  });

  // The regex keys on a CODE extension precisely so host:port and version:port
  // strings — which these docs are full of — don't read as citations.
  it('does not treat host:port or a server version as a citation', () => {
    const r = makeRoot({
      'docs/a.md': 'Server at http://localhost:8096 and the 12.0 box on :8102. Also 10.11:8101.\n',
    });
    expect(run(r).exitCode).toBe(0);
  });

  it('does not count a filename with no line number', () => {
    const r = makeRoot({
      'docs/a.md': 'See `source/utils/versionResume.bs` and `ItemDetails.bs`.\n',
    });
    expect(run(r).exitCode).toBe(0);
  });
});

describe('doc-citation-ratchet — scope', () => {
  it('governs docs/, CLAUDE.md, AGENTS.md and .claude/', () => {
    for (const rel of [
      'docs/a.md',
      'CLAUDE.md',
      'AGENTS.md',
      '.claude/rules/x.md',
      'tests/rta/CLAUDE.md',
    ]) {
      const r = makeRoot({ [rel]: 'See `a.bs:1`.\n' });
      expect(run(r).exitCode, `${rel} should be governed`).toBe(1);
      rmSync(r, { recursive: true, force: true });
      root = undefined;
    }
  });

  // Ephemeral, gitignored prose: archived or pruned when its work finishes, so a
  // stale ref inside it rots privately. AGENTS.md already forbids citing these
  // paths FROM tracked content.
  it('ignores gitignored ephemeral prose (projects / handoffs / plans)', () => {
    const r = makeRoot({
      'docs/projects/2026-09-x/PLAN.md': 'See `a.bs:1`.\n',
      '.claude/handoffs/h.md': 'See `b.bs:2`.\n',
      '.claude/plans/p.md': 'See `c.bs:3`.\n',
    });
    expect(run(r).exitCode).toBe(0);
  });

  // `.claude/worktrees/<name>` is a whole second checkout (a `.git` FILE marks a worktree,
  // a `.git` directory a clone). Its docs are that branch's; counting them here failed
  // this repo's gate on files no branch being pushed touched.
  it('ignores a nested checkout (worktree or clone) wherever it sits', () => {
    const r = makeRoot({
      '.claude/worktrees/other-branch/.git': 'gitdir: /elsewhere/.git/worktrees/other-branch\n',
      '.claude/worktrees/other-branch/docs/a.md': 'See `a.bs:1`.\n',
      '.claude/worktrees/other-branch/CLAUDE.md': 'See `b.bs:2`.\n',
      'docs/vendor-clone/.git/HEAD': 'ref: refs/heads/main\n',
      'docs/vendor-clone/notes.md': 'See `c.bs:3`.\n',
    });
    expect(run(r).exitCode).toBe(0);
  });

  it('still governs this checkout beside a nested one', () => {
    const r = makeRoot({
      '.claude/worktrees/other-branch/.git': 'gitdir: /elsewhere\n',
      '.claude/skills/x/SKILL.md': 'See `a.bs:1`.\n',
    });
    const res = run(r);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('.claude/skills/x/SKILL.md');
  });

  // An AUDIT-LOG entry records what a run saw on a date — a historical measurement,
  // which the rule's third clause explicitly allows.
  it('ignores append-only AUDIT-LOG.md records', () => {
    const r = makeRoot({ '.claude/skills/pr/AUDIT-LOG.md': 'Run saw `a.bs:1`.\n' });
    expect(run(r).exitCode).toBe(0);
  });

  it('ignores markdown outside the governed set', () => {
    const r = makeRoot({ 'some/other/place.md': 'See `a.bs:1`.\n' });
    expect(run(r).exitCode).toBe(0);
  });
});

describe('doc-citation-ratchet — the ratchet', () => {
  it('passes at exactly the baseline', () => {
    const r = makeRoot({ 'docs/a.md': 'See `a.bs:1` and `b.bs:2`.\n' }, { 'docs/a.md': 2 });
    const res = run(r);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('at the committed baseline');
  });

  it('passes but advises lowering when a file improves', () => {
    const r = makeRoot({ 'docs/a.md': 'See `a.bs:1`.\n' }, { 'docs/a.md': 2 });
    const res = run(r);
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toContain('LOWER THE BASELINE');
    expect(res.stderr).toContain('docs/a.md: 2 → 1');
  });

  it('tells you to remove the entry when a file reaches zero', () => {
    const r = makeRoot({ 'docs/a.md': 'All symbols now.\n' }, { 'docs/a.md': 3 });
    const res = run(r);
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toContain('remove the entry');
  });

  // The reason the baseline is per-file rather than one total: otherwise an
  // unrelated cleanup could fund a fresh citation somewhere else and stay green.
  it('fails a file that gained one even when the repo total went DOWN', () => {
    const r = makeRoot(
      { 'docs/a.md': 'only `a.bs:1`.\n', 'docs/b.md': 'gained `b.bs:2`.\n' },
      { 'docs/a.md': 5, 'docs/b.md': 0 },
    );
    const res = run(r);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('docs/b.md');
  });

  it('allows zero for a file absent from the baseline', () => {
    const r = makeRoot({ 'docs/new.md': 'See `a.bs:1`.\n' }, {});
    const res = run(r);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('allowed 0');
  });

  it('exits 1 with a clear message when the baseline file is missing', () => {
    root = mkdtempSync(join(tmpdir(), 'cite-ratchet-'));
    const res = run(root);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('missing baseline');
  });

  it('exits 1 on a malformed baseline rather than silently allowing everything', () => {
    root = mkdtempSync(join(tmpdir(), 'cite-ratchet-'));
    writeFileSync(join(root, '.doc-citation-baseline.json'), '{ not json');
    const res = run(root);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('not valid JSON');
  });

  it('--json reports the machine-readable shape', () => {
    const r = makeRoot({ 'docs/a.md': 'See `a.bs:1`.\n' }, { 'docs/a.md': 0 });
    const res = run(r, ['--json']);
    const out = JSON.parse(res.stdout);
    expect(out.total).toBe(1);
    expect(out.over).toHaveLength(1);
    expect(out.over[0].file).toBe('docs/a.md');
  });
});

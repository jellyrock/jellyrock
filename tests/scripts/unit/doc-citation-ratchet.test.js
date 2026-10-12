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
// The same script holds the house-voice ratchet (docs/dev/writing-style.md); its tests
// pin what counts as prose (code, link targets and URLs do not), the wider scope, the
// per-category ratchet, and the two baseline flags.
//
// Driven offline via spawnScript against a synthetic --root. No network, no hardware.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
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
function makeRoot(files, baseline, voiceBaseline = {}) {
  root = mkdtempSync(join(tmpdir(), 'cite-ratchet-'));
  writeFileSync(join(root, '.doc-citation-baseline.json'), JSON.stringify(baseline ?? {}, null, 2));
  if (voiceBaseline !== null)
    writeFileSync(join(root, '.doc-voice-baseline.json'), JSON.stringify(voiceBaseline, null, 2));
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

  // The full form keys on a CODE extension, and the shorthand form needs nothing
  // glued to its left, so host:port, version:port and clock times don't read as
  // citations.
  it('does not treat host:port, a server version or a clock time as a citation', () => {
    const r = makeRoot({
      'docs/a.md':
        'Server at http://localhost:8096 and http://<server>:8098. Also 10.11:8101, ' +
        'and the window ran 15:45–15:52 UTC.\n',
    });
    expect(run(r).exitCode).toBe(0);
  });

  // `RokuDevice.js:63-70 / :71-76` and "the comment at `:25-28`": a shorthand that
  // leans on a file named nearby rots exactly like the full form.
  it('fails on a shorthand citation, inline, bare or as link text', () => {
    for (const body of [
      'The comment at `:25-28` explains it.\n',
      'See `RokuDevice.js` / :71-76 for the callback.\n',
      'Only `ARCH_DIR`, [:60](../scripts/lint/x.cjs), is scanned.\n',
    ]) {
      const r = makeRoot({ 'docs/a.md': body });
      const res = run(r);
      expect(res.exitCode, body).toBe(1);
      expect(res.stderr).toContain('docs/a.md');
      rmSync(r, { recursive: true, force: true });
      root = undefined;
    }
  });

  // A lone `:46` (a clock minute) or `:8102` (a port) cannot be told apart from a
  // shorthand line citation, so it is counted, and the advice says to write it in words.
  it('counts a lone minute or port and says to write it in words', () => {
    const r = makeRoot({ 'docs/a.md': 'Runs after roughly `:46` hit the reset, on :8102.\n' });
    const res = run(r);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain(':46');
    expect(res.stderr).toContain('minutes past the hour');
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
    expect(res.stdout).toContain('within the committed baselines');
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

const readVoice = (r) => JSON.parse(readFileSync(join(r, '.doc-voice-baseline.json'), 'utf8'));

describe('doc-citation-ratchet — what counts against the house voice', () => {
  it.each([
    ['em-dash', 'One thought — and another.'],
    ['filler', 'This is just a test.'],
    ['filler', 'Note that the cache resets.'],
    ['caps-emphasis', 'Do NOT edit this file.'],
    ['prose-arrow', 'launch → home'],
    ['latin-abbrev', 'Use a short name, e.g. a slug.'],
  ])('fails on a new %s hit in prose', (category, text) => {
    const res = run(makeRoot({ 'docs/a.md': `${text}\n` }));
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain(`docs/a.md: ${category} 1 (allowed 0)`);
  });

  // A command, an identifier or a URL is not prose; counting it would push writers to
  // mangle code to pass the gate.
  it('ignores inline code, fenced blocks, link targets and URLs', () => {
    const r = makeRoot({
      'docs/a.md': [
        'Run `grep -c "—" file` and `just build`.',
        '',
        '```text',
        'Before: one — two, NOT three, e.g. four → five',
        '```',
        '',
        'See [the guide](https://example.com/just—NOT) or <https://example.com/e.g.>.',
        '',
      ].join('\n'),
    });
    expect(run(r).exitCode).toBe(0);
  });

  it('allows a table cell holding only a dash, but not a dash in a cell sentence', () => {
    const ok = makeRoot({ 'docs/a.md': '| Cmd | Push |\n|---|---|\n| `x` | — |\n' });
    expect(run(ok).exitCode).toBe(0);
    rmSync(root, { recursive: true, force: true });
    const bad = makeRoot({ 'docs/a.md': '| Cmd | Why |\n|---|---|\n| `x` | Fast — cheap |\n' });
    expect(run(bad).exitCode).toBe(1);
  });

  it('allows an arrow inside a bold UI path', () => {
    const r = makeRoot({ 'docs/a.md': 'Open **Settings → Playback**.\n' });
    expect(run(r).exitCode).toBe(0);
  });

  // Word boundaries: a filler word inside a longer word, and a capitalized word that is
  // part of a hyphenated or underscored name, are not hits.
  it('does not count adjust, NOT_FOUND or AUDIT-ONLY', () => {
    const r = makeRoot({ 'docs/a.md': 'Adjust it. NOT_FOUND is a code. AUDIT-ONLY is a mode.\n' });
    expect(run(r).exitCode).toBe(0);
  });
});

describe('doc-citation-ratchet — house-voice scope', () => {
  it('governs README, CONTRIBUTING, .github and any other markdown', () => {
    for (const rel of [
      'README.md',
      'CONTRIBUTING.md',
      '.github/pull_request_template.md',
      'resources/icons/README.md',
    ]) {
      const res = run(makeRoot({ [rel]: 'One — two.\n' }));
      expect(res.exitCode, rel).toBe(1);
      rmSync(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  // A ratchet forces no rewrite, so append-only records can be held to it: old entries
  // keep their allowance and new ones start clean.
  it('governs AUDIT-LOG.md records, which the citation gate skips', () => {
    const r = makeRoot({ '.claude/skills/pr/AUDIT-LOG.md': 'Run saw `a.bs:1` — fine.\n' });
    const res = run(r);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('em-dash');
    expect(res.stderr).not.toContain('line-number citations');
  });

  it('ignores CHANGELOG.md, locale/ and components/vendor/', () => {
    const r = makeRoot({
      'CHANGELOG.md': 'Fix — a thing.\n',
      'locale/README.md': 'Translation — text.\n',
      'components/vendor/lib/README.md': 'Vendor — text.\n',
    });
    expect(run(r).exitCode).toBe(0);
  });

  it('ignores gitignored ephemeral prose', () => {
    const r = makeRoot({ 'docs/projects/2026-10-x/PLAN.md': 'One — two.\n' });
    expect(run(r).exitCode).toBe(0);
  });
});

describe('doc-citation-ratchet — the house-voice ratchet', () => {
  it('passes at exactly the baseline and advises lowering when a file improves', () => {
    const r = makeRoot(
      { 'docs/a.md': 'One — two.\n' },
      {},
      { 'docs/a.md': { 'em-dash': 2, filler: 1 } },
    );
    const res = run(r);
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toContain('--lower-voice-baseline');
  });

  it('fails a category that went up even when another went down', () => {
    const r = makeRoot({ 'docs/a.md': 'Just one thing.\n' }, {}, { 'docs/a.md': { 'em-dash': 3 } });
    const res = run(r);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('docs/a.md: filler 1 (allowed 0)');
  });

  it('exits 1 with the init command when the voice baseline is missing', () => {
    const res = run(makeRoot({ 'docs/a.md': 'Fine.\n' }, {}, null));
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('--init-voice-baseline');
  });

  it('--init-voice-baseline writes the current counts', () => {
    const r = makeRoot({ 'docs/a.md': 'One — two — three, e.g. four.\n' }, {}, null);
    expect(run(r, ['--init-voice-baseline']).exitCode).toBe(0);
    expect(readVoice(r)).toEqual({ 'docs/a.md': { 'em-dash': 2, 'latin-abbrev': 1 } });
  });

  it('--init-voice-baseline refuses to overwrite an existing baseline', () => {
    const r = makeRoot({ 'docs/a.md': 'One — two.\n' }, {}, { 'docs/a.md': { 'em-dash': 9 } });
    const res = run(r, ['--init-voice-baseline']);
    expect(res.exitCode).toBe(1);
    expect(readVoice(r)).toEqual({ 'docs/a.md': { 'em-dash': 9 } });
  });

  it('--lower-voice-baseline lowers, drops zeros and never raises', () => {
    const r = makeRoot(
      { 'docs/a.md': 'One — two.\n', 'docs/b.md': 'Clean now.\n', 'docs/c.md': 'Just — this.\n' },
      {},
      {
        'docs/a.md': { 'em-dash': 4 },
        'docs/b.md': { filler: 2 },
        'docs/c.md': { 'em-dash': 1 },
      },
    );
    const res = run(r, ['--lower-voice-baseline']);
    // c.md gained a filler word: lowering must not grant it, so the run still fails.
    expect(res.exitCode).toBe(1);
    expect(readVoice(r)).toEqual({ 'docs/a.md': { 'em-dash': 1 }, 'docs/c.md': { 'em-dash': 1 } });
    expect(existsSync(join(r, '.doc-voice-baseline.json'))).toBe(true);
  });

  it('--json reports the voice result alongside citations', () => {
    const res = run(makeRoot({ 'docs/a.md': 'One — two.\n' }), ['--json']);
    const out = JSON.parse(res.stdout);
    expect(res.exitCode).toBe(1);
    expect(out.voice.total).toBe(1);
    expect(out.voice.over[0]).toMatchObject({ file: 'docs/a.md', category: 'em-dash', count: 1 });
  });
});

// The same five categories, counted in code comments. The parsers decide what a comment
// is, so each language gets a case where a naive regex over raw source would be wrong:
// the comment marker or an em dash sitting inside a string.
describe('doc-citation-ratchet — house voice in code comments', () => {
  const DASH_COMMENT = {
    'source/a.bs': "sub main()\n  x = 1 ' one — two\nend sub\n",
    'source/b.brs': 'REM one — two\nsub main()\nend sub\n',
    'scripts/a.js': '// one — two\nexport const x = 1;\n',
    'scripts/b.cjs': '/* one — two */\nmodule.exports = 1;\n',
    'scripts/c.mjs': '/**\n * one — two\n */\nexport const x = 1;\n',
    'components/a.xml': '<?xml version="1.0"?>\n<!-- one — two -->\n<component name="A" />\n',
    '.github/workflows/a.yml': '# one — two\non: push\n',
    'config/a.yaml': 'a: 1 # one — two\n',
    'scripts/a.sh': '#!/usr/bin/env bash\n# one — two\necho hi\n',
    '.husky/pre-x': '#!/usr/bin/env sh\n# one — two\necho hi\n',
  };

  it.each(Object.entries(DASH_COMMENT))('counts an em dash in a comment of %s', (rel, body) => {
    const res = run(makeRoot({ [rel]: body }));
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain(`${rel}: em-dash 1 (allowed 0) in comments`);
  });

  it.each([
    ['source/a.bs', 'sub main()\n  x = "it\'s — fine"\n  y = "REM — fine"\nend sub\n'],
    ['scripts/a.js', 'export const x = "a // b — c";\nexport const y = `d /* e — f */`;\n'],
    ['scripts/a.cjs', 'module.exports = "a // b — c";\n'],
    ['.github/workflows/a.yml', 'a: "x # y — z"\nb: http://example.com/#frag—ment\n'],
    ['components/a.xml', '<component name="A" desc="a — b" />\n'],
    ['scripts/a.sh', 'echo "a # b — c"\necho x # trailing — dash\n'],
  ])('does not count an em dash that is not in a comment (%s)', (rel, body) => {
    expect(run(makeRoot({ [rel]: body })).exitCode).toBe(0);
  });

  it('skips inline code and URLs inside a comment', () => {
    const r = makeRoot({
      'source/a.bs':
        "sub main()\n  ' Run `just build` or `a — b`; see https://x.test/just—NOT\nend sub\n",
      'scripts/a.js': '// Use `e.g.` literally, see https://x.test/e.g.\nexport const x = 1;\n',
    });
    expect(run(r).exitCode).toBe(0);
  });

  it.each([
    ['filler', "' This is just a test."],
    ['caps-emphasis', "' Do NOT edit this."],
    ['latin-abbrev', "' Pick a name, e.g. a slug."],
    ['prose-arrow', "' launch → home"],
  ])('counts %s in a BrightScript comment', (category, comment) => {
    const res = run(makeRoot({ 'source/a.bs': `sub main()\n${comment}\nend sub\n` }));
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain(`source/a.bs: ${category} 1 (allowed 0) in comments`);
  });

  it('does not count a shebang line as a comment', () => {
    const r = makeRoot({
      'scripts/a.js': '#!/usr/bin/env node\nexport const x = 1;\n',
      'scripts/a.sh': '#!/usr/bin/env bash — a shebang, not a comment\necho hi\n',
    });
    expect(run(r).exitCode).toBe(0);
  });

  it('fails loudly, naming the file, when a JS file does not parse', () => {
    const res = run(makeRoot({ 'scripts/broken.js': 'const = ;\n' }));
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toContain('scripts/broken.js');
  });

  it('ignores vendored and generated code', () => {
    const r = makeRoot({
      'components/vendor/x/a.xml': '<!-- one — two -->\n<c />\n',
      'roku_modules/x/a.bs': "' one — two\n",
      'node_modules/x/a.js': '// one — two\n',
      'build/a.js': '// one — two\n',
      'out/a.brs': "' one — two\n",
    });
    expect(run(r).exitCode).toBe(0);
  });

  it('ignores a nested checkout', () => {
    const r = makeRoot({
      '.claude/worktrees/w/.git': 'gitdir: /elsewhere\n',
      '.claude/worktrees/w/source/a.bs': "' one — two\n",
    });
    expect(run(r).exitCode).toBe(0);
  });

  it('passes at the allowance, fails over it, and advises lowering under it', () => {
    const files = { 'source/a.bs': "sub main()\n' one — two — three\nend sub\n" };
    const at = run(makeRoot(files, {}, { 'source/a.bs': { 'em-dash': 2 } }));
    expect(at.exitCode).toBe(0);
    rmSync(root, { recursive: true, force: true });
    const over = run(makeRoot(files, {}, { 'source/a.bs': { 'em-dash': 1 } }));
    expect(over.exitCode).toBe(1);
    expect(over.stderr).toContain('source/a.bs: em-dash 2 (allowed 1) in comments');
    rmSync(root, { recursive: true, force: true });
    const under = run(makeRoot(files, {}, { 'source/a.bs': { 'em-dash': 5 } }));
    expect(under.exitCode).toBe(0);
    expect(under.stderr).toContain('--lower-voice-baseline');
  });

  it('--lower-voice-baseline lowers a code file allowance', () => {
    const r = makeRoot(
      { 'source/a.bs': "sub main()\n' one — two\nend sub\n" },
      {},
      { 'source/a.bs': { 'em-dash': 4, filler: 2 } },
    );
    expect(run(r, ['--lower-voice-baseline']).exitCode).toBe(0);
    expect(readVoice(r)).toEqual({ 'source/a.bs': { 'em-dash': 1 } });
  });
});

describe('doc-citation-ratchet — --init-comment-baseline', () => {
  const files = {
    'docs/a.md': 'A doc — with a dash.\n',
    'source/a.bs': "sub main()\n' one — two — three\nend sub\n",
    'scripts/a.js': '// just this\nexport const x = 1;\n',
  };

  it('seeds code-file entries only and keeps the doc entries', () => {
    const r = makeRoot(files, {}, { 'docs/a.md': { 'em-dash': 1 } });
    expect(run(r, ['--init-comment-baseline']).exitCode).toBe(0);
    expect(readVoice(r)).toEqual({
      'docs/a.md': { 'em-dash': 1 },
      'scripts/a.js': { filler: 1 },
      'source/a.bs': { 'em-dash': 2 },
    });
  });

  it('refuses a second time and leaves the baseline alone', () => {
    const r = makeRoot(files, {}, { 'docs/a.md': { 'em-dash': 1 } });
    expect(run(r, ['--init-comment-baseline']).exitCode).toBe(0);
    const before = readFileSync(join(r, '.doc-voice-baseline.json'), 'utf8');
    const res = run(r, ['--init-comment-baseline']);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('already has code-file entries');
    expect(readFileSync(join(r, '.doc-voice-baseline.json'), 'utf8')).toBe(before);
  });
});

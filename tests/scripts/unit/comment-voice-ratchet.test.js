// Tests for the code-comment house-voice ratchet (scripts/lint/comment-voice-ratchet.js).
//
// The tool holds the comments of tracked code to the house voice
// (docs/dev/writing-style.md), per file, against `.doc-voice-baseline.json`. Markdown is
// not its job: `.claude/skills/log/voice-check.sh` checks it (the first describe block
// pins that this tool neither counts nor fails on it). What the tests pin is the
// judgment calls the parsers encode, because each one is a place a naive regex over raw
// source would either miss a comment or count a string:
//   - only comment text is read, by a parser per language
//   - inline code and URLs inside a comment are not prose
//   - vendored, generated, gitignored and nested-checkout paths are out of scope
//   - the ratchet is PER FILE and per category, and only improves
//
// Driven offline via spawnScript against a synthetic root. No network, no hardware.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { spawnScript } from './_helpers/spawn-script.js';
import { gitSafeEnv } from './_helpers/git-env.js';

const LINT = 'scripts/lint/comment-voice-ratchet.js';

let root;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

/** Build a throwaway repo: `files` maps repo-relative path -> contents. */
function makeRoot(files, voiceBaseline = {}) {
  root = mkdtempSync(join(tmpdir(), 'voice-ratchet-'));
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
const readVoice = (r) => JSON.parse(readFileSync(join(r, '.doc-voice-baseline.json'), 'utf8'));

// Markdown moved to .claude/skills/log/voice-check.sh. This tool must neither count it
// nor fail on it, whatever the markdown holds, and must not need a citation baseline.
describe('comment-voice-ratchet — markdown is not checked here', () => {
  const MD = [
    'One — two. This is just a test. Do NOT edit. launch → home. Use e.g. a slug.',
    'See `components/ItemDetails.bs:623` and :25-28 for the launch path.',
  ].join('\n');

  it.each(['docs/a.md', 'README.md', 'CLAUDE.md', 'AGENTS.md', '.claude/rules/x.md'])(
    'passes on a %s full of voice hits and line citations',
    (rel) => {
      const res = run(makeRoot({ [rel]: `${MD}\n` }));
      expect(res.exitCode).toBe(0);
      expect(res.stderr).toBe('');
      expect(res.stdout).toContain('OK');
    },
  );

  it('does not require a line-citation baseline file', () => {
    const res = run(makeRoot({ 'source/a.bs': "sub main()\n' fine\nend sub\n" }));
    expect(res.exitCode).toBe(0);
  });

  it('does not count markdown in the --json result', () => {
    const res = run(makeRoot({ 'docs/a.md': 'One — two.\n' }), ['--json']);
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout)).toEqual({
      voice: { total: 0, allowedTotal: 0, over: [], under: [] },
    });
  });

  // Old baselines carried one entry per .md file. They are stale now: the run still
  // passes, says to lower them, and --lower-voice-baseline drops them.
  it('treats a leftover .md baseline entry as slack to lower, not a failure', () => {
    const r = makeRoot({ 'docs/a.md': 'One — two.\n' }, { 'docs/a.md': { 'em-dash': 3 } });
    const res = run(r);
    expect(res.exitCode).toBe(0);
    expect(res.stderr).toContain('--lower-voice-baseline');
    expect(run(r, ['--lower-voice-baseline']).exitCode).toBe(0);
    expect(readVoice(r)).toEqual({});
  });
});

describe('comment-voice-ratchet — the baseline file', () => {
  it('exits 1 with the init command when the voice baseline is missing', () => {
    const res = run(makeRoot({ 'source/a.bs': "' Fine.\n" }, null));
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('missing baseline');
    expect(res.stderr).toContain('--init-comment-baseline');
  });

  it('exits 1 on a malformed baseline rather than silently allowing everything', () => {
    const r = makeRoot({ 'source/a.bs': "' Fine.\n" }, null);
    writeFileSync(join(r, '.doc-voice-baseline.json'), '{ not json');
    const res = run(r);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('not valid JSON');
  });

  it('does not offer --init-voice-baseline any more', () => {
    const r = makeRoot({ 'source/a.bs': "sub main()\n' one — two\nend sub\n" }, null);
    const res = run(r, ['--init-voice-baseline']);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('missing baseline');
  });

  it('--init-comment-baseline creates a missing baseline from the current comment counts', () => {
    const r = makeRoot({ 'source/a.bs': "sub main()\n' one — two — three\nend sub\n" }, null);
    expect(run(r, ['--init-comment-baseline']).exitCode).toBe(0);
    expect(readVoice(r)).toEqual({ 'source/a.bs': { 'em-dash': 2 } });
  });
});

describe('comment-voice-ratchet — scope', () => {
  // The root `tasks/` is gitignored; a nested `components/tasks/` is tracked source.
  it('skips tasks/ at the repo root only', () => {
    const line = "' One — two.\n";
    const ignored = run(makeRoot({ 'tasks/X.bs': line }));
    expect(ignored.exitCode).toBe(0);
    rmSync(root, { recursive: true, force: true });
    root = undefined;
    const gated = run(makeRoot({ 'components/tasks/X.bs': line }));
    expect(gated.exitCode).toBe(1);
    expect(gated.stderr).toContain('em-dash');
  });

  it('ignores locale/ and components/vendor/', () => {
    const r = makeRoot({
      'locale/a.js': '// one — two\n',
      'components/vendor/lib/a.brs': "' one — two\n",
    });
    expect(run(r).exitCode).toBe(0);
  });

  it('ignores gitignored ephemeral folders (projects / handoffs / plans)', () => {
    const r = makeRoot({
      'docs/projects/2026-10-x/a.js': '// one — two\n',
      '.claude/handoffs/a.sh': '# one — two\n',
      '.claude/plans/a.yml': '# one — two\n',
    });
    expect(run(r).exitCode).toBe(0);
  });
});

// The same five categories, counted in code comments. The parsers decide what a comment
// is, so each language gets a case where a naive regex over raw source would be wrong:
// the comment marker or an em dash sitting inside a string.
describe('comment-voice-ratchet — house voice in code comments', () => {
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
    const at = run(makeRoot(files, { 'source/a.bs': { 'em-dash': 2 } }));
    expect(at.exitCode).toBe(0);
    rmSync(root, { recursive: true, force: true });
    const over = run(makeRoot(files, { 'source/a.bs': { 'em-dash': 1 } }));
    expect(over.exitCode).toBe(1);
    expect(over.stderr).toContain('source/a.bs: em-dash 2 (allowed 1) in comments');
    rmSync(root, { recursive: true, force: true });
    const under = run(makeRoot(files, { 'source/a.bs': { 'em-dash': 5 } }));
    expect(under.exitCode).toBe(0);
    expect(under.stderr).toContain('--lower-voice-baseline');
  });

  it('--lower-voice-baseline lowers a code file allowance', () => {
    const r = makeRoot(
      { 'source/a.bs': "sub main()\n' one — two\nend sub\n" },
      { 'source/a.bs': { 'em-dash': 4, filler: 2 } },
    );
    expect(run(r, ['--lower-voice-baseline']).exitCode).toBe(0);
    expect(readVoice(r)).toEqual({ 'source/a.bs': { 'em-dash': 1 } });
  });
});

describe('comment-voice-ratchet — --init-comment-baseline seeding', () => {
  const files = {
    'docs/a.md': 'A doc — with a dash.\n',
    'source/a.bs': "sub main()\n' one — two — three\nend sub\n",
    'scripts/a.js': '// just this\nexport const x = 1;\n',
  };

  it('seeds code-file entries only and keeps the doc entries', () => {
    const r = makeRoot(files, { 'docs/a.md': { 'em-dash': 1 } });
    expect(run(r, ['--init-comment-baseline']).exitCode).toBe(0);
    expect(readVoice(r)).toEqual({
      'docs/a.md': { 'em-dash': 1 },
      'scripts/a.js': { filler: 1 },
      'source/a.bs': { 'em-dash': 2 },
    });
  });

  it('refuses a second time and leaves the baseline alone', () => {
    const r = makeRoot(files, { 'docs/a.md': { 'em-dash': 1 } });
    expect(run(r, ['--init-comment-baseline']).exitCode).toBe(0);
    const before = readFileSync(join(r, '.doc-voice-baseline.json'), 'utf8');
    const res = run(r, ['--init-comment-baseline']);
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('already has code-file entries');
    expect(readFileSync(join(r, '.doc-voice-baseline.json'), 'utf8')).toBe(before);
  });
});

describe('comment-voice-ratchet — which files a git checkout governs', () => {
  const gitIn = (dir, ...args) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: gitSafeEnv() });

  it('skips gitignored files and counts tracked and untracked-not-ignored ones', () => {
    const r = makeRoot({
      '.gitignore': 'scratch/\n',
      'source/clean.bs': "' A plain sentence.\n",
      'source/untracked.bs': "' This is just a draft.\n",
      'scratch/notes.bs': "' This is just a note → with an arrow.\n",
    });
    gitIn(r, 'init', '--quiet');
    gitIn(r, 'add', '.gitignore', 'source/clean.bs');

    const res = run(r);
    expect(res.stderr).not.toContain('scratch/');
    expect(res.stderr).toContain('source/untracked.bs: filler 1 (allowed 0) in comments');
    expect(res.exitCode).toBe(1);
  });

  it('passes when the only violations are in a gitignored folder', () => {
    const r = makeRoot({
      '.gitignore': 'scratch/\n',
      'source/clean.bs': "' A plain sentence.\n",
      'scratch/notes.bs': "' This is just a note → with an arrow.\n",
    });
    gitIn(r, 'init', '--quiet');
    gitIn(r, 'add', '.gitignore', 'source/clean.bs');

    const res = run(r);
    expect(res.stderr).not.toContain('scratch/');
    expect(res.exitCode).toBe(0);
  });

  it('ignores a GIT_DIR that points at another repository', () => {
    const r = makeRoot({
      '.gitignore': 'scratch/\n',
      'source/clean.bs': "' A plain sentence.\n",
      'scratch/notes.bs': "' This is just a note.\n",
    });
    gitIn(r, 'init', '--quiet');
    const other = mkdtempSync(join(tmpdir(), 'cite-ratchet-other-'));
    try {
      gitIn(other, 'init', '--quiet');
      const res = spawnScript(LINT, [r], { env: { GIT_DIR: join(other, '.git') } });
      expect(res.stderr).not.toContain('scratch/');
      expect(res.exitCode).toBe(0);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

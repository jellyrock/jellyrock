// Tests for scripts/lint/docs-check.cjs.
//
// Validates: related-files frontmatter paths, markdown links, tech-debt
// anchor refs across docs/architecture/, docs/dev/, docs/user/, docs/decisions.md,
// every CLAUDE.md, and the BSC plugin sources under scripts/bsc-plugins/.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';
import { createGitFixture } from '../_helpers/temp-git-fixture.js';

const SCRIPT = 'scripts/lint/docs-check.cjs';

function setup(files = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-docs-check-'));
  for (const [relPath, content] of Object.entries(files)) {
    const full = join(dir, relPath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

const fmDoc = (relatedFiles = [], body = 'body\n') => {
  const fm =
    relatedFiles.length === 0
      ? 'related-files: []'
      : 'related-files:\n' + relatedFiles.map((f) => `  - ${f}`).join('\n');
  return `---\ntopic: foo\n${fm}\nlast-reviewed: 2026-05-01\n---\n# Heading\n\n${body}`;
};

describe('docs-check', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('exits 0 when an architecture doc has only valid related-files', () => {
    dir = setup({
      'docs/architecture/foo.md': fmDoc(['source/foo.bs']),
      'source/foo.bs': 'sub init()\nend sub\n',
      'docs/architecture/tech-debt.md': '---\ntopic: tech-debt\n---\n# Tech Debt\n',
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/clean/);
  });

  it('exits 1 with a broken related-files path', () => {
    dir = setup({
      'docs/architecture/foo.md': fmDoc(['source/missing.bs']),
      'docs/architecture/tech-debt.md': '---\ntopic: tech-debt\n---\n# Tech Debt\n',
    });
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/related-files path does not exist: source\/missing\.bs/);
  });

  it('exits 1 on a broken inline markdown link', () => {
    dir = setup({
      'docs/architecture/foo.md': fmDoc([], 'See [missing](./missing-doc.md) for details.\n'),
      'docs/architecture/tech-debt.md': '---\ntopic: tech-debt\n---\n# Tech Debt\n',
    });
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/markdown link target does not exist/);
  });

  it('checks the docs in a subfolder of a docs folder', () => {
    dir = setup({
      'docs/dev/guides/foo.md': '# Foo\n\nSee [settings](app-settings.md).\n',
      'docs/dev/app-settings.md': '# App settings\n',
      'docs/architecture/tech-debt.md': '---\ntopic: tech-debt\n---\n# Tech Debt\n',
    });
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(
      /docs\/dev\/guides\/foo\.md: markdown link target does not exist: app-settings\.md/,
    );
  });

  it('exits 1 on a stale tech-debt anchor reference', () => {
    dir = setup({
      'docs/architecture/foo.md': fmDoc(
        [],
        'See [`old-slug`](./tech-debt.md#old-slug) — the canonical citation form.\n',
      ),
      'docs/architecture/tech-debt.md': '---\ntopic: tech-debt\n---\n# Tech Debt\n\n## Real Slug\n',
    });
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/stale tech-debt anchor reference/);
  });

  it('passes when a tech-debt anchor matches a real heading', () => {
    dir = setup({
      'docs/architecture/foo.md': fmDoc(
        [],
        'See [`legacy`](./tech-debt.md#legacy-print-statements).\n',
      ),
      'docs/architecture/tech-debt.md':
        '---\ntopic: tech-debt\n---\n# Tech Debt\n\n## `legacy-print-statements`\n',
    });
    const { exitCode } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(0);
  });

  it('scans plugins under scripts/bsc-plugins/ for stale anchor refs (regression coverage)', () => {
    // The reorg moved plugins from scripts/bsc-plugin-*.cjs to
    // scripts/bsc-plugins/*.cjs; a stale plugin reference here must still
    // be caught.
    dir = setup({
      'docs/architecture/tech-debt.md':
        '---\ntopic: tech-debt\n---\n# Tech Debt\n\n## `real-slug`\n',
      'scripts/bsc-plugins/example.cjs':
        '// Plugin enforces the rule documented at tech-debt.md#nonexistent-slug.\n',
    });
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/nonexistent-slug/);
  });

  it('--verbose emits per-file counts', () => {
    dir = setup({
      'docs/architecture/foo.md': fmDoc(['source/foo.bs']),
      'source/foo.bs': 'sub init()\nend sub\n',
      'docs/architecture/tech-debt.md': '---\ntopic: tech-debt\n---\n# Tech Debt\n',
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--verbose']);
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/foo\.md.*1 related/);
  });

  it('--json emits structured output on a clean run (exit 0)', () => {
    dir = setup({
      'docs/architecture/foo.md': fmDoc(['source/foo.bs']),
      'source/foo.bs': 'sub init()\nend sub\n',
      'docs/architecture/tech-debt.md': '---\ntopic: tech-debt\n---\n# Tech Debt\n',
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.errorsCount).toBe(0);
    expect(parsed.errors).toEqual([]);
    expect(parsed.filesChecked).toBeGreaterThan(0);
  });

  it('--json categorizes errors and exits 1', () => {
    dir = setup({
      'docs/architecture/foo.md': fmDoc(
        ['source/missing.bs'],
        'See [missing](./missing-doc.md) and [`x`](./tech-debt.md#nope).\n',
      ),
      'docs/architecture/tech-debt.md': '---\ntopic: tech-debt\n---\n# Tech Debt\n',
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed.errorsCount).toBe(3);
    const cats = parsed.errors.map((e) => e.category).sort();
    expect(cats).toEqual(['broken-link', 'broken-related-file', 'stale-anchor']);
    for (const e of parsed.errors) {
      expect(e.file).toMatch(/foo\.md$/);
      expect(typeof e.message).toBe('string');
      expect(typeof e.target).toBe('string');
    }
  });
});

describe('docs-check — GitHub heading anchors', () => {
  let dir;
  const TD = '---\ntopic: tech-debt\n---\n# Tech Debt\n\n';

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const run = (files) => {
    dir = setup(files);
    return spawnScript(SCRIPT, [dir, '--json']);
  };
  const cats = (stdout) => JSON.parse(stdout).errors.map((e) => e.category);

  it('resolves a tech-debt heading with an em dash by its double-hyphen slug', () => {
    const { exitCode } = run({
      'docs/architecture/foo.md': fmDoc(
        [],
        '[x](./tech-debt.md#recently-removed--dont-go-searching-for-these)\n',
      ),
      'docs/architecture/tech-debt.md': `${TD}## Recently removed — don't go searching for these\n`,
    });
    expect(exitCode).toBe(0);
  });

  it('reports the single-hyphen form of that heading as stale', () => {
    const { exitCode, stdout } = run({
      'docs/architecture/foo.md': fmDoc(
        [],
        '[x](./tech-debt.md#recently-removed-dont-go-searching-for-these)\n',
      ),
      'docs/architecture/tech-debt.md': `${TD}## Recently removed — don't go searching for these\n`,
    });
    expect(exitCode).toBe(1);
    expect(cats(stdout)).toEqual(['stale-anchor']);
  });

  it('keeps the underscore from a code span in the slug', () => {
    const files = (ref) => ({
      'docs/architecture/foo.md': fmDoc([], `[x](./tech-debt.md#${ref})\n`),
      'docs/architecture/tech-debt.md': `${TD}## Compile-time flags (\`bs_const\`)\n`,
    });
    expect(run(files('compile-time-flags-bs_const')).exitCode).toBe(0);
    rmSync(dir, { recursive: true, force: true });
    const bad = run(files('compile-time-flags-bs_cnst'));
    expect(bad.exitCode).toBe(1);
    expect(cats(bad.stdout)).toEqual(['stale-anchor']);
  });

  it('reports a cross-file link to a missing heading as a broken anchor', () => {
    const { exitCode, stdout } = run({
      'docs/architecture/foo.md': fmDoc([], '[x](./other.md#missing)\n'),
      'docs/architecture/other.md': fmDoc([], '## Real heading\n'),
      'docs/architecture/tech-debt.md': TD,
    });
    expect(exitCode).toBe(1);
    expect(cats(stdout)).toEqual(['broken-anchor']);
    expect(JSON.parse(stdout).errors[0].target).toBe('./other.md#missing');
  });

  it('passes a cross-file link to a real heading, including a percent-encoded one', () => {
    const { exitCode } = run({
      'docs/architecture/foo.md': fmDoc(
        [],
        '[x](./other.md#real-heading) and [y](./other.md#caf%C3%A9--notes)\n[z](./other.md#tech-debt--cruft)\n',
      ),
      'docs/architecture/other.md': fmDoc(
        [],
        '## Real heading\n\n## Café & notes\n\n## Tech Debt & Cruft\n',
      ),
      'docs/architecture/tech-debt.md': TD,
    });
    expect(exitCode).toBe(0);
  });

  it('numbers a repeated heading with -1, -2 suffixes', () => {
    const files = (ref) => ({
      'docs/architecture/foo.md': fmDoc([], `[x](./other.md#${ref})\n`),
      'docs/architecture/other.md': '# Top\n\n## Notes\n\n## Notes\n\n## Notes\n',
      'docs/architecture/tech-debt.md': TD,
    });
    expect(run(files('notes')).exitCode).toBe(0);
    rmSync(dir, { recursive: true, force: true });
    expect(run(files('notes-1')).exitCode).toBe(0);
    rmSync(dir, { recursive: true, force: true });
    expect(run(files('notes-2')).exitCode).toBe(0);
    rmSync(dir, { recursive: true, force: true });
    expect(run(files('notes-3')).exitCode).toBe(1);
  });

  it('accepts explicit <a id>, <a name> and <hN id> targets', () => {
    const { exitCode } = run({
      'docs/architecture/foo.md': fmDoc(
        [],
        '[a](./other.md#by-id) [b](./other.md#by-name) [c](./other.md#by-h)\n',
      ),
      'docs/architecture/other.md':
        '# Top\n\n<a id="by-id"></a>\n<a name="by-name"></a>\n<h2 id="by-h">Title</h2>\n',
      'docs/architecture/tech-debt.md': TD,
    });
    expect(exitCode).toBe(0);
  });

  it('does not treat a heading inside a fenced code block as an anchor', () => {
    const { exitCode, stdout } = run({
      'docs/architecture/foo.md': fmDoc([], '[x](./other.md#fake)\n'),
      'docs/architecture/other.md': '# Top\n\n```md\n## Fake\n```\n',
      'docs/architecture/tech-debt.md': TD,
    });
    expect(exitCode).toBe(1);
    expect(cats(stdout)).toEqual(['broken-anchor']);
  });

  it('checks docs/user, including cross-site links into docs/dev', () => {
    const { exitCode, stdout } = run({
      'docs/user/guide.md':
        '# Guide\n\n[x](no-such-page.md) and [y](../dev/flags.md#no-such-heading)\n',
      'docs/dev/flags.md': '# Flags\n\n## Real heading\n',
      'docs/architecture/tech-debt.md': TD,
    });
    expect(exitCode).toBe(1);
    expect(cats(stdout).sort()).toEqual(['broken-anchor', 'broken-link']);
    expect(JSON.parse(stdout).errors.every((e) => e.file.endsWith('docs/user/guide.md'))).toBe(
      true,
    );
  });

  it('passes valid cross-site links between docs/user and docs/dev', () => {
    const { exitCode } = run({
      'docs/user/guide.md': '# Guide\n\n## Settings\n\n[x](../dev/flags.md#real-heading)\n',
      'docs/dev/flags.md': '# Flags\n\n## Real heading\n\n[y](../user/guide.md#settings)\n',
      'docs/architecture/tech-debt.md': TD,
    });
    expect(exitCode).toBe(0);
  });

  it('does not check GitHub line anchors', () => {
    const { exitCode } = run({
      'docs/architecture/foo.md': fmDoc([], '[x](./other.md#L12) and [y](./other.md#L12-L20)\n'),
      'docs/architecture/other.md': '# Top\n',
      'docs/architecture/tech-debt.md': TD,
    });
    expect(exitCode).toBe(0);
  });
});

describe('docs-check — same-file anchor links', () => {
  let dir;
  const TD = '---\ntopic: tech-debt\n---\n# Tech Debt\n\n';

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const run = (files) => {
    dir = setup(files);
    return spawnScript(SCRIPT, [dir, '--json']);
  };

  it('reports a same-file link to a missing heading as a broken anchor', () => {
    const { exitCode, stdout } = run({
      'docs/architecture/foo.md': fmDoc([], '[x](#missing)\n'),
      'docs/architecture/tech-debt.md': TD,
    });
    expect(exitCode).toBe(1);
    const errors = JSON.parse(stdout).errors;
    expect(errors.map((e) => e.category)).toEqual(['broken-anchor']);
    expect(errors[0].target).toBe('#missing');
  });

  it('passes a same-file link to a real heading and to an explicit <a id>', () => {
    const { exitCode } = run({
      'docs/architecture/foo.md': fmDoc(
        [],
        '[x](#real-heading) [y](#by-id)\n\n## Real heading\n\n<a id="by-id"></a>\n',
      ),
      'docs/architecture/tech-debt.md': TD,
    });
    expect(exitCode).toBe(0);
  });

  it('does not check a same-file line anchor', () => {
    const { exitCode } = run({
      'docs/architecture/foo.md': fmDoc([], '[x](#L12) [y](#L12-L20)\n'),
      'docs/architecture/tech-debt.md': TD,
    });
    expect(exitCode).toBe(0);
  });

  it('checks a same-file link inside tech-debt.md itself', () => {
    const { exitCode, stdout } = run({
      'docs/architecture/tech-debt.md': `${TD}## Real\n\n[ok](#real) [bad](#nope)\n`,
    });
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).errors.map((e) => e.category)).toEqual(['broken-anchor']);
  });

  it('checks a CLAUDE.md under a nested tasks/ dir but not under the root tasks/', () => {
    const TDOC = { 'docs/architecture/tech-debt.md': TD };
    const nested = run({ ...TDOC, 'components/tasks/CLAUDE.md': '# Rules\n\n[bad](#gone)\n' });
    expect(nested.exitCode).toBe(1);
    const atRoot = run({ ...TDOC, 'tasks/CLAUDE.md': '# Rules\n\n[bad](#gone)\n' });
    expect(atRoot.exitCode).toBe(0);
  });

  it('checks a same-file link in a CLAUDE.md', () => {
    const { exitCode, stdout } = run({
      'tests/CLAUDE.md': '# Rules\n\n[ok](#rules) [bad](#gone)\n',
      'docs/architecture/tech-debt.md': TD,
    });
    expect(exitCode).toBe(1);
    expect(JSON.parse(stdout).errors.map((e) => e.category)).toEqual(['broken-anchor']);
  });
});

describe('docs-check — progress.md frontmatter (structural, not temporal)', () => {
  // Temporal staleness (how OLD last-updated is) is intentionally not gated
  // here: it moved to the non-blocking progress-cursor-nudge.cjs + the weekly
  // docs-stale-tracker.yml. docs-check only validates the *structure* of the
  // frontmatter, which is a per-PR property. See progress-cursor-nudge.test.js
  // for the temporal-staleness + maintenance-filter coverage.
  let fixture;

  afterEach(() => {
    if (fixture) fixture.cleanup();
    fixture = null;
  });

  function makeProgress(lastUpdated) {
    return `---\nlast-updated: ${lastUpdated}\n---\n# Progress\n\nbody\n`;
  }

  function withDocsDir(fix) {
    mkdirSync(join(fix.dir, 'docs'), { recursive: true });
    return fix;
  }

  it('passes when last-updated is well-formed', () => {
    fixture = withDocsDir(createGitFixture());
    fixture.commit('seed', { 'docs/progress.md': makeProgress('2020-01-01') });
    const { exitCode, stdout } = spawnScript(SCRIPT, [fixture.dir, '--json']);
    const fm = JSON.parse(stdout).errors.filter((e) => e.category === 'progress-frontmatter');
    expect(fm.length).toBe(0);
    expect(exitCode).toBe(0);
  });

  it('does NOT fail on an OLD-but-well-formed date, even with commits since', () => {
    // Regression guard for the relocated behavior: an ancient last-updated with a
    // pile of feature commits must not block a PR from docs-check anymore.
    fixture = withDocsDir(createGitFixture());
    fixture.commit('seed: progress.md from 2020', {
      'docs/progress.md': makeProgress('2020-01-01'),
    });
    fixture.commit('feat: a real feature commit long after the cursor date');
    const { exitCode, stdout } = spawnScript(SCRIPT, [fixture.dir, '--json']);
    const errs = JSON.parse(stdout).errors;
    expect(errs.filter((e) => e.category === 'progress-frontmatter').length).toBe(0);
    expect(errs.filter((e) => e.category === 'progress-stale').length).toBe(0);
    expect(exitCode).toBe(0);
  });

  it('FAILs when last-updated frontmatter is missing or malformed', () => {
    fixture = withDocsDir(createGitFixture());
    fixture.commit('seed', { 'docs/progress.md': '# Progress\n\nno frontmatter\n' });
    const { exitCode, stdout } = spawnScript(SCRIPT, [fixture.dir, '--json']);
    expect(exitCode).toBe(1);
    const fm = JSON.parse(stdout).errors.filter((e) => e.category === 'progress-frontmatter');
    expect(fm.length).toBe(1);
    expect(fm[0].message).toMatch(/missing or has a malformed/);
  });

  it('passes silently when progress.md does not exist (pre-foundation builds)', () => {
    fixture = createGitFixture();
    fixture.commit('seed: no progress.md yet');
    const { exitCode } = spawnScript(SCRIPT, [fixture.dir, '--json']);
    expect(exitCode).toBe(0);
  });
});

describe('docs-check — decisions.md supersede chain', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  // A decisions.md note. Pass null for a field to omit it. The partial fields
  // take a RAW value (for example '`old` (fill axis only)') so malformed ones
  // can be exercised too.
  function note(
    slug,
    {
      status = 'accepted',
      supersedes = null,
      supersededBy = null,
      partiallySupersedes = null,
      partiallySupersededBy = null,
      body = 'Body prose.',
    } = {},
  ) {
    let out = `## decision-id: ${slug}\n\n**date**: 2026-07-30\n`;
    if (status !== null) out += `**status**: ${status}\n`;
    if (supersedes) out += `**supersedes**: \`${supersedes}\`\n`;
    if (supersededBy) out += `**superseded-by**: \`${supersededBy}\`\n`;
    if (partiallySupersedes) out += `**partially-supersedes**: ${partiallySupersedes}\n`;
    if (partiallySupersededBy) out += `**partially-superseded-by**: ${partiallySupersededBy}\n`;
    return `${out}\n${body}\n\n`;
  }

  const write = (body) => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-decisions-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(join(dir, 'docs/decisions.md'), `# Decision notes\n\n${body}`);
    return spawnScript(SCRIPT, [dir, '--json']);
  };

  const chainErrors = (stdout) =>
    (JSON.parse(stdout).errors || []).filter((e) => e.category === 'decisions-supersede-chain');

  it('passes on a fully-formed supersede pair', () => {
    const { exitCode } = write(
      note('old-one', { status: 'superseded', supersededBy: 'new-one' }) +
        note('new-one', { supersedes: 'old-one' }),
    );
    expect(exitCode).toBe(0);
  });

  it('passes on notes with no supersede relationship at all', () => {
    const { exitCode } = write(note('a') + note('b'));
    expect(exitCode).toBe(0);
  });

  // The failure this gate exists for: the ritual is a three-part edit, and
  // forgetting the status flip leaves a note claiming to be live when it isn't.
  it('FAILs when the superseded note still reads `accepted`', () => {
    const { exitCode, stdout } = write(
      note('old-one', { status: 'accepted', supersededBy: 'new-one' }) +
        note('new-one', { supersedes: 'old-one' }),
    );
    expect(exitCode).toBe(1);
    const messages = chainErrors(stdout)
      .map((e) => e.message)
      .join('\n');
    expect(messages).toMatch(/flip it to/);
    // ...and routes the author to the partial fields, since "only part of it
    // was replaced" is the other thing this shape can mean.
    expect(messages).toMatch(/partially-supersedes/);
  });

  it('FAILs when the back-pointer is missing (asymmetric chain)', () => {
    const { exitCode, stdout } = write(
      note('old-one', { status: 'superseded' }) + note('new-one', { supersedes: 'old-one' }),
    );
    expect(exitCode).toBe(1);
    expect(
      chainErrors(stdout)
        .map((e) => e.message)
        .join('\n'),
    ).toMatch(/superseded-by.*is missing/);
  });

  it('FAILs when `supersedes` points at a slug that does not exist', () => {
    const { exitCode, stdout } = write(note('new-one', { supersedes: 'ghost-slug' }));
    expect(exitCode).toBe(1);
    expect(chainErrors(stdout)[0].message).toMatch(/not a decision note in this file/);
  });

  it('FAILs when `superseded-by` points at a slug that does not exist', () => {
    const { exitCode, stdout } = write(
      note('old-one', { status: 'superseded', supersededBy: 'ghost-slug' }),
    );
    expect(exitCode).toBe(1);
    expect(chainErrors(stdout)[0].message).toMatch(/not a decision note in this file/);
  });

  it('FAILs on an invalid status enum value', () => {
    const { exitCode, stdout } = write(note('a', { status: 'kinda-accepted' }));
    expect(exitCode).toBe(1);
    expect(chainErrors(stdout)[0].message).toMatch(/invalid status "kinda-accepted"/);
  });

  it('FAILs on a missing status field', () => {
    const { exitCode, stdout } = write(note('a', { status: null }));
    expect(exitCode).toBe(1);
    expect(chainErrors(stdout)[0].message).toMatch(/missing a `\*\*status\*\*:` field/);
  });

  it('FAILs on a self-supersede', () => {
    const { exitCode, stdout } = write(note('a', { supersedes: 'a' }));
    expect(exitCode).toBe(1);
    expect(chainErrors(stdout)[0].message).toMatch(/supersedes itself/);
  });

  // The Format section of decisions.md shows the schema inside a fence.
  it('ignores note-shaped lines inside code fences', () => {
    const { exitCode } = write(
      '```markdown\n## decision-id: example\n\n**status**: not-a-real-status\n```\n\n' + note('a'),
    );
    expect(exitCode).toBe(0);
  });

  it('ignores note-shaped lines inside tilde fences', () => {
    const { exitCode } = write(
      '~~~markdown\n## decision-id: example\n\n**status**: not-a-real-status\n~~~\n\n' + note('a'),
    );
    expect(exitCode).toBe(0);
  });

  // Fields live in the header block only. Body prose that happens to begin
  // with `**status**:` used to be read as a field and, last-write-wins,
  // silently override the real one.
  it('does not read body prose beginning with `**status**:` as a field', () => {
    const { exitCode } = write(
      note('a', { body: 'Prose about the rule:\n**status**: one of accepted, superseded.' }),
    );
    expect(exitCode).toBe(0);
  });

  it('passes silently when decisions.md does not exist', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-decisions-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    const { exitCode } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(0);
  });

  // Slugs are stable references. A duplicate used to silently shadow the first
  // note, which then misattributed every downstream pointer error.
  it('FAILs on a duplicate decision-id', () => {
    const { exitCode, stdout } = write(note('dup') + note('dup'));
    expect(exitCode).toBe(1);
    expect(chainErrors(stdout)[0].message).toMatch(/duplicates the decision-id/);
  });

  // Two `**supersedes**:` lines used to mean "last one wins", so the first
  // predecessor went entirely unvalidated.
  it('FAILs when a field is declared twice', () => {
    const { exitCode, stdout } = write(
      note('old-one') +
        note('new-one', { supersedes: 'old-one' }).replace(
          '**supersedes**: `old-one`',
          '**supersedes**: `old-one`\n**supersedes**: `other`',
        ),
    );
    expect(exitCode).toBe(1);
    expect(
      chainErrors(stdout)
        .map((e) => e.message)
        .join('\n'),
    ).toMatch(/declares `\*\*supersedes\*\*:` more than once/);
  });

  // The mirror image of the "still reads accepted" break: the status flip was
  // applied but neither pointer was, so the note says it was replaced without
  // saying by what.
  it('FAILs when a `superseded` note records no successor', () => {
    const { exitCode, stdout } = write(note('a', { status: 'superseded' }) + note('b'));
    expect(exitCode).toBe(1);
    expect(chainErrors(stdout)[0].message).toMatch(/records no `\*\*superseded-by\*\*:` pointer/);
  });

  // Errors point at the offending field, not the note heading. The body is
  // "# Decision notes" + blank, so the note starts on line 3 and its
  // `**status**:` lands on line 6.
  it('reports the offending field line, not the heading line', () => {
    const { stdout } = write(note('a', { status: 'bogus' }));
    expect(chainErrors(stdout)[0].message).toMatch(/\(line 6\)/);
  });

  describe('withdrawn is terminal', () => {
    it('passes for a withdrawn note with no pointers', () => {
      const { exitCode } = write(note('a', { status: 'withdrawn' }));
      expect(exitCode).toBe(0);
    });

    // Withdrawn and superseded are different fates, so the advice here must
    // not be the usual "flip it to `superseded`".
    it('FAILs when a supersede target is withdrawn', () => {
      const { exitCode, stdout } = write(
        note('old-one', { status: 'withdrawn', supersededBy: 'new-one' }) +
          note('new-one', { supersedes: 'old-one' }),
      );
      expect(exitCode).toBe(1);
      const messages = chainErrors(stdout)
        .map((e) => e.message)
        .join('\n');
      expect(messages).toMatch(/is `withdrawn` — withdrawn and superseded are different fates/);
      expect(messages).not.toMatch(/flip it to/);
    });

    it('FAILs when a withdrawn note declares `supersedes`', () => {
      const { exitCode, stdout } = write(
        note('old-one', { status: 'superseded', supersededBy: 'new-one' }) +
          note('new-one', { status: 'withdrawn', supersedes: 'old-one' }),
      );
      expect(exitCode).toBe(1);
      expect(
        chainErrors(stdout)
          .map((e) => e.message)
          .join('\n'),
      ).toMatch(/is `withdrawn` but declares `\*\*supersedes\*\*:`/);
    });
  });

  // Mirrors the ADR convention (0003/0004, 0008/0011): when only part of a
  // record is replaced, BOTH stay `accepted` because both are still live.
  describe('partial supersede', () => {
    it('passes on a symmetric, scoped pair with both notes accepted', () => {
      const { exitCode } = write(
        note('old-one', { partiallySupersededBy: '`new-one` (fill axis only)' }) +
          note('new-one', { partiallySupersedes: '`old-one` (fill axis only)' }),
      );
      expect(exitCode).toBe(0);
    });

    it('coexists with a later full supersede of the same note', () => {
      const { exitCode } = write(
        note('old-one', {
          status: 'superseded',
          supersededBy: 'newest',
          partiallySupersededBy: '`mid` (logging only)',
        }) +
          note('mid', { partiallySupersedes: '`old-one` (logging only)' }) +
          note('newest', { supersedes: 'old-one' }),
      );
      expect(exitCode).toBe(0);
    });

    it('FAILs when the pair is asymmetric', () => {
      const { exitCode, stdout } = write(
        note('old-one', { partiallySupersededBy: '`new-one` (fill axis only)' }) + note('new-one'),
      );
      expect(exitCode).toBe(1);
      expect(chainErrors(stdout)[0].message).toMatch(/partial supersedes are symmetric too/);
    });

    // A partial supersede that doesn't say WHICH part moved isn't a usable
    // record: the ADR precedents all carry the annotation.
    it('FAILs when the scope annotation is missing', () => {
      const { exitCode, stdout } = write(
        note('old-one', { partiallySupersededBy: '`new-one`' }) +
          note('new-one', { partiallySupersedes: '`old-one` (fill axis only)' }),
      );
      expect(exitCode).toBe(1);
      expect(
        chainErrors(stdout)
          .map((e) => e.message)
          .join('\n'),
      ).toMatch(/the scope annotation is required/);
    });

    it('FAILs when the target does not exist', () => {
      const { exitCode, stdout } = write(
        note('a', { partiallySupersedes: '`ghost-slug` (some scope)' }),
      );
      expect(exitCode).toBe(1);
      expect(chainErrors(stdout)[0].message).toMatch(/not a decision note in this file/);
    });

    it('FAILs on a self-pointer', () => {
      const { exitCode, stdout } = write(note('a', { partiallySupersedes: '`a` (some scope)' }));
      expect(exitCode).toBe(1);
      expect(chainErrors(stdout)[0].message).toMatch(/points at itself/);
    });

    it('FAILs when the partially-superseded target is withdrawn', () => {
      const { exitCode, stdout } = write(
        note('old-one', {
          status: 'withdrawn',
          partiallySupersededBy: '`new-one` (scope)',
        }) + note('new-one', { partiallySupersedes: '`old-one` (scope)' }),
      );
      expect(exitCode).toBe(1);
      expect(
        chainErrors(stdout)
          .map((e) => e.message)
          .join('\n'),
      ).toMatch(/is `withdrawn` — a withdrawn note has no successor/);
    });
  });
});

describe('docs-check: store listing', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  // The sources the listing's counts are checked against: two languages (plus
  // the code-less "Automatic" entry, which is not a language), two theme presets
  // (plus Custom, which is not a preset) and a 10.7.0 floor.
  const sources = {
    'locale/languages.json': JSON.stringify([
      { code: '', name: 'Automatic' },
      { code: 'en_US', name: 'English' },
      { code: 'fr', name: 'French' },
    ]),
    'settings/settings.json': JSON.stringify([
      {
        title: 'User Interface',
        children: [
          {
            settingName: 'uiTheme',
            options: [{ id: 'jellyrock' }, { id: 'ocean' }, { id: 'custom' }],
          },
        ],
      },
    ]),
    'docs/dev/jellyfin-version-boundaries.yml':
      "floor: '10.7.0'\ntiers:\n  1:\n    minServer: '10.7.0'\n    maxServer: null\n    status: active\n",
  };

  const listing = (onDevice, online) =>
    '# Roku store listing\n\n' +
    (onDevice === null ? '' : '```text store-on-device\n' + onDevice + '\n```\n\n') +
    (online === null ? '' : '```text store-online\n' + online + '\n```\n');

  const run = (onDevice, online) => {
    dir = setup({ ...sources, 'docs/admin/store-listing.md': listing(onDevice, online) });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    const found = JSON.parse(stdout).errors.filter((e) => e.category === 'store-listing');
    return { exitCode, found };
  };

  const good = 'Two languages, two themes. Needs Jellyfin 10.7 or later.';

  it('passes when both blocks fit and every count matches its source', () => {
    const { exitCode, found } = run(good, `${good}\n\n2 languages and two themes.`);
    expect(found).toEqual([]);
    expect(exitCode).toBe(0);
  });

  it('FAILs a block over its limit', () => {
    const { exitCode, found } = run('a'.repeat(301), good);
    expect(exitCode).toBe(1);
    expect(found[0].message).toMatch(/store-on-device is 301 characters, over its limit of 300/);
  });

  it('counts each line break as two characters', () => {
    // 298 letters and one line break: 299 as typed, 300 counted as CRLF, which fits.
    expect(run('a'.repeat(149) + '\n' + 'a'.repeat(149), good).found).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
    // One more letter: 301 counted as CRLF.
    const { found } = run('a'.repeat(150) + '\n' + 'a'.repeat(149), good);
    expect(found[0].message).toMatch(/is 301 characters/);
  });

  it('FAILs a language count that includes the "Automatic" entry', () => {
    const { exitCode, found } = run('3 languages.', good);
    expect(exitCode).toBe(1);
    expect(found[0].message).toMatch(/says 3 languages, but locale\/languages\.json has 2/);
  });

  it('FAILs a theme count, written as a word, that does not match the presets', () => {
    const { exitCode, found } = run('Three themes.', good);
    expect(exitCode).toBe(1);
    expect(found[0].message).toMatch(/says Three themes, but the uiTheme setting has 2 presets/);
  });

  it('FAILs a server version that is not the floor', () => {
    const { exitCode, found } = run('Needs Jellyfin 10.8 or later.', good);
    expect(exitCode).toBe(1);
    expect(found[0].message).toMatch(/says Jellyfin 10\.8, but the supported floor is 10\.7\.0/);
  });

  it('FAILs when a block is missing', () => {
    const { exitCode, found } = run(good, null);
    expect(exitCode).toBe(1);
    expect(found[0].message).toMatch(/no ```text store-online block/);
  });

  it('checks the counts the README cites too', () => {
    dir = setup({ ...sources, 'README.md': '# JellyRock\n\nIn 3 languages and two themes.\n' });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    const found = JSON.parse(stdout).errors.filter((e) => e.category === 'readme-counts');
    expect(exitCode).toBe(1);
    expect(found.map((e) => e.message)).toEqual([
      'README.md says 3 languages, but locale/languages.json has 2',
    ]);
  });

  it('is silent when the repo has no store listing', () => {
    dir = setup(sources);
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    expect(JSON.parse(stdout).errors).toEqual([]);
    expect(exitCode).toBe(0);
  });
});

describe('docs-check: feature pages', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  // What a feature page's frontmatter is checked against: the app's version,
  // the oldest supported server, the plugins page's table and the screenshot list.
  const sources = {
    'package.json': JSON.stringify({ version: '3.2.0' }),
    'docs/dev/jellyfin-version-boundaries.yml': "floor: '10.7.0'\n",
    'docs/user/jellyfin-server-plugins.md':
      '# Jellyfin server plugins\n\n## Supported plugins\n\n| Plugin | What you get |\n| --- | --- |\n' +
      '| [Open Subtitles](https://example.com/os) | Subtitles |\n| [Intro Skipper](https://example.com/is) | Skips |\n',
    'docs/screenshots/screenshots.json': JSON.stringify({ screens: ['home', 'osd'] }),
  };

  const page = (frontmatter) =>
    (frontmatter === null ? '' : `---\n${frontmatter}\n---\n\n`) + '# A feature\n\nBody.\n';

  const run = (frontmatter) => {
    dir = setup({ ...sources, 'docs/user/features/a-feature.md': page(frontmatter) });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    const found = JSON.parse(stdout).errors.filter((e) => e.category === 'feature-frontmatter');
    return { exitCode, found, messages: found.map((e) => e.message).join('\n') };
  };

  const good = [
    'pitch: Skip the intros your server has marked.',
    'since: 2.9.0',
    'server: 10.10.0',
    'plugins: Intro Skipper',
    'screenshots: osd, home',
  ].join('\n');

  it('passes a page whose every field is valid', () => {
    const { exitCode, found } = run(good);
    expect(found).toEqual([]);
    expect(exitCode).toBe(0);
  });

  it('accepts `since: unreleased` and no optional fields', () => {
    expect(run('pitch: Soon.\nsince: unreleased\nserver: 10.7.0').found).toEqual([]);
  });

  it('FAILs a page with no frontmatter', () => {
    const { exitCode, messages } = run(null);
    expect(exitCode).toBe(1);
    expect(messages).toMatch(/has no frontmatter/);
  });

  it('FAILs a missing required field', () => {
    expect(run('pitch: Hi.\nserver: 10.7.0').messages).toMatch(/missing `since:`/);
  });

  it('FAILs an unknown field, so a typo cannot pass', () => {
    expect(run(`${good}\nplugin: Intro Skipper`).messages).toMatch(/unknown field `plugin:`/);
  });

  it('FAILs a pitch over its limit', () => {
    expect(run(good.replace(/^pitch: .*/m, `pitch: ${'a'.repeat(121)}`)).messages).toMatch(
      /pitch is 121 characters, over its limit of 120/,
    );
  });

  it('FAILs a since newer than the app', () => {
    expect(run(good.replace('since: 2.9.0', 'since: 3.3.0')).messages).toMatch(
      /since: 3\.3\.0 is newer than the app \(3\.2\.0\)/,
    );
  });

  it('FAILs a server below the floor', () => {
    expect(run(good.replace('server: 10.10.0', 'server: 10.6.0')).messages).toMatch(
      /server: 10\.6\.0 is older than the supported floor \(10\.7\.0\)/,
    );
  });

  it('FAILs a plugin the plugins page does not list', () => {
    expect(
      run(good.replace('plugins: Intro Skipper', 'plugins: Intro Skipper, Ghost')).messages,
    ).toMatch(/plugin "Ghost" is not a row in docs\/user\/jellyfin-server-plugins\.md/);
  });

  it('FAILs a screenshot key that screenshots.json does not list', () => {
    expect(run(good.replace('screenshots: osd, home', 'screenshots: osd, nope')).messages).toMatch(
      /screenshot "nope" is not in docs\/screenshots\/screenshots\.json/,
    );
  });

  describe('values YAML would misread', () => {
    const pitchOf = (value) => run(good.replace(/^pitch: .*/m, `pitch: ${value}`));

    it('FAILs a value YAML cannot parse, and says why', () => {
      const { messages } = pitchOf('Give JellyRock your own look: pick a color theme.');
      expect(messages).toMatch(/pitch: YAML can't read it \(Nested mappings are not allowed/);
    });

    it('FAILs every value that does not read back unchanged', () => {
      // A hand-kept list of YAML's rules missed the second line of values.
      for (const value of [
        'Pick a theme:',
        '#1 choice',
        '# hash',
        'foo\t#bar',
        ',comma first',
        ']close',
        '}close',
        '.inf',
        '.nan',
        '0x1F',
        '0o17',
        '- one',
        '[one]',
        '"one"',
        '*one',
        '%one',
        '`one`',
        '! bang first',
        'Skip intros #1 and more',
        'true',
        'null',
        '~',
        '10.10',
        '5',
      ]) {
        expect(pitchOf(value).found.filter((e) => e.target === 'pitch').length, value).toBe(1);
      }
    });

    it('says what YAML read instead', () => {
      expect(pitchOf('Skip intros #1 and more').messages).toMatch(
        /pitch: YAML reads it as "Skip intros"; reword it/,
      );
      expect(pitchOf('#1 choice').messages).toMatch(/pitch: YAML reads it as null; reword it/);
    });

    it('names the offending field in a list value', () => {
      const { found } = run(good.replace('screenshots: osd, home', 'screenshots: osd: x, home'));
      expect(found.some((e) => e.target === 'screenshots' && /YAML/.test(e.message))).toBe(true);
    });

    it('FAILs a repeated key, which only the whole page shows', () => {
      const { messages } = run(`${good}\nserver: 10.11.0`);
      expect(messages).toMatch(/YAML can't read the frontmatter \(Map keys must be unique/);
    });

    it('passes values YAML reads back unchanged', () => {
      for (const value of [
        '100% free',
        'key:value no space',
        'C:\\path',
        'SyncPlay (watch together)',
        'Cast, then pause, seek and skip.',
        '3.3.0',
        'yes',
        '-one',
        'Watch together. Join a group',
      ]) {
        expect(pitchOf(value).found, value).toEqual([]);
      }
    });

    it('checks a list as written, however it is spaced', () => {
      expect(run(good.replace('screenshots: osd, home', 'screenshots: osd,home')).found).toEqual(
        [],
      );
    });

    it('still accepts a numeric `highlight:`', () => {
      expect(run(`${good}\nhighlight: 3`).found).toEqual([]);
    });
  });

  describe('what a feature needs on HTTPS', () => {
    const https = 'httpsserver: 10.11.0\nhttpsplugins: Intro Skipper';

    it('accepts the two fields together', () => {
      expect(run(`${good}\n${https}`).found).toEqual([]);
    });

    it('FAILs one without the other', () => {
      for (const line of ['httpsserver: 10.11.0', 'httpsplugins: Intro Skipper']) {
        expect(run(`${good}\n${line}`).messages).toMatch(/set both or neither/);
      }
    });

    it('FAILs a server older than the page server, or not a version', () => {
      expect(run(`${good}\nhttpsserver: 10.9.0\nhttpsplugins: Intro Skipper`).messages).toMatch(
        /httpsserver: 10\.9\.0 is older than server \(10\.10\.0\)/,
      );
      expect(run(`${good}\nhttpsserver: soon\nhttpsplugins: Intro Skipper`).messages).toMatch(
        /httpsserver: soon is not x\.y\.z/,
      );
    });

    it('FAILs a plugin the plugins page does not list', () => {
      expect(run(`${good}\nhttpsserver: 10.11.0\nhttpsplugins: Ghost`).messages).toMatch(
        /plugin "Ghost" is not a row/,
      );
    });
  });

  it('accepts a `highlight:` rank from 1 to 6 and FAILs anything else', () => {
    expect(run(`${good}\nhighlight: 1`).found).toEqual([]);
    expect(run(`${good}\nhighlight: 6`).found).toEqual([]);
    for (const bad of ['yes', '0', '7', '1.5']) {
      expect(run(`${good}\nhighlight: ${bad}`).messages).toMatch(
        new RegExp(`highlight: ${bad.replace('.', '\\.')} is not a whole number from 1 to 6`),
      );
    }
  });

  it('FAILs two pages with the same highlight rank', () => {
    dir = setup({
      ...sources,
      'docs/user/features/a.md': page(`${good}\nhighlight: 2`),
      'docs/user/features/b.md': page(`${good}\nhighlight: 2`),
    });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    const messages = JSON.parse(stdout)
      .errors.filter((e) => e.category === 'feature-frontmatter')
      .map((e) => e.message)
      .join('\n');
    expect(messages).toMatch(/highlight: 2 is also on a\.md/);
    expect(exitCode).toBe(1);
  });

  it('checks only pages in docs/user/features/', () => {
    dir = setup({ ...sources, 'docs/user/app-settings.md': '# App settings\n' });
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    expect(JSON.parse(stdout).errors).toEqual([]);
    expect(exitCode).toBe(0);
  });
});

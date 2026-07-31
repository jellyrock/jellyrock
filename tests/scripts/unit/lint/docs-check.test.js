// Tests for scripts/lint/docs-check.cjs.
//
// Validates: related-files frontmatter paths, markdown links, tech-debt
// anchor refs across docs/architecture/, docs/dev/, docs/decisions.md,
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

describe('docs-check — progress.md frontmatter (structural, not temporal)', () => {
  // Temporal staleness (how OLD last-updated is) is intentionally NOT gated
  // here — it moved to the non-blocking progress-cursor-nudge.cjs + the weekly
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
    // Regression guard: the relocated behavior — an ancient last-updated with a
    // pile of feature commits must NOT block a PR from docs-check anymore.
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

describe('docs-check — signals-backlog schema', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  const SIGNALS_FRONTMATTER = `---\nlast-updated: ${new Date()
    .toISOString()
    .slice(0, 10)}\n---\n# Signals backlog\n\n## Watching\n\n`;

  function makeRow(slug, opts = {}) {
    const o = {
      watching: 'something',
      current: 'v1',
      latest_upstream: 'v2',
      latest_acknowledged: 'v2',
      last_checked: '2026-05-06',
      action_when_moves: 'do thing',
      status: 'watching',
      ...opts,
    };
    let row = `### ${slug}: label\n\n`;
    for (const [k, v] of Object.entries(o)) {
      if (v === null) continue;
      row += `- **${k}**: ${v}\n`;
    }
    return row + '\n';
  }

  it('passes on a well-formed row', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-signals-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(
      join(dir, 'docs/signals-backlog.md'),
      SIGNALS_FRONTMATTER + makeRow('valid-slug'),
    );
    const { exitCode } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(0);
  });

  it('FAILs when a required bullet is missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-signals-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(
      join(dir, 'docs/signals-backlog.md'),
      SIGNALS_FRONTMATTER + makeRow('missing-status', { status: null }),
    );
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    const errs = parsed.errors.filter((e) => e.category === 'signals-schema-invalid');
    expect(errs.length).toBe(1);
    expect(errs[0].message).toMatch(/missing required bullet `\*\*status\*\*`/);
  });

  it('FAILs on an invalid status value', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-signals-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(
      join(dir, 'docs/signals-backlog.md'),
      SIGNALS_FRONTMATTER + makeRow('bad-status', { status: 'wat' }),
    );
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    const errs = parsed.errors.filter((e) => e.category === 'signals-schema-invalid');
    expect(errs.length).toBe(1);
    expect(errs[0].message).toMatch(/invalid status "wat"/);
  });

  it('FAILs on a non-ISO last_checked', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-signals-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(
      join(dir, 'docs/signals-backlog.md'),
      SIGNALS_FRONTMATTER + makeRow('bad-date', { last_checked: 'yesterday' }),
    );
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    const errs = parsed.errors.filter((e) => e.category === 'signals-schema-invalid');
    expect(errs.length).toBe(1);
    expect(errs[0].message).toMatch(/invalid last_checked "yesterday"/);
  });

  it('accepts an optional staleness_days override', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-signals-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(
      join(dir, 'docs/signals-backlog.md'),
      SIGNALS_FRONTMATTER + makeRow('with-override', { staleness_days: '14' }),
    );
    const { exitCode } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(0);
  });

  it('FAILs on a non-positive staleness_days', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-signals-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    writeFileSync(
      join(dir, 'docs/signals-backlog.md'),
      SIGNALS_FRONTMATTER + makeRow('bad-override', { staleness_days: '-1' }),
    );
    const { exitCode, stdout } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(1);
    const parsed = JSON.parse(stdout);
    const errs = parsed.errors.filter((e) => e.category === 'signals-schema-invalid');
    expect(errs.length).toBe(1);
    expect(errs[0].message).toMatch(/invalid staleness_days "-1"/);
  });

  it('ignores schema-shaped lines inside code fences (preamble examples)', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-signals-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    const withFence = `---\nlast-updated: 2026-05-06\n---\n# Signals\n\n## Schema\n\n\`\`\`markdown\n### example: label\n\n- **watching**: stuff\n\`\`\`\n\n## Watching\n\n${makeRow('real-row')}`;
    writeFileSync(join(dir, 'docs/signals-backlog.md'), withFence);
    const { exitCode } = spawnScript(SCRIPT, [dir, '--json']);
    expect(exitCode).toBe(0);
  });

  it('passes silently when signals-backlog.md does not exist', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-signals-'));
    mkdirSync(join(dir, 'docs'), { recursive: true });
    const { exitCode } = spawnScript(SCRIPT, [dir, '--json']);
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
  // take a RAW value (e.g. '`old` (fill axis only)') so malformed ones can be
  // exercised too.
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
  // with `**status**:` used to be read as a field — and, last-write-wins,
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

    // Withdrawn and superseded are different fates — so the advice here must
    // NOT be the usual "flip it to `superseded`".
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
    // record — both ADR precedents carry the annotation.
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

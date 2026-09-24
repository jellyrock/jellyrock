/**
 * Unit tests for the PR-description gate.
 *
 * The load-bearing case is `the shipped template fails`: this check only earns its CI
 * slot if an unedited template is red. If the template ever drifts into a shape that
 * passes — a placeholder that reads as prose, a pre-ticked box — the gate silently
 * becomes decorative and nothing else in the repo would notice. That test reads the
 * REAL file rather than a fixture copy, so template edits are what break it.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkIssueRefs,
  checkPrBody,
  issueRefs,
  listIssueRefs,
  sectionBody,
  stripComments,
} from '../../../../scripts/lint/pr-body-check.js';
import { spawnScript } from '../_helpers/spawn-script.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = resolve(HERE, '../../../../.github/pull_request_template.md');

/** A body that answers every section — the shape `/pr` renders. */
const FILLED = `# Overview

Stops the router retaining screens the user backed out of.

## Changes

- Move three routes from \`keepAlive\` to \`suspendMode: "detach"\`

## Follow-ups

None

## Issues

Ref #728
`;

describe('checkPrBody', () => {
  it('passes a fully answered description', () => {
    expect(checkPrBody(FILLED)).toEqual([]);
  });

  it('fails the shipped template — the gate is pointless if this ever passes', () => {
    const problems = checkPrBody(readFileSync(TEMPLATE, 'utf8'));
    expect(problems.length).toBeGreaterThan(0);
    // Named explicitly: these are the sections the template ships unanswered, and a
    // template change that fills one should force a deliberate update here.
    expect(problems.join('\n')).toMatch(/# Overview/);
    expect(problems.join('\n')).toMatch(/## Changes/);
    // The optional sections ship as headings with only a hint: left like that, they
    // would put empty headings in `git log`, so they fail until filled or deleted.
    expect(problems.join('\n')).toMatch(/## Testing/);
    expect(problems.join('\n')).toMatch(/## Issues/);
  });

  it('rejects an empty body outright', () => {
    expect(checkPrBody('')).toHaveLength(1);
    expect(checkPrBody(null)[0]).toMatch(/empty/);
  });

  it('does not accept a bare "-" as a change', () => {
    const problems = checkPrBody(
      FILLED.replace('- Move three routes from `keepAlive` to `suspendMode: "detach"`', '-'),
    );
    expect(problems.join('\n')).toMatch(/## Changes/);
  });

  it('accepts "None" as a real answer for Follow-ups and Issues', () => {
    expect(checkPrBody(FILLED.replace('Ref #728', 'None'))).toEqual([]);
  });

  it('reports a required section that was deleted rather than filled', () => {
    const problems = checkPrBody(
      FILLED.replace(
        '## Changes\n\n- Move three routes from `keepAlive` to `suspendMode: "detach"`\n\n',
        '',
      ),
    );
    expect(problems.join('\n')).toMatch(/"## Changes" section is missing/);
  });

  it('lets an optional section be left out', () => {
    const body = FILLED.replace('## Follow-ups\n\nNone\n\n', '').replace(
      '## Issues\n\nRef #728\n',
      '',
    );
    expect(body).not.toMatch(/## Issues|## Follow-ups/);
    expect(checkPrBody(body)).toEqual([]);
  });

  it('fails an optional section left as an empty heading', () => {
    const problems = checkPrBody(
      `${FILLED}\n## Testing\n\n<!-- Optional: how you verified it -->\n`,
    );
    expect(problems.join('\n')).toMatch(/"## Testing" is empty/);
  });

  // A PR opened on the previous template still carries the Docs checklist; it must not
  // go red the day this check changes.
  it('still passes a body written on the previous template', () => {
    const legacy = `${FILLED}\n## Docs / context updates\n\n- [ ] None — this PR doesn't change any of the above\n`;
    expect(checkPrBody(legacy)).toEqual([]);
  });

  it('ignores content that lives only inside HTML comments', () => {
    const commentedOut = FILLED.replace(
      'Stops the router retaining screens the user backed out of.',
      '<!-- Stops the router retaining screens the user backed out of. -->',
    );
    expect(checkPrBody(commentedOut).join('\n')).toMatch(/# Overview/);
  });
});

describe('sectionBody', () => {
  it('stops at the next heading', () => {
    expect(sectionBody(FILLED, '## Follow-ups').trim()).toBe('None');
  });

  it('returns null for an absent heading', () => {
    expect(sectionBody(FILLED, '## Nope')).toBeNull();
  });

  // Regression: the template's `# Overview` is an h1 and every other section an h2, so
  // the markdown "same or higher level" rule never closed it — Overview absorbed the
  // whole document and inherited another section's content, so it could never be
  // reported empty. Any heading must close a section.
  it('closes a section at the next heading of ANY level', () => {
    const doc = '# Overview\n\n## Changes\n\n- a real change\n';
    expect(sectionBody(doc, '# Overview').trim()).toBe('');
    expect(checkPrBody(doc).join('\n')).toMatch(/# Overview/);
  });
});

describe('stripComments', () => {
  it('removes multi-line comments', () => {
    expect(stripComments('a\n<!-- one\ntwo -->\nb').replace(/\n+/g, '\n')).toBe('a\nb');
  });
});

// The shapes below are the real ones: #940 / #1000 / #1002 wrote Jellyfin's issues as the
// unlinked shorthand, and #1016's "legacy PR #669" linked to our own unrelated #669.
describe('issueRefs', () => {
  it('sorts references by the form GitHub reads them in', () => {
    const refs = issueRefs(
      'Adds creators (jellyfin#17107) as the legacy app did (jellyfin-archive/jellyfin-roku-legacy#669); Ref #988.',
    );
    expect(refs).toEqual({
      shorthand: ['jellyfin#17107'],
      qualified: ['jellyfin-archive/jellyfin-roku-legacy#669'],
      bare: [988],
    });
  });

  it('reads a bare #N after a repo name as bare — that is the #1016 mis-link', () => {
    expect(issueRefs('from jellyfin-roku-legacy PR #669').bare).toEqual([669]);
  });

  // One case per test, so no case can hide another: a single joined fixture once put
  // every later case inside an unclosed fence, where they passed without being read.
  // Each shape renders unlinked through GitHub's renderer (`gh api markdown`, mode gfm,
  // context jellyrock/jellyrock, 2026-09-23).
  it.each([
    ['an inline code span', 'see `jellyfin#1` here'],
    ['a code span with a longer backtick run', 'see ``C#10 and `jellyfin#1` `` here'],
    ['a code span over a line break', 'see `a\njellyfin#1` here'],
    ['a backtick fence', 'text\n```\njellyfin#2\n```\ntext'],
    ['a tilde fence', 'text\n~~~\njellyfin#2\n~~~\ntext'],
    ['a longer fence that contains a shorter one', '````\njellyfin#2\n```\njellyfin#3\n````'],
    ['an unclosed fence, which runs to the end', 'text\n```\njellyfin#2'],
    ['a code span at the start of a line, not a fence', '```jellyfin#1```\nnext'],
    ['a <pre> element', '<pre>jellyfin#4</pre>'],
    ['a <code> element', 'a <code>jellyfin#5</code> b'],
    ['an HTML comment', '<!-- jellyfin#3 -->'],
    ['a markdown link', '[jellyfin-web#8209](https://github.com/jellyfin/jellyfin-web/pull/8209)'],
    ['a bare URL', 'https://example.com/docs?page#12'],
    ['an escaped reference', 'Renovate writes #&#8203;433 to stop a link'],
    ['a heading', '## Changes'],
  ])('ignores %s', (_label, text) => {
    expect(issueRefs(text)).toEqual({ shorthand: [], qualified: [], bare: [] });
  });

  // Shapes that look like code to a regex but are text to GitHub, which links them
  // (same renderer check): removing them would hide real references.
  it.each([
    ['a four-space paragraph under a list item', '- item\n\n    jellyfin#6 nested'],
    ['backticks that open mid-line, before a fence line', 'x and ```\njellyfin#2\n``` y'],
    ['a code span broken by a blank line', 'x `a\n\njellyfin#3 b`'],
    ['the line after a backtick span that starts a line', '```code```\nthen jellyfin#2'],
  ])('still reads %s', (_label, text) => {
    expect(issueRefs(text).shorthand.length).toBe(1);
  });

  it('lists each reference once', () => {
    expect(issueRefs('#5, #5 and jellyfin#7 twice: jellyfin#7').bare).toEqual([5]);
    expect(issueRefs('jellyfin#7 twice: jellyfin#7').shorthand).toEqual(['jellyfin#7']);
  });
});

describe('checkIssueRefs', () => {
  it('flags a shorthand reference with the owner/repo form to use', () => {
    const [problem] = checkIssueRefs('saved per version (jellyfin#17044)');
    expect(problem).toContain('"jellyfin#17044" is not a link');
    expect(problem).toContain('owner/repo#17044');
  });

  // Each of these rendered as plain text through GitHub's own renderer (`gh api markdown`,
  // mode gfm, context jellyrock/jellyrock, 2026-09-23), so failing them is right; the
  // message must not assume the word before `#` is a repo.
  it.each(['PR#123', 'issue#12', 'C#10', 'v2.2.5#3', 'CHANGELOG.md#399'])(
    'flags %s with every form that links and the backtick escape',
    (text) => {
      const [problem] = checkIssueRefs(text);
      const n = text.slice(text.indexOf('#'));
      expect(problem).toContain(`"${text}" is not a link`);
      expect(problem).toContain(`only ${n} (this repo's issue), owner/repo${n} or a URL`);
      expect(problem).toContain('put it in backticks');
    },
  );

  it('passes bare and fully qualified references', () => {
    expect(checkIssueRefs('Fixes #12, see jellyfin/jellyfin#17044')).toEqual([]);
  });
});

describe('listIssueRefs', () => {
  const known = {
    'this#669': { type: 'issue', state: 'open', title: 'Cast to JellyRock' },
    'jellyfin-archive/jellyfin-roku-legacy#669': {
      type: 'pull request',
      state: 'closed',
      title: 'Auto Reload LiveTv when feed Errors',
    },
  };
  const resolve = (repo, n) => known[`${repo ?? 'this'}#${n}`] ?? null;

  it("prints each bare #N with our issue's title, so a mis-link is visible", () => {
    const { lines, failed } = listIssueRefs('from jellyfin-roku-legacy PR #669', resolve);
    expect(lines).toEqual(['  #669 — issue (open): Cast to JellyRock']);
    expect(failed).toBe(false);
  });

  it('confirms a qualified reference exists in its repo', () => {
    const { lines, failed } = listIssueRefs('jellyfin-archive/jellyfin-roku-legacy#669', resolve);
    expect(lines[0]).toContain('pull request (closed): Auto Reload LiveTv');
    expect(failed).toBe(false);
  });

  it('fails a reference that does not exist, and a shorthand one', () => {
    expect(listIssueRefs('Jellyfin #17107', resolve).failed).toBe(true);
    expect(listIssueRefs('jellyfin/jelyfin#669', resolve).failed).toBe(true);
    expect(listIssueRefs('jellyfin#17107', resolve).failed).toBe(true);
  });

  it('reports an unresolvable reference without failing', () => {
    const offline = () => {
      throw new Error('error connecting to api.github.com');
    };
    const { lines, failed } = listIssueRefs('#5', offline);
    expect(lines[0]).toContain('could not resolve (error connecting to api.github.com)');
    expect(failed).toBe(false);
  });
});

// The CLI is what CI and /pr actually run, so its wiring is gated here, not only the
// helpers: dropping the reference check from main(), leaving the title out of it, or
// letting --list-refs exit 0 must each fail. No case below reaches `gh`: CI mode never
// resolves, and the --list-refs inputs carry no bare or qualified reference.
describe('pr-body-check CLI', () => {
  const SCRIPT = 'scripts/lint/pr-body-check.js';
  const ciRun = ({ title = 'fix: Keep the router from retaining screens', body = FILLED } = {}) =>
    spawnScript(
      SCRIPT,
      [
        '--pr-title',
        title,
        '--pr-author',
        'contributor',
        '--pr-labels',
        'bug-fix',
        '--pr-head-ref',
        'fix/router',
      ],
      { env: { PR_BODY: body } },
    );
  const listRefs = (input) =>
    spawnScript(SCRIPT, ['--list-refs', '--pr-title', 'fix: x'], { input });

  it('passes a filled body with no shorthand reference', () => {
    const { exitCode, stdout } = ciRun();
    expect(exitCode).toBe(0);
    expect(stdout).toContain('PR title has a changelog type');
    expect(stdout).toContain('PR description is filled in');
  });

  it('fails a title with no type, and lists the types', () => {
    const { exitCode, stderr } = ciRun({ title: 'Keep the router from retaining screens' });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('the PR title has no type');
    expect(stderr).toMatch(/Fixed: fix,/);
  });

  // The title reaches CHANGELOG.md even when the description check is skipped.
  it('checks the title of a documentation-labelled PR', () => {
    const { exitCode, stderr } = spawnScript(
      SCRIPT,
      [
        '--pr-title',
        'Tidy the README',
        '--pr-author',
        'contributor',
        '--pr-labels',
        'documentation',
      ],
      { env: { PR_BODY: '' } },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain('the PR title has no type');
  });

  it('--body-file checks a rendered body the way CI checks PR_BODY', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pr-body-'));
    const file = join(dir, 'body.md');
    writeFileSync(file, FILLED);
    const ok = spawnScript(SCRIPT, ['--pr-title', 'fix: x', '--body-file', file]);
    expect(ok.exitCode).toBe(0);
    writeFileSync(file, '# Overview\n\n## Changes\n\n-\n');
    const bad = spawnScript(SCRIPT, ['--pr-title', 'fix: x', '--body-file', file]);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toContain('"## Changes" is empty');
    rmSync(dir, { recursive: true, force: true });
  });

  it('skips a bot PR entirely', () => {
    const { exitCode, stdout } = spawnScript(
      SCRIPT,
      ['--pr-title', 'Prepare for v2.33.0 release', '--pr-author', 'app/jellyrock'],
      { env: { PR_BODY: '' } },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain('skipped');
  });

  it('fails a shorthand reference in the body', () => {
    const { exitCode, stderr } = ciRun({ body: `${FILLED}\nSee jellyfin#17107.\n` });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('"jellyfin#17107" is not a link');
  });

  it('fails a shorthand reference in the title, which becomes the squash commit subject', () => {
    const { exitCode, stderr } = ciRun({ title: 'fix: Match the server (jellyfin#17107)' });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('"jellyfin#17107" is not a link');
  });

  it('--list-refs exits 1 on a shorthand reference', () => {
    const { exitCode, stdout } = listRefs('Matches jellyfin#17107.');
    expect(exitCode).toBe(1);
    expect(stdout).toContain('"jellyfin#17107" is not a link');
  });

  it('--list-refs exits 0 when there is nothing to confirm', () => {
    const { exitCode, stdout } = listRefs('No references here.');
    expect(exitCode).toBe(0);
    expect(stdout).toContain('(no issue references)');
  });
});

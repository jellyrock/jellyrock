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
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkIssueRefs,
  checkPrBody,
  issueRefs,
  listIssueRefs,
  sectionBody,
  stripComments,
} from '../../../../scripts/lint/pr-body-check.js';

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

## Docs / context updates

- [x] **Architecture doc** updated
- [ ] None — this PR doesn't change any of the above
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
    expect(problems.join('\n')).toMatch(/## Docs \/ context updates/);
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

  it('does not accept an all-unticked checklist', () => {
    const problems = checkPrBody(
      FILLED.replace('- [x] **Architecture doc** updated', '- [ ] **Architecture doc** updated'),
    );
    expect(problems.join('\n')).toMatch(/## Docs \/ context updates/);
  });

  it('accepts "None" as a real answer for Follow-ups and Issues', () => {
    expect(checkPrBody(FILLED.replace('Ref #728', 'None'))).toEqual([]);
  });

  it('reports a section that was deleted rather than filled', () => {
    const problems = checkPrBody(FILLED.replace('## Issues\n\nRef #728\n\n', ''));
    expect(problems.join('\n')).toMatch(/"## Issues" section is missing/);
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

  it('ignores code, comments, links, URLs and escaped references', () => {
    const refs = issueRefs(
      [
        '`jellyfin#1` and ```\njellyfin#2\n```',
        '<!-- jellyfin#3 -->',
        '[jellyfin-web#8209](https://github.com/jellyfin/jellyfin-web/pull/8209)',
        'https://github.com/prettier/prettier/blob/HEAD/CHANGELOG.md#399',
        '([#&#8203;433](https://redirect.github.com/rokucommunity/rooibos/pull/433))',
        '## Changes',
      ].join('\n'),
    );
    expect(refs).toEqual({ shorthand: [], qualified: [], bare: [] });
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

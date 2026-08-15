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
import { checkPrBody, sectionBody, stripComments } from '../../../../scripts/lint/pr-body-check.js';

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

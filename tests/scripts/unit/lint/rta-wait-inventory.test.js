// Tests for scripts/lint/rta-wait-inventory.js — the gate that keeps the wait inventory in
// tests/rta/CLAUDE.md matching the suite.
//
// Two halves are tested here and they are tested differently on purpose:
//
//   - `classifyWait` is the SHARED ladder, and the reason it was extracted was so the gate
//     and the checker cannot classify a wait differently. So the cases below are the five
//     categories, asserted against the exported function directly — if this drifts from
//     rta-wait-justified.test.js's expectations, the two consumers have diverged, which is
//     the failure the extraction exists to prevent.
//   - `publishedCounts` / `extractBlock` are the DOC parsers, and their failure mode is
//     silent: a parser that matches nothing reports "0 rows" rather than a wrong number, so
//     the cases pin the shapes that must and must not be picked up.
//
// The end-to-end count (does the real doc match the real suite?) is deliberately NOT here —
// it needs ESLint over the whole tree, which is `npm run lint:rta-waits`'s job and has a CI
// home of its own. Duplicating it in a unit test would double a slow check for no signal.

import { describe, it, expect } from 'vitest';
import { Linter } from 'eslint';
import {
  classifyWait,
  WAIT_CATEGORIES,
} from '../../../../scripts/lint/eslint-rules/rta-wait-justified.js';
import { publishedCounts, extractBlock } from '../../../../scripts/lint/rta-wait-inventory.js';

// Driven through ESLint's own Linter rather than a parser of our own. `espree` is one of
// eslint's transitive dependencies, not one of ours, so importing it directly is what
// `n/no-extraneous-import` exists to stop — and going through the Linter is the better test
// anyway: `classifyWait` sees exactly the node shapes it will see in production, from the
// same parser at the same `ecmaVersion` the rule runs under.
const linter = new Linter();

/** The category `classifyWait` assigns the first `waitFor`-shaped call in `code`, or null. */
function categoryOf(code) {
  const probe = {
    meta: { schema: [], messages: { at: '{{category}}' } },
    create: (context) => ({
      CallExpression(node) {
        const verdict = classifyWait(node);
        if (verdict) {
          context.report({ node, messageId: 'at', data: { category: verdict.category } });
        }
      },
    }),
  };
  const messages = linter.verify(code, {
    plugins: { probe: { rules: { classify: probe } } },
    rules: { 'probe/classify': 'error' },
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
  });
  return messages[0]?.message ?? null;
}

describe('classifyWait — the ladder the rule and the checker share', () => {
  it('is null for a call that is not a waitFor, so the checker counts nothing else', () => {
    expect(categoryOf(`getVal('#osd.visible')`)).toBe(null);
    expect(categoryOf(`waitFocused((f) => true)`)).toBe(null);
  });

  it('is null for a bare `waitFor()` — no arguments means nothing to classify', () => {
    expect(categoryOf(`waitFor()`)).toBe(null);
  });

  it('reports ACT before it looks at the keyPath at all', () => {
    // The order matters and is the rule's: an `action` justifies the wait whatever the
    // keyPath is, including one that would otherwise be UNVERIFIED.
    expect(categoryOf(`waitFor('#never.verified', (v) => v === 1, { action: resend() })`)).toBe(
      WAIT_CATEGORIES.ACT,
    );
  });

  it('reports DYN for an interpolated keyPath, which no allowlist could cover', () => {
    expect(categoryOf('waitFor(`${list}.rowItemFocused`, (v) => v)')).toBe(WAIT_CATEGORIES.DYN);
  });

  it('reports FN for a function keyPath — ODC observes a field, not a call', () => {
    expect(categoryOf(`waitFor('#x.content.getChildCount()', hasChildren)`)).toBe(
      WAIT_CATEGORIES.FN,
    );
  });

  it('reports ABS when the predicate tests for a departed node', () => {
    expect(categoryOf(`waitFor('#jrDialog.id', (v) => v === undefined)`)).toBe(WAIT_CATEGORIES.ABS);
  });

  it('reports SETTLE for an allowlisted field, and UNVERIFIED for one nobody read', () => {
    expect(categoryOf(`waitFor('#osd.visible', (v) => v === true)`)).toBe(WAIT_CATEGORIES.SETTLE);
    expect(categoryOf(`waitFor('#made.up.field', (v) => v === true)`)).toBe(
      WAIT_CATEGORIES.UNVERIFIED,
    );
  });

  it('treats a template literal with no interpolation as the static string it is', () => {
    // Otherwise a keyPath would change category on a purely cosmetic quote swap.
    expect(categoryOf('waitFor(`#osd.visible`, (v) => v === true)')).toBe(WAIT_CATEGORIES.SETTLE);
  });
});

describe('publishedCounts — reading the n column out of the inventory', () => {
  const table = [
    '| Category | n | Why a poll, not an observer |',
    '|---|---|---|',
    '| `FN` Function `keyPath` | 12 | ODC observes a **field**. |',
    '| `SETTLE` Plain field settle | 37 | ruled out below |',
    '| `FOCUS_IDENTITY` Focus identity (`waitFocused`) | 15 | terminal |',
  ].join('\n');

  it('keys on the leading category token, not on the row label', () => {
    // The label is documentation and must stay free to be reworded; the token is the
    // contract. A checker keyed on prose would break on an editorial pass.
    expect(publishedCounts(table)).toEqual({ FN: 12, SETTLE: 37, FOCUS_IDENTITY: 15 });
  });

  it('ignores the header and separator rows rather than reading them as data', () => {
    expect(publishedCounts(table)).not.toHaveProperty('Category');
  });

  it('ignores prose outside the table', () => {
    expect(publishedCounts(`Some text about \`FN\` and 12.\n${table}`)).toEqual({
      FN: 12,
      SETTLE: 37,
      FOCUS_IDENTITY: 15,
    });
  });

  it('skips a row whose n is not a bare integer, rather than guessing at it', () => {
    // "~12" or "12 (was 11)" is a row someone is mid-editing. Silently rounding it would
    // publish a number the gate invented.
    expect(publishedCounts('| `FN` x | ~12 | y |')).toEqual({});
    expect(publishedCounts('| `FN` x | 12 (was 11) | y |')).toEqual({});
  });

  it('skips a row with no category token, so a decorative table cannot be misread', () => {
    expect(publishedCounts('| Function keyPath | 12 | y |')).toEqual({});
  });
});

describe('extractBlock — locating the inventory', () => {
  const START = '<!-- rta-wait-inventory:start -->';
  const END = '<!-- rta-wait-inventory:end -->';

  it('returns only what is between the markers', () => {
    expect(extractBlock(`before${START}INSIDE${END}after`)).toBe('INSIDE');
  });

  it('is null when a marker is missing — the caller must fail, not scan the whole file', () => {
    expect(extractBlock(`no markers here`)).toBe(null);
    expect(extractBlock(`${START} only the opener`)).toBe(null);
  });

  it('is null when the markers are inverted', () => {
    expect(extractBlock(`${END} backwards ${START}`)).toBe(null);
  });
});

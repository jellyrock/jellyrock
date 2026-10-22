// Tests for scripts/lint/rta-wait-inventory.js: the gate that keeps the wait inventory in
// tests/rta/CLAUDE.md matching the suite.
//
// Two halves are tested here and they are tested differently on purpose:
//
//   - `classifyWait` is the SHARED ladder, and the reason it was extracted was so the gate
//     and the checker cannot classify a wait differently. So the cases below are the five
//     categories, asserted against the exported function directly. If this drifts from
//     rta-wait-justified.test.js's expectations, the two consumers have diverged, which is
//     the failure the extraction exists to prevent.
//   - `publishedCategories` / `extractBlock` are the DOC parsers, and their failure mode is
//     silent: a parser that matches nothing reports "0 rows" rather than a wrong answer, so
//     the cases pin the shapes that must and must not be picked up. `inventoryProblems` is
//     the pure check on top of them.
//
// Whether the real doc has a row for every category is not asserted here, on purpose: that
// is `npm run lint:rta-waits`'s job and it has a CI home of its own. The one run of the CLI
// below checks only the shape of `--json`, because the live counts need ESLint over the tree.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { Linter } from 'eslint';
import {
  classifyWait,
  WAIT_CATEGORIES,
} from '../../../../scripts/lint/eslint-rules/rta-wait-justified.js';
import {
  publishedCategories,
  inventoryProblems,
  extractBlock,
  REQUIRED_CATEGORIES,
} from '../../../../scripts/lint/rta-wait-inventory.js';

// Driven through ESLint's own Linter rather than a parser of our own. `espree` is one of
// eslint's transitive dependencies, not one of ours, so importing it directly is what
// `n/no-extraneous-import` exists to stop, and going through the Linter is the better test
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

describe('publishedCategories — reading the row tokens out of the inventory', () => {
  const table = [
    '| Category | Why a poll, not an observer |',
    '|---|---|',
    '| `FN` Function `keyPath` | ODC observes a **field**. |',
    '| `SETTLE` Plain field settle | ruled out below |',
    '| `FOCUS_IDENTITY` Focus identity (`waitFocused`) | terminal |',
  ].join('\n');

  it('keys on the leading category token, not on the row label', () => {
    // The label is documentation and must stay free to be reworded; the token is the
    // contract. A checker keyed on prose would break on an editorial pass.
    expect(publishedCategories(table)).toEqual(['FN', 'SETTLE', 'FOCUS_IDENTITY']);
  });

  it('ignores the header and separator rows rather than reading them as data', () => {
    expect(publishedCategories(table)).not.toContain('Category');
  });

  it('ignores prose outside the table', () => {
    expect(publishedCategories(`Some text about \`FN\` and 12.\n${table}`)).toEqual([
      'FN',
      'SETTLE',
      'FOCUS_IDENTITY',
    ]);
  });

  it('skips a row with no category token, so a decorative table cannot be misread', () => {
    expect(publishedCategories('| Function keyPath | y |')).toEqual([]);
  });

  it('does not read a token from a later cell', () => {
    expect(publishedCategories('| Function keyPath | `FN` |')).toEqual([]);
  });
});

describe('inventoryProblems — what the gate fails on', () => {
  // Derived the same way the gate derives it, so this test cannot drift from the module.
  const allRows = [...REQUIRED_CATEGORIES];
  const actual = Object.fromEntries(allRows.map((k) => [k, 1]));

  it('requires every wait category but UNVERIFIED, plus the focus rows', () => {
    expect(REQUIRED_CATEGORIES).not.toContain(WAIT_CATEGORIES.UNVERIFIED);
    for (const c of Object.values(WAIT_CATEGORIES)) {
      if (c !== WAIT_CATEGORIES.UNVERIFIED) expect(REQUIRED_CATEGORIES).toContain(c);
    }
    expect(REQUIRED_CATEGORIES).toContain('FOCUS_IDENTITY');
  });

  it('passes a table with no count column when every category has a row', () => {
    const table = allRows.map((k) => `| \`${k}\` label | why |`).join('\n');
    const problems = inventoryProblems({ published: publishedCategories(table), actual });
    expect(problems).toEqual({ missing: [], unknown: [], unverified: 0 });
  });

  it('fails a category with no row', () => {
    const published = allRows.slice(1);
    const problems = inventoryProblems({ published, actual });
    expect(problems.missing).toEqual([allRows[0]]);
  });

  it('fails a row whose token is not a known category', () => {
    const problems = inventoryProblems({ published: [...allRows, 'SETTLEX'], actual });
    expect(problems.unknown).toEqual(['SETTLEX']);
  });

  it('fails a row for UNVERIFIED, which is a failure and never a category', () => {
    const problems = inventoryProblems({ published: [...allRows, 'UNVERIFIED'], actual });
    expect(problems.unknown).toEqual(['UNVERIFIED']);
  });

  it('still fails an unverified wait', () => {
    const problems = inventoryProblems({
      published: allRows,
      actual: { ...actual, UNVERIFIED: 2 },
    });
    expect(problems.unverified).toBe(2);
  });
});

describe('--json — the live counts', () => {
  it('reports the live count per category, plus the problems', () => {
    // The CLI walks the whole tree, so it is run once here rather than mocked: the
    // output shape is the contract `npm run lint:rta-waits -- --json` documents.
    const out = JSON.parse(
      execFileSync('node', ['scripts/lint/rta-wait-inventory.js', '--json'], {
        encoding: 'utf8',
      }),
    );
    expect(Object.keys(out).sort()).toEqual(['actual', 'missing', 'unknown', 'unverified']);
    for (const c of REQUIRED_CATEGORIES) expect(out.actual[c]).toBeGreaterThan(0);
  }, 120_000);
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

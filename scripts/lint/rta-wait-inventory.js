// scripts/lint/rta-wait-inventory.js — keeps the wait inventory in tests/rta/CLAUDE.md
// honest against the waits that actually exist.
//
// WHY THIS EXISTS
// ---------------
// The inventory publishes a count per category, and those counts are the one part of that
// doc nothing derived. `jellyrock-rta/wait-justified` gates the CATEGORIES — a wait may not
// land outside them — but it never counts, so the numbers were maintained by hand against a
// suite that changes every time a nav is added.
//
// They have been wrong seven times. The doc's own note says five, then says the totals were
// "derived from those known deltas rather than re-counted" — and that derivation missed the
// settle site `waitOsdUp` had added earlier in the same branch, publishing 36 where the AST
// says 37. A review pass found that, and found `docs/decisions.md` carrying a SECOND, larger
// wrong figure (101) for the same population. Two documents, two different wrong numbers, in
// one branch. That is not a proofreading failure — it is what an ungated number does.
//
// So the number stops being prose. This is the same answer, and deliberately the same shape,
// as `rta-capability-coverage.cjs` one directory up: markers around the block, a `--check`
// that fails on drift, a `npm run lint:*` entry and a CI home.
//
// WHY IT CHECKS RATHER THAN GENERATES
// -----------------------------------
// The table's value is its "Why a poll, not an observer" column, which is argued prose and
// must stay hand-written. A generator would own the whole table and either clobber that or
// need a templating layer to preserve it. Checking costs one regex and leaves the writing
// alone — and a red gate naming the right number is as actionable as a rewrite.
//
// WHY IT DRIVES ESLINT RATHER THAN WALKING THE AST ITSELF
// -------------------------------------------------------
// The question is "how many waits does the GATE see", so the file set and the classification
// both have to come from the gate. Running ESLint with the repo's own config gets the file
// set for free — including the `tests/rta/**` + `capture-screenshots.js` scope and the
// `*.test.js` exclusion — and `classifyWait` is imported from the rule module itself, so the
// checker cannot classify a wait differently from the rule that polices it. A standalone
// walker would be a second copy of both, and the first thing to drift.
//
// `.js` (ESM) rather than the `.cjs` that `scripts/lint/` mostly uses: it imports the ESM
// rule module, nothing `require()`s it, and `scripts/CLAUDE.md` puts a top-level CLI script
// with no internal callers on ESM by default.
//
// Usage:  node scripts/lint/rta-wait-inventory.js [--json]
// Exit:   0 = inventory matches · 1 = drift (or an unclassifiable wait) · 2 = internal error

import fs from 'node:fs';
import path from 'node:path';
import { ESLint } from 'eslint';
import baseConfig from '../../eslint.config.js';
import rule, { classifyWait, WAIT_CATEGORIES } from './eslint-rules/rta-wait-justified.js';

const DOC_REL = 'tests/rta/CLAUDE.md';
const START = '<!-- rta-wait-inventory:start -->';
const END = '<!-- rta-wait-inventory:end -->';

/**
 * The scope the wait gate covers, restated here because ESLint's `lintFiles` needs targets
 * rather than a config query. The CONFIG still decides what is linted — these are only the
 * directories walked — so a file excluded by `eslint.config.js` stays excluded.
 */
const LINT_TARGETS = ['tests/rta', 'scripts/capture-screenshots.js'];

/**
 * The two helpers that call `waitFocused` internally.
 *
 * A `waitFocused` inside one of these is that row's IMPLEMENTATION, not a site of its own —
 * counting it would report the same wait twice, once under its own row and once under the
 * helper's. Excluding by enclosing function name keeps the published `waitFocused` figure
 * meaning "sites that chose `waitFocused` directly", which is what the row claims.
 */
const FOCUS_WRAPPERS = new Set(['waitFocusInside', 'waitFocusInHomeContent']);

/** The focus helpers counted in their own right, keyed by the inventory row they feed. */
const FOCUS_ROWS = {
  FOCUS_INSIDE: 'waitFocusInside',
  FOCUS_SUBTYPE: 'waitFocusInHomeContent',
  FOCUS_IDENTITY: 'waitFocused',
};

/** Plain name a callee has, or null. Mirrors `_shared.js`'s `calleeName` for one local use. */
function calleeName(node) {
  const callee = node?.callee;
  if (!callee) return null;
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return null;
}

/**
 * A counting ESLint rule. It reports every wait it finds as a message, which is how the
 * counts get out of ESLint without a second traversal of our own — the messages are the
 * tally, and `ruleId` filtering keeps them apart from the real gate's findings.
 */
const counter = {
  meta: { type: 'problem', schema: [], messages: { tally: '{{bucket}}' } },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      CallExpression(node) {
        const verdict = classifyWait(node);
        if (verdict) {
          context.report({ node, messageId: 'tally', data: { bucket: verdict.category } });
          return;
        }
        const name = calleeName(node);
        const row = Object.keys(FOCUS_ROWS).find((k) => FOCUS_ROWS[k] === name);
        if (!row) return;
        if (name === 'waitFocused') {
          const ancestors = sourceCode.getAncestors ? sourceCode.getAncestors(node) : [];
          const enclosing = [...ancestors]
            .reverse()
            .find((a) => a.type === 'FunctionDeclaration' && a.id?.name);
          if (enclosing && FOCUS_WRAPPERS.has(enclosing.id.name)) return;
        }
        context.report({ node, messageId: 'tally', data: { bucket: row } });
      },
    };
  },
};

/** Count every wait the gate can see, bucketed by inventory row. */
export async function countWaits({ cwd = process.cwd(), targets = LINT_TARGETS } = {}) {
  const eslint = new ESLint({
    cwd,
    overrideConfigFile: true,
    overrideConfig: [
      ...baseConfig,
      {
        // The SAME scope the gate is applied under in `eslint.config.js`. Stated rather than
        // inherited because the counting rule is a different plugin: a wider scope would
        // count waits the gate never judged, and a narrower one would under-report.
        files: ['tests/rta/**/*.{js,mjs}', 'scripts/capture-screenshots.js'],
        ignores: ['tests/rta/**/*.test.js'],
        plugins: { 'rta-inventory': { rules: { count: counter } } },
        rules: { 'rta-inventory/count': 'error' },
      },
    ],
  });

  const counts = {};
  for (const result of await eslint.lintFiles(targets)) {
    for (const m of result.messages) {
      if (m.ruleId === 'rta-inventory/count') counts[m.message] = (counts[m.message] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * The `n` published for each row, keyed by the code span that opens its first cell.
 *
 * Keying on an explicit token rather than on the row's prose label is what makes this
 * robust: the label is documentation and should stay free to be reworded, while the token
 * is a contract. The tokens are the rule's own category names, which the gate's messages
 * and its header already speak in — so the table now names the thing that judges it.
 */
export function publishedCounts(block) {
  const published = {};
  for (const line of block.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = line.split('|');
    if (cells.length < 3) continue;
    const key = cells[1].match(/`([A-Z_]+)`/)?.[1];
    const n = cells[2].trim();
    if (key && /^\d+$/.test(n)) published[key] = Number(n);
  }
  return published;
}

/** The inventory block, or null when the markers are missing or inverted. */
export function extractBlock(doc) {
  const a = doc.indexOf(START);
  const b = doc.indexOf(END);
  if (a === -1 || b === -1 || b < a) return null;
  return doc.slice(a + START.length, b);
}

async function main() {
  const json = process.argv.includes('--json');
  const root = process.cwd();
  const docPath = path.join(root, DOC_REL);

  if (!fs.existsSync(docPath)) {
    console.error(`[rta-waits] missing ${DOC_REL}`);
    return 2;
  }
  const block = extractBlock(fs.readFileSync(docPath, 'utf8'));
  if (block === null) {
    console.error(`[rta-waits] ${DOC_REL} is missing the ${START} / ${END} markers.`);
    return 2;
  }

  const actual = await countWaits({ cwd: root });
  const published = publishedCounts(block);

  if (!Object.keys(published).length) {
    console.error(
      `[rta-waits] no rows parsed from the inventory block in ${DOC_REL}. Each row's first ` +
        'cell must open with its category token in backticks (e.g. `FN`).',
    );
    return 2;
  }

  // An UNVERIFIED wait is a gate failure, not a number to publish — `lint:js` fails on it
  // first. Reported here anyway rather than silently folded into a row: if this ever runs
  // where the gate did not, a wait outside every category must not read as an inventory.
  const unverified = actual[WAIT_CATEGORIES.UNVERIFIED] ?? 0;

  const rows = [...new Set([...Object.keys(published), ...Object.keys(actual)])]
    .filter((k) => k !== WAIT_CATEGORIES.UNVERIFIED)
    .sort();
  const drift = rows
    .map((key) => ({ key, published: published[key] ?? null, actual: actual[key] ?? 0 }))
    .filter((r) => r.published !== r.actual);

  if (json) {
    console.log(JSON.stringify({ actual, published, drift, unverified }, null, 2));
    return drift.length || unverified ? 1 : 0;
  }

  if (unverified) {
    console.error(
      `[rta-waits] ${unverified} wait(s) fall in NO justified category. Run \`npm run lint:js\` ` +
        '— `jellyrock-rta/wait-justified` names them and says what to do.',
    );
  }
  if (drift.length) {
    console.error(
      `[rta-waits] ${drift.length} inventory row(s) in ${DOC_REL} disagree with the suite:\n` +
        drift
          .map(
            (d) =>
              `  - \`${d.key}\` publishes ${d.published ?? '(no row)'}, the suite has ${d.actual}`,
          )
          .join('\n') +
        '\n\n  Update the `n` column to match. The counts are derived from the same' +
        '\n  `classifyWait` the gate uses, so the suite is right and the doc is stale.',
    );
  }
  if (drift.length || unverified) return 1;

  const total = rows.reduce((sum, k) => sum + (actual[k] ?? 0), 0);
  console.log(`[rta-waits] OK — all ${rows.length} inventory rows match (${total} waits).`);
  return 0;
}

export { rule, START, END, DOC_REL };

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exit(await main());
  } catch (err) {
    console.error(`[rta-waits] internal error: ${err?.stack ?? err}`);
    process.exit(2);
  }
}

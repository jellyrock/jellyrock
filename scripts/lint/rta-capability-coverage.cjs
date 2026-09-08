// scripts/lint/rta-capability-coverage.cjs — keeps the ODC capability inventory in
// tests/rta/CLAUDE.md honest against the roku-test-automation client actually installed.
//
// The charter bar this serves: "an unused primitive is fine when there is a recorded
// reason, and a defect when there is not." That inventory was written once and went stale
// — it accounted for 20 of the client's 47 public methods while claiming to be complete —
// which is the failure this exists to make impossible rather than to re-audit by hand.
//
// Two directions, and they catch different things:
//
//   - UNCOVERED — every public method on OnDeviceComponent must be named somewhere in the
//     inventory block. This is the one that fires on a library upgrade that ADDS a
//     capability: it appears, nobody has judged it, the gate says so.
//   - STALE — an identifier named in an inventory TABLE row must still exist on the
//     client. This fires on a RENAME, which is a real event here: the library removed
//     `getNodeReferences` and replaced it with `getNodesInfo` in a past release, and an
//     inventory that still argued about the old name would read as current.
//
// Only table rows are checked for staleness, not the family paragraphs. A table cell
// exists to name a primitive, so an identifier there is a claim; prose is prose, and a
// gate that made every inline-code word in a paragraph require an allowlist entry would
// tax writing the argument — which is the part worth having.
//
// The method list is read from the installed .d.ts rather than from a committed copy, on
// purpose: a committed copy is a second thing to keep in sync, and would go stale in
// exactly the way this check exists to prevent.
//
// `.cjs` (scripts/lint convention). No network, no device.
//
// Usage:  node scripts/lint/rta-capability-coverage.cjs [--root <dir>] [--json]
// Exit:   0 = clean (or library not installed) · 1 = coverage failure · 2 = internal error

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DTS_REL = 'node_modules/roku-test-automation/client/dist/OnDeviceComponent.d.ts';
const DOC_REL = 'tests/rta/CLAUDE.md';
const START = '<!-- rta-capability-inventory:start -->';
const END = '<!-- rta-capability-inventory:end -->';

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[a.slice(2)] = next;
      i++;
    } else {
      flags[a.slice(2)] = true;
    }
  }
  return flags;
}

/**
 * Public Promise-returning methods on the OnDeviceComponent class — the capability surface.
 *
 * Parameter lists are matched by BALANCING parens rather than by a `\([^)]*\)` regex,
 * because at least one member's parameters contain parens of their own: `onFieldChange`
 * takes a `callback: (response: …) => …`, and the naive form stops at that inner `)` and
 * silently drops the method. That is the precise failure a coverage gate must not have —
 * it would under-report the surface and pass.
 *
 * Filtering on a `Promise` return is what separates capabilities from the client's own
 * config accessors (`constructor`, `setConfig`, `getRtaConfig`, `getConfig`), which are
 * local bookkeeping and not something we could deviate from the library's docs about.
 */
function readClientMethods(dts) {
  const names = new Set();
  // Class members sit at exactly four spaces in the emitted .d.ts; deeper is a nested
  // type literal, shallower is module scope.
  const re = /^ {4}(?:async )?([a-zA-Z][a-zA-Z0-9]*)\s*(?:<[^>]*>)?\(/gm;
  let m;
  while ((m = re.exec(dts)) !== null) {
    let depth = 0;
    let i = m.index + m[0].length - 1; // at the opening paren
    for (; i < dts.length; i++) {
      if (dts[i] === '(') depth++;
      else if (dts[i] === ')' && --depth === 0) break;
    }
    if (depth !== 0) continue; // unbalanced — not a signature we can trust
    if (/^\s*:\s*Promise\b/.test(dts.slice(i + 1, i + 40))) names.add(m[1]);
  }
  return names;
}

/** The inventory block, or null when the markers are missing/inverted. */
function extractBlock(doc) {
  const a = doc.indexOf(START);
  const b = doc.indexOf(END);
  if (a === -1 || b === -1 || b < a) return null;
  return doc.slice(a + START.length, b);
}

const codeTokens = (s) => [...s.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
const isIdentifier = (s) => /^[a-zA-Z][a-zA-Z0-9]*$/.test(s);

/** Identifiers named in the first cell of a table row — each one is a claim. */
function claimedInTables(block) {
  const claimed = new Set();
  for (const line of block.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = line.split('|');
    if (cells.length < 2) continue;
    for (const tok of codeTokens(cells[1])) if (isIdentifier(tok)) claimed.add(tok);
  }
  return claimed;
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const root = typeof flags.root === 'string' ? flags.root : process.cwd();
  const dtsPath = path.join(root, DTS_REL);
  const docPath = path.join(root, DOC_REL);

  if (!fs.existsSync(dtsPath)) {
    // Not installed (a checkout without devDeps). Skipping beats failing a contributor
    // who never asked to run the device suite; CI installs deps, so the gate still runs.
    const msg = `SKIP: ${DTS_REL} not installed — cannot check capability coverage.`;
    if (flags.json) console.log(JSON.stringify({ skipped: true, reason: msg }, null, 2));
    else console.log(`[rta-capabilities] ${msg}`);
    return 0;
  }
  if (!fs.existsSync(docPath)) {
    console.error(`[rta-capabilities] missing ${DOC_REL}`);
    return 2;
  }

  const methods = readClientMethods(fs.readFileSync(dtsPath, 'utf8'));
  if (methods.size === 0) {
    console.error(
      `[rta-capabilities] parsed ZERO methods from ${DTS_REL} — the emitted shape changed; ` +
        `fix readClientMethods rather than trusting a pass.`,
    );
    return 2;
  }

  const doc = fs.readFileSync(docPath, 'utf8');
  const block = extractBlock(doc);
  if (block === null) {
    console.error(
      `[rta-capabilities] ${DOC_REL} is missing the ${START} / ${END} markers around the inventory.`,
    );
    return 2;
  }

  const mentioned = new Set(codeTokens(block));
  const uncovered = [...methods].filter((m) => !mentioned.has(m)).sort();
  const stale = [...claimedInTables(block)].filter((t) => !methods.has(t)).sort();

  if (flags.json) {
    console.log(JSON.stringify({ total: methods.size, uncovered, stale }, null, 2));
    return uncovered.length || stale.length ? 1 : 0;
  }

  if (uncovered.length) {
    console.error(
      `[rta-capabilities] ${uncovered.length} client method(s) have no verdict in ${DOC_REL}:\n` +
        uncovered.map((m) => `  - ${m}`).join('\n') +
        `\n\n  Each needs a recorded reason — used, evaluated-and-rejected, or not-applicable.` +
        `\n  Add it to the inventory block, then re-run.`,
    );
  }
  if (stale.length) {
    console.error(
      `[rta-capabilities] ${stale.length} inventory table row(s) name a method the installed ` +
        `client no longer ships:\n` +
        stale.map((m) => `  - ${m}`).join('\n') +
        `\n\n  The library renamed or removed it; update the row rather than leaving a verdict` +
        `\n  about a primitive that no longer exists.`,
    );
  }
  if (uncovered.length || stale.length) return 1;

  console.log(
    `[rta-capabilities] OK — all ${methods.size} OnDeviceComponent methods carry a verdict.`,
  );
  return 0;
}

module.exports = { readClientMethods, extractBlock, claimedInTables, codeTokens };

if (require.main === module) {
  try {
    process.exit(main());
  } catch (err) {
    console.error(`[rta-capabilities] internal error: ${err && err.stack ? err.stack : err}`);
    process.exit(2);
  }
}

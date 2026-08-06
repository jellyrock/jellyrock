/**
 * Force every development-only `bs_const` OFF in the built production manifest.
 *
 * WHY THIS IS A SCRIPT AND NOT A bsconfig SETTING
 *
 * `bsconfig.json` accepts `manifest.bs_const`, and BrighterScript does apply it — but
 * only to its own IN-MEMORY manifest (`Program.buildBsConstsIntoParsedManifest`). The
 * `manifest` file itself is listed in `files` and copied to `build/` verbatim, so the
 * override never reaches the artifact.
 *
 * That matters because `#if` is NOT evaluated by `bsc`. The directives survive
 * transpilation into the emitted `.brs` and are compiled out by Roku ON DEVICE, using
 * the `bs_const` line in the shipped manifest. The manifest is therefore the only thing
 * that decides what a production build actually runs — verifying the `.brs` output
 * proves nothing, because the `#if` blocks are always present there.
 *
 * WHAT THIS PREVENTS
 *
 *   - `perfTiming=true` shipping: the wait/emit orchestrator instrumentation creates
 *     roTimespans and reads them per item (up to `m.top.limit`, default 100, on every
 *     grid load). `roku-log` strips the log CALL from prod but not the clocks feeding
 *     it, so an unhardened release does the whole measurement and discards the result.
 *   - `debug=true` shipping: attaches `rawApiData` to every transformed item, enables
 *     failure injection (`shouldForceFiltersFail` and friends), the toast cheat code,
 *     and raises the log level from 2 to 4. Flipping it locally is a routine part of
 *     manual testing — it is the only way to surface `m.log.debug` / `.verbose` output
 *     today — so it reaches the working tree often. It has been committed as `true`
 *     TWICE (27d99141 on 2025-10-24, dc05db8d on 2026-03-12), each caught and reverted
 *     the same day, i.e. after landing rather than before.
 *   - `ENABLE_RTA=true` shipping: RTA's deploy rewrites this in the build dir, so a
 *     release built after a test run could otherwise inherit it.
 *   - An UNREGISTERED dev const shipping: see the default-deny check below.
 *
 * WHAT THIS DOES NOT NEED TO PREVENT
 *
 * A manifest that DROPS a const cannot reach this script. `bsc` raises
 * `hash-const-does-not-exist` (error, exit 1) for every `#if` referencing an undeclared
 * const, and `build:prod` is `bsc … && node scripts/harden-prod-manifest.js`. All three
 * consts below are referenced in source, so all three are gated there — earlier, and
 * with a file:line per use site.
 *
 * Runs as the last step of `npm run build:prod`, so every path to a release artifact
 * (including `npm run package:signed`, which composes it) is covered.
 */

import fs from 'node:fs';
import path from 'node:path';

/**
 * Consts expected to be TRUE in a dev manifest and forced false for production.
 *
 * This is a denylist, so it only knows what someone remembered to add — which is why
 * the default-deny check below backstops it. The two say different things: this list
 * means "expected true in dev, turn it off"; the check means "anything else true is a
 * mistake."
 */
const FORCED_OFF = ['debug', 'perfTiming', 'ENABLE_RTA'];

/**
 * Consts allowed to remain TRUE in a production artifact.
 *
 * Deliberately empty: no const legitimately ships on today. If one ever does, the
 * default-deny check fails the build and adding it here is the deliberate, reviewable
 * act of saying so. Do not pre-populate it.
 */
const ALLOWED_TRUE = [];

const manifestPath = path.join(process.cwd(), 'build', 'manifest');

if (!fs.existsSync(manifestPath)) {
  console.error(`❌ harden-prod-manifest: no manifest at ${manifestPath}`);
  console.error("   Run 'npm run build:prod' — this script is its final step.");
  process.exit(1);
}

const original = fs.readFileSync(manifestPath, 'utf8');
const lines = original.split('\n');
const index = lines.findIndex((l) => l.startsWith('bs_const='));

if (index === -1) {
  // No bs_const at all means nothing to harden, but it also means the manifest is not
  // the shape we expect — fail rather than silently pass a release through.
  console.error('❌ harden-prod-manifest: no `bs_const=` line found in the built manifest.');
  process.exit(1);
}

// Preserve the line's own terminator: splitting on '\n' leaves '\r' on the end of every
// line in a CRLF file, and rebuilding without it would emit one lone LF line into an
// otherwise CRLF manifest.
const eol = lines[index].endsWith('\r') ? '\r' : '';
const before = lines[index].slice('bs_const='.length);
const consts = new Map();
for (const pair of before.split(';')) {
  if (!pair.trim()) continue;
  const [key, value] = pair.split('=');
  consts.set(key.trim(), (value || '').trim());
}

const flipped = [];
for (const key of FORCED_OFF) {
  if (consts.get(key) === 'true') flipped.push(key);
  consts.set(key, 'false');
}

// Default-deny backstop. The manifest's const set turns over every few months
// (printReg → debug → ENABLE_RTA → perfTiming), and `perfTiming` established the first
// const that is TRUE by default — the pattern the next dev flag will copy. A const
// added to the manifest but never registered in FORCED_OFF above would otherwise ship
// on, silently: bsc is happy (it IS declared), roku-log does not touch `#if` blocks,
// and nothing else reads the built manifest.
const stillTrue = [...consts].filter(([k, v]) => v === 'true' && !ALLOWED_TRUE.includes(k));

if (stillTrue.length) {
  const names = stillTrue.map(([k]) => k).join(', ');
  console.error(`❌ harden-prod-manifest: unregistered const(s) still TRUE → ${names}`);
  console.error('   A production artifact must not ship a dev flag on.');
  console.error('   Fix: add it to FORCED_OFF in scripts/harden-prod-manifest.js,');
  console.error('   or to ALLOWED_TRUE if it genuinely must ship enabled.');
  process.exit(1);
}

const after = [...consts].map(([k, v]) => `${k}=${v}`).join(';');
lines[index] = `bs_const=${after}${eol}`;
fs.writeFileSync(manifestPath, lines.join('\n'));

if (flipped.length) {
  console.log(`🔒 harden-prod-manifest: forced OFF for production → ${flipped.join(', ')}`);
} else {
  console.log('🔒 harden-prod-manifest: all dev consts already false');
}
console.log(`   bs_const=${after}`);

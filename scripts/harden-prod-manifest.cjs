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
 *     and the Task-thread ledger. Flipping this locally while debugging is a normal
 *     habit; forgetting to revert it before a release is the hazard. It has been
 *     committed as `true` once before (dc05db8d, reverted same day).
 *   - `ENABLE_RTA=true` shipping: RTA's deploy rewrites this in the build dir, so a
 *     release built after a test run could otherwise inherit it.
 *
 * Runs as the last step of `npm run build:prod`, so every path to a release artifact
 * (including `npm run package:signed`, which composes it) is covered.
 */
'use strict';

const fs = require('fs');
const path = require('path');

/** Consts that must be false in any production artifact. */
const FORCED_OFF = ['debug', 'perfTiming', 'ENABLE_RTA'];

const manifestPath = path.join(__dirname, '..', 'build', 'manifest');

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
  // Set rather than only-flip: a const the manifest never declared would otherwise be
  // undefined on device, and `#if <undefined>` is a compile error there.
  if (consts.has(key)) consts.set(key, 'false');
}

const after = [...consts].map(([k, v]) => `${k}=${v}`).join(';');
lines[index] = `bs_const=${after}`;
fs.writeFileSync(manifestPath, lines.join('\n'));

if (flipped.length) {
  console.log(`🔒 harden-prod-manifest: forced OFF for production → ${flipped.join(', ')}`);
} else {
  console.log('🔒 harden-prod-manifest: all dev consts already false');
}
console.log(`   bs_const=${after}`);

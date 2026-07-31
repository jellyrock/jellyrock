// scripts/lint/promise-ratchet.cjs — anti-backslide ratchet for the
// @rokucommunity/promises adoption (issue #551).
//
// WHY THIS EXISTS
// ---------------
// #551 replaces the app's observer-spaghetti — render-thread (or main-thread)
// callers that `submitApiRequest(...)` a raw pool request and then observe the
// result node's `isDone` field by hand — with the promise adapter
// (`fetchAsync(...).then(...)`, see source/api/apiPromise.bs). The migration is
// incremental: two paradigms coexist while the long tail is in flight (see
// docs/architecture/async.md, "Risk & coexistence"). The danger during that
// window is NET-NEW spaghetti — a fresh `observeField("isDone", ...)` call site
// landing while the old ones are still being migrated, so the codebase never
// converges. This ratchet makes that impossible: it counts the banned signature
// and FAILS when the count rises above a committed baseline. The count can only
// go DOWN (each migration lowers the baseline); it can never silently climb.
//
// THE METRIC (a deliberate, robust proxy)
// ---------------------------------------
// We count `\.observeField("isDone"` occurrences in app code. `isDone` is the
// field the pool's `ApiResultNode` fires (source/api/apiPool.bs), so a raw
// `observeField("isDone", ...)` is, by construction, an app-code consumer of a
// raw pool result — i.e. the exact observer-spaghetti #551 removes. Counting the
// OBSERVE side (not the `submitApiRequest` side) is intentional:
//   - It is the half that defines the spaghetti. A `submitApiRequest` that never
//     observes its result (e.g. VideoPlayerView.forceFinishPlayback, a deliberate
//     fire-and-submit) is NOT spaghetti and is correctly not counted.
//   - It is collision-proof against `unobserveField("isDone")`: the regex anchors
//     on a literal `.observeField(`, and in `.unobserveField(` the substring
//     `observeField` is preceded by `n`, not `.`, so it does not match.
//
// EXCLUSIONS (the engine + the bridge, not spaghetti):
//   - source/api/apiPool.bs    — the pool engine itself observes `isDone`.
//   - source/api/apiPromise.bs — the adapter's single bridging observer; every
//                                migrated call site funnels through here.
//   - roku_modules/**          — vendored library code.
//   - whole-line comments      — a `'`-prefixed line is documentation, not a call.
//
// FAIL POLICY ("blocking on increase only", per the adoption plan)
// ----------------------------------------------------------------
//   count >  baseline → FAIL (exit 1). Net-new observer-spaghetti — migrate it to
//                       fetchAsync, or this is the regression the ratchet guards.
//   count <  baseline → PASS (exit 0) + LOUD advisory to lower the baseline so the
//                       gain is locked in (an unlowered baseline leaves slack a
//                       later PR could refill without tripping the gate).
//   count == baseline → PASS (exit 0), one-line OK.
//   baseline == 0     → the ratchet has automatically become a hard grep-zero
//                       guard: any reintroduction trips `count > baseline`.
//
// WHERE IT RUNS (the exit codes above only matter where something reads them)
// ---------------------------------------------------------------------------
//   CI       → the `lint-brightscript` workflow, BLOCKING. This is the real gate.
//   pre-push → advisory (`|| true`) so a local push isn't blocked.
//
// Historical note: this ratchet spent its early life blocking NOTHING. It was in
// the `npm run lint` aggregate and run `|| true` at pre-push, and .husky/pre-push
// asserted CI enforced it "because it's in `npm run lint`" — but CI never runs the
// aggregate; it runs the per-domain reusable workflows. `scripts/lint/ci-parity-check.js`
// now fails the build if any aggregate member loses its CI home like this again.
//
// USAGE
//   node scripts/lint/promise-ratchet.cjs [--root <dir>]
//   --root defaults to the current working directory (the repo root in CI / hooks).
//
// Wired into `npm run lint` (→ CI blocking) and the pre-push hook (advisory).
// Companion Vitest suite: tests/scripts/unit/lint/promise-ratchet.test.js.

const fs = require('fs');
const path = require('path');

const BASELINE_REL = '.promise-ratchet-baseline';
const SCAN_DIRS = ['source', 'components'];
// Engine + adapter — they legitimately observe `isDone`; never count them.
const EXCLUDED_FILES = new Set([
  path.normalize('source/api/apiPool.bs'),
  path.normalize('source/api/apiPromise.bs'),
]);
// The banned signature: a literal `.observeField("isDone"` call. The leading dot
// keeps `.unobserveField("isDone"` from matching (its `observeField` is preceded
// by `n`). Global flag so multiple hits on one line each count.
const SIGNATURE = /\.observeField\("isDone"/g;

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') flags.root = argv[++i];
  }
  return flags;
}

// Recursively collect every .bs file under `dir` (absolute paths). Skips
// roku_modules (vendored).
function collectBsFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'roku_modules') continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collectBsFiles(full));
    else if (ent.name.endsWith('.bs')) out.push(full);
  }
  return out;
}

// Count banned-signature occurrences in one file, skipping whole-line comments.
// Returns { count, lines: [{ line, text }] } for human-readable reporting.
function countInFile(absPath) {
  const text = fs.readFileSync(absPath, 'utf8');
  let count = 0;
  const lines = [];
  text.split('\n').forEach((raw, idx) => {
    if (raw.trim().startsWith("'")) return; // whole-line comment
    const matches = raw.match(SIGNATURE);
    if (matches) {
      count += matches.length;
      lines.push({ line: idx + 1, text: raw.trim() });
    }
  });
  return { count, lines };
}

function readBaseline(rootDir) {
  const baselinePath = path.join(rootDir, BASELINE_REL);
  if (!fs.existsSync(baselinePath)) {
    throw new Error(
      `missing baseline file ${BASELINE_REL} — create it with the current count ` +
        `(a single integer). See the header of scripts/lint/promise-ratchet.cjs.`,
    );
  }
  const raw = fs.readFileSync(baselinePath, 'utf8').trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `${BASELINE_REL} must contain a single non-negative integer, got: ${JSON.stringify(raw)}`,
    );
  }
  return parseInt(raw, 10);
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  const rootDir = flags.root || '.';

  const baseline = readBaseline(rootDir);

  let count = 0;
  const sites = [];
  for (const rel of SCAN_DIRS) {
    for (const abs of collectBsFiles(path.join(rootDir, rel))) {
      const relFromRoot = path.normalize(path.relative(rootDir, abs));
      if (EXCLUDED_FILES.has(relFromRoot)) continue;
      const { count: c, lines } = countInFile(abs);
      count += c;
      for (const l of lines) sites.push(`  ${relFromRoot}:${l.line}  ${l.text}`);
    }
  }

  if (count > baseline) {
    console.error(
      `promise-ratchet: FAIL — observer-spaghetti count rose to ${count} (baseline ${baseline}).`,
    );
    console.error(
      `\nNet-new raw pool-result observers detected. The banned signature is a\n` +
        `\`.observeField("isDone", ...)\` on a submitApiRequest() result. Migrate the\n` +
        `new call site to the promise adapter (fetchAsync(...).then(...)) — see\n` +
        `docs/dev/promises.md. The ratchet only moves DOWN.\n\nCurrent sites:`,
    );
    for (const s of sites) console.error(s);
    return 1;
  }

  if (count < baseline) {
    console.log(
      `promise-ratchet: count dropped to ${count} (baseline ${baseline}). ` +
        `Lower ${BASELINE_REL} to ${count} to lock in the gain.`,
    );
    return 0;
  }

  const guardNote = baseline === 0 ? ' (hard grep-zero guard active)' : '';
  console.log(`promise-ratchet: OK — ${count} of ${baseline} allowed${guardNote}.`);
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  console.error(`promise-ratchet: ${err.message}`);
  process.exit(2);
}

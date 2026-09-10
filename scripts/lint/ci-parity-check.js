// scripts/lint/ci-parity-check.js — reconciles the `npm run lint` aggregate
// against what CI actually runs.
//
// WHY THIS EXISTS
// ---------------
// `npm run lint` is the de-facto "run everything" surface, but CI is assembled
// from ~11 hand-maintained per-domain reusable workflows and never invokes the
// aggregate. Nothing reconciled the two, so a check could be added locally and
// silently never gate a PR.
//
// That is not hypothetical. When this script was written, three aggregate
// members had no CI home at all:
//
//   - lint:promise-ratchet     the #551 anti-backslide ratchet. Its own FAIL
//                              POLICY promises `exit 1`, and .husky/pre-push ran
//                              it as `|| true` with the comment "BLOCKING in CI
//                              (it's in `npm run lint`)". CI does not run
//                              `npm run lint`, so it blocked nowhere.
//   - docs:api-manifest:check  drift gate on docs/architecture/api-usage-manifest.json,
//                              which is itself an INPUT to the floor-system
//                              lint's path filter. Pre-push regenerates it as an
//                              auto-fix, but that is skipped on a dirty tree and
//                              bypassed by --no-verify or a GitHub-UI edit, so
//                              drift could land green and downstream floor
//                              analysis would reason over a stale map.
//   - lint:dictionary          dictionary.txt hygiene.
//
// This is the same failure `validate-deps-workflow-sync.cjs` guards one level
// down ("if a new reusable is added without a matching entry here, dep bumps
// that break it will silently land green") — applied to the layer above it.
//
// WHAT IT CHECKS
// --------------
// Expands `npm run lint` recursively to its leaf scripts, then asserts each
// leaf is invoked by some workflow under .github/workflows/ — either as
// `npm run <name>` or, for node-based scripts, as a direct `node scripts/...`
// call (several workflows invoke the script path rather than the npm alias).
// Comment lines are stripped first, so a mention of a check never counts as a
// run of it — see executableText() below.
//
// A second, indirect CI home is recognised: a Vitest repo-drift-gate test that
// shells the real check against the real repo, run in CI by `npm run
// test:scripts`. That is how the two asset generators gate — see
// COVERED_BY_TEST below. It is verified, not trusted.
//
// SCOPE — what this does NOT prove
// --------------------------------
//   - That the hosting workflow's `paths` filter matches the files the check
//     reads. A too-narrow filter passes here and never fires on the PR that
//     needed it. Tracked as `ci-path-filters-unverified` in tech-debt.md.
//   - For a COVERED_BY_TEST entry: that the cited test asserts against the REAL
//     repo rather than a temp fixture. It proves the test invokes the script in
//     --check mode and that CI runs the suite; the assertion's target is the
//     same unverifiable step as a workflow's path filter, above.
//   - That the hosting workflow's status-check context is a REQUIRED check on
//     main. A check in a non-required context runs but does not block a merge.
//     Branch protection lives outside the repo and needs admin scope to read,
//     so it can't be gated here — the invariant is documented in
//     build-and-tooling.md's "adding a new reusable workflow" note instead.
//
// Deliberate local-only entries live in LOCAL_ONLY below, each with a REASON.
// An allowlist entry is a decision on the record, not a silent exemption.
//
// Only Node stdlib — no npm ci needed.

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Aggregate members deliberately NOT run in CI. Key = npm script name,
// value = why. Anything not listed here MUST have a CI home.
export const LOCAL_ONLY = {
  'lint:bs':
    'bslint is declared as a BSC plugin in bsconfig.json, and CI runs `npm run validate` ' +
    "(`bsc --noEmit`) with that config — so bslint's diagnostics DO gate in CI, via validate. " +
    'The standalone `bslint` CLI in the aggregate is redundancy, not a gap.',
};

// Aggregate members whose CI home is a Vitest repo-drift-gate test rather than a
// workflow `run:` line. Key = npm script name, value = the test file that gates
// it. These DO block a merge — `_test-scripts.yml`'s job id is `vitest`, and
// `vitest / vitest` is a required context on main — so they are not exemptions
// and must not be listed in LOCAL_ONLY.
//
// The indirection is verified on every run: the cited test must exist, must
// invoke the leaf's script path in --check mode, and `test:scripts` must itself
// have a workflow home. Rename the test, delete its drift gate, or unwire
// test:scripts, and the leaf goes back to being reported MISSING.
export const COVERED_BY_TEST = {
  'icons:check': 'tests/scripts/unit/generate/icons-build.test.js',
  'gradients:check': 'tests/scripts/unit/generate/gradient-assets.test.js',
};

// The npm script that runs the COVERED_BY_TEST suites in CI. If this loses its
// own workflow home, every entry above loses its coverage with it.
const TEST_RUNNER = 'test:scripts';

const WORKFLOW_DIR = '.github/workflows';
const AGGREGATE = 'lint';

// Expand an npm script to the leaves it ultimately runs. A leaf is a script
// whose command contains no further `npm run` reference.
export function expandAggregate(scripts, entry = AGGREGATE) {
  const leaves = [];
  const seen = new Set();
  const walk = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const cmd = scripts[name];
    if (cmd === undefined) {
      leaves.push({ name, cmd: null });
      return;
    }
    const refs = [...cmd.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)].map((m) => m[1]);
    if (refs.length === 0) {
      leaves.push({ name, cmd });
      return;
    }
    refs.forEach(walk);
  };
  const top = [...(scripts[entry] ?? '').matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)].map((m) => m[1]);
  top.forEach(walk);
  return leaves;
}

// The `node scripts/...` path a leaf ultimately shells out to, if any. Used so
// a workflow that calls the script directly still counts as covering the leaf.
function scriptPathOf(cmd) {
  const m = /node\s+(scripts\/[\w./-]+)/.exec(cmd ?? '');
  return m ? m[1] : null;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Workflow text with comment lines removed — a MENTION of a check must never
// count as a RUN of it. That distinction is the whole point: the bug this
// script was written to catch was `npm run lint` appearing in .github/workflows/
// exactly once, inside a comment. Dropping `#` lines is correct in both
// contexts a match can occur — at step level it is a YAML comment, and inside a
// `run: |` block it is a shell comment. Neither executes.
//
// Deliberately line-based rather than YAML-parsed: _lint-docs.yml runs this
// script with no `npm ci` step, so it must stay Node-stdlib-only (no js-yaml).
// Line-based also survives multi-line `run: |` blocks, which this repo uses
// heavily — a stricter "only lines carrying a run: key" filter would silently
// report a false MISSING for any check invoked inside a block scalar.
function executableText(files, commentRe = /^\s*#/) {
  return files
    .flatMap((w) => w.text.split('\n'))
    .filter((line) => !commentRe.test(line))
    .join('\n');
}

// Same rule one language over: a JS line comment naming a script must not count
// as running it. Every test file in this repo opens with a `// Tests for
// scripts/<path>` header, so without this each one would vacuously "cover" its
// own subject even after its drift gate was deleted. Line-based for the same
// reason as the workflow pass; block comments are not used for this in tests/.
const executableTestText = (tests) => executableText(tests, /^\s*\/\//);

/**
 * @param {{scripts: object, workflows: {name: string, text: string}[]}} input
 * @returns {{missing: object[], staleAllowlist: string[]}}
 */
export function check({ scripts, workflows, tests = [] }) {
  const leaves = expandAggregate(scripts);
  const blob = executableText(workflows);
  const testBlobs = new Map(tests.map((t) => [t.name, executableTestText([t])]));

  // The whole indirection hangs off the test runner having a workflow home of
  // its own. Resolved once, here, rather than per entry.
  const runnerInCi = new RegExp(`npm run ${TEST_RUNNER}(?![\\w:-])`).test(blob);

  // A leaf gated by a Vitest drift-gate test instead of a workflow step.
  const coveredByTest = (leaf) => {
    const testFile = COVERED_BY_TEST[leaf.name];
    if (!testFile || !runnerInCi) return false;
    const text = testBlobs.get(testFile);
    if (text === undefined) return false; // cited test renamed or deleted
    const p = scriptPathOf(leaf.cmd);
    // Must invoke the script AND do it in --check mode: a test that only spawns
    // the generator against a temp fixture gates nothing about the committed
    // assets, which is the property this entry claims.
    return p ? new RegExp(escapeRe(p)).test(text) && /--check/.test(text) : false;
  };

  const covers = (leaf) => {
    // Trailing guard so `lint:docs` isn't satisfied by a `lint:docs-extra` step.
    // Script names are [a-zA-Z0-9:_-] only, so none of them need regex escaping.
    if (new RegExp(`npm run ${leaf.name}(?![\\w:-])`).test(blob)) return true;
    const p = scriptPathOf(leaf.cmd);
    // Match the INVOCATION (`node <path>`), not the bare path. Workflows also
    // name script paths inside their hand-authored `paths` filters; one written
    // with an unescaped dot (`docs-check.cjs` rather than `docs-check\.cjs`)
    // would otherwise satisfy its own coverage requirement.
    if (p && new RegExp(`node\\s+${escapeRe(p)}`).test(blob)) return true;
    return coveredByTest(leaf);
  };

  const missing = leaves
    .filter((leaf) => !covers(leaf) && !(leaf.name in LOCAL_ONLY))
    .map((leaf) => ({ name: leaf.name, cmd: leaf.cmd }));

  // An allowlist entry for a script that IS now in CI (or no longer in the
  // aggregate) is stale — drop it so the list stays a real decision record.
  const leafNames = new Set(leaves.map((l) => l.name));
  const staleAllowlist = Object.keys(LOCAL_ONLY).filter(
    (n) => !leafNames.has(n) || covers(leaves.find((l) => l.name === n)),
  );

  // Same rot, one map over: an entry claiming a test gates a check that is no
  // longer in the aggregate is a stale claim, not a harmless leftover.
  const staleTestCoverage = Object.keys(COVERED_BY_TEST).filter((n) => !leafNames.has(n));

  return { missing, staleAllowlist, staleTestCoverage };
}

// ── CLI ────────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf('--root');
  const rootDir = rootIdx >= 0 ? argv[rootIdx + 1] : '.';

  let scripts, workflows, tests;
  try {
    scripts = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8')).scripts ?? {};
    const dir = path.join(rootDir, WORKFLOW_DIR);
    workflows = readdirSync(dir)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((f) => ({ name: f, text: readFileSync(path.join(dir, f), 'utf8') }));
    // Only the files COVERED_BY_TEST actually names — reading the whole suite
    // would cost more and prove nothing extra.
    tests = [...new Set(Object.values(COVERED_BY_TEST))].flatMap((rel) => {
      try {
        return [{ name: rel, text: readFileSync(path.join(rootDir, rel), 'utf8') }];
      } catch {
        return []; // absent → check() reports the leaf MISSING, with the reason
      }
    });
  } catch (err) {
    console.error(`ci-parity: ${err.message}`);
    process.exit(2);
  }

  const { missing, staleAllowlist, staleTestCoverage } = check({ scripts, workflows, tests });

  if (staleTestCoverage.length > 0) {
    console.error(
      'ci-parity: COVERED_BY_TEST has stale entries (no longer in the `npm run lint` aggregate):',
    );
    for (const n of staleTestCoverage) console.error(`  - ${n}`);
    process.exit(1);
  }

  if (staleAllowlist.length > 0) {
    console.error(
      'ci-parity: LOCAL_ONLY has stale entries (now covered by CI, or gone from the aggregate):',
    );
    for (const n of staleAllowlist) console.error(`  - ${n}`);
    console.error(
      '\nRemove them from LOCAL_ONLY so the allowlist stays an accurate decision record.',
    );
    process.exit(1);
  }

  if (missing.length > 0) {
    console.error(`ci-parity: ${missing.length} check(s) in \`npm run lint\` never run in CI:`);
    for (const m of missing) console.error(`  - ${m.name}  (${m.cmd ?? '<undefined script>'})`);
    console.error(
      '\nCI does NOT run the `npm run lint` aggregate — it is assembled from the per-domain\n' +
        `reusable workflows under ${WORKFLOW_DIR}/. A check that is only in the aggregate gates\n` +
        'nothing on a PR.\n\n' +
        'Fix: add a step to the workflow whose path filter already matches what the check reads\n' +
        '(a new workflow pair is rarely needed); or gate it from a Vitest drift-gate test that\n' +
        `shells the check against the real repo and register that in COVERED_BY_TEST (\`${TEST_RUNNER}\`\n` +
        'already runs in a required context); or — if it is deliberately local-only — add it to\n' +
        'LOCAL_ONLY in this file WITH a reason.',
    );
    process.exit(1);
  }

  const n = expandAggregate(scripts).length;
  const allow = Object.keys(LOCAL_ONLY).length;
  const viaTest = Object.keys(COVERED_BY_TEST).length;
  console.log(
    `ci-parity: all ${n - allow} of ${n} \`npm run lint\` checks have a CI home ` +
      `(${viaTest} via a drift-gate test, ${allow} deliberately local-only) ✓`,
  );
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();

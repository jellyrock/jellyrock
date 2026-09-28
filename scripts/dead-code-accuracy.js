/**
 * Accuracy evidence for the dead-code BSC plugin (scripts/bsc-plugins/dead-code.cjs).
 *
 *   npm run dead-code:replay       past dead-code removals: did the rule flag them?
 *   npm run dead-code:mutate       erase a live declaration's references: is it flagged?
 *   npm run dead-code:write-only   fields every reference only writes (a review list)
 *
 * replay options:  --ref <rev> (default origin/main)  --grep <regex>  --commit <sha>
 *                  --json <file>
 * mutate options:  --per-kind <n> (default 8)
 *
 * ## Why this is committed
 *
 * The plugin is a build-failing gate, so its accuracy claims have to be re-checkable
 * by the next person who edits it. The first round of evidence was produced by
 * uncommitted scripts, and its numbers did not add up; nobody could rerun them to
 * find out why. Each command here prints totals that are checked to sum, and names
 * the exact reference behind every miss.
 *
 * ## Why every run starts with a parity check
 *
 * The replay cannot run `bsc` at a past commit (that commit's plugins, config and
 * installed modules are not what is on disk), so it rebuilds each commit's program
 * in memory from `git archive`. That loader is only evidence if it sees what the
 * real build sees. Before anything else, it loads the working tree the same way and
 * must produce exactly the findings the real `bsc` build produces; a mismatch aborts.
 * This caught a real gap while the tool was written: `roku_modules` is installed by
 * ropm, not committed, and without it router callbacks looked dead.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDORED_DIRS = ['source/roku_modules', 'components/roku_modules'];
// Paths a program snapshot needs: the app build's inputs plus the tests the
// plugin reads as interface-exposure consumers.
const SNAPSHOT_PATHS = ['manifest', 'source', 'components', 'locale', 'settings', 'tests'];
const DEFAULT_GREP = '\\b(dead|unused)\\b';
const KINDS = [
  'function',
  'method',
  'class',
  'const',
  'enum',
  'enumMember',
  'component',
  'field',
  'interfaceFunction',
];

// ======================================================================================
// Pure helpers (unit-tested)
// ======================================================================================

/**
 * The OLD-side lines each file loses in a `git diff -M -U0` between two commits, as
 * { path → { all: boolean, lines: Set<0-based line> } }, plus the renames old → new.
 */
export function parseDeletedLines(diffText) {
  const deleted = new Map();
  const renames = new Map();
  let oldPath = null;
  let pendingRenameFrom = null;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('diff --git ')) {
      oldPath = null;
      pendingRenameFrom = null;
    } else if (line.startsWith('rename from ')) {
      pendingRenameFrom = line.slice('rename from '.length);
    } else if (line.startsWith('rename to ') && pendingRenameFrom) {
      renames.set(pendingRenameFrom, line.slice('rename to '.length));
    } else if (line.startsWith('--- ')) {
      oldPath = line === '--- /dev/null' ? null : line.slice(4).replace(/^a\//, '');
    } else if (line.startsWith('+++ ') && oldPath) {
      if (line === '+++ /dev/null') deleted.set(oldPath, { all: true, lines: new Set() });
    } else if (line.startsWith('@@ ') && oldPath) {
      const m = /^@@ -(\d+)(?:,(\d+))? /.exec(line);
      if (!m) continue;
      const start = Number(m[1]);
      const count = m[2] === undefined ? 1 : Number(m[2]);
      if (!count) continue;
      if (!deleted.has(oldPath)) deleted.set(oldPath, { all: false, lines: new Set() });
      for (let i = 0; i < count; i++) deleted.get(oldPath).lines.add(start - 1 + i);
    }
  }
  return { deleted, renames };
}

/** Did the commit delete the line this reference sits on? */
export function referenceDeleted(ref, deleted) {
  const d = deleted.get(ref.rel);
  return !!d && (d.all || d.lines.has(ref.line));
}

/**
 * Classify one declaration the commit deleted, from its state at the parent.
 * Exactly one bucket, so the buckets sum to the deletions:
 *   flagged   the rule reported it dead at the parent
 *   kept      recorded as kept on purpose
 *   exempt    never reported by design (entry point, firmware field, injected call)
 *   refactor  live at the parent, and the same commit deleted a caller of it or the
 *             live component it belongs to — it died WITH its users, so it was not
 *             dead before the commit
 *   override  a function overriding a same-named one in its scope, which the commit
 *             kept: calls now reach that one, so it was live
 *   miss      the commit deleted it without touching anything the rule counted as a
 *             use, so none of those was a real use: the rule kept dead code alive
 * A feature removal lands in `refactor` even when some of its references were
 * incidental same-name matches: the deleted caller is what made it live.
 *
 * `context.parentDeleted`: the commit also deleted the live component `decl` belongs
 * to. `context.overrideKept`: a function `decl` overrides survives the commit.
 */
export function classifyDeletion(decl, deleted, context = {}) {
  if (decl.state === 'dead') return { bucket: 'flagged' };
  if (decl.state === 'kept') return { bucket: 'kept' };
  if (decl.state === 'exempt') return { bucket: 'exempt' };
  if (context.parentDeleted || decl.liveBy.some((r) => referenceDeleted(r, deleted))) {
    return { bucket: 'refactor' };
  }
  if (context.overrideKept) return { bucket: 'override' };
  return { bucket: 'miss', surviving: decl.liveBy };
}

/** `n` items spread evenly across `sorted`, deterministically. */
export function sampleEvenly(sorted, n) {
  if (sorted.length <= n) return [...sorted];
  const out = [];
  for (let i = 0; i < n; i++) out.push(sorted[Math.floor((i * sorted.length) / n)]);
  return out;
}

/**
 * Replace the first case-insensitive occurrence of `text` at or after column `col`
 * of `line`. Returns the line unchanged when it is not there.
 */
export function eraseAt(line, col, text, replacement) {
  const at = line.toLowerCase().indexOf(text.toLowerCase(), col);
  if (at < 0) return line;
  return line.slice(0, at) + replacement + line.slice(at + text.length);
}

// ======================================================================================
// Programs
// ======================================================================================

function plugin() {
  return require('./bsc-plugins/dead-code.cjs');
}

function effectiveConfig() {
  const { util } = require('brighterscript');
  return util.normalizeAndResolveConfig({ project: path.join(ROOT, 'bsconfig.json') });
}

/**
 * The app program rooted at `dir`, loaded with the real build's file selection and
 * options but no plugins and no validation — the analysis needs neither, and the
 * replay loads two programs per commit.
 */
async function loadProgram(dir) {
  const { ProgramBuilder } = require('brighterscript');
  const config = effectiveConfig();
  const builder = new ProgramBuilder();
  await builder.run({
    ...config,
    project: undefined,
    rootDir: dir,
    cwd: dir,
    // Images are packaged assets; nothing in them can reference code.
    files: config.files.filter((f) => typeof f !== 'string' || !f.startsWith('images/')),
    plugins: [],
    validate: false,
    noEmit: true,
    createPackage: false,
    watch: false,
    logLevel: 'error',
    deadCode: { ...config.deadCode, baseline: undefined },
  });
  return builder.program;
}

/** The real `bsc` build of the working tree: the parity reference. */
async function loadRealBuild() {
  const { ProgramBuilder } = require('brighterscript');
  const builder = new ProgramBuilder();
  await builder.run({
    project: path.join(ROOT, 'bsconfig.json'),
    cwd: ROOT,
    noEmit: true,
    createPackage: false,
    watch: false,
    logLevel: 'error',
  });
  return builder.program;
}

function findingKeys(decls) {
  const { baselineKey } = plugin().__internals;
  return new Set(decls.filter((d) => d.finding).map(baselineKey));
}

function relOf(srcPath, dir) {
  return path.relative(dir, srcPath).replace(/\\/g, '/');
}

// A declaration inside a dead component is reported through that component, so it
// counts as flagged even when its own name still matches something.
function stateOf(d) {
  if (d.dead || d.parentDecl?.dead) return 'dead';
  if (d.kept) return 'kept';
  if (d.alwaysLive) return 'exempt';
  return 'live';
}

async function checkParity() {
  const { analyze } = plugin().__internals;
  const real = findingKeys(analyze(await loadRealBuild()));
  const loaded = findingKeys(analyze(await loadProgram(ROOT)));
  const onlyReal = [...real].filter((k) => !loaded.has(k));
  const onlyLoaded = [...loaded].filter((k) => !real.has(k));
  if (onlyReal.length || onlyLoaded.length) {
    console.error('Parity check FAILED: the in-memory loader does not see what `bsc` sees.');
    for (const k of onlyReal) console.error(`  only in the real build:  ${k}`);
    for (const k of onlyLoaded) console.error(`  only in the loader:      ${k}`);
    process.exit(1);
  }
  console.log(`parity: in-memory loader matches the real build (${real.size} findings)`);
}

function git(args, opts = {}) {
  return execFileSync('git', ['-C', ROOT, ...args], {
    encoding: opts.encoding ?? 'utf8',
    maxBuffer: 1 << 30,
  });
}

/** Analyze commit `rev`: its tree from git, plus today's installed roku_modules. */
async function analyzeRevision(rev, { explain = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jellyrock-dead-code-'));
  try {
    const present = git(['ls-tree', '--name-only', rev, '--', ...SNAPSHOT_PATHS])
      .split('\n')
      .filter(Boolean);
    const tar = git(['archive', '--format=tar', rev, '--', ...present], { encoding: 'buffer' });
    execFileSync('tar', ['-x', '-C', dir], { input: tar, maxBuffer: 1 << 30 });
    for (const v of VENDORED_DIRS) {
      fs.cpSync(path.join(ROOT, v), path.join(dir, v), { recursive: true });
    }
    const { analyze, baselineKey, componentScopeMembership } = plugin().__internals;
    const program = await loadProgram(dir);
    const decls = analyze(program, { explain });
    const scopeFilesOf = componentScopeMembership(program);
    // The same-named functions each function shadows or overrides in its scope.
    const functionsByName = new Map();
    for (const d of decls) {
      if (d.kind !== 'function' || d.ns) continue;
      const k = d.name.toLowerCase();
      if (!functionsByName.has(k)) functionsByName.set(k, []);
      functionsByName.get(k).push(d);
    }
    const overridden = (d) => {
      if (d.kind !== 'function' || d.ns) return [];
      const scope = scopeFilesOf.get(d.file.srcPath);
      if (!scope) return [];
      return functionsByName
        .get(d.name.toLowerCase())
        .filter((o) => o !== d && scope.has(o.file.srcPath))
        .map(baselineKey);
    };
    return decls.map((d) => ({
      key: baselineKey(d),
      kind: d.kind,
      rel: d.rel,
      qname: d.qname,
      parentKey: d.parentDecl ? baselineKey(d.parentDecl) : null,
      overrides: overridden(d),
      state: stateOf(d),
      liveBy: (d.liveBy || []).map((r) => ({
        rel: relOf(r.file.srcPath, dir),
        line: r.line,
        via: r.via,
      })),
    }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function assertVendoredInstalled() {
  for (const v of VENDORED_DIRS) {
    if (!fs.existsSync(path.join(ROOT, v))) {
      console.error(`${v} is missing — run \`npm ci\` first (ropm installs it).`);
      process.exit(1);
    }
  }
}

// ======================================================================================
// replay
// ======================================================================================

async function replay({ ref, grep, commit, json }) {
  assertVendoredInstalled();
  await checkParity();
  const commits = commit
    ? [git(['rev-parse', commit]).trim()]
    : git(['log', '--no-merges', '--format=%H', '-i', '-E', `--grep=${grep}`, ref])
        .split('\n')
        .filter(Boolean);
  const headDeps = JSON.stringify(JSON.parse(git(['show', 'HEAD:package.json'])).dependencies);
  const buckets = { flagged: 0, refactor: 0, override: 0, kept: 0, exempt: 0, miss: 0 };
  const misses = [];
  const perCommit = [];
  const vendoredDrift = [];
  let deletedTotal = 0;
  let moved = 0;
  // Refactors that ALSO kept a counted reference: a same-name match, or a user the
  // commit left in place. The replay cannot tell which, so it reports the count.
  let refactorWithSurvivor = 0;

  for (const [i, sha] of commits.entries()) {
    const parent = `${sha}^`;
    // A root commit has no parent to compare against.
    if (!git(['rev-list', '--parents', '-n', '1', sha]).trim().includes(' ')) continue;
    const subject = git(['log', '-1', '--format=%s', sha]).trim();
    process.stdout.write(
      `  [${i + 1}/${commits.length}] ${sha.slice(0, 8)} ${subject.slice(0, 60)}\n`,
    );
    const { deleted, renames } = parseDeletedLines(
      git(['diff', '-M', '-U0', '--no-color', parent, sha, '--', ...SNAPSHOT_PATHS]),
    );
    // Declarations live only in source/ and components/: a commit that removes no
    // line there cannot delete one.
    if (![...deleted.keys()].some((p) => /^(source|components)\//.test(p))) continue;
    const before = await analyzeRevision(parent, { explain: true });
    const after = await analyzeRevision(sha);
    const afterKeys = new Set(after.map((d) => d.key));
    const beforeKeys = new Set(before.map((d) => d.key));
    // kind + name of every declaration that APPEARED in the commit: one of those
    // matching a vanished declaration means it moved files rather than died.
    const appeared = new Set(
      after.filter((d) => !beforeKeys.has(d.key)).map((d) => `${d.kind} ${d.qname}`),
    );
    const counts = { flagged: 0, refactor: 0, override: 0, kept: 0, exempt: 0, miss: 0 };
    const liveBefore = new Set(before.filter((d) => d.state === 'live').map((d) => d.key));
    for (const d of before) {
      const renamedKey = `${d.kind} ${renames.get(d.rel) ?? d.rel} ${d.qname}`;
      if (afterKeys.has(renamedKey)) continue;
      if (appeared.has(`${d.kind} ${d.qname}`)) {
        moved++;
        continue;
      }
      const { bucket, surviving } = classifyDeletion(d, deleted, {
        parentDeleted: !!d.parentKey && liveBefore.has(d.parentKey) && !afterKeys.has(d.parentKey),
        overrideKept: d.overrides.some((k) => afterKeys.has(k)),
      });
      counts[bucket]++;
      buckets[bucket]++;
      if (bucket === 'refactor' && d.liveBy.some((r) => !referenceDeleted(r, deleted))) {
        refactorWithSurvivor++;
      }
      deletedTotal++;
      if (bucket === 'miss') misses.push({ sha, subject, decl: d, surviving });
    }
    const n = Object.values(counts).reduce((a, b) => a + b, 0);
    if (!n) continue;
    const deps = JSON.stringify(JSON.parse(git(['show', `${parent}:package.json`])).dependencies);
    if (deps !== headDeps) vendoredDrift.push(sha);
    perCommit.push({ sha, subject, ...counts });
  }

  const sum = Object.values(buckets).reduce((a, b) => a + b, 0);
  if (sum !== deletedTotal) {
    console.error(`Internal error: buckets sum to ${sum}, deletions are ${deletedTotal}.`);
    process.exit(1);
  }
  const judged = buckets.flagged + buckets.miss;
  console.log('');
  console.log(
    `dead-code replay — ${commits.length} commit(s) matching /${grep}/i on ${ref}, ` +
      `${perCommit.length} of them deleting declarations`,
  );
  console.log(`  declarations deleted: ${deletedTotal}`);
  console.log(`    flagged   ${buckets.flagged}   reported dead at the parent commit`);
  console.log(`    miss      ${buckets.miss}   deleted with every counted reference left in place`);
  console.log(
    `    refactor  ${buckets.refactor}   live until the same commit deleted a caller or its component`,
  );
  console.log(
    `    override  ${buckets.override}   an override removed while the function it overrode stayed`,
  );
  console.log(
    `              (${refactorWithSurvivor} refactors also kept a counted reference: a same-name ` +
      `match or a user the commit left, which the replay cannot tell apart)`,
  );
  console.log(`    kept      ${buckets.kept}   recorded as kept on purpose`);
  console.log(`    exempt    ${buckets.exempt}   never reported by design`);
  console.log(`  moved to another file (not counted): ${moved}`);
  if (judged) {
    console.log(`  of the dead ones the rule could judge: ${buckets.flagged} of ${judged} flagged`);
  }
  if (vendoredDrift.length) {
    console.log(
      `  ${vendoredDrift.length} commit(s) had different roku_modules dependencies from today's ` +
        `(analyzed with today's): ${vendoredDrift.map((s) => s.slice(0, 8)).join(' ')}`,
    );
  }
  if (misses.length) {
    console.log('');
    console.log('misses — each with the reference that kept it alive:');
    for (const m of misses) {
      console.log(`  ${m.sha.slice(0, 8)} ${m.subject}`);
      console.log(`    ${m.decl.kind} ${m.decl.qname} (${m.decl.rel})`);
      for (const r of m.surviving.slice(0, 3)) {
        console.log(`      kept alive by ${r.via} at ${r.rel}:${r.line + 1}`);
      }
    }
  }
  if (json) {
    fs.writeFileSync(
      json,
      JSON.stringify(
        { ref, grep, buckets, refactorWithSurvivor, moved, perCommit, misses, vendoredDrift },
        null,
        2,
      ) + '\n',
    );
    console.log(`\nwrote ${json}`);
  }
}

// ======================================================================================
// mutate
// ======================================================================================

async function mutate({ perKind }) {
  assertVendoredInstalled();
  await checkParity();
  const { analyze, baselineKey } = plugin().__internals;
  const program = await loadProgram(ROOT);
  const options = program.options.deadCode;
  const decls = analyze(program, { explain: true });
  const results = [];
  let placeholder = 0;

  for (const kind of KINDS) {
    const live = decls
      .filter((d) => d.kind === kind && stateOf(d) === 'live' && d.liveBy?.length)
      .sort((a, b) => baselineKey(a).localeCompare(baselineKey(b)));
    for (const d of sampleEvenly(live, perKind)) {
      const key = baselineKey(d);
      const originals = new Map();
      const missed = [];
      let touchesTests = false;
      // Erase right to left within a line, so earlier columns stay valid.
      const refs = [...d.liveBy].sort((a, b) => b.line - a.line || (b.col ?? 0) - (a.col ?? 0));
      for (const r of refs) {
        const file = program.getFile(r.file.srcPath);
        if (!file) {
          touchesTests = true;
          continue;
        }
        if (!originals.has(file.srcPath)) originals.set(file.srcPath, fileText(file));
        const text = r.prefix ?? r.text;
        const lines = fileText(file).split('\n');
        const erased = eraseAt(lines[r.line] ?? '', r.col ?? 0, text, `__dcm${placeholder++}__`);
        // An erase that finds nothing would leave the reference in place and fail for
        // the wrong reason; report it as the tool's fault instead.
        if (erased === lines[r.line])
          missed.push(`${relOf(file.srcPath, ROOT)}:${r.line + 1} "${text}"`);
        lines[r.line] = erased;
        program.setFile({ src: file.srcPath, dest: file.destPath }, lines.join('\n'));
      }
      program.options.deadCode = touchesTests ? { ...options, exposureConsumers: [] } : options;
      const after = analyze(program, { explain: true }).find((x) => baselineKey(x) === key);
      // A declaration that VANISHED (its own file stopped parsing) proves nothing, so
      // it fails rather than passing as flagged.
      const flagged = !!after && !missed.length && (after.dead || after.parentDecl?.dead);
      results.push({
        kind,
        key,
        flagged,
        why: !after
          ? 'the declaration vanished'
          : missed.length
            ? `could not erase ${missed.join(', ')}`
            : '',
        surviving:
          flagged || !after
            ? []
            : (after.liveBy || []).map((r) => ({
                rel: relOf(r.file.srcPath, ROOT),
                line: r.line,
                via: r.via,
              })),
      });
      for (const [srcPath, text] of originals) {
        const file = program.getFile(srcPath);
        program.setFile({ src: srcPath, dest: file.destPath }, text);
      }
      program.options.deadCode = options;
    }
  }

  const failed = results.filter((r) => !r.flagged);
  console.log('');
  console.log(`dead-code mutate — up to ${perKind} live declarations per kind`);
  for (const kind of KINDS) {
    const rs = results.filter((r) => r.kind === kind);
    console.log(
      `  ${kind.padEnd(18)} ${rs.filter((r) => r.flagged).length} of ${rs.length} flagged`,
    );
  }
  console.log(
    `  total              ${results.length - failed.length} of ${results.length} flagged`,
  );
  for (const f of failed) {
    console.log(`  NOT flagged: ${f.key}${f.why ? ` — ${f.why}` : ''}`);
    for (const r of f.surviving.slice(0, 3))
      console.log(`    still reached by ${r.via} at ${r.rel}:${r.line + 1}`);
  }
  if (failed.length) process.exitCode = 1;
}

function fileText(file) {
  if (typeof file.fileContents === 'string') return file.fileContents;
  const value = file.data?.value;
  return value !== undefined && value !== null
    ? value.toString()
    : fs.readFileSync(file.srcPath, 'utf8');
}

// ======================================================================================
// write-only
// ======================================================================================

async function writeOnly() {
  assertVendoredInstalled();
  const bs = require('brighterscript');
  const program = await loadProgram(ROOT);
  const decls = plugin().__internals.analyze(program, { explain: true });
  const writes = new Set();
  for (const file of Object.values(program.files)) {
    if (!bs.isBrsFile(file)) continue;
    file.parser.ast.walk(
      bs.createVisitor({
        DottedSetStatement: (s) => {
          const r = s.tokens?.name?.location?.range;
          if (r) writes.add(`${file.srcPath}:${r.start.line}:${r.start.character}`);
        },
      }),
      { walkMode: bs.WalkMode.visitAllRecursive },
    );
  }
  const isWrite = (r) =>
    r.via === 'aaKey' ||
    ((r.via === 'member' || r.via === 'mTopMember') &&
      writes.has(`${r.file.srcPath}:${r.line}:${r.col}`));
  const found = decls
    .filter(
      (d) =>
        d.kind === 'field' &&
        stateOf(d) === 'live' &&
        !d.hasOnChange &&
        !d.hasAlias &&
        d.liveBy?.length &&
        d.liveBy.every(isWrite),
    )
    .sort((a, b) => a.qname.localeCompare(b.qname));
  console.log(
    `dead-code write-only — ${found.length} interface field(s) whose every reference writes them.`,
  );
  console.log(
    '  A candidate, not a verdict: a getFields() loop, a serializer or planned work can read a',
  );
  console.log('  field by no name. Decide each one, then delete it or leave it.');
  for (const d of found) {
    const sites = d.liveBy.slice(0, 2).map((r) => `${relOf(r.file.srcPath, ROOT)}:${r.line + 1}`);
    console.log(`  ${d.qname.padEnd(48)} ${d.rel}   written at ${sites.join(', ')}`);
  }
}

// ======================================================================================
// CLI
// ======================================================================================

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const command = process.argv[2];
  if (command === 'replay') {
    await replay({
      ref: arg('ref') ?? 'origin/main',
      grep: arg('grep') ?? DEFAULT_GREP,
      commit: arg('commit'),
      json: arg('json'),
    });
  } else if (command === 'mutate') {
    await mutate({ perKind: Number(arg('per-kind') ?? 8) });
  } else if (command === 'write-only') {
    await writeOnly();
  } else {
    console.error('Usage: node scripts/dead-code-accuracy.js <replay|mutate|write-only> [options]');
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

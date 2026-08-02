// scripts/lint/log-manager-init-check.js — guards the roku-log manager's single
// initialization site.
//
// WHY THIS EXISTS
// ---------------
// `log.Logger.new()` resolves `m.global.rLog` ONCE and caches it, and every level
// method then opens with `if m.rLog = invalid then return`. A component built
// before the manager exists therefore logs NOTHING, forever, at any level, on any
// build — silently, with no error and no fallback output. That is the worst shape
// a defect can have: the app builds, runs, passes every test, and simply stops
// producing a class of log line.
//
// It already happened once. `initializeLogManager` lived in `JRScreen.init()` on
// the assumption that a screen always initializes first; `setGlobalNodes()` runs
// before the first screen mounts, so JRScene itself plus RemoteControlTask,
// SceneManager, QueueManager and SideEffectTask never emitted a single line.
// Nobody noticed until someone tried to observe the ws:// receiver on-device and
// found `print` emitting where `m.log.info` did not.
//
// WHY A LINT GATE AND NOT A TEST
// ------------------------------
// There is no test that can catch it. `bsconfig-tests-unit.json` excludes
// `source/Main.bs`, so the bootstrap ordering never runs under Rooibos, and
// `BaseTestSuite` provisions its own `rLog` before any node mounts — so a broken
// app-side init is invisible to the suite. A static gate is the only instrument
// available. See docs/architecture/logging.md.
//
// WHAT IT CHECKS
// --------------
//   1. `log.initializeLogManager` is called in EXACTLY one file: JRScene.bs.
//      A second call is at best a wasted log_Log + Timer node allocation, at
//      worst an earlier call that wins and silently changes the level.
//   2. JRScene.bs's call is the FIRST statement in its `init()`. Anything that
//      constructs a Logger ahead of it (including JRScene's own `m.log`) gets
//      the dead-logger behavior.
//   3. Nothing constructed during the bootstrap window builds a `log.Logger`.
//      Nodes created in `setGlobals()` exist before the manager CAN exist —
//      `log_Log`'s init creates a `Timer`, and Timer creation fails on the main
//      thread before `m.screen.show()` (verified on device, OS 15.2.4). Their
//      loggers are permanently dead, so they must use `print`.
//
// Only Node stdlib — no npm ci needed.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SCENE_REL = 'components/JRScene.bs';
export const GLOBALS_REL = 'source/utils/globals.bs';

// Rule 3 exceptions — nodes created in setGlobals() that DO build a Logger, where
// the dead logger is known and accepted rather than a new mistake.
//
// JellyfinUserSettings: its bootstrap instance loses its init() line and the
// bootstrap `enableAutoSync` call. Accepted because the instance is short-lived —
// SessionDataTransformer.transformUserInfo creates a FRESH JellyfinUserSettings at
// login (source/data/SessionDataTransformer.bs), after the scene is up, and that
// one logs normally. Fixing it would need either a second, lazy logging idiom for
// one node or a bootstrap reorder; neither is worth two startup lines. This is a
// platform limitation, not tech debt — `print` is the correct tool in the
// bootstrap window. Documented in docs/architecture/logging.md.
export const BOOTSTRAP_LOGGER_ALLOWLIST = new Set(['JellyfinUserSettings']);

// Components created in setGlobals() — i.e. BEFORE m.screen.show(), so before the
// log manager can exist. Derived from globals.bs at runtime rather than hardcoded
// so adding a node to setGlobals() is covered automatically.
export const BOOTSTRAP_SCAN_DIRS = ['components'];

// Strip whole-line BrightScript comments so prose mentioning a pattern can't
// satisfy or trip a rule — this file's own subject matter is quoted in comments
// in every file it scans.
function stripComments(src) {
  return src
    .split('\n')
    .map((line) => (/^\s*'/.test(line) ? '' : line))
    .join('\n');
}

/** Extract the node type names created inside `sub setGlobals()`. */
export function bootstrapNodeTypes(globalsSrc) {
  const src = stripComments(globalsSrc);
  // NB: `[ \t]*` not `\s*` — `\s` matches newlines, so `^\s*sub` would match starting
  // at a preceding blank line and throw off every offset computed from the index.
  const start = src.search(/^[ \t]*sub[ \t]+setGlobals[ \t]*\([ \t]*\)/m);
  if (start < 0) return null;
  const rest = src.slice(start);
  const end = rest.search(/^[ \t]*end[ \t]+sub/m);
  const body = end < 0 ? rest : rest.slice(0, end);

  const types = new Set();
  const re = /CreateObject\s*\(\s*"roSGNode"\s*,\s*"([^"]+)"\s*\)/g;
  let m;
  while ((m = re.exec(body)) !== null) types.add(m[1]);
  return types;
}

/**
 * @param {{ files: Map<string,string>, globals: string, scene: string }} input
 *   files — every scanned .bs file, keyed by repo-relative path.
 * @returns {string[]} problems
 */
export function check({ files, globals, scene }) {
  const problems = [];

  // ── Rule 1: exactly one initializeLogManager call site ──────────────────────
  const callers = [];
  for (const [rel, src] of files) {
    if (/\blog\.initializeLogManager\s*\(/.test(stripComments(src))) callers.push(rel);
  }
  const extra = callers.filter((c) => c !== SCENE_REL);
  if (!callers.includes(SCENE_REL)) {
    problems.push(
      `${SCENE_REL}: no \`log.initializeLogManager\` call. The app has NO log manager — every ` +
        'Logger built anywhere will cache invalid and no-op forever.',
    );
  }
  for (const rel of extra) {
    problems.push(
      `${rel}: a second \`log.initializeLogManager\` call. ${SCENE_REL} owns it and is already ` +
        'the earliest point the manager can exist; a duplicate is at best a wasted log_Log + ' +
        'Timer allocation, at worst an earlier call that silently wins with a different level.',
    );
  }

  // ── Rule 2: it is the first statement in JRScene.init() ─────────────────────
  const sceneSrc = stripComments(scene);
  const initIdx = sceneSrc.search(/^[ \t]*sub[ \t]+init[ \t]*\([ \t]*\)/m);
  if (initIdx < 0) {
    problems.push(`${SCENE_REL}: no \`sub init()\` — the manager has nowhere to be initialized.`);
  } else {
    const body = sceneSrc.slice(initIdx).split('\n').slice(1);
    const firstStmt = body.find((l) => l.trim() !== '' && !/^\s*#(if|else|end if)/.test(l));
    if (firstStmt !== undefined && !/log\.initializeLogManager\s*\(/.test(firstStmt)) {
      problems.push(
        `${SCENE_REL}: \`log.initializeLogManager\` is not the first statement in init(). Found ` +
          `\`${firstStmt.trim()}\` first. Anything that builds a Logger ahead of the manager — ` +
          "including JRScene's own `m.log` — caches invalid and no-ops forever.",
      );
    }
  }

  // ── Rule 3: no Logger in a node created during the bootstrap window ─────────
  const bootstrapTypes = bootstrapNodeTypes(globals);
  if (bootstrapTypes === null) {
    problems.push(`${GLOBALS_REL}: could not find \`sub setGlobals()\` — rule 3 cannot run.`);
  } else {
    for (const [rel, src] of files) {
      const type = path.basename(rel, '.bs');
      if (!bootstrapTypes.has(type)) continue;
      if (BOOTSTRAP_LOGGER_ALLOWLIST.has(type)) continue;
      if (/\bnew\s+log\.Logger\s*\(/.test(stripComments(src))) {
        problems.push(
          `${rel}: builds a \`log.Logger\`, but \`${type}\` is created in setGlobals() — before ` +
            '`m.screen.show()`, and therefore before the log manager can exist at all ' +
            "(log_Log's init creates a Timer, which fails on the main thread pre-show). That " +
            'logger caches invalid and no-ops forever. Use `print` in the bootstrap window.',
        );
      }
    }
  }

  return problems;
}

// ── CLI ────────────────────────────────────────────────────────────────────────

function collectBsFiles(rootDir, relDir, out) {
  for (const entry of readdirSync(path.join(rootDir, relDir))) {
    const rel = path.join(relDir, entry);
    const abs = path.join(rootDir, rel);
    if (statSync(abs).isDirectory()) {
      if (entry === 'roku_modules' || entry === 'vendor') continue;
      collectBsFiles(rootDir, rel, out);
    } else if (entry.endsWith('.bs')) {
      out.set(rel.split(path.sep).join('/'), readFileSync(abs, 'utf8'));
    }
  }
}

function main() {
  const argv = process.argv.slice(2);
  const rootIdx = argv.indexOf('--root');
  const rootDir = rootIdx >= 0 ? argv[rootIdx + 1] : '.';

  const files = new Map();
  let globals;
  let scene;
  try {
    for (const dir of [...BOOTSTRAP_SCAN_DIRS, 'source']) collectBsFiles(rootDir, dir, files);
    globals = readFileSync(path.join(rootDir, GLOBALS_REL), 'utf8');
    scene = readFileSync(path.join(rootDir, SCENE_REL), 'utf8');
  } catch (err) {
    console.error(`log-manager-init: ${err.message}`);
    process.exit(2);
  }

  const problems = check({ files, globals, scene });
  if (problems.length === 0) {
    console.log(
      'log-manager-init: single init site, first in JRScene.init, no bootstrap loggers ✓',
    );
    return;
  }
  console.error('log-manager-init: the roku-log initialization contract is broken:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error(
    '\nWhy this blocks: a Logger built before the manager exists caches `invalid` and silently ' +
      'no-ops for its entire life — no output, no error, on any build, at any level. No test can ' +
      'catch it (Rooibos excludes source/Main.bs and provisions its own rLog). See ' +
      'docs/architecture/logging.md.',
  );
  process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();

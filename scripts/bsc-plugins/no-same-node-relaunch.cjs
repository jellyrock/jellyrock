/**
 * BrighterScript plugin — no STOP-then-relaunch of the same Task node.
 *
 * Measured on device (docs/architecture/threading.md, "Measured findings";
 * pinned by tests/source/unit/platform/TaskRelaunch.spec.bs): writing
 * `control = "STOP"` to a Task node whose function is still running, then
 * `launchTask()` on that same node in the same callback, is a race. The launch
 * is sometimes ignored — nothing starts and nothing errors — and sometimes
 * honored. Neither outcome can be relied on. A NEW node launched in that
 * callback always starts, and the stopped function makes no further progress.
 * So a run that can be restarted while the previous one is in flight must get a
 * new node; `ExtrasRowList.startRun` is the reference.
 *
 * What is flagged — a `launchTask(X)` call, in a function that earlier (in
 * source order):
 *   - writes `X.control = "STOP"` (any casing; also `X["control"] = "STOP"`,
 *     `X.setField("control", "STOP")` and a literal `X.setFields({ control: "STOP" })`), or
 *   - passes `X` as the first argument to `releaseTask()` or `replaceTask()`
 *     (source/utils/tasks.bs), which STOP it. They live in another file, so the
 *     same-file helper hop below would never see inside them; they are named here
 *     instead. `m.x = replaceTask(m.x, …)` is the fix and is not flagged: the
 *     assignment lands after the call it wraps. A bare `replaceTask(m.x, …)` whose
 *     result is dropped, then `launchTask(m.x)`, IS flagged — that relaunches the
 *     node the call just stopped. Or
 *   - calls a function or sub declared in the SAME file that STOPs `X` and does
 *     not assign `X` (or a parent of it) afterwards, where `X` is an `m.` path
 *     (one hop: `prepareDataLoad()` then `launchTask(m.loadItemsTask)`). A
 *     helper's locals mean nothing to its caller, so only `m.`-rooted paths
 *     cross the hop.
 *
 * Each function is checked on its own, and an inline `sub(...)` / `function(...)`
 * is a function of its own: a promise callback runs in a later callback, so
 * neither its STOPs, its launches nor its assignments belong to the function
 * that wrote it.
 *
 * What is NOT flagged:
 *   - A STOP after the launch (a timeout that stops the task it just started).
 *   - A launch after `X`, or a parent of it, is assigned between the STOP and the
 *     launch — that is the new-node fix. All three write spellings count:
 *     `X = …` / `m.x = …`, the literal-key `m["x"] = …`, and a literal-AA
 *     `setFields` / `addFields`. Assigning `invalid` counts too: launching
 *     `invalid` fails every time rather than racing, and `launchTask` reports it.
 *   - A STOP in a different function from the launch, other than the one-hop
 *     helper above (e.g. a STOP in a completion handler, then a launch from a later
 *     callback). Those run in different callbacks, and a relaunch from a later
 *     callback is reliable.
 *
 * Known residual gaps, stated rather than chased:
 *   - Source order is not control flow. A STOP in one branch and the launch in
 *     another (`if a then stop else launch`) is flagged though they cannot both
 *     run; one suppression each. No such site exists today.
 *   - Only the STOP crosses the helper hop, not the launch. A function that STOPs
 *     and then calls a helper which launches is missed.
 *   - Helpers are followed one hop, within one file, by bare name. A helper
 *     reached through `m.someMethod()`, another file, or a second hop is missed,
 *     and a namespaced function shares its bare name with any same-named
 *     function in the file. The `m.someMethod()` half is the class-shaped blind
 *     spot, since a class reaches its own methods that way and never by bare
 *     name. Measured 2026-09-17 before leaving it: following dotted `m.<name>()`
 *     calls as well found the same 16 sites and no others, so closing it would
 *     have to be justified by a future site, not a present one. Closing it
 *     properly means resolving BOTH directions by scope — bare to free
 *     functions, `m.x()` to methods of the enclosing class — or a bare call
 *     inherits a same-named method's STOPs, which is the same defect mirrored.
 *   - Paths are compared as written. A STOP through a local alias
 *     (`t = m.task` then `t.control = "STOP"`) followed by `launchTask(m.task)`
 *     is missed.
 *   - A STOP guarded by `if X.state = "run"` is flagged like any other: the guard
 *     is exactly the running case the race needs.
 *
 * Allowed call sites:
 *  - `source/utils/tasks.bs`   (the wrapper itself)
 *  - `components/vendor/**`    (vendored third-party code we don't author)
 *
 * Sites that predate the rule are listed in PENDING_MIGRATIONS below rather than
 * suppressed inline, so there is no marker to copy onto a new site. The list can
 * only shrink, and that is enforced rather than hoped for: EVERY state an entry
 * can be in produces an actionable error except the one where it matches its site.
 * The two halves of that live in different hooks, split by where the fix is made:
 *
 *   afterValidateFile    — a fault in the CODE: the entry's function is there
 *                          and does not relaunch that node. Anchored on the
 *                          function, so BSC clears it when that file re-validates.
 *   afterValidateProgram — a fault in the LIST: the entry cannot be checked. Its
 *                          file may be absent from the build, be one this rule
 *                          never inspects, not be BrightScript, or be spelled in
 *                          a different case; the entry may be listed twice, or
 *                          name a function the file does not have. Anchored on
 *                          the entry's line here and tagged, so the set is
 *                          cleared and re-derived on every validation.
 *
 * Keep that split when adding a state. A diagnostic the file hook anchors
 * outside its own file is never cleared by BSC, so it outlives the fix; and most
 * list faults are invisible to the file hook anyway, which never runs for such a
 * file — without the program half the entry AND the site under it go quiet.
 *
 * An entry that matched nothing yields ONE claim, and never a second one
 * contradicting it about the same node. The plugin sees only what the code does
 * now, so it cannot tell a finished migration from an entry that was always
 * wrong, and says neither. `tests/.../no-same-node-relaunch.test.js` pins every
 * state in one table.
 *
 * Escape hatch, for a relaunch that is intended (state the reason after the code):
 *  - `' bsc-disable-next-line no-same-node-relaunch <reason>` on the line above
 *    the launch, or `' bsc-disable-line …` on it. `bsc-disable-file` is
 *    deliberately NOT honored, as with `no-raw-run` and `no-task-fanout`.
 */
'use strict';

const fs = require('node:fs');
const brighterscript = require('brighterscript');

const CODE = 'no-same-node-relaunch';
// Findings about the LIST rather than about one file. They anchor in this file,
// which no validation clears, so they are tagged and cleared by hand each run.
const AUDIT_TAG = `${CODE}-list-audit`;
const PLUGIN_DEST_PATH = `scripts/bsc-plugins/${CODE}.cjs`;
const ALLOWED_DEST_PATHS = new Set(['source/utils/tasks.bs', 'source/utils/tasks.brs']);
const EXCLUDED_DEST_PREFIXES = ['components/vendor/'];
// Line and next-line only, like the other Task rules: a whole-file opt-out would
// remove the guard from every launch in the file.
const DISABLE_LINE_MARKER = /'\s*bsc-disable-line\s+no-same-node-relaunch\b/i;
const DISABLE_NEXT_LINE_MARKER = /'\s*bsc-disable-next-line\s+no-same-node-relaunch\b/i;

/**
 * Sites that relaunched the same node before this rule existed, each awaiting a
 * move to a new node per run (docs/progress.md, same-node relaunch followup).
 * File → [function, launched path]. Delete an entry when its site is migrated;
 * the build fails until you do.
 */
const PENDING_MIGRATIONS = {
  'components/video/VideoPlayerView.bs': [
    ['loadCaption', 'm.captionTask'],
    ['onSubtitleChange', 'm.captionTask'],
  ],
};

const LAUNCH_FUNCTION = 'launchtask';
const CONTROL_FIELD = 'control';
const STOP_VALUE = 'stop';
const SET_FIELD = 'setfield';
const FIELD_WRITE_METHODS = new Set(['setfields', 'addfields']);
/** tasks.bs helpers that STOP the node passed as their first argument. */
const TASK_RELEASERS = new Set(['releasetask', 'replacetask']);
const SELF_REFERENCE = 'm';

/** The value of a string literal expression, or undefined. */
function stringLiteralValue(expression) {
  if (!brighterscript.isLiteralExpression(expression)) return undefined;
  const raw = expression.tokens?.value?.text;
  if (typeof raw !== 'string') return undefined;
  if (!raw.startsWith('"') || !raw.endsWith('"')) return undefined;
  return raw.slice(1, -1);
}

function isLiteral(expression, wanted) {
  const value = stringLiteralValue(expression);
  return typeof value === 'string' && value.toLowerCase() === wanted;
}

function aaKey(element) {
  const key = element?.tokens?.key?.text ?? element?.key?.text;
  return typeof key === 'string' ? key.replace(/^"|"$/g, '').toLowerCase() : undefined;
}

/**
 * The lowercased dotted path an expression names — `task`, `m.loadtask`,
 * `m.view.task` — or undefined for anything else (an index, a call). Lowercased
 * because BrightScript identifiers and AA keys are case-insensitive.
 */
function refPath(expression) {
  const steps = [];
  let current = expression;
  while (brighterscript.isDottedGetExpression(current)) {
    const step = current.tokens?.name?.text;
    if (!step) return undefined;
    steps.unshift(step.toLowerCase());
    current = current.obj;
  }
  if (!brighterscript.isVariableExpression(current)) return undefined;
  const root = current.tokens?.name?.text;
  if (!root) return undefined;
  return [root.toLowerCase(), ...steps].join('.');
}

/** True when `call` is `launchTask(...)`, bare or with a dotted callee. */
function isLaunchTaskCall(call) {
  const callee = call?.callee;
  if (
    !brighterscript.isVariableExpression(callee) &&
    !brighterscript.isDottedGetExpression(callee)
  ) {
    return false;
  }
  return callee.tokens?.name?.text?.toLowerCase() === LAUNCH_FUNCTION;
}

function start(node) {
  const s = node?.location?.range?.start;
  return s ? s.line * 100000 + s.character : -1;
}

/**
 * Where an assignment TAKES EFFECT: after its right-hand side has run, so at the
 * statement's end. `m.x = replaceTask(m.x, …)` stops `m.x` inside the value and
 * only then rebinds it; positioning the rebind at the statement's start would
 * order it before that stop and flag the fix.
 */
function end(node) {
  const e = node?.location?.range?.end;
  return e ? e.line * 100000 + e.character : -1;
}

/**
 * Every STOP, launch, rebind and bare call in `func`'s own body, each with its
 * source position. Nested function expressions are skipped: they are checked as
 * functions of their own. The walk does not visit in source order, so this sorts.
 */
function collectEvents(func) {
  const events = [];
  const push = (kind, path, node, extra = {}) => {
    if (path === undefined) return;
    events.push({ kind, path, pos: start(node), node, ...extra });
  };
  const pushRebind = (path, statement) => {
    if (path === undefined) return;
    events.push({ kind: 'rebind', path, pos: end(statement), node: statement });
  };
  const skipper = new brighterscript.ChildrenSkipper();

  func.body.walk(
    brighterscript.createVisitor({
      FunctionExpression: () => {
        skipper.skip();
      },
      DottedSetStatement: (statement) => {
        const base = refPath(statement.obj);
        const field = statement.tokens?.name?.text?.toLowerCase();
        if (base === undefined || !field) return;
        if (field === CONTROL_FIELD && isLiteral(statement.value, STOP_VALUE)) {
          push('stop', base, statement);
        }
        pushRebind(`${base}.${field}`, statement);
      },
      IndexedSetStatement: (statement) => {
        const indexes = statement.indexes || [];
        if (indexes.length !== 1) return;
        const base = refPath(statement.obj);
        const key = stringLiteralValue(indexes[0])?.toLowerCase();
        if (base === undefined || !key) return;
        if (key === CONTROL_FIELD && isLiteral(statement.value, STOP_VALUE)) {
          push('stop', base, statement);
        }
        pushRebind(`${base}.${key}`, statement);
      },
      AssignmentStatement: (statement) => {
        const name = statement.tokens?.name?.text;
        if (name) pushRebind(name.toLowerCase(), statement);
      },
      CallExpression: (call) => {
        const callee = call?.callee;
        const args = call.args || [];
        if (isLaunchTaskCall(call)) {
          if (args.length === 1) push('launch', refPath(args[0]), call);
          return;
        }
        if (brighterscript.isVariableExpression(callee)) {
          const name = callee.tokens?.name?.text?.toLowerCase();
          if (name && TASK_RELEASERS.has(name)) {
            if (args.length >= 1) push('stop', refPath(args[0]), call);
            return;
          }
          if (name) push('call', name, call);
          return;
        }
        if (!brighterscript.isDottedGetExpression(callee)) return;
        const method = callee.tokens?.name?.text?.toLowerCase();
        const base = refPath(callee.obj);
        if (base === undefined) return;
        if (method === SET_FIELD) {
          if (
            args.length >= 2 &&
            isLiteral(args[0], CONTROL_FIELD) &&
            isLiteral(args[1], STOP_VALUE)
          ) {
            push('stop', base, call);
          }
          return;
        }
        if (FIELD_WRITE_METHODS.has(method)) {
          if (args.length !== 1 || !brighterscript.isAALiteralExpression(args[0])) return;
          for (const element of args[0].elements || []) {
            const key = aaKey(element);
            if (!key) continue;
            if (key === CONTROL_FIELD && isLiteral(element.value, STOP_VALUE)) {
              push('stop', base, call);
            }
            push('rebind', `${base}.${key}`, call);
          }
        }
      },
    }),
    { walkMode: brighterscript.WalkMode.visitAllRecursive, skipChildren: skipper },
  );
  return events.sort((a, b) => a.pos - b.pos);
}

/** True when `path` itself or any parent of it is in `rebound`. */
function isRebound(path, rebound) {
  const steps = path.split('.');
  for (let end = 1; end <= steps.length; end++) {
    if (rebound.has(steps.slice(0, end).join('.'))) return true;
  }
  return false;
}

/**
 * Replay `events` in order and call `onLaunch(event, via)` for each launch of a
 * node that is still stopped — stopped, and not assigned anew since. A call to a
 * function in `helperStops` stops the paths it lists. Returns the paths still
 * stopped at the end, which is what a helper hands its caller.
 */
function trackStops(events, helperStops, onLaunch) {
  // path -> { rebound: paths assigned since that path's last STOP, via: helper name }
  const stopped = new Map();
  for (const e of events) {
    if (e.kind === 'stop') {
      stopped.set(e.path, { rebound: new Set(), via: undefined });
    } else if (e.kind === 'call') {
      for (const path of helperStops.get(e.path) ?? []) {
        stopped.set(path, { rebound: new Set(), via: e.path });
      }
    } else if (e.kind === 'rebind') {
      for (const state of stopped.values()) state.rebound.add(e.path);
    } else if (e.kind === 'launch') {
      const state = stopped.get(e.path);
      if (state && !isRebound(e.path, state.rebound)) onLaunch(e, state.via);
    }
  }
  return [...stopped]
    .filter(([path, state]) => !isRebound(path, state.rebound))
    .map(([path]) => path);
}

/**
 * Every function in `file`, named or inline, as
 * { name, bareCallable, statement, func }.
 *
 * `name` is the lowercased IDENTITY of a top-level function or a class method —
 * what a PENDING_MIGRATIONS entry names. It is undefined for an inline function,
 * which nothing can name.
 *
 * `bareCallable` is narrower, and the two must not be conflated: only a top-level
 * `function` / `sub` can be reached by the bare `helper()` call the one-hop walk
 * follows. BrightScript reaches a class method as `m.helper()` (`MoviePresenter`
 * calls every one of its own that way), so letting a method answer to its bare
 * name would hand an unrelated global call someone else's STOPs.
 */
function functionsIn(file) {
  const found = [];
  file.parser.ast.walk(
    brighterscript.createVisitor({
      FunctionExpression: (func) => {
        if (!func.body) return;
        // `MethodStatement extends FunctionStatement`, but the guards are
        // kind-based, so a method does NOT satisfy `isFunctionStatement`.
        const bareCallable = brighterscript.isFunctionStatement(func.parent);
        const statement =
          bareCallable || brighterscript.isMethodStatement(func.parent) ? func.parent : undefined;
        found.push({
          name: statement?.tokens?.name?.text?.toLowerCase(),
          bareCallable,
          statement,
          func,
        });
      },
    }),
    { walkMode: brighterscript.WalkMode.visitAllRecursive },
  );
  return found;
}

/**
 * The 0-based line in THIS file where a PENDING_MIGRATIONS entry is written, so a
 * diagnostic about the list opens on the line to edit. With `entry`, finds that
 * entry's own tuple; without one, the file key it sits under. Falls back to 0.
 */
function pendingEntryLine(destPath, entry) {
  try {
    const lines = fs.readFileSync(__filename, 'utf8').split(/\r?\n/);
    if (entry) {
      const at = lines.findIndex(
        (text) => text.includes(`'${entry.fn}'`) && text.includes(`'${entry.path}'`),
      );
      if (at >= 0) return at;
    }
    const at = lines.findIndex((text) => text.includes(`'${destPath}'`));
    if (at >= 0) return at;
  } catch (_e) {
    // Fall through to 0.
  }
  return 0;
}

/** `pendingEntryLine` as a location in this file. */
function pendingEntryLocation(destPath, entry) {
  const line = pendingEntryLine(destPath, entry);
  return brighterscript.util.createLocation(
    line,
    0,
    line,
    0,
    brighterscript.util.pathToUri(__filename),
  );
}

/**
 * The PENDING_MIGRATIONS key naming `destPath`, ignoring case, or undefined.
 * Matched case-INSENSITIVELY on purpose: `program.getFile` already is, so an exact
 * lookup here would have the two disagree — the key would find its file (no
 * missing-file error) while its entries silently matched nothing. The casing is
 * still wrong, and `auditPendingList` reports it; it just does not break the gate
 * while it is wrong.
 */
function pendingKeyFor(pending, destPath) {
  const wanted = destPath.toLowerCase();
  return Object.keys(pending).find((key) => key.toLowerCase() === wanted);
}

/**
 * One file's entries, as a Map of lowercased `function|path` -> the entry AS
 * WRITTEN (original casing, which is what locates it in this file's source and
 * what a message should echo back). A repeated tuple collapses here and is
 * reported by `auditPendingList`.
 */
function entriesFor(pending, destPath) {
  const entries = new Map();
  for (const [fn, path] of pending[pendingKeyFor(pending, destPath)] || []) {
    entries.set(`${fn.toLowerCase()}|${path.toLowerCase()}`, { fn, path });
  }
  return entries;
}

/** The entries listed more than once under `key`, as written. */
function duplicateEntries(pending, key) {
  const seen = new Set();
  const duplicates = [];
  for (const [fn, path] of pending[key] || []) {
    const id = `${fn.toLowerCase()}|${path.toLowerCase()}`;
    if (seen.has(id)) duplicates.push({ fn, path });
    seen.add(id);
  }
  return duplicates;
}

/**
 * True when the rule does not inspect `destPath` at all — the launch wrapper
 * itself, or vendored code we do not author. Shared so the audit can tell when a
 * listed file is one the file hook will silently skip.
 */
function isRuleExempt(destPath) {
  if (ALLOWED_DEST_PATHS.has(destPath)) return true;
  return EXCLUDED_DEST_PREFIXES.some((prefix) => destPath.startsWith(prefix));
}

class NoSameNodeRelaunchPlugin {
  constructor(pending = PENDING_MIGRATIONS) {
    this.name = 'jellyrock-no-same-node-relaunch';
    this.pending = pending;
  }

  afterValidateFile(event) {
    try {
      const file = event.file;
      if (!brighterscript.isBrsFile(file)) return;

      const destPath = (file.destPath || '').replace(/\\/g, '/');
      if (isRuleExempt(destPath)) return;

      const functions = functionsIn(file).map((fn) => ({ ...fn, events: collectEvents(fn.func) }));

      // One hop: the `m.` paths each named function leaves stopped.
      const helperStops = new Map();
      for (const fn of functions) {
        if (!fn.bareCallable) continue;
        const stops = trackStops(fn.events, new Map(), () => {}).filter((path) =>
          path.startsWith(`${SELF_REFERENCE}.`),
        );
        if (stops.length) helperStops.set(fn.name, new Set(stops));
      }

      const unclaimed = entriesFor(this.pending, destPath);
      const reported = new Set();
      for (const fn of functions) {
        trackStops(fn.events, helperStops, (e, via) => {
          const key = `${fn.name}|${e.path}`;
          if (fn.name && unclaimed.delete(key)) return;
          this.report(event.program, file, e.node, e.path, via, reported);
        });
      }

      // Whatever is left described a site this file does not have. An entry whose
      // function is missing is a fault in the LIST, reported on the list by
      // `afterValidateProgram`; only one whose function is here is this file's.
      for (const entry of unclaimed.values()) {
        const fn = functions.find((f) => f.name === entry.fn.toLowerCase());
        if (fn) this.reportStaleEntry(event.program, fn, destPath, entry);
      }
    } catch (_e) {
      // Never crash the build.
    }
  }

  report(program, file, call, path, via, reported) {
    const range = call?.location?.range;
    if (!range) return;
    const key = `${range.start.line}:${range.start.character}`;
    if (reported.has(key)) return;
    const lines = (file.fileContents || '').split(/\r?\n/);
    if (DISABLE_LINE_MARKER.test(lines[range.start.line] ?? '')) return;
    if (range.start.line > 0 && DISABLE_NEXT_LINE_MARKER.test(lines[range.start.line - 1] ?? '')) {
      return;
    }
    reported.add(key);

    const where = via ? ` (stopped inside \`${via}()\`)` : '';
    program.diagnostics.register({
      code: CODE,
      severity: 1, // Error
      source: this.name,
      message:
        `\`${path}\` is stopped${where} and relaunched in the same function. If its task is still running, the relaunch is a race: it is sometimes silently ignored. ` +
        'Launch a new node for each run instead (ExtrasRowList.startRun is the reference). ' +
        'Evidence: docs/architecture/threading.md (Measured findings). ' +
        `Add ' bsc-disable-next-line ${CODE} <reason> above the launch to suppress.`,
      location: call.location,
    });
  }

  /**
   * The whole-program half of the ledger: whether each entry CAN be checked at
   * all. Most of these are invisible to `afterValidateFile` — a key whose file
   * never reaches the rule never gets reconciled, so without this the entry (and
   * the real violation under it) would simply go quiet. A missing function is
   * visible there, but it is a fault in the list, so it is reported here with
   * the rest.
   *
   * Anchored on the entry's own line in this file, because the edit is here.
   * Tagged, so the set is cleared and re-derived on every validation.
   */
  afterValidateProgram(event) {
    try {
      const { program } = event;
      program.diagnostics.clearForTag(AUDIT_TAG);

      const flag = (destPath, entry, message) =>
        program.diagnostics.register(
          {
            code: CODE,
            severity: 1, // Error
            source: this.name,
            message,
            location: pendingEntryLocation(destPath, entry),
          },
          { tags: [AUDIT_TAG] },
        );

      for (const key of Object.keys(this.pending)) {
        const listed = program.getFile(key);
        if (!listed) {
          flag(
            key,
            undefined,
            `PENDING_MIGRATIONS lists \`${key}\`, which is not in the build (moved, renamed or deleted). ` +
              'Update or delete its entries: an entry for a missing file would silently cover a file that later appears at that path.',
          );
          continue;
        }

        const destPath = (listed.destPath || '').replace(/\\/g, '/');
        if (destPath !== key) {
          flag(
            key,
            undefined,
            `PENDING_MIGRATIONS lists \`${key}\`, but the file in the build is \`${destPath}\`. ` +
              'Match the casing: the lookup tolerates it, but nothing else in the build does.',
          );
        }

        // Past either of these the file hook never reconciles the entries, so
        // nothing below could be checked either.
        if (isRuleExempt(destPath)) {
          flag(
            key,
            undefined,
            `PENDING_MIGRATIONS lists \`${key}\`, which this rule never inspects (it is the launch wrapper, or vendored). ` +
              'Its entries can never be checked or retired, so delete them — and note the rule is not guarding that file at all.',
          );
          continue;
        }
        if (!brighterscript.isBrsFile(listed)) {
          flag(
            key,
            undefined,
            `PENDING_MIGRATIONS lists \`${key}\`, which is not a BrightScript file, so its entries can never be checked. ` +
              'Key them by the `.bs` / `.brs` file that holds the function.',
          );
          continue;
        }

        for (const entry of duplicateEntries(this.pending, key)) {
          flag(
            key,
            entry,
            `PENDING_MIGRATIONS lists \`${entry.fn}\` / \`${entry.path}\` in \`${key}\` more than once. ` +
              'Only the first can ever be retired; delete the duplicate.',
          );
        }

        const names = new Set(functionsIn(listed).map((fn) => fn.name));
        for (const entry of entriesFor(this.pending, key).values()) {
          if (names.has(entry.fn.toLowerCase())) continue;
          flag(
            key,
            entry,
            `PENDING_MIGRATIONS names \`${entry.fn}()\` in ${destPath}, and no function or method by that name is there. ` +
              'If it was renamed, point the entry at the new name; if the site is gone, delete the entry.',
          );
        }
      }
    } catch (_e) {
      // Never crash the build.
    }
  }

  /**
   * A listed entry whose function is here but does not relaunch that node. The
   * plugin sees only what the code does NOW, so it CANNOT tell a finished
   * migration from an entry that never matched — so the message claims neither.
   * It reports what it checked and leaves the judgment to the reader.
   *
   * Anchored on the function, in the file being validated, so BSC clears it when
   * that file next re-validates.
   */
  reportStaleEntry(program, fn, destPath, entry) {
    const entryLine = pendingEntryLine(destPath, entry) + 1;
    program.diagnostics.register({
      code: CODE,
      severity: 1, // Error
      source: this.name,
      message:
        `\`${entry.fn}()\` does not stop and relaunch \`${entry.path}\` in ${destPath}. ` +
        'If you migrated it, delete its PENDING_MIGRATIONS entry; if the entry is wrong, correct it. ' +
        `Its entry is at ${PLUGIN_DEST_PATH}:${entryLine}.`,
      location: fn.statement.tokens.name.location,
    });
  }
}

module.exports = () => new NoSameNodeRelaunchPlugin();
// Tests pass their own list, so they do not depend on which sites are still pending.
module.exports.withPendingMigrations = (pending) => () => new NoSameNodeRelaunchPlugin(pending);
module.exports.PENDING_MIGRATIONS = PENDING_MIGRATIONS;

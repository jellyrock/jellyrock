/**
 * BrighterScript plugin — no Task fan-out from a loop.
 *
 * `no-raw-run` forces every Task launch through `launchTask()` so the live
 * thread count stays derivable. It does NOT stop someone launching a thread
 * per item: `for each library ... launchTask(<a fresh node>)` passes it
 * cleanly, and that is precisely the shape that produced epic #728's `&h29`
 * "too many task threads".
 *
 * The original crash site, removed in PR #762 (`HomeRows.bs`, pre-`c59e96a1`):
 *
 *     for each library in m.filteredLatest
 *       loadLatest = createObject("roSGNode", "LoadItemsTask")
 *       m.latestMediaTasks.push(loadLatest)
 *       loadLatest.control = "RUN"          ' one thread per library
 *     end for
 *
 * Worth stating because it is the reason this plugin exists rather than an
 * `onDestroy` rule: **that code already had correct teardown.**
 * `cleanupLatestMediaTasks()` stopped and unobserved every task, both before a
 * new run and on destroy. The crash was concurrent launches *within a single
 * Home load*, not threads leaked across navigation — so teardown discipline
 * would not have prevented it, and a bound on simultaneous launches would.
 *
 * `tech-debt.md#task-thread-budget` direction (2) records a 2026-08-02 sweep
 * finding no remaining per-item Task fan-out, re-confirmed 2026-08-22. A sweep
 * is true on the day it runs; this plugin is what keeps it true.
 *
 * ── What is flagged ────────────────────────────────────────────────────────
 *
 * A `launchTask(<arg>)` call lexically inside a `for` / `for each` / `while`
 * body, unless `<arg>` is a stable field path rooted at `m` that the loop body
 * does not rebind — see below.
 *
 * ── What is NOT flagged, and why ───────────────────────────────────────────
 *
 * `launchTask(m.SomeTask)` and `launchTask(m.view.someTask)` — a dotted path
 * rooted at `m`, with no indexing, that the loop does not rebind. That names ONE
 * node however many times the loop turns, so the thread count is bounded by the
 * number of distinct field paths written in the source, not by the collection
 * being iterated. This is the live shape in `HomeRows.startParallelLoads()`,
 * which loops over `m.sectionPlan` and launches four fixed singleton slots, each
 * additionally guarded by an `m.isLoadingX` flag.
 *
 * An indexed step anywhere in the path (`m.tasks[i]`) IS flagged — a computed
 * index is a per-iteration node wearing an `m.` prefix. A literal key
 * (`m["loader"]`) is every bit as stable as `m.loader` but is flagged too: the
 * rule reads dotted steps only, and that shape appears nowhere in the codebase.
 * Suppress the one line if it ever does.
 *
 * Note the deliberate asymmetry with `slotsAssignedIn`, which DOES resolve a
 * literal key. It is not an oversight — both halves err the same way, toward
 * reporting. Resolving the key on the write side makes the rule stricter (one
 * more way to catch a rebind); declining to resolve it on the launch side also
 * makes it stricter (a stable slot loses its exemption). Were either reversed,
 * a launch would slip through.
 *
 * ── An `m.` slot is only stable while the loop leaves it alone ──────────────
 *
 * Parking a freshly built node in an `m.` field does not make it one node:
 *
 *     for each lib in m.libs
 *       m.loader = createObject("roSGNode", "LoadItemsTask")
 *       launchTask(m.loader)              ' still one thread per library
 *     end for
 *
 * Nothing STOPs the node the previous turn launched and the loop never waits, so
 * N threads start inside one pass — #728's property exactly, wearing the shape
 * that would otherwise earn the stable-slot exemption. That matters more than it
 * looks: hoisting a flagged local into an `m.` field is the first thing someone
 * reaches for to clear the diagnostic, it is idiomatic here (`QueueManager` and
 * `JRScene` both build Task nodes straight into an `m.` slot at a call site),
 * and it preserves the bug.
 *
 * So a stable slot loses its exemption when the loop body assigns that path — or
 * any prefix of it, since `m.view = <fresh>` then `launchTask(m.view.task)` is
 * the same trick one level up.
 *
 * Deliberate trade: a lazily-initialized singleton (`if not isValid(m.loader)
 * then m.loader = ...` inside the loop) builds one node and is flagged anyway.
 * Rare, absent from the codebase, and one suppression comment away — the rule
 * would rather over-report a launch than reason about which branch ran.
 *
 * ── Known residual gaps, stated rather than chased ─────────────────────────
 *
 * Two are interprocedural, and closing either needs call-graph analysis this
 * plugin family does not do:
 *
 *  1. A loop that calls a helper which launches internally
 *     (`for each lib ... loadLibrary(lib)`, where `loadLibrary` launches).
 *  2. A local aliased to a stable slot before the loop
 *     (`task = m.LoadX` then `launchTask(task)` inside the loop) is flagged,
 *     though it is safe. Contrived, absent from the codebase, and the escape
 *     hatch covers it — `observe-without-on-destroy` pays real complexity for
 *     alias-awareness because its false positives are routine; here they are
 *     hypothetical.
 *
 * One is not interprocedural: a rebind through a COMPUTED index
 * (`m[someVar] = ...`) is not collected, because which field it names is not
 * knowable statically. Treating it as rebinding every slot would flag correct
 * code to guard a shape nobody writes. (The *literal*-key form, `m["loader"] =
 * ...`, IS collected — see `slotsAssignedIn`.)
 *
 * Catching the direct forms is still strictly better than catching nothing: they
 * are the shape #728 actually took, and the one-token escape from it.
 *
 * ── The sanctioned fix ─────────────────────────────────────────────────────
 *
 * One orchestrator Task servicing every item, keeping a bounded number of
 * requests in flight on the 3-slot API pool — `LoadLatestRowsTask` is the
 * reference implementation, `source/api/apiPipeline.bs` the mechanism.
 * Mechanism is chosen per orchestrator from a measured wait/emit split, never
 * carried across; see `docs/architecture/tech-debt.md#task-thread-budget`.
 *
 * Allowed call sites:
 *  - `source/utils/tasks.bs`   (the wrapper itself)
 *  - `components/vendor/**`    (vendored third-party code we don't author)
 *
 * Escape hatch:
 *  - `' bsc-disable-line no-task-fanout` on the offending line
 *  - `' bsc-disable-next-line no-task-fanout` on the line above
 */
'use strict';

const brighterscript = require('brighterscript');

const ALLOWED_DEST_PATHS = new Set(['source/utils/tasks.bs', 'source/utils/tasks.brs']);
const EXCLUDED_DEST_PREFIXES = ['components/vendor/'];
const DISABLE_LINE_MARKER = /'\s*bsc-disable-line\s+no-task-fanout\b/i;
const DISABLE_NEXT_LINE_MARKER = /'\s*bsc-disable-next-line\s+no-task-fanout\b/i;

const LAUNCH_FUNCTION = 'launchtask';
const FIELD_WRITE_METHODS = new Set(['setfields', 'addfields']);
const SELF_REFERENCE = 'm';

/**
 * The lowercased dotted path `expression` names when it is rooted at the `m`
 * scope object and every step is a plain dotted step — `"m"`, `"m.a"`,
 * `"m.a.b"`. Returns undefined for anything else: an indexed step
 * (`m.tasks[i]`), a bare local, a call result.
 */
function mPath(expression) {
  const steps = [];
  let current = expression;
  // Unwrap the dotted chain right-to-left; anything other than a dotted step
  // (an index, a call, a grouping) disqualifies the whole path.
  while (brighterscript.isDottedGetExpression(current)) {
    const step = current.tokens?.name?.text;
    if (!step) return undefined;
    steps.unshift(step.toLowerCase());
    current = current.obj;
  }
  if (!brighterscript.isVariableExpression(current)) return undefined;
  if (current.tokens?.name?.text?.toLowerCase() !== SELF_REFERENCE) return undefined;
  return [SELF_REFERENCE, ...steps].join('.');
}

/**
 * The lowercased key of a literal-string index — `"loader"` for `m["loader"]`.
 * Returns undefined for a computed index (`m[key]`), whose target is not
 * knowable statically, and for a non-string literal (`m[3]`).
 *
 * Lowercased because BrightScript AA keys are case-insensitive, so
 * `m["Loader"]` and `m.loader` are the same field and must collide here.
 *
 * Two of the four checks here are redundant against today's AST, established by
 * mutation rather than assumed — removing either alone leaves the suite green:
 * a computed index is already rejected by the `typeof raw !== 'string'` check
 * (its token carries `name`, not `value`), and a non-string literal like `m[3]`
 * is rejected by the quote check AND, independently, by the length guard
 * (`"3".slice(1, -1)` is empty). They are kept as type preconditions so the
 * function is correct by construction rather than by that coincidence, and
 * because this mirrors `no-raw-run.cjs`'s `stringLiteralValue` — a reader
 * comparing the two plugins should find the same idiom, not a subtly pruned
 * variant of it.
 */
function literalIndexKey(expression) {
  if (!brighterscript.isLiteralExpression(expression)) return undefined;
  const raw = expression.tokens?.value?.text;
  if (typeof raw !== 'string') return undefined;
  if (!raw.startsWith('"') || !raw.endsWith('"')) return undefined;
  const key = raw.slice(1, -1);
  return key.length > 0 ? key.toLowerCase() : undefined;
}

/**
 * The path of a stable field slot — an `m.` path with at least one dotted step.
 * A bare `m` is the scope object, not a task node, so it is not a slot.
 *
 * Such a path resolves to the same node on every turn of a loop *provided the
 * loop does not rebind it* — see `slotIsReboundIn`.
 */
function stableSlotPath(expression) {
  const path = mPath(expression);
  return path === SELF_REFERENCE ? undefined : path;
}

/**
 * Every `m.` path assigned anywhere inside `loop`'s subtree, e.g. `m.loader` for
 * `m.loader = createObject(...)`.
 *
 * Both spellings of a write are collected — `m.loader = ...` and the
 * literal-key indexed form `m["loader"] = ...` — because they name the same
 * field and mixing them across the write and the launch would otherwise slip
 * the check. That mixed form has no call site today (every one of the ~50
 * bracket writes in the app targets a plain AA — `params`, `headers` — never
 * `m`), so this buys robustness rather than a caught bug; it costs a few lines
 * and, since a literal key is statically known, cannot false-positive.
 *
 * The third spelling is a literal-AA `setFields` / `addFields`
 * (`m.global.addFields({ loader: <fresh> })`). That one has real precedent —
 * `globals.bs:120` and `:163` park Task nodes exactly that way — so a loop doing
 * it is the likeliest of the three to be written. Covering it also lines this
 * plugin up with `no-raw-run.cjs`, which already inspects literal-AA
 * `setFields`, so the two Task rules read the same set of write spellings.
 *
 * Two forms are deliberately NOT collected, both because the target is not
 * knowable statically and treating them as rebinding every slot would flag
 * correct code to guard a shape nobody writes: a COMPUTED key
 * (`m[someVar] = ...`), and a non-literal `setFields(someVariable)` — the same
 * limitation `no-raw-run` documents, for the same reason. They stay accepted
 * gaps, on the same footing as the interprocedural ones.
 */
function slotsAssignedIn(loop) {
  const assigned = new Set();
  loop.walk(
    brighterscript.createVisitor({
      // m.loader = <value>
      DottedSetStatement: (statement) => {
        const base = mPath(statement.obj);
        const field = statement.tokens?.name?.text;
        if (base === undefined || !field) return;
        assigned.add(`${base}.${field.toLowerCase()}`);
      },
      // m["loader"] = <value> — the same field, spelled the other way.
      IndexedSetStatement: (statement) => {
        const indexes = statement.indexes || [];
        if (indexes.length !== 1) return;
        const base = mPath(statement.obj);
        const field = literalIndexKey(indexes[0]);
        if (base === undefined || field === undefined) return;
        assigned.add(`${base}.${field}`);
      },
      // m.view.setFields({ task: <value> }) / m.global.addFields({ ... }) —
      // the same write through ifSGNodeField. Only a literal AA can be read;
      // see the docblock on the non-literal form.
      CallExpression: (call) => {
        const callee = call?.callee;
        if (!brighterscript.isDottedGetExpression(callee)) return;
        if (!FIELD_WRITE_METHODS.has(callee.tokens?.name?.text?.toLowerCase())) return;
        const args = call.args || [];
        if (args.length !== 1 || !brighterscript.isAALiteralExpression(args[0])) return;
        const base = mPath(callee.obj);
        if (base === undefined) return;
        for (const element of args[0].elements || []) {
          const key = element?.tokens?.key?.text ?? element?.key?.text;
          if (typeof key !== 'string') continue;
          assigned.add(`${base}.${key.replace(/^"|"$/g, '').toLowerCase()}`);
        }
      },
    }),
    { walkMode: brighterscript.WalkMode.visitAllRecursive },
  );
  return assigned;
}

/**
 * True when the loop rebinds `slotPath` itself or any parent of it — `m.view =
 * <fresh>` makes `m.view.task` a different node each turn just as surely as
 * `m.task = <fresh>` does.
 */
function slotIsReboundIn(slotPath, assignedPaths) {
  if (assignedPaths.size === 0) return false;
  const steps = slotPath.split('.');
  // Start at 2: `steps[0]` is the bare `m` root, which is never a slot.
  for (let end = 2; end <= steps.length; end++) {
    if (assignedPaths.has(steps.slice(0, end).join('.'))) return true;
  }
  return false;
}

/** True when `call` is a call to the `launchTask()` free function. */
function isLaunchTaskCall(call) {
  const callee = call?.callee;
  if (!brighterscript.isVariableExpression(callee)) return false;
  return callee.tokens?.name?.text?.toLowerCase() === LAUNCH_FUNCTION;
}

class NoTaskFanoutPlugin {
  constructor() {
    this.name = 'jellyrock-no-task-fanout';
  }

  afterValidateFile(event) {
    try {
      const file = event.file;
      if (!brighterscript.isBrsFile(file)) return;

      const destPath = (file.destPath || '').replace(/\\/g, '/');
      if (ALLOWED_DEST_PATHS.has(destPath)) return;
      if (EXCLUDED_DEST_PREFIXES.some((prefix) => destPath.startsWith(prefix))) return;

      const sourceLines = (file.fileContents || '').split(/\r?\n/);

      // A call inside nested loops is reached once per enclosing loop —
      // measured, not assumed: the walk hits an inner `launchTask` twice at an
      // identical position. Reports are keyed by position to keep one
      // diagnostic per site.
      //
      // Belt-and-braces: `diagnostics.register` also collapses identical
      // diagnostics, so removing this changes no observable output today (a
      // mutation confirmed the suite stays green without it). It is kept
      // because that collapsing is undocumented compiler behaviour, and the
      // cost of not depending on it is four lines.
      const reported = new Set();

      const report = (call) => {
        const range = call?.location?.range;
        if (!range) return;

        const key = `${range.start.line}:${range.start.character}`;
        if (reported.has(key)) return;
        reported.add(key);

        const sourceLine = sourceLines[range.start.line] ?? '';
        if (DISABLE_LINE_MARKER.test(sourceLine)) return;
        const prevLine = range.start.line > 0 ? (sourceLines[range.start.line - 1] ?? '') : '';
        if (DISABLE_NEXT_LINE_MARKER.test(prevLine)) return;

        event.program.diagnostics.register({
          code: 'no-task-fanout',
          severity: 1, // Error
          source: this.name,
          message:
            "Launching a Task from a loop spawns one thread per iteration, so the count scales with server data — this is the shape that caused epic #728 (`&h29` too many task threads). Launch a fixed `m.<field>` slot the loop does not rebind, or service every item from one orchestrator Task over `apiPipeline` (see `LoadLatestRowsTask`). Details: docs/architecture/tech-debt.md#task-thread-budget. Add ' bsc-disable-line no-task-fanout to suppress.",
          location: call.location,
        });
      };

      // Walk the body of each loop for launch calls, rather than walking every
      // call and reconstructing its ancestry — the AST carries no parent links.
      const inspectLoopBody = (loop) => {
        // Collected at most once per loop, and only once a stable-slot launch
        // is actually found — the vast majority of loops contain no launch at
        // all, and this hook runs per keystroke in the language server.
        let reboundSlots;
        const loopRebinds = (slot) => {
          if (reboundSlots === undefined) reboundSlots = slotsAssignedIn(loop);
          return slotIsReboundIn(slot, reboundSlots);
        };

        loop.walk(
          brighterscript.createVisitor({
            CallExpression: (call) => {
              if (!isLaunchTaskCall(call)) return;
              const args = call.args || [];
              // A launch with no argument, or a computed/multi-arg form, cannot
              // be shown stable — report rather than assume it is safe.
              if (args.length !== 1) {
                report(call);
                return;
              }
              const slot = stableSlotPath(args[0]);
              if (slot !== undefined && !loopRebinds(slot)) return;
              report(call);
            },
          }),
          { walkMode: brighterscript.WalkMode.visitAllRecursive },
        );
      };

      const visitor = brighterscript.createVisitor({
        ForStatement: inspectLoopBody,
        ForEachStatement: inspectLoopBody,
        WhileStatement: inspectLoopBody,
      });

      file.parser.ast.walk(visitor, {
        walkMode: brighterscript.WalkMode.visitAllRecursive,
      });
    } catch (_e) {
      // Never crash the build.
    }
  }
}

module.exports = () => new NoTaskFanoutPlugin();

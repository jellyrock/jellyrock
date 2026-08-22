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
 * body, unless `<arg>` is a stable field path rooted at `m` — see below.
 *
 * ── What is NOT flagged, and why ───────────────────────────────────────────
 *
 * `launchTask(m.SomeTask)` and `launchTask(m.view.someTask)` — a dotted path
 * rooted at `m` with no indexing. That names ONE node however many times the
 * loop turns, so the thread count is bounded by the number of distinct field
 * paths written in the source, not by the collection being iterated. This is
 * the live shape in `HomeRows.startParallelLoads()`, which loops over
 * `m.sectionPlan` and launches four fixed singleton slots, each additionally
 * guarded by an `m.isLoadingX` flag.
 *
 * An indexed step anywhere in the path (`m.tasks[i]`) IS flagged — that is a
 * per-iteration node wearing an `m.` prefix.
 *
 * ── Known residual gaps, stated rather than chased ─────────────────────────
 *
 * Both are interprocedural, and closing either needs call-graph analysis this
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
 * Catching the direct form is still strictly better than catching nothing: it
 * is the shape #728 actually took.
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
const SELF_REFERENCE = 'm';

/**
 * True when `expression` names a stable field slot: a dotted path rooted at the
 * `m` variable, with no indexed step at any level (`m.A`, `m.a.b` — but not
 * `m.tasks[i]`, and not a bare local or a call result).
 *
 * Such a path resolves to the same node on every turn of a loop, so it cannot
 * be the per-iteration fan-out this plugin exists to stop.
 */
function isStableSlot(expression) {
  let current = expression;
  // Unwrap the dotted chain right-to-left; anything other than a dotted step
  // (an index, a call, a grouping) disqualifies the whole path.
  while (brighterscript.isDottedGetExpression(current)) {
    current = current.obj;
  }
  return (
    brighterscript.isVariableExpression(current) &&
    current.tokens?.name?.text?.toLowerCase() === SELF_REFERENCE &&
    // A bare `m` is not a task node; require at least one dotted step.
    current !== expression
  );
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
            "Launching a Task from a loop spawns one thread per iteration, so the count scales with server data — this is the shape that caused epic #728 (`&h29` too many task threads). Launch a fixed `m.<field>` slot, or service every item from one orchestrator Task over `apiPipeline` (see `LoadLatestRowsTask`). Details: docs/architecture/tech-debt.md#task-thread-budget. Add ' bsc-disable-line no-task-fanout to suppress.",
          location: call.location,
        });
      };

      // Walk the body of each loop for launch calls, rather than walking every
      // call and reconstructing its ancestry — the AST carries no parent links.
      const inspectLoopBody = (loop) => {
        loop.walk(
          brighterscript.createVisitor({
            CallExpression: (call) => {
              if (!isLaunchTaskCall(call)) return;
              const args = call.args || [];
              // A launch with no argument, or a computed/multi-arg form, cannot
              // be shown stable — report rather than assume it is safe.
              if (args.length === 1 && isStableSlot(args[0])) return;
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

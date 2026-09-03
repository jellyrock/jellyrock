/**
 * BrighterScript plugin — detach observers before releasing the references
 * their handlers dereference.
 *
 * The observer half of the teardown-race class that ADR 0032 closes for key
 * events. An EXTERNAL writer — a Task thread, or the native playback engine —
 * can update an observed field just as teardown begins, and that callback is
 * delivered while `onDestroy` is still running. If `onDestroy` has already set
 * a reference the handler dereferences to `invalid`, the handler dots into
 * `invalid` and throws `&hec`. This is what #733 was: `destroyPlayer` sets
 * `control="stop"`, queuing one last `position` update, BEFORE `onDestroy`
 * detaches the `position` observer.
 *
 * The property is CROSS-REFERENCE ORDERING inside one `onDestroy`:
 *
 *     is a reference released while a handler that dereferences it
 *     is still attached?
 *
 * It is emphatically NOT "how many unguarded reads are there" (a read-site
 * count returns ~636 and means nothing), and not "does any unobserve follow any
 * release" (that flags 62 sites, effectively all of them noise, because the
 * paired `m.foo.unobserveField(…)` / `m.foo = invalid` idiom trips it).
 *
 * Three things make the rule precise enough to be worth a diagnostic:
 *
 *   1. Handlers bind by (TARGET, FIELD), not by field name alone. Six tasks all
 *      observe `"content"`; binding on the field alone cross-matches every one
 *      of them to every other one's handler.
 *   2. Only RECEIVER-POSITION uses count — `m.X.foo`, `m.X.foo()`, `m.X[i]`.
 *      Reading a released `m.X` into a variable yields `invalid` and a write to
 *      `m.X` replaces it; neither throws. Only dotting INTO it does.
 *   3. A handler that `isValid(m.X)`-checks the reference has handled the case
 *      itself and is not flagged.
 *
 * Severity 2 (warning), matching `observe-without-on-destroy` — the house split
 * is that structural-absence rules error (`jrscreen-on-destroy`,
 * `auto-abandon-promises`, `auto-destroyed-guard`) while inference-heavy ones
 * warn. This rule infers a handler binding through an alias graph, so a wrong
 * call must never block a push.
 *
 * The fix a hit asks for is REORDERING, not a guard: move the `unobserveField`
 * above the first release. Reordering suppresses nothing, whereas an early
 * return in an observer callback can skip a callback that legitimately runs
 * during teardown (stop-reporting, dialog cleanup) — which is exactly why
 * `auto-destroyed-guard` is deliberately not extended to observer callbacks.
 *
 * Escape hatch:
 *  - `' bsc-disable-line unobserve-before-release` on the unobserveField line
 *  - `' bsc-disable-next-line unobserve-before-release` on the line above
 *  - `' bsc-disable-file unobserve-before-release` anywhere in the file
 *
 * Known gaps, both toward FALSE NEGATIVES (the safe direction for a rule whose
 * whole value is that a hit means something):
 *  - Detachment or release reached through a HELPER is invisible.
 *    `ExtrasRowList.onDestroy` calls `cancelInFlightChain()` as its first
 *    statement, which correctly stops 19 tasks and detaches their observers;
 *    this rule neither credits nor blames it.
 *  - A handler named by a non-literal, or observed on a target this file never
 *    names, is not bound to anything.
 *  - `isValid(m.X)` anywhere in a handler clears `m.X` for that handler, even
 *    if some path reads it unguarded.
 */
'use strict';

const brighterscript = require('brighterscript');

const ON_DESTROY = 'onDestroy';
const DIAGNOSTIC_CODE = 'unobserve-before-release';
const DISABLE_FILE_MARKER = /'\s*bsc-disable-file\s+unobserve-before-release\b/i;
const DISABLE_LINE_MARKER = /'\s*bsc-disable-line\s+unobserve-before-release\b/i;
const DISABLE_NEXT_LINE_MARKER = /'\s*bsc-disable-next-line\s+unobserve-before-release\b/i;
const VALIDITY_CHECKS = new Set(['isvalid', 'isvalidandnotempty']);

class UnobserveBeforeReleasePlugin {
  constructor() {
    this.name = 'jellyrock-unobserve-before-release';
  }

  afterValidateFile(event) {
    try {
      const file = event.file;
      if (!brighterscript.isBrsFile(file)) return;
      if (!hasSiblingComponentXml(event.program, file)) return;

      const contents = file.fileContents;
      if (typeof contents === 'string' && DISABLE_FILE_MARKER.test(contents)) return;

      const functions = topLevelFunctions(file);
      const onDestroy = functions.get(ON_DESTROY.toLowerCase());
      if (!onDestroy) return;

      const { aliases, observations } = collectObservations(file);
      if (observations.length === 0) return;

      const sourceLines = (contents || '').split(/\r?\n/);
      for (const hit of findOrderingHits(onDestroy, observations, aliases, functions)) {
        const line = hit.location?.range?.start?.line;
        if (typeof line === 'number') {
          if (DISABLE_LINE_MARKER.test(sourceLines[line] ?? '')) continue;
          if (line > 0 && DISABLE_NEXT_LINE_MARKER.test(sourceLines[line - 1] ?? '')) continue;
        }
        if (!hit.location) continue;

        event.program.diagnostics.register({
          code: DIAGNOSTIC_CODE,
          severity: 2, // Warning — the binding is inferred, so never block a push.
          source: this.name,
          message:
            `${hit.unobserveMethod}("${hit.field}") on '${hit.target}' runs AFTER ${ON_DESTROY} released ` +
            `'m.${hit.releasedRef}', which its handler ${hit.handler}() dereferences. An external writer (a Task ` +
            `thread, or the native playback engine) can deliver this field one last time while ${ON_DESTROY} is ` +
            `still running, and the handler then dots into invalid (&hec) — the #733 shape. Move this ` +
            `${hit.unobserveMethod} above the first reference release in ${ON_DESTROY}; reordering is the fix, not ` +
            `an early return, which would also skip callbacks that legitimately run during teardown. Add ` +
            `' bsc-disable-next-line ${DIAGNOSTIC_CODE} to suppress.`,
          location: hit.location,
        });
      }
    } catch (_e) {
      // Never crash the build.
    }
  }
}

// ── analysis ────────────────────────────────────────────────────────────────

// Every `<target>.observeField("<field>", "<handler>")` in the file, plus the
// alias graph that says which reference texts name the same node.
function collectObservations(brsFile) {
  const aliases = new UnionFind();
  const observations = [];

  const visitor = brighterscript.createVisitor({
    AssignmentStatement: (stmt) => {
      const lhs = stmt.tokens?.name?.text;
      const rhs = referenceText(stmt.value);
      if (lhs && rhs) aliases.union(lhs, rhs);
    },
    DottedSetStatement: (stmt) => {
      const base = referenceText(stmt.obj);
      const name = stmt.tokens?.name?.text;
      const rhs = referenceText(stmt.value);
      if (base && name && rhs) aliases.union(`${base}.${name}`, rhs);
    },
    CallExpression: (call) => {
      const callee = call?.callee;
      if (!brighterscript.isDottedGetExpression(callee)) return;
      const method = callee.tokens?.name?.text;
      const scoped = method === 'observeFieldScoped';
      if (method !== 'observeField' && !scoped) return;

      const field = literalText(call.args?.[0]);
      const handler = literalText(call.args?.[1]);
      const target = referenceText(callee.obj);
      if (!field || !handler || !target) return;

      observations.push({ target, field, handler, scoped });
    },
  });

  brsFile.parser.ast.walk(visitor, { walkMode: brighterscript.WalkMode.visitAllRecursive });
  return { aliases, observations };
}

// Walks onDestroy in source order, tracking which `m.<ref>`s have been released,
// and reports every still-attached observer whose handler dereferences one.
function findOrderingHits(onDestroy, observations, aliases, functions) {
  const released = new Map(); // lowercased ref → the ref as written
  const hits = [];
  const seen = new Set();
  // One walk per handler, not one per (unobserve x observation) pair — a file
  // like ItemDetails pairs ~30 unobserves against ~30 observations, and this
  // runs on every validate, including in the language server as you type.
  const handlerCache = new Map();
  const handlerFacts = (name, fnStmt) => {
    let facts = handlerCache.get(name);
    if (!facts) {
      facts = analyzeHandler(fnStmt);
      handlerCache.set(name, facts);
    }
    return facts;
  };

  const visitor = brighterscript.createVisitor({
    DottedSetStatement: (stmt) => {
      // `m.<ref> = invalid` — a release. `m.<ref>.<field> = …` is not.
      if (!isMRoot(stmt.obj)) return;
      if (!isInvalidLiteral(stmt.value)) return;
      const name = stmt.tokens?.name?.text;
      if (name) released.set(name.toLowerCase(), name);
    },
    CallExpression: (call) => {
      if (released.size === 0) return;
      const callee = call?.callee;
      if (!brighterscript.isDottedGetExpression(callee)) return;
      const method = callee.tokens?.name?.text;
      const scoped = method === 'unobserveFieldScoped';
      if (method !== 'unobserveField' && !scoped) return;

      const field = literalText(call.args?.[0]);
      const target = referenceText(callee.obj);
      if (!field || !target) return;

      const targetRoot = aliases.find(target);
      for (const obs of observations) {
        if (obs.scoped !== scoped) continue;
        if (obs.field !== field) continue;
        if (aliases.find(obs.target) !== targetRoot) continue;

        const handlerKey = obs.handler.toLowerCase();
        const handlerFn = functions.get(handlerKey);
        if (!handlerFn) continue;
        const { derefs, guarded } = handlerFacts(handlerKey, handlerFn);

        for (const [refLower, refText] of released) {
          if (!derefs.has(refLower)) continue;
          if (guarded.has(refLower)) continue;
          // The observed target itself being already-released is a different
          // (and more obvious) defect: the unobserve line would throw first.
          if (aliases.find(`m.${refText}`) === targetRoot) continue;

          const key = `${obs.handler}|${refLower}|${call.location?.range?.start?.line}`;
          if (seen.has(key)) continue;
          seen.add(key);
          hits.push({
            unobserveMethod: method,
            field,
            target,
            handler: obs.handler,
            releasedRef: refText,
            location: call.location,
          });
        }
      }
    },
  });

  onDestroy.walk(visitor, { walkMode: brighterscript.WalkMode.visitAllRecursive });
  return hits;
}

// For one handler: which `m.<ref>`s it DEREFERENCES (receiver position — the
// only shape that throws), and which it validity-checks for itself.
function analyzeHandler(fnStmt) {
  const derefs = new Set();
  const guarded = new Set();
  const note = (name) => {
    if (name) derefs.add(name.toLowerCase());
  };

  const visitor = brighterscript.createVisitor({
    // `m.X.field` / `m.X.method()` — the outer get's object is `m.X`.
    DottedGetExpression: (expr) => note(mFieldName(expr.obj)),
    // `m.X[i]`
    IndexedGetExpression: (expr) => note(mFieldName(expr.obj)),
    // `m.X.field = …` — the set's object is `m.X`.
    DottedSetStatement: (stmt) => note(mFieldName(stmt.obj)),
    CallExpression: (call) => {
      const callee = call?.callee;
      if (!brighterscript.isVariableExpression(callee)) return;
      if (!VALIDITY_CHECKS.has(callee.tokens?.name?.text?.toLowerCase() ?? '')) return;
      const name = mFieldName(call.args?.[0]);
      if (name) guarded.add(name.toLowerCase());
    },
  });

  fnStmt.walk(visitor, { walkMode: brighterscript.WalkMode.visitAllRecursive });
  return { derefs, guarded };
}

// ── small helpers ───────────────────────────────────────────────────────────

// Top-level FunctionStatements by lowercased name.
function topLevelFunctions(brsFile) {
  const byName = new Map();
  const statements = brsFile?.parser?.ast?.statements;
  if (!Array.isArray(statements)) return byName;
  for (const stmt of statements) {
    if (!brighterscript.isFunctionStatement(stmt)) continue;
    const name = stmt.tokens?.name?.text;
    if (name) byName.set(name.toLowerCase(), stmt);
  }
  return byName;
}

// `m` itself.
function isMRoot(expr) {
  return (
    brighterscript.isVariableExpression(expr) && expr.tokens?.name?.text?.toLowerCase() === 'm'
  );
}

// For an expression that IS `m.<name>`, the `<name>`; otherwise null.
function mFieldName(expr) {
  if (!brighterscript.isDottedGetExpression(expr)) return null;
  if (!isMRoot(expr.obj)) return null;
  return expr.tokens?.name?.text || null;
}

function isInvalidLiteral(expr) {
  return (
    brighterscript.isLiteralExpression(expr) &&
    expr.tokens?.value?.kind === brighterscript.TokenKind.Invalid
  );
}

// The text of a string-literal argument, unquoted.
function literalText(expr) {
  if (!brighterscript.isLiteralExpression(expr)) return null;
  const raw = expr.tokens?.value?.text;
  if (typeof raw !== 'string') return null;
  return raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
}

// Stable text for a reference chain (`m`, `m.foo`, `m.foo.bar`); null otherwise.
function referenceText(expr) {
  if (!expr) return null;
  if (brighterscript.isVariableExpression(expr)) return expr.tokens?.name?.text || null;
  if (brighterscript.isDottedGetExpression(expr)) {
    const base = referenceText(expr.obj);
    const name = expr.tokens?.name?.text;
    return base && name ? `${base}.${name}` : null;
  }
  return null;
}

// True if the brs file has a sibling component .xml (i.e. it's a codebehind).
function hasSiblingComponentXml(program, brsFile) {
  if (!program || !brsFile) return false;
  const bases = [];
  if (brsFile.srcPath) bases.push(brsFile.srcPath.replace(/\.(bs|brs)$/i, ''));
  if (brsFile.pkgPath) bases.push(brsFile.pkgPath.replace(/\.(bs|brs)$/i, ''));
  for (const base of bases) {
    const xml = program.getFile(base + '.xml');
    if (xml && brighterscript.isXmlFile(xml)) return true;
  }
  return false;
}

/** Minimal union-find for grouping reference texts that alias the same node. */
class UnionFind {
  constructor() {
    this.parent = new Map();
  }
  find(x) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      return x;
    }
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur);
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

module.exports = () => new UnobserveBeforeReleasePlugin();

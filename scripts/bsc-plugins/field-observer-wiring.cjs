/**
 * BrighterScript plugin — how an interface field is wired to its handler.
 *
 * Five diagnostics. The first three are driven from a component's XML
 * `<field onChange="...">` declarations cross-referenced against its codebehind;
 * the last two from where the codebehind observes and unobserves `m.top`. Unlike the sibling
 * `observe-without-on-destroy` plugin, these are NOT scoped to `JRScreen`
 * subclasses: a duplicate registration is not screen-specific, and both known
 * instances were leaf widgets.
 *
 * 1. `duplicate-field-observer` (error) — a field wired BOTH by an XML
 *    `onChange` and by `m.top.observeField()`. Two observers are registered and
 *    the handler runs twice on every write. It is silent whenever the handler is
 *    idempotent, which is why `OSD.itemData` and `IconButton.isButtonSelected`
 *    survived months apiece before #891. The second instance is the instructive
 *    one: it came from a mechanical rename sweep that renamed the XML attribute
 *    AND the BrightScript call and left both wired, so a rename is where this
 *    class is born.
 *
 * 2. `ineffective-unobserve` (error) — a field whose ONLY registration is an XML
 *    `onChange`, which the codebehind nonetheless calls `unobserveField()` on.
 *    An XML `onChange` does not appear to be removable that way (see
 *    `components/CLAUDE.md`), and `unobserveField` returns `true` regardless, so
 *    nothing surfaces the mistake at runtime. The line reads as teardown
 *    protection and provides none — which is worse than not having it, because
 *    the next reader stops looking.
 *
 * 3. `undetachable-observer` (error) — a component that defines `onDestroy` and
 *    ALSO declares an XML `onChange` on an interface field. An `onDestroy` is the
 *    declaration that this component releases state at teardown; from that point
 *    any handler that can still run is a hazard, and an XML `onChange` is the one
 *    form that cannot be detached. So the two do not belong in the same component.
 *
 *    This is the STRUCTURAL version of a rule that used to be a judgment call
 *    ("can a writer of this field outlive onDestroy?" — true but undecidable by a
 *    linter, so it left every site needing a human). Keying on the presence of an
 *    `onDestroy` is blunter and provable: 42 of the 53 components using `onChange`
 *    have no `onDestroy` at all, release nothing, and are untouched by this.
 *
 *    It reports ONCE per component, listing the fields, because the fix is one
 *    edit to that component rather than one per field.
 *
 * 4. `top-unobserve-outside-ondestroy` (error) — `m.top.unobserveField()` or
 *    `m.top.unobserveFieldScoped()` anywhere but `onDestroy()`.
 *
 *    A registration is not private to the component that made it. On device
 *    (`tests/source/unit/platform/ObserverRegistry.spec.bs`), a component
 *    unobserving its own field — with either form — removed the plain observer
 *    its parent held on that field. That is how #898's "unobserve before observe"
 *    re-registration in `VideoPlayerView` removed `PlayerHostView`'s `state`
 *    observer, so no natural episode end ever reached the host. Mid-life, a
 *    component cannot know who else is listening; at teardown, the node is going
 *    away with its observers anyway. Both forms are banned alike, deliberately:
 *    how `observeFieldScoped` registrations behave is NOT understood beyond the one
 *    configuration that spec records, so nothing here relies on it.
 *
 *    The field argument is NOT required to be a literal: which field is named does
 *    not change who loses their observer (`JellyfinUserSettings.disableAutoSync`
 *    loops over `getFields()`).
 *
 * 5. `top-observer-outside-init` (error) — `m.top.observeField()` or
 *    `m.top.observeFieldScoped()` with a HANDLER NAME anywhere but `init()`.
 *
 *    The other half of the same lifecycle. Once (4) forbids de-duplicating with a
 *    mid-life unobserve, an observe in a function that runs more than once simply
 *    accumulates, and Roku runs the handler once per registration (#896, #898) —
 *    deleting the unobserve (4) flags is exactly how you would get there. `init()`
 *    runs once per node, so placement there IS the single-registration guarantee.
 *
 *    Placement, not reachability: a helper called only from `init()` is still
 *    flagged, because nothing would notice the day it gains a second caller.
 *    Inline it. A MESSAGE-PORT observer is out of the population — the pool Tasks
 *    observe their own request fields on a port inside the Task function, no
 *    handler runs in a component scope, and no defect is on record for the shape.
 *
 * All five attach to the BrightScript line that should change, matching
 * `observe-without-on-destroy`'s convention — the XML half is named in the
 * message. The rule runs per component SCOPE, so editing either half re-derives
 * the verdict and a fix made on the XML side clears the diagnostic on the `.bs`
 * (see `scripts/lib/bsc-rule.cjs` for why that needs saying).
 *
 * KNOWN GAPS — all fall toward false negatives, none has an instance in the tree
 * -----------------------------------------------------------------------------
 *  - A non-literal field argument (`JellyfinUserSettings` observes a computed
 *    name) or a registration reached through a helper.
 *  - An `onChange` INHERITED from an ancestor component: only the component's own
 *    `<interface>` is read.
 *  - An `m.top` reached through a local alias (`top = m.top`); the sibling plugin
 *    does union-find aliasing, this one matches the written form. Applies to (4)
 *    and (5) too — `LoadCaptionTask`'s alias is the one instance, and it observes nothing.
 *  - (4) and (5) read the component's own codebehind only. An observe or unobserve
 *    on `m.top` inside a `source/` helper it imports is invisible; there is none today.
 *  - (5) treats a non-literal second argument as a port, since it cannot tell a
 *    variable holding a handler NAME from one holding a port.
 *  - Two PROGRAMMATIC observers of the same field, with no XML `onChange` — also
 *    a duplicate registration, but not this pairing.
 *  - `m.top.observeFieldScoped` + `m.top.unobserveField` suppresses
 *    `ineffective-unobserve` (a programmatic observe exists). Whether that plain
 *    unobserve removes the scoped registration is not established in general — it
 *    did in the one configuration `ObserverRegistry.spec.bs` records — so this
 *    diagnostic does not reason about mixed forms. Nothing goes silent:
 *    `duplicate-field-observer` still fires on the observe.
 *
 * Escape hatches (per diagnostic, on the offending BrightScript line):
 *  - `' bsc-disable-line <code>`
 *  - `' bsc-disable-next-line <code>` on the line above
 *  - `' bsc-disable-file <code>` anywhere in the file
 */
'use strict';

const brighterscript = require('brighterscript');
const { createScopeRule, stringLiteralValue, referenceText } = require('../lib/bsc-rule.cjs');

const DUPLICATE = 'duplicate-field-observer';
const INEFFECTIVE = 'ineffective-unobserve';
const UNDETACHABLE = 'undetachable-observer';
const TOP_UNOBSERVE = 'top-unobserve-outside-ondestroy';
const TOP_OBSERVE = 'top-observer-outside-init';

// Third-party code we cannot edit. Both vendored trees, for the reason
// no-hand-rolled-dialog gives: excluding only one leaves the other to be suppressed
// line by line.
const VENDORED_PREFIXES = ['components/vendor/', 'components/roku_modules/'];

module.exports = () =>
  createScopeRule({
    name: 'jellyrock-field-observer-wiring',
    analyze({ xmlFile, brsFile, report }) {
      if (!isVendored(brsFile)) reportTopLifecycle(brsFile, report);

      const onChangeFields = xmlOnChangeFields(xmlFile);
      if (onChangeFields.size === 0) return;

      const calls = collectMTopFieldCalls(brsFile);
      const xmlName = baseName(xmlFile.srcPath);

      // A component that tears down state must be able to detach every observer,
      // and an XML onChange cannot be detached. Anchored on `onDestroy` — the
      // declaration that makes the rule apply — and reported once for the whole
      // component, since the fix is one edit rather than one per field.
      const onDestroy = findOnDestroy(brsFile);
      if (onDestroy?.location) {
        const spellings = [...onChangeFields.values()].map((v) => v.written);
        report({
          code: UNDETACHABLE,
          location: onDestroy.location,
          message: `${baseName(brsFile.srcPath)} defines onDestroy(), so every observer it registers must be detachable — but ${xmlName} still wires ${spellings.length === 1 ? 'a field' : spellings.length + ' fields'} with an XML onChange: ${spellings.join(', ')}. An XML onChange does not appear to be removable by unobserveField, so a handler wired that way can still run after onDestroy has released the references it dereferences. Move ${spellings.length === 1 ? 'it' : 'them'} to m.top.observeField() in init(), with a matching unobserveField() ahead of the releases in onDestroy(). Suppress with ' bsc-disable-next-line ${UNDETACHABLE}.`,
        });
      }

      for (const call of calls) {
        const entry = onChangeFields.get(call.field);
        if (!entry) continue;
        const handler = entry.handler;

        const code = call.kind === 'observe' ? DUPLICATE : INEFFECTIVE;

        // An unobserve is only ineffective when there is NO programmatic observe
        // to remove; when both exist the duplicate diagnostic is the accurate
        // one, and reporting both would send the author to the wrong fix.
        if (
          code === INEFFECTIVE &&
          calls.some((c) => c.kind === 'observe' && c.field === call.field)
        ) {
          continue;
        }

        report({
          code,
          location: call.location,
          message:
            code === DUPLICATE
              ? `Field "${call.written}" is wired to ${handler}() TWICE — by onChange in ${xmlName} and by this ${call.method}(). Two observers are registered, so the handler runs twice on every write. Keep exactly one: the XML onChange is the default, and ${call.method} earns its place only when the handler must be detachable at teardown. Suppress with ' bsc-disable-next-line ${DUPLICATE}.`
              : `${call.method}("${call.written}") has nothing it can remove: the only registration for "${call.written}" is the onChange in ${xmlName}, which does not appear to be removable this way (it returns true regardless — see components/CLAUDE.md). Register the observer with m.top.observeField() in init() if it must be detachable, or drop this call. Suppress with ' bsc-disable-next-line ${INEFFECTIVE}.`,
        });
      }
    },
  });

/**
 * Diagnostics (4) and (5): every `m.top` observe outside `init()` that names a handler,
 * and every `m.top` unobserve outside `onDestroy()`, attributed to the TOP-LEVEL function
 * that contains it — a function literal nested inside `fetch()` runs on `fetch()`'s
 * schedule, not once per node, so it gets no pass.
 */
function reportTopLifecycle(brsFile, report) {
  const statements = brsFile?.parser?.ast?.statements;
  if (!Array.isArray(statements)) return;

  for (const stmt of statements) {
    if (!brighterscript.isFunctionStatement(stmt)) continue;
    const fn = stmt.tokens?.name?.text;
    const body = stmt.func?.body;
    if (!fn || !body?.walk) continue;
    const lowerFn = fn.toLowerCase();

    body.walk(
      brighterscript.createVisitor({
        CallExpression: (call) => {
          const callee = call?.callee;
          if (!brighterscript.isDottedGetExpression(callee)) return;
          // BrightScript identifiers are case-insensitive, so `M.Top.UnobserveField` must
          // not slip past an error-level rule.
          if (referenceText(callee.obj)?.toLowerCase() !== 'm.top') return;
          const method = callee.tokens?.name?.text;
          const lowerMethod = method?.toLowerCase();
          const field = argumentText(call.args?.[0]);

          if (lowerMethod === 'unobservefield' || lowerMethod === 'unobservefieldscoped') {
            if (lowerFn === 'ondestroy') return;
            report({
              code: TOP_UNOBSERVE,
              location: call.location,
              message: `m.top.${method}(${field}) in '${fn}' can remove observers ANOTHER component registered on this node, not just this component's (#898 removed PlayerHostView's "state" observer exactly this way, and no episode end reached it; see tests/source/unit/platform/ObserverRegistry.spec.bs). Register this component's own observer once in init(), make its handler ignore the notifications it must not act on (a readiness flag, or a value the component applied itself), and unobserve only in onDestroy(). Suppress with ' bsc-disable-next-line ${TOP_UNOBSERVE} only if no other component can ever observe this node.`,
            });
            return;
          }

          if (lowerMethod === 'observefield' || lowerMethod === 'observefieldscoped') {
            if (lowerFn === 'init') return;
            // A port observer carries no handler name; see the header for why it is
            // outside the population.
            const handler = stringLiteralValue(call.args?.[1]?.tokens?.value?.text);
            if (!brighterscript.isLiteralExpression(call.args?.[1]) || handler === null) return;
            report({
              code: TOP_OBSERVE,
              location: call.location,
              message: `m.top.${method}(${field}, "${handler}") in '${fn}' adds another registration every time '${fn}' runs, and Roku does not de-duplicate them — ${handler}() then runs once per registration (#896, #898). Move it into init(), which runs once per node, and have the handler ignore the notifications that made a later registration look necessary. A helper called only from init() still counts: inline it, since nothing would notice the day it gains a second caller. Suppress with ' bsc-disable-next-line ${TOP_OBSERVE}.`,
            });
          }
        },
      }),
      { walkMode: brighterscript.WalkMode.visitAllRecursive },
    );
  }
}

/** A call argument as the author wrote it: `"state"` for a literal, else its reference text. */
function argumentText(arg) {
  if (brighterscript.isLiteralExpression(arg)) {
    const value = stringLiteralValue(arg.tokens?.value?.text);
    if (value !== null) return `"${value}"`;
  }
  return referenceText(arg) ?? '<computed>';
}

function isVendored(brsFile) {
  const dest = (brsFile?.destPath || brsFile?.pkgPath || '').replace(/\\/g, '/');
  return VENDORED_PREFIXES.some((prefix) => dest.startsWith(prefix));
}

/**
 * Lower-cased field id → onChange handler name, for every `<field onChange="...">`
 * in the component's own `<interface>`.
 *
 * Keyed lower-case because BrightScript field names are case-insensitive:
 * `<field id="isSelected">` and `observeField("isselected")` are the same field,
 * and a case-sensitive compare would miss the pairing. Matches the
 * case-insensitive membership `callfunc-interface` uses for the same reason.
 */
function xmlOnChangeFields(xmlFile) {
  const fields =
    xmlFile?.parser?.ast?.componentElement?.interfaceElement?.getElementsByTagName?.('field') || [];
  const out = new Map();
  for (const field of fields) {
    if (field?.id && field?.onChange) {
      out.set(field.id.toLowerCase(), { handler: field.onChange, written: field.id });
    }
  }
  return out;
}

/**
 * Every `m.top.(un)observeField[Scoped]("literal")` call in the codebehind.
 *
 * Restricted to `m.top` on purpose: observing ANOTHER node's field is a different
 * relationship, and an XML onChange only ever registers against the node itself.
 * `field` is lower-cased for comparison; `written` keeps the author's spelling so
 * the message quotes what they typed.
 */
function collectMTopFieldCalls(brsFile) {
  const out = [];
  const ast = brsFile?.parser?.ast;
  if (!ast?.walk) return out;

  const visitor = brighterscript.createVisitor({
    CallExpression: (call) => {
      const callee = call?.callee;
      if (!brighterscript.isDottedGetExpression(callee)) return;
      const method = callee.tokens?.name?.text;
      const kind =
        method === 'observeField' || method === 'observeFieldScoped'
          ? 'observe'
          : method === 'unobserveField' || method === 'unobserveFieldScoped'
            ? 'unobserve'
            : null;
      if (!kind) return;
      if (referenceText(callee.obj) !== 'm.top') return;

      const fieldArg = call.args?.[0];
      if (!brighterscript.isLiteralExpression(fieldArg)) return;
      const written = stringLiteralValue(fieldArg.tokens?.value?.text);
      if (!written) return;

      out.push({ field: written.toLowerCase(), written, kind, method, location: call.location });
    },
  });

  ast.walk(visitor, { walkMode: brighterscript.WalkMode.visitAllRecursive });
  return out;
}

/** The component's own top-level `onDestroy` function statement, or null. */
function findOnDestroy(brsFile) {
  const statements = brsFile?.parser?.ast?.statements;
  if (!Array.isArray(statements)) return null;
  for (const stmt of statements) {
    if (!brighterscript.isFunctionStatement(stmt)) continue;
    if (stmt.tokens?.name?.text?.toLowerCase() === 'ondestroy') return stmt;
  }
  return null;
}

function baseName(p) {
  return typeof p === 'string' ? p.split(/[\\/]/).pop() : 'the component XML';
}

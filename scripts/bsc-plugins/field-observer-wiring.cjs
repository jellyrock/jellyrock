/**
 * BrighterScript plugin — how an interface field is wired to its handler.
 *
 * Two diagnostics, both driven from a component's XML `<field onChange="...">`
 * declarations cross-referenced against its codebehind. Unlike the sibling
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
 *    ⚠️ Known false positive: a component that calls `m.top.unobserveField()` to
 *    clear observers registered by OTHER nodes is doing something legal but
 *    exotic. There is no instance in the tree; suppress with the escape hatch
 *    below and say why in the comment.
 *
 * Both attach to the BrightScript line that should change, matching
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
 *    does union-find aliasing, this one matches the written form.
 *  - Two PROGRAMMATIC observers of the same field, with no XML `onChange` — also
 *    a duplicate registration, but not this pairing.
 *  - `observeFieldScoped` + `unobserveField` suppresses `ineffective-unobserve`
 *    (a programmatic observe exists) even though Roku tracks scoped and unscoped
 *    on separate lists, so that unobserve removes nothing either. Nothing goes
 *    silent — `duplicate-field-observer` still fires on the observe.
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

module.exports = () =>
  createScopeRule({
    name: 'jellyrock-field-observer-wiring',
    analyze({ xmlFile, brsFile, report }) {
      const onChangeFields = xmlOnChangeFields(xmlFile);
      if (onChangeFields.size === 0) return;

      const calls = collectMTopFieldCalls(brsFile);
      const xmlName = baseName(xmlFile.srcPath);

      for (const call of calls) {
        const handler = onChangeFields.get(call.field);
        if (!handler) continue;

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
    if (field?.id && field?.onChange) out.set(field.id.toLowerCase(), field.onChange);
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

function baseName(p) {
  return typeof p === 'string' ? p.split(/[\\/]/).pop() : 'the component XML';
}

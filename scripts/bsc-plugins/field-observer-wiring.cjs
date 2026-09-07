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
 * Escape hatches (per diagnostic, on the offending BrightScript line):
 *  - `' bsc-disable-line <code>`
 *  - `' bsc-disable-next-line <code>` on the line above
 *  - `' bsc-disable-file <code>` anywhere in the file
 *
 * Both diagnostics attach to the BrightScript line that should change, matching
 * `observe-without-on-destroy`'s convention — the XML half is named in the
 * message. Re-analysis is triggered by EITHER half changing, so editing only the
 * codebehind still updates the diagnostic in the IDE.
 */
'use strict';

const brighterscript = require('brighterscript');

const DUPLICATE = 'duplicate-field-observer';
const INEFFECTIVE = 'ineffective-unobserve';

const disableMarkers = (code) => ({
  file: new RegExp(`'\\s*bsc-disable-file\\s+${code}\\b`, 'i'),
  line: new RegExp(`'\\s*bsc-disable-line\\s+${code}\\b`, 'i'),
  nextLine: new RegExp(`'\\s*bsc-disable-next-line\\s+${code}\\b`, 'i'),
});

const MARKERS = {
  [DUPLICATE]: disableMarkers(DUPLICATE),
  [INEFFECTIVE]: disableMarkers(INEFFECTIVE),
};

class FieldObserverWiringPlugin {
  constructor() {
    this.name = 'jellyrock-field-observer-wiring';
    // codebehind srcPath → xml srcPath, so a codebehind-only edit re-runs the check.
    this.xmlByCodebehind = new Map();
  }

  afterValidateFile(event) {
    try {
      const file = event.file;

      if (brighterscript.isXmlFile(file)) {
        const codebehind = findCodebehind(event.program, file);
        if (!codebehind) return;
        this.xmlByCodebehind.set(codebehind.srcPath, file.srcPath);
        this.analyze(event.program, file, codebehind);
        return;
      }

      if (!brighterscript.isBrsFile(file)) return;
      const xmlPath = this.xmlByCodebehind.get(file.srcPath);
      if (!xmlPath) return;
      const xmlFile = event.program.getFile(xmlPath);
      if (!xmlFile) return;
      this.analyze(event.program, xmlFile, file);
    } catch (_e) {
      // Never crash the build.
    }
  }

  analyze(program, xmlFile, brsFile) {
    const onChangeFields = xmlOnChangeFields(xmlFile);
    if (onChangeFields.size === 0) return;

    const contents = brsFile.fileContents || '';
    const lines = contents.split(/\r?\n/);
    const calls = collectMTopFieldCalls(brsFile);

    for (const call of calls) {
      if (!onChangeFields.has(call.field)) continue;

      const code = call.kind === 'observe' ? DUPLICATE : INEFFECTIVE;

      // An unobserve is only ineffective when there is NO programmatic observe to
      // remove; when both exist, the duplicate diagnostic is the accurate one.
      if (
        code === INEFFECTIVE &&
        calls.some((c) => c.kind === 'observe' && c.field === call.field)
      ) {
        continue;
      }

      const markers = MARKERS[code];
      if (markers.file.test(contents)) continue;
      if (markers.line.test(lines[call.line] ?? '')) continue;
      if (call.line > 0 && markers.nextLine.test(lines[call.line - 1] ?? '')) continue;
      if (!call.location) continue;

      const handler = onChangeFields.get(call.field);
      const xmlName = baseName(xmlFile.srcPath);
      const message =
        code === DUPLICATE
          ? `Field "${call.field}" is wired to ${handler}() TWICE — by onChange in ${xmlName} and by this ${call.method}(). Two observers are registered, so the handler runs twice on every write. Keep exactly one: the XML onChange is the default, and ${call.method} earns its place only when the handler must be detachable at teardown. Suppress with ' bsc-disable-next-line ${DUPLICATE}.`
          : `${call.method}("${call.field}") has nothing it can remove: the only registration for "${call.field}" is the onChange in ${xmlName}, which does not appear to be removable this way (it returns true regardless — see components/CLAUDE.md). Register the observer with m.top.observeField() in init() if it must be detachable, or drop this call. Suppress with ' bsc-disable-next-line ${INEFFECTIVE}.`;

      program.diagnostics.register({
        code,
        severity: 1, // Error
        source: this.name,
        message,
        location: call.location,
      });
    }
  }
}

// field id → onChange handler name, for every `<field onChange="...">` in the
// component's <interface>.
function xmlOnChangeFields(xmlFile) {
  const fields =
    xmlFile?.parser?.ast?.componentElement?.interfaceElement?.getElementsByTagName?.('field') || [];
  const out = new Map();
  for (const field of fields) {
    if (field?.id && field?.onChange) out.set(field.id, field.onChange);
  }
  return out;
}

// Every `m.top.(un)observeField[Scoped]("literal")` call in the codebehind.
// Restricted to `m.top` on purpose: observing ANOTHER node's field is a different
// relationship, and an XML onChange only ever registers against the node itself.
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
      const field = unwrapStringLiteral(fieldArg.tokens?.value?.text);
      if (!field) return;

      out.push({
        field,
        kind,
        method,
        location: call.location,
        line: call.location?.range?.start?.line ?? 0,
      });
    },
  });

  ast.walk(visitor, { walkMode: brighterscript.WalkMode.visitAllRecursive });
  return out;
}

// Dotted reference as source text ("m.top"), or null for anything else.
function referenceText(expr) {
  if (brighterscript.isVariableExpression(expr)) return expr.tokens?.name?.text ?? null;
  if (brighterscript.isDottedGetExpression(expr)) {
    const base = referenceText(expr.obj);
    const name = expr.tokens?.name?.text;
    if (!base || !name) return null;
    return `${base}.${name}`;
  }
  return null;
}

function unwrapStringLiteral(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/^"(.*)"$/s);
  return m ? m[1] : null;
}

function findCodebehind(program, xmlFile) {
  const baseSrc = xmlFile.srcPath?.replace(/\.xml$/i, '');
  if (!baseSrc) return null;
  for (const ext of ['.bs', '.brs']) {
    const f = program.getFile(baseSrc + ext);
    if (f && brighterscript.isBrsFile(f)) return f;
  }
  return null;
}

function baseName(p) {
  return typeof p === 'string' ? p.split(/[\\/]/).pop() : 'the component XML';
}

module.exports = () => new FieldObserverWiringPlugin();

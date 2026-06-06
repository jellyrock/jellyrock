/**
 * BrighterScript plugin — callFunc() targets must be declared in a component
 * <interface>.
 *
 * THE BUG THIS PREVENTS
 * ---------------------
 * `node.callFunc("doThing")` only dispatches to a function that the target
 * component EXPOSES via `<function name="doThing" />` in its `<interface>`.
 * If the codebehind defines `sub doThing()` but the `.xml` interface never
 * declares it, the `callFunc` is a SILENT no-op — no compile error, no runtime
 * error, the method simply never runs. This bit us shipping the watched-toggle
 * migration (#551 Batch 2): `ItemDetails.toggleWatched()` was written and
 * `main.bs` called `group.callFunc("toggleWatched")`, but the
 * `<function name="toggleWatched" />` interface line was missing, so the build
 * passed clean and the toggle did nothing on-device. The transpiler can't catch
 * this on its own — so this plugin does.
 *
 * THE RULE (deliberately conservative — near-zero false positives)
 * ---------------------------------------------------------------
 * For every `callFunc("X")` string-literal call site in our (non-vendored) code,
 * ERROR when BOTH hold:
 *   - X is the name of a top-level function/sub DEFINED in one of OUR component
 *     codebehinds (a `.bs`/`.brs` with a sibling component `.xml`), AND
 *   - X is declared in NO component `<interface><function>` anywhere in the
 *     program.
 * That pair is, by construction, always the "wrote the method, forgot the
 * interface line" bug — there is no legitimate version of it (an undeclared
 * target is always a no-op). Membership is checked PROGRAM-WIDE and
 * case-insensitively (BrightScript identifiers are case-insensitive): if ANY
 * component declares `<function name="X" />`, no `callFunc("X")` is flagged.
 * That makes the check err toward false NEGATIVES (a callFunc to a non-declaring
 * component whose name another component happens to declare slips through) and
 * away from false POSITIVES — the right trade for a build-FAILING error.
 *
 * Targets we don't own (X defined only in `roku_modules` vendored components,
 * e.g. the log library's `logItem`) are out of scope and never flagged.
 *
 * Escape hatches (rare — an undeclared target is normally a real bug):
 *  - `' bsc-disable-line callfunc-interface` on the callFunc line
 *  - `' bsc-disable-next-line callfunc-interface` on the line above
 *  - `' bsc-disable-file callfunc-interface` anywhere in the file
 */
'use strict';

const brighterscript = require('brighterscript');

const CALLFUNC = 'callFunc';
const DIAGNOSTIC_CODE = 'callfunc-interface';
const DISABLE_FILE_MARKER = /'\s*bsc-disable-file\s+callfunc-interface\b/i;
const DISABLE_LINE_MARKER = /'\s*bsc-disable-line\s+callfunc-interface\b/i;
const DISABLE_NEXT_LINE_MARKER = /'\s*bsc-disable-next-line\s+callfunc-interface\b/i;
const VENDORED = /(^|[\\/])roku_modules([\\/])/;

class CallFuncInterfacePlugin {
  constructor() {
    this.name = 'jellyrock-callfunc-interface';
  }

  // Program-wide cross-check: needs every interface decl + every component
  // method name before it can judge a single callFunc site, so it runs once
  // after all files validate (see Program.js: "use afterValidateProgram").
  afterValidateProgram(event) {
    try {
      const program = event.program;
      const files = Object.values(program.files || {});

      // 1. DECLARED — every <function name> across ALL component interfaces
      //    (vendored included; that only makes the guard more conservative).
      const declared = new Set();
      for (const file of files) {
        if (!brighterscript.isXmlFile(file)) continue;
        for (const name of interfaceFunctionNames(file)) {
          declared.add(name.toLowerCase());
        }
      }

      // 2. DEFINED — every top-level function/sub in a NON-vendored component
      //    codebehind. That's the precise universe of callFunc targets we own.
      const definedInComponents = new Set();
      for (const file of files) {
        if (!brighterscript.isBrsFile(file) || isVendored(file)) continue;
        if (!hasSiblingComponentXml(program, file)) continue;
        for (const name of topLevelFunctionNames(file)) {
          definedInComponents.add(name.toLowerCase());
        }
      }

      // 3. FLAG — callFunc("X") where X is one of our component methods but is
      //    declared in no interface (the silent no-op).
      for (const file of files) {
        if (!brighterscript.isBrsFile(file) || isVendored(file)) continue;
        const contents = file.fileContents;
        if (typeof contents === 'string' && DISABLE_FILE_MARKER.test(contents)) continue;
        const sourceLines = (contents || '').split(/\r?\n/);

        for (const site of findCallFuncSites(file)) {
          const key = site.method.toLowerCase();
          if (!definedInComponents.has(key)) continue; // external/vendored target — out of scope
          if (declared.has(key)) continue; // exposed somewhere — fine

          const srcLine = sourceLines[site.line] ?? '';
          if (DISABLE_LINE_MARKER.test(srcLine)) continue;
          const prevLine = site.line > 0 ? (sourceLines[site.line - 1] ?? '') : '';
          if (DISABLE_NEXT_LINE_MARKER.test(prevLine)) continue;
          if (!site.location) continue;

          program.diagnostics.register({
            code: DIAGNOSTIC_CODE,
            severity: 1, // Error — an undeclared callFunc target is a silent no-op.
            source: this.name,
            message: `callFunc("${site.method}") targets a method defined in a component codebehind but declared in NO component <interface>. callFunc only dispatches to functions exposed via <function name="${site.method}" />; without that line the call is a SILENT no-op (the transpiler does not catch it). Add <function name="${site.method}" /> to the target component's <interface>. Suppress with ' bsc-disable-next-line callfunc-interface only if this is deliberate.`,
            location: site.location,
          });
        }
      }
    } catch (_e) {
      // Never crash the build — the plugin is a guard, not a hard dependency.
    }
  }
}

// All `<function name="...">` names declared in a component's <interface>.
function interfaceFunctionNames(xmlFile) {
  const fns =
    xmlFile?.parser?.ast?.componentElement?.interfaceElement?.getElementsByTagName?.('function') ||
    [];
  const out = [];
  for (const fn of fns) {
    if (fn?.name) out.push(fn.name);
  }
  return out;
}

// Names of all top-level function/sub statements in a codebehind.
function topLevelFunctionNames(brsFile) {
  const statements = brsFile?.parser?.ast?.statements;
  if (!Array.isArray(statements)) return [];
  const out = [];
  for (const stmt of statements) {
    if (brighterscript.isFunctionStatement(stmt)) {
      const name = stmt.tokens?.name?.text;
      if (name) out.push(name);
    }
  }
  return out;
}

// Every `<obj>.callFunc("X")` string-literal call site: { method, location, line }.
function findCallFuncSites(brsFile) {
  const ast = brsFile?.parser?.ast;
  if (!ast || typeof ast.walk !== 'function') return [];
  const sites = [];
  const visitor = brighterscript.createVisitor({
    CallExpression: (call) => {
      const callee = call?.callee;
      if (!brighterscript.isDottedGetExpression(callee)) return;
      if (callee.tokens?.name?.text !== CALLFUNC) return;
      const arg = call.args?.[0];
      if (!brighterscript.isLiteralExpression(arg)) return;
      const method = unwrapStringLiteral(arg.tokens?.value?.text);
      if (!method) return;
      sites.push({
        method,
        location: call.location,
        line: call.location?.range?.start?.line ?? 0,
      });
    },
  });
  ast.walk(visitor, { walkMode: brighterscript.WalkMode.visitAllRecursive });
  return sites;
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

function isVendored(file) {
  return VENDORED.test(file?.srcPath || '') || VENDORED.test(file?.pkgPath || '');
}

function unwrapStringLiteral(raw) {
  if (typeof raw !== 'string') return null;
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1);
  }
  return raw;
}

module.exports = () => new CallFuncInterfacePlugin();

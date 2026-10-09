/**
 * BrighterScript plugin — report code nothing in the app uses.
 *
 * THE RULE
 * --------
 * Every declaration we own — function/sub, class, class method, const, enum and
 * enum member (in `source/` and `components/`), plus every XML component,
 * interface field and interface function — must have a consumer somewhere in the
 * app build. One that has none is an ERROR (`dead-code`), unless it is recorded
 * as kept on purpose (see KEEPING CODE ON PURPOSE).
 *
 * The app build does not contain `tests/`, so code only a test uses is dead
 * here: a test of code the app never runs protects nothing. The one exception is
 * an interface function: a test needs the exposure to drive a live component
 * through `callFunc`, so `deadCode.exposureConsumers` (test globs) is read for
 * `callFunc("x")` / `@.x` in BrightScript and for quoted names in JavaScript (the
 * RTA suite passes `funcName: 'x'` to ODC). Such a call keeps the interface
 * declaration alive only while the app itself still runs the function behind it;
 * it never keeps that function, or anything else, alive.
 *
 * WHAT COUNTS AS A CONSUMER
 * -------------------------
 * SceneGraph reaches code by NAME far more often than by call, so a reference is
 * any of:
 *   - an identifier: a bare call or value (`foo()`, `cb = foo`), a member access
 *     (`node.field`, `m.method()`), an AA key (`{ field: 1 }`), or a qualified
 *     chain (`imageSize.LOGO.width`, `new ns.Klass()`);
 *   - a string literal naming it (`observeField("f", "onF")`,
 *     `functionName = "run"`, `CreateObject("roSGNode", "Comp")`,
 *     `callFunc("fn")`), and for a namespaced function its transpiled
 *     `ns_name` spelling, which is what a string callback must use;
 *   - `node@.fn()`;
 *   - an XML tag (`<Comp />`), attribute name (a field set on a child) or
 *     attribute value (`extends`, `itemComponentName`, `onChange`, `alias`);
 *   - a string value in a packaged JSON file (`settings.json` names user-setting
 *     fields by `settingName`);
 *   - a string-literal PREFIX that is concatenated (`"segmentAction" + type`
 *     reaches every declaration whose name starts with `segmentAction`).
 *
 * Matching is case-insensitive (BrightScript is), and resolution follows scope:
 *   - A namespaced declaration is matched by its QUALIFIED name, or by a
 *     relative reference written inside that namespace — never by its short
 *     name alone. `itemAspectRatio.SQUARE` and the live `rowSlotSize.SQUARE`
 *     share a short name; bare-name matching hid the first behind the second.
 *   - A function in a component codebehind is matched by name only inside the
 *     component scopes that include its file (the component, its ancestors and
 *     descendants). Two components can each define `onHeightChanged`, and one of
 *     them can still be dead.
 *   - A `source/` function is shared by every scope that imports it, so its name
 *     is matched anywhere.
 *   - `callFunc("x")` / `@.x` reaches a function only through an `<interface>`
 *     `<function name="x">` declared by a component whose scope includes it: the
 *     interface is how SceneGraph dispatches the call. A same-named function in
 *     a component that declares no such exposure is not reached.
 *   - An interface function is reached only by `callFunc` / `@.`. A string that
 *     merely spells its name (`"top"`, another component's `observeField`
 *     handler) is not a call.
 *
 * Deadness is TRANSITIVE: a reference that sits inside dead code does not keep
 * its target alive. The analysis iterates to a fixed point, so code reachable
 * only from dead code is reported too (the message names what it was reached
 * from). Dead code here includes a dead field's own XML element (its `onChange`
 * handler), matched by column so a live element on the same line is unaffected,
 * and a script several components include once every one of them is dead.
 *
 * NEVER REPORTED
 * --------------
 *   - Roku entry points and lifecycle callbacks (ENTRY_POINTS).
 *   - Interface fields the Roku firmware writes into item / row-title / row
 *     decoration components (FIRMWARE_FIELDS), taken from Roku's list/grid node
 *     docs.
 *   - An alias field with a `value`: its initial value sizes or configures the
 *     child it aliases, which is a use even when nothing reads the field.
 *   - Calls another JellyRock plugin injects at transpile time (INJECTED_CALLS).
 *     They are invisible in source, so the injecting plugin exports their names.
 *   - `roku_modules`, `components/vendor` and the generated `translationKeys`
 *     namespace (unused translation keys are `lint:translations`' job).
 *
 * KEEPING CODE ON PURPOSE
 * -----------------------
 * Unused code is kept only as one of six recorded kinds:
 *   design-system  a whole set kept deliberately, e.g. a color × size matrix
 *   api            built ahead of its first caller
 *   planned        scaffolding for a tracked feature; the reason must cite an
 *                  issue (#123)
 *   platform       invoked by the Roku OS by a name this rule does not know
 *   test-infra     exists for the test suites (probe components the RTA and
 *                  Rooibos suites create by name)
 *   debug-console  called by a developer from the BrightScript console in a
 *                  debug build; nothing in the app calls it
 * One declaration is kept with a marker on the line above it (or on its own
 * line), stating the kind and the reason:
 *     ' bsc-disable-next-line dead-code keep: api: first caller lands with #288
 *     <!-- bsc-disable-next-line dead-code keep: planned: #1070 theme media -->
 * A whole set is kept by an entry in bsconfig.json's `deadCode.keep`:
 *     { "kind": "design-system", "files": ["components/ui/label/colors/**"],
 *       "names": ["*"], "reason": "…" }
 * A bare marker without a kind and reason, a file-level `bsc-disable-file
 * dead-code`, a marker on code that is actually used, and an allowlist entry
 * that matches nothing are all errors (`dead-code-keep`): a keep that says
 * nothing about why, or that outlived its reason, is a silent carve-out.
 *
 * BASELINE
 * --------
 * `deadCode.baseline` names a JSON file of findings awaiting removal. They are
 * not reported; an entry that no longer matches a finding IS (`dead-code-
 * baseline`), so the file cannot hold a stale entry. Nothing stops an entry
 * being ADDED — that is how a deliberate deferral is recorded — so an addition
 * is a review decision, visible in the diff. Entries are keyed by kind, file and
 * qualified name — never by line — so unrelated edits do not churn it.
 * `DEAD_CODE_WRITE_BASELINE=1 npx bsc --noEmit` rewrites it from the current
 * findings; do that only to record findings you are deliberately deferring.
 *
 * KNOWN LIMITS
 * ------------
 * Reporting LESS (a dead declaration can go unreported):
 *   - A member access on anything but `m.top` (`node.field`, `obj.method()`) is
 *     matched by name program-wide, because the node or object's type is not
 *     known statically. An unused field or method whose name another of our
 *     components, or a Roku built-in node, also uses is kept alive by it.
 *   - Reads and writes are not told apart: a field that is only ever written
 *     counts as used. `npm run dead-code:write-only` lists those candidates for
 *     review; whether one is dead needs judgment (a `getFields()` loop reads
 *     every field by no name), so it is a report, not a build error.
 * Reporting MORE (a live declaration can be reported, which fails the build):
 *   - A name assembled at runtime from a variable (`setField(name, …)`,
 *     `m[name]`, `callFunc(name)`) is invisible. A declaration reached only
 *     that way must be kept with a marker whose reason names the site.
 *
 * ACCURACY TOOLING
 * ----------------
 * `scripts/dead-code-accuracy.js` replays the rule over the repo's history
 * (`npm run dead-code:replay`) and checks that every live declaration is
 * flagged once its references are erased (`npm run dead-code:mutate`). Run both
 * after changing this file; docs/architecture/build-and-tooling.md#dead-code
 * records the last result.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const brighterscript = require('brighterscript');
const { createProgramRule } = require('../lib/bsc-rule.cjs');

const { TokenKind } = brighterscript;

const NAME = 'jellyrock-dead-code';
const CODE = 'dead-code';
const KEEP_CODE = 'dead-code-keep';
const BASELINE_CODE = 'dead-code-baseline';

const KEEP_KINDS = ['design-system', 'api', 'planned', 'platform', 'test-infra', 'debug-console'];

// Functions the Roku OS calls by name. Source: Roku's channel entry points
// (Main / RunUserInterface / RunScreenSaver / RunScreenSaverSettings) and the
// SceneGraph component lifecycle (init / onKeyEvent).
const ENTRY_POINTS = new Set([
  'main',
  'runuserinterface',
  'runscreensaver',
  'runscreensaversettings',
  'init',
  'onkeyevent',
]);

// Interface fields the firmware writes into our components when they are used as
// a MarkupGrid / MarkupList / RowList / ZoomRowList item, a ZoomRowList row
// decoration, or a RowList row title. From the "XML component" / "Item component
// fields" / "Row decoration component fields" sections and the
// rowTitleComponentName field of rokudev/dev-doc (v2.0),
// docs/REFERENCES/scenegraph/list-and-grid-nodes/.
const FIRMWARE_FIELDS = new Set(
  [
    'itemContent',
    'focusPercent',
    'width',
    'height',
    'index',
    'itemHasFocus',
    'gridHasFocus',
    'listHasFocus',
    'rowListHasFocus',
    'rowHasFocus',
    'rowFocusPercent',
    'rowIndex',
    'rowHeightPercent',
    'rowContent',
    'rowCounterText',
    'rowFocused',
    'drawBeforeItems',
    'content',
    'rowCounterVertAlign',
  ].map((n) => n.toLowerCase()),
);

// Interface functions the firmware calls on a component that extends a built-in
// node, keyed by that node. DynamicCustomKeyboard calls keySelected(key) for every
// key press (rokudev/dev-doc v2.0,
// docs/REFERENCES/scenegraph/dynamic-voice-keyboard-nodes/dynamic-custom-keyboard.md).
const PLATFORM_INTERFACE_FUNCTIONS = new Map([['dynamiccustomkeyboard', new Set(['keyselected'])]]);

// Calls other plugins inject at transpile time; they never appear in source.
const INJECTED_CALLS = new Set(
  (require('./auto-abandon-promises.cjs').injectedCalls || []).map((n) => n.toLowerCase()),
);

// A concatenated string literal shorter than this is formatting ("x" + w), not
// the stem of a name family.
const MIN_PREFIX_LENGTH = 3;

const DECLARATION_KEYWORDS = new Set([
  TokenKind.Function,
  TokenKind.Sub,
  TokenKind.Class,
  TokenKind.Namespace,
  TokenKind.Enum,
  TokenKind.Const,
  TokenKind.Interface,
]);

const VENDORED = /(^|[\\/])(roku_modules|components[\\/]vendor)([\\/])/;
const GENERATED_PATHS = new Set(['source/translationkeys.bs']);
const WORD = /[A-Za-z_][A-Za-z0-9_]*/g;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*[$%!#&]?$/;

module.exports = () =>
  createProgramRule({
    name: NAME,
    analyze({ program }) {
      const register = (diagnostic) =>
        program.diagnostics.register(
          { severity: 1, source: NAME, ...diagnostic },
          { tags: [NAME] },
        );
      analyzeProgram(program, register);
    },
  });

function analyzeProgram(program, register, { explain = false } = {}) {
  const options = program.options?.deadCode || {};
  const rootDir = program.options?.rootDir || process.cwd();
  const files = Object.values(program.files || {});
  const brsFiles = files.filter((f) => brighterscript.isBrsFile(f));
  const xmlFiles = files.filter((f) => brighterscript.isXmlFile(f));

  const index = buildReferenceIndex(program, files, brsFiles, xmlFiles);
  index.testCallFunc = indexExposureConsumers(options.exposureConsumers, rootDir);
  const { decls, markers, fileLevelMarkers, sharedScripts } = collectDeclarations(
    brsFiles,
    xmlFiles,
    rootDir,
  );
  const scopeFilesOf = componentScopeMembership(program);
  // By lowercased name: the interface functions that expose it, and the plain
  // functions that could implement it.
  const exposures = new Map();
  const functionsByName = new Map();
  for (const d of decls) {
    const into =
      d.kind === 'interfaceFunction'
        ? exposures
        : d.kind === 'function' && !d.ns
          ? functionsByName
          : null;
    if (!into) continue;
    const k = d.name.toLowerCase();
    if (!into.has(k)) into.set(k, []);
    into.get(k).push(d);
  }

  // --- keeps: inline markers + bsconfig allowlist --------------------------------
  const keepEntries = normalizeKeepEntries(options.keep);
  for (const d of decls) {
    const marker = markers.get(d.file.srcPath)?.get(d.line);
    if (marker) {
      d.marker = marker;
      if (marker.valid) d.kept = marker.kind;
    }
    for (const entry of keepEntries) {
      if (entry.valid && entry.matches(d)) {
        d.kept = entry.kind;
        entry.used = true;
      }
    }
  }

  // --- fixed point -------------------------------------------------------------------
  const ctx = {
    index,
    scopeFilesOf,
    exposures,
    functionsByName,
    sharedScripts,
    deadRegions: new Map(),
    deadFiles: new Map(),
    deadSharedFiles: new Set(),
  };
  let changed = true;
  while (changed) {
    changed = false;
    for (const d of decls) {
      if (d.dead || d.kept || d.alwaysLive) continue;
      const verdict = liveness(d, ctx);
      if (verdict.live) continue;
      d.dead = true;
      d.reachedFrom = verdict.reachedFrom;
      markDead(d, ctx);
      changed = true;
    }
  }

  // --- report --------------------------------------------------------------------------
  const baseline = loadBaseline(options.baseline, rootDir);
  const findings = new Map();
  for (const d of decls) {
    // Code inside a dead component, or in a script only dead components include,
    // is reported through those components.
    if (!d.dead || d.parentDecl?.dead || ctx.deadSharedFiles.has(d.file.srcPath)) continue;
    d.finding = true;
    findings.set(baselineKey(d), d);
  }

  // Writing the baseline records every current finding, so none is reported.
  if (process.env.DEAD_CODE_WRITE_BASELINE === '1' && baseline.path) {
    writeBaseline(baseline.path, [...findings.keys()]);
  } else {
    for (const [key, d] of findings) {
      if (baseline.entries.has(key)) continue;
      register({ code: CODE, message: deadMessage(d, ctx, rootDir), location: d.location });
    }
    reportStaleBaseline(baseline, findings, decls, program, register);
  }

  reportKeepProblems({ decls, markers, fileLevelMarkers, keepEntries, ctx, program, register });

  // Explain mode (accuracy tooling, never the build): every live declaration's
  // live references, so a check can ask why something is NOT reported.
  if (explain) {
    for (const d of decls) {
      if (d.dead || d.kept || d.alwaysLive) continue;
      const by = [];
      liveness(d, ctx, by);
      d.liveBy = by;
    }
  }
  return decls;
}

// ======================================================================================
// References
// ======================================================================================

/**
 * One occurrence of a name: where it is, and (for identifiers) the namespace it
 * was written in, so relative references can be resolved.
 */
function buildReferenceIndex(program, files, brsFiles, xmlFiles) {
  const idx = {
    bare: new Map(), // identifier not after `.` / `@.`
    member: new Map(), // identifier after `.`
    mTopMember: new Map(), // identifier after `m.top.` — always the file's own component
    aaKey: new Map(), // identifier before `:`
    chain: new Map(), // every leading prefix of a dotted chain → occurrences (with ns)
    callFunc: new Map(), // callFunc("x") and node@.x
    str: new Map(), // exact string-literal value
    xmlTag: new Map(),
    xmlAttrName: new Map(),
    xmlAttrWord: new Map(),
    xmlComponentRef: new Map(), // exact value of extends= / *ComponentName=
    json: new Map(), // exact string value in a packaged JSON file
    prefixes: [], // { prefix, occ }
  };

  for (const file of brsFiles) indexBrsFile(file, idx);
  for (const file of xmlFiles) indexXmlFile(file, idx);
  for (const file of files) {
    if (!/\.json$/i.test(file.srcPath || '')) continue;
    indexJsonFile(file, idx);
  }
  return idx;
}

function add(map, key, occ) {
  if (occ.text === undefined) occ = { ...occ, text: key };
  const k = key.toLowerCase();
  let list = map.get(k);
  if (!list) map.set(k, (list = []));
  list.push(occ);
}

function lineOf(token) {
  return token?.location?.range?.start?.line ?? token?.range?.start?.line ?? 0;
}

function colOf(token) {
  return token?.location?.range?.start?.character ?? token?.range?.start?.character ?? 0;
}

// 0-based line / column of each offset in `text`.
function positionMap(text) {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, col: offset - lineStarts[lo] };
  };
}

function indexBrsFile(file, idx) {
  const tokens = (file.parser?.tokens || []).filter(
    (t) =>
      t.kind !== TokenKind.Whitespace &&
      t.kind !== TokenKind.Newline &&
      t.kind !== TokenKind.Comment,
  );
  const nsRanges = namespaceRanges(file);
  const nsAt = (line) => {
    let best = '';
    for (const r of nsRanges) {
      if (line >= r.start && line <= r.end && r.name.length > best.length) best = r.name;
    }
    return best;
  };

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const prev = tokens[i - 1];
    const next = tokens[i + 1];
    const line = lineOf(t);
    const occ = { file, line, col: colOf(t) };

    if (t.kind === TokenKind.StringLiteral || t.kind === TokenKind.TemplateStringQuasi) {
      const value = t.kind === TokenKind.StringLiteral ? t.text.replace(/^"|"$/g, '') : t.text;
      // findNode("x") takes a node ID, which can never name a component.
      const calledWith = prev?.kind === TokenKind.LeftParen && tokens[i - 2]?.text?.toLowerCase();
      const nodeId = calledWith === 'findnode';
      // callFunc("x", ...) is a call through an interface, not a string naming a
      // handler, so it is indexed as a call only: otherwise it would reach any
      // function of that name by the string route and bypass the interface.
      if (t.kind === TokenKind.StringLiteral && calledWith === 'callfunc') {
        add(idx.callFunc, value, occ);
      } else if (t.kind === TokenKind.StringLiteral) {
        add(idx.str, value, nodeId ? { ...occ, nodeId } : occ);
      }
      if (
        next?.kind === TokenKind.Plus &&
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) &&
        value.length >= MIN_PREFIX_LENGTH
      ) {
        idx.prefixes.push({ prefix: value.toLowerCase(), occ });
      }
      continue;
    }

    if (!IDENT.test(t.text)) continue;
    // A declaration's own name is not a use. Our declarations are discounted as
    // `self` anyway, but a vendored library's are not: its `function getString()`
    // would otherwise keep a same-named function of ours alive.
    if (DECLARATION_KEYWORDS.has(prev?.kind)) continue;
    const name = t.text.replace(/[$%!#&]$/, '');

    if (prev?.kind === TokenKind.Callfunc) {
      add(idx.callFunc, name, occ);
      add(idx.member, name, occ);
      continue;
    }
    if (prev?.kind === TokenKind.Dot) {
      const isMTop =
        tokens[i - 2]?.text?.toLowerCase() === 'top' &&
        tokens[i - 3]?.kind === TokenKind.Dot &&
        tokens[i - 4]?.text?.toLowerCase() === 'm' &&
        tokens[i - 5]?.kind !== TokenKind.Dot;
      add(isMTop ? idx.mTopMember : idx.member, name, occ);
      continue;
    }
    if (next?.kind === TokenKind.Colon) add(idx.aaKey, name, occ);
    add(idx.bare, name, occ);

    // A chain start: record every leading prefix (`a`, `a.b`, `a.b.c`).
    const ns = nsAt(line);
    let chain = name;
    add(idx.chain, chain, { ...occ, ns });
    for (
      let j = i + 1;
      tokens[j]?.kind === TokenKind.Dot && tokens[j + 1] && IDENT.test(tokens[j + 1].text);
      j += 2
    ) {
      chain += '.' + tokens[j + 1].text.replace(/[$%!#&]$/, '');
      add(idx.chain, chain, { ...occ, ns });
    }
  }
}

function namespaceRanges(file) {
  const out = [];
  file.parser?.ast?.walk?.(
    brighterscript.createVisitor({
      NamespaceStatement: (s) => {
        const range = s.location?.range;
        if (!range) return;
        out.push({
          name: namespaceNameOf(s).toLowerCase(),
          start: range.start.line,
          end: range.end.line,
        });
      },
    }),
    { walkMode: brighterscript.WalkMode.visitStatementsRecursive },
  );
  return out;
}

function namespaceNameOf(s) {
  try {
    return s.getName(brighterscript.ParseMode.BrighterScript);
  } catch (_e) {
    return s.nameExpression?.getName?.(brighterscript.ParseMode.BrighterScript) || '';
  }
}

// Attribute values that DECLARE or LOCATE rather than reference.
const NON_REFERENCE_ATTRS = new Set(['id', 'uri']);

function indexXmlFile(file, idx) {
  // Comments are blanked (not removed) so offsets still map to lines.
  const text = (file.fileContents || '').replace(/<!--[\s\S]*?-->/g, (c) =>
    c.replace(/[^\n]/g, ' '),
  );
  const at = positionMap(text);
  // An element's attributes may span lines, so match whole start tags.
  for (const m of text.matchAll(/<([A-Za-z_][\w.]*)([^<>]*?)\/?>/g)) {
    const tag = m[1].toLowerCase();
    add(idx.xmlTag, m[1], { file, ...at(m.index + 1) });
    const attrsAt = m.index + 1 + m[1].length;
    for (const a of m[2].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const attr = a[1];
      const value = a[2] ?? a[3] ?? '';
      const la = attr.toLowerCase();
      // Declarations: <component name>, <function name>; <field id> and child ids.
      if ((tag === 'component' || tag === 'function') && la === 'name') continue;
      if (NON_REFERENCE_ATTRS.has(la)) continue;
      const attrAt = attrsAt + a.index;
      add(idx.xmlAttrName, attr, { file, ...at(attrAt) });
      const valueAt = attrAt + a[0].indexOf(value, attr.length);
      for (const w of value.matchAll(WORD))
        add(idx.xmlAttrWord, w[0], { file, ...at(valueAt + w.index) });
      if (la === 'extends' || la.endsWith('componentname'))
        add(idx.xmlComponentRef, value.trim(), { file, ...at(valueAt) });
    }
  }
}

// Test sources are outside the program, so they are read from disk. Cached by
// mtime: the language server re-runs this rule on every edit.
const exposureCache = new Map();

function indexExposureConsumers(globs, rootDir) {
  const out = new Map();
  if (!Array.isArray(globs) || !globs.length) return out;
  let paths;
  try {
    paths = require('fast-glob').sync(globs, {
      cwd: rootDir,
      absolute: true,
      ignore: ['**/node_modules/**'],
    });
  } catch (_e) {
    return out;
  }
  for (const srcPath of paths) {
    let mtime;
    try {
      mtime = fs.statSync(srcPath).mtimeMs;
    } catch (_e) {
      continue;
    }
    let cached = exposureCache.get(srcPath);
    if (!cached || cached.mtime !== mtime) {
      cached = { mtime, names: exposureNamesIn(srcPath) };
      exposureCache.set(srcPath, cached);
    }
    for (const { name, line } of cached.names) add(out, name, { file: { srcPath }, line });
  }
  return out;
}

function exposureNamesIn(srcPath) {
  const names = [];
  let text;
  try {
    text = fs.readFileSync(srcPath, 'utf8');
  } catch (_e) {
    return names;
  }
  if (/\.(bs|brs)$/i.test(srcPath)) {
    const tokens = brighterscript.Lexer.scan(text).tokens.filter(
      (t) =>
        t.kind !== TokenKind.Whitespace &&
        t.kind !== TokenKind.Newline &&
        t.kind !== TokenKind.Comment,
    );
    tokens.forEach((t, i) => {
      if (
        t.kind === TokenKind.StringLiteral &&
        tokens[i - 1]?.kind === TokenKind.LeftParen &&
        tokens[i - 2]?.text?.toLowerCase() === 'callfunc'
      ) {
        names.push({ name: t.text.replace(/^"|"$/g, ''), line: lineOf(t) });
      } else if (tokens[i - 1]?.kind === TokenKind.Callfunc && IDENT.test(t.text)) {
        names.push({ name: t.text, line: lineOf(t) });
      }
    });
  } else {
    // JavaScript: any quoted identifier. RTA names ODC targets as `funcName: 'x'`,
    // usually on a different line from the callFunc it belongs to.
    const lines = text.split('\n');
    lines.forEach((l, line) => {
      for (const m of l.matchAll(/(['"`])([A-Za-z_][A-Za-z0-9_]*)\1/g))
        names.push({ name: m[2], line });
    });
  }
  return names;
}

function indexJsonFile(file, idx) {
  let text;
  try {
    // An AssetFile loads its content lazily through `data.value`; fall back to disk.
    const value = file.data?.value;
    text =
      value !== undefined && value !== null
        ? value.toString()
        : fs.readFileSync(file.srcPath, 'utf8');
  } catch (_e) {
    return;
  }
  const at = positionMap(text);
  for (const m of text.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g))
    add(idx.json, m[1], { file, ...at(m.index + 1) });
}

// ======================================================================================
// Declarations
// ======================================================================================

// A file's path inside the package, with its SOURCE extension. `pkgPath` is the
// transpiled path (`.bs` becomes `.brs`), so it cannot be matched against a
// `<script uri="….bs">` or a source filename; `destPath` can.
function packagePath(file) {
  return (file.destPath || file.pkgPath || '')
    .replace(/\\/g, '/')
    .replace(/^pkg:\//i, '')
    .toLowerCase();
}

// Every file under `source/` is compiled into the one main scope.
function isSourceScopeFile(file) {
  return packagePath(file).startsWith('source/');
}

function isOwnedFile(file) {
  const p = (file.srcPath || '').replace(/\\/g, '/');
  if (VENDORED.test(p)) return false;
  if (GENERATED_PATHS.has(packagePath(file))) return false;
  return true;
}

function relPath(file, rootDir) {
  const p = path.relative(rootDir, file.srcPath || '').replace(/\\/g, '/');
  return p.startsWith('..') ? packagePath(file) : p;
}

function collectDeclarations(brsFiles, xmlFiles, rootDir) {
  const decls = [];
  const markers = new Map(); // srcPath → Map(declLine → marker)
  const fileLevelMarkers = [];

  for (const file of brsFiles) {
    if (!isOwnedFile(file)) continue;
    const rel = relPath(file, rootDir);
    const inSource = /^source\//i.test(rel);
    const fileMarkers = parseBrsMarkers(file);
    markers.set(file.srcPath, fileMarkers.byDeclLine);
    if (fileMarkers.fileLevel) fileLevelMarkers.push({ file, ...fileMarkers.fileLevel });

    // The innermost namespace statement's name is already fully qualified
    // (`namespace a.b` nests, and each level reports its whole dotted name).
    const nsOf = (node) => {
      for (let p = node.parent; p; p = p.parent) {
        if (brighterscript.isNamespaceStatement(p)) return namespaceNameOf(p);
      }
      return '';
    };
    const base = (s, kind, extra = {}) => {
      const nameTok = s.tokens?.name;
      const name = nameTok?.text || s.name?.text || s.name;
      const ns = nsOf(s);
      const range = s.location?.range;
      return {
        kind,
        name,
        ns,
        qname: (ns ? ns + '.' : '') + name,
        file,
        rel,
        inSource,
        location: nameTok?.location || s.location,
        line: lineOf(nameTok) ?? range?.start?.line,
        start: range?.start?.line ?? 0,
        end: range?.end?.line ?? 0,
        ...extra,
      };
    };

    file.parser.ast.walk(
      brighterscript.createVisitor({
        ClassStatement: (s) => decls.push(base(s, 'class')),
        MethodStatement: (s) => {
          const d = base(s, 'method');
          let cls = s.parent;
          while (cls && !brighterscript.isClassStatement(cls)) cls = cls.parent;
          const owner = decls.find(
            (x) =>
              x.kind === 'class' &&
              x.file === file &&
              x.start === cls?.location?.range?.start?.line,
          );
          d.parentDecl = owner;
          d.qname = (owner ? owner.qname + '.' : '') + d.name;
          if (d.name.toLowerCase() === 'new') d.alwaysLive = true;
          decls.push(d);
        },
        FunctionStatement: (s) => {
          if (brighterscript.isMethodStatement(s)) return;
          const d = base(s, 'function');
          if (
            !d.ns &&
            (ENTRY_POINTS.has(d.name.toLowerCase()) || INJECTED_CALLS.has(d.name.toLowerCase()))
          )
            d.alwaysLive = true;
          decls.push(d);
        },
        ConstStatement: (s) => decls.push(base(s, 'const')),
        EnumStatement: (s) => decls.push(base(s, 'enum')),
        EnumMemberStatement: (s) => {
          const d = base(s, 'enumMember');
          let en = s.parent;
          while (en && !brighterscript.isEnumStatement(en)) en = en.parent;
          const owner = decls.find(
            (x) =>
              x.kind === 'enum' && x.file === file && x.start === en?.location?.range?.start?.line,
          );
          d.parentDecl = owner;
          d.qname = (owner ? owner.qname + '.' : '') + d.name;
          decls.push(d);
        },
      }),
      { walkMode: brighterscript.WalkMode.visitStatementsRecursive },
    );
  }

  // Built-in ancestors of each component, for PLATFORM_INTERFACE_FUNCTIONS.
  const xmlByName = new Map();
  for (const f of xmlFiles)
    if (f.componentName?.text) xmlByName.set(f.componentName.text.toLowerCase(), f);
  const ancestorsOf = (file) => {
    const out = [];
    const seen = new Set();
    let parent = file.parentComponentName?.text;
    while (parent && !seen.has(parent.toLowerCase())) {
      seen.add(parent.toLowerCase());
      out.push(parent.toLowerCase());
      parent = xmlByName.get(parent.toLowerCase())?.parentComponentName?.text;
    }
    return out;
  };
  const platformFunctionsOf = (file) => {
    const names = new Set();
    for (const a of ancestorsOf(file))
      for (const n of PLATFORM_INTERFACE_FUNCTIONS.get(a) || []) names.add(n);
    return names;
  };

  for (const file of xmlFiles) {
    if (!isOwnedFile(file)) continue;
    const rel = relPath(file, rootDir);
    const platformFunctions = platformFunctionsOf(file);
    const fileMarkers = parseXmlMarkers(file);
    markers.set(file.srcPath, fileMarkers.byDeclLine);
    const component = file.parser?.ast?.componentElement;
    const compName = file.componentName?.text;
    if (!component || !compName) continue;
    const compDecl = {
      kind: 'component',
      name: compName,
      ns: '',
      qname: compName,
      file,
      rel,
      location: file.componentName.location || component.location,
      line: lineOf(file.componentName),
      ownFiles: new Set([file.srcPath]),
    };
    decls.push(compDecl);
    const api = component.interfaceElement;
    for (const field of api?.getElementsByTagName?.('field') || []) {
      const name = field.id;
      if (!name) continue;
      const hasAlias = !!field.getAttribute?.('alias');
      const hasValue = !!field.getAttribute?.('value');
      const hasOnChange = !!field.getAttribute?.('onChange');
      decls.push({
        kind: 'field',
        name,
        ns: '',
        qname: compName + '.' + name,
        file,
        rel,
        location: field.location,
        line: field.location?.range?.start?.line ?? 0,
        parentDecl: compDecl,
        alwaysLive: FIRMWARE_FIELDS.has(name.toLowerCase()) || (hasAlias && hasValue),
        // A write to an aliased or self-observed field is a use in its own right.
        hasAlias,
        hasOnChange,
      });
    }
    for (const fn of api?.getElementsByTagName?.('function') || []) {
      const name = fn.name;
      if (!name) continue;
      decls.push({
        kind: 'interfaceFunction',
        name,
        ns: '',
        qname: compName + '.' + name,
        file,
        rel,
        location: fn.location,
        line: fn.location?.range?.start?.line ?? 0,
        parentDecl: compDecl,
        alwaysLive: platformFunctions.has(name.toLowerCase()),
      });
    }
    compDecl.platformFunctions = platformFunctions;
  }

  // A component's own files: its XML plus codebehind files no other component
  // includes. Those die with it.
  const scriptOwners = new Map();
  for (const d of decls) {
    if (d.kind !== 'component') continue;
    for (const s of d.file.parser?.ast?.componentElement?.scriptElements || []) {
      const uri = (s.uri || '').replace(/^pkg:\//i, '').toLowerCase();
      if (!uri) continue;
      if (!scriptOwners.has(uri)) scriptOwners.set(uri, []);
      scriptOwners.get(uri).push(d);
    }
  }
  const byPkg = new Map();
  for (const f of brsFiles) byPkg.set(packagePath(f), f);
  // autoImportComponentScript: the same-named .bs/.brs beside the XML is part of
  // the component even without a <script> tag.
  for (const d of decls) {
    if (d.kind !== 'component') continue;
    const base = packagePath(d.file).replace(/\.xml$/i, '');
    for (const ext of ['.bs', '.brs']) {
      const uri = base + ext;
      if (!byPkg.has(uri)) continue;
      if (!scriptOwners.has(uri)) scriptOwners.set(uri, []);
      if (!scriptOwners.get(uri).includes(d)) scriptOwners.get(uri).push(d);
    }
  }
  // A script several components include dies once all of them are dead
  // (markDead). A `source/` script never dies with a component: every `source/`
  // file is also compiled into the main scope.
  const sharedScripts = new Map();
  for (const [uri, owners] of scriptOwners) {
    const f = byPkg.get(uri);
    if (!f || /^source\//.test(uri)) continue;
    if (owners.length === 1) owners[0].ownFiles.add(f.srcPath);
    else sharedScripts.set(f.srcPath, owners);
  }
  // Codebehind functions belong to their component: when it is dead, report the
  // component, not every function in it. A function the firmware calls through the
  // component's interface is live whenever any component including its file is.
  const components = decls.filter((c) => c.kind === 'component');
  for (const d of decls) {
    if ((d.kind === 'function' || d.kind === 'const') && !d.parentDecl && !d.inSource) {
      const owner = components.find((c) => c.ownFiles?.has(d.file.srcPath));
      if (owner) d.parentDecl = owner;
    }
    if (d.kind === 'function' && !d.inSource && !d.ns) {
      const lname = d.name.toLowerCase();
      if (
        components.some((c) => c.platformFunctions?.has(lname) && c.ownFiles?.has(d.file.srcPath))
      )
        d.alwaysLive = true;
    }
  }

  return { decls, markers, fileLevelMarkers, sharedScripts };
}

// --- keep markers ------------------------------------------------------------------------

const MARKER = /bsc-disable-(next-line|line)\s+dead-code\b(.*)$/i;
const FILE_MARKER = /bsc-disable-file\s+dead-code\b/i;

function parseKeep(rest) {
  const m = /^\s*keep:\s*([a-z-]+)\s*(.*)$/i.exec(rest || '');
  if (!m) return { valid: false, problem: 'it names no keep kind' };
  const kind = m[1].toLowerCase();
  const reason = m[2]
    .replace(/^[\s—–:-]+/, '')
    .replace(/\s*-->\s*$/, '')
    .trim();
  if (!KEEP_KINDS.includes(kind)) return { valid: false, problem: `"${kind}" is not a keep kind` };
  if (!reason) return { valid: false, kind, problem: 'it gives no reason' };
  if (kind === 'planned' && !/#\d+/.test(reason))
    return { valid: false, kind, problem: 'a planned keep must cite its issue (#123)' };
  return { valid: true, kind, reason };
}

function parseBrsMarkers(file) {
  const byDeclLine = new Map();
  let fileLevel = null;
  const lines = (file.fileContents || '').split(/\r?\n/);
  let ifDepth = 0;
  lines.forEach((text, i) => {
    if (/^\s*#if\b/i.test(text)) ifDepth++;
    else if (/^\s*#end\s*if\b/i.test(text)) ifDepth = Math.max(0, ifDepth - 1);
    const commentAt = text.indexOf("'");
    if (commentAt < 0) return;
    const comment = text.slice(commentAt);
    if (FILE_MARKER.test(comment)) fileLevel = { line: i, text: comment };
    const m = MARKER.exec(comment);
    if (!m) return;
    const target = m[1].toLowerCase() === 'next-line' ? i + 1 : i;
    byDeclLine.set(target, { markerLine: i, file, inConditional: ifDepth > 0, ...parseKeep(m[2]) });
  });
  return { byDeclLine, fileLevel };
}

function parseXmlMarkers(file) {
  const byDeclLine = new Map();
  const lines = (file.fileContents || '').split(/\r?\n/);
  lines.forEach((text, i) => {
    for (const c of text.matchAll(/<!--([\s\S]*?)-->/g)) {
      const m = MARKER.exec(c[1]);
      if (!m) continue;
      const target = m[1].toLowerCase() === 'next-line' ? i + 1 : i;
      byDeclLine.set(target, { markerLine: i, file, ...parseKeep(m[2]) });
    }
  });
  return { byDeclLine };
}

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + re + '$', 'i');
}

function normalizeKeepEntries(entries) {
  return (Array.isArray(entries) ? entries : []).map((raw, i) => {
    const kept = parseKeep(`keep: ${raw?.kind || ''} ${raw?.reason || ''}`);
    const files = (raw?.files || []).map(globToRegExp);
    const names = (raw?.names?.length ? raw.names : ['*']).map(globToRegExp);
    return {
      index: i,
      raw,
      valid: kept.valid && files.length > 0,
      problem: files.length === 0 ? 'it lists no files' : kept.problem,
      kind: kept.kind,
      used: false,
      matches: (d) =>
        files.some((f) => f.test(d.rel)) && names.some((n) => n.test(d.name) || n.test(d.qname)),
    };
  });
}

// ======================================================================================
// Liveness
// ======================================================================================

function componentScopeMembership(program) {
  const scopesByFile = new Map();
  for (const scope of program.getScopes?.() || []) {
    if (!brighterscript.isXmlScope(scope)) continue;
    const scopeFiles = new Set(scope.getAllFiles().map((f) => f.srcPath));
    for (const f of scopeFiles) {
      if (!scopesByFile.has(f)) scopesByFile.set(f, new Set());
      const acc = scopesByFile.get(f);
      for (const g of scopeFiles) acc.add(g);
    }
  }
  return scopesByFile;
}

function markDead(d, ctx) {
  if (d.kind === 'component') {
    for (const f of d.ownFiles) ctx.deadFiles.set(f, d);
    for (const [f, owners] of ctx.sharedScripts) {
      if (ctx.deadFiles.has(f) || !owners.every((o) => o.dead)) continue;
      ctx.deadFiles.set(f, d);
      ctx.deadSharedFiles.add(f);
    }
    return;
  }
  const region = deadRegionOf(d);
  if (!region) return;
  const key = d.file.srcPath;
  if (!ctx.deadRegions.has(key)) ctx.deadRegions.set(key, []);
  ctx.deadRegions.get(key).push({ ...region, decl: d });
}

// The code a dead declaration takes with it. A function, method or class is whole
// lines. An interface field or function is its XML element, bounded by COLUMN: an
// element can share a line with a live one, and a line-based region would take the
// neighbor's onChange handler down with it.
function deadRegionOf(d) {
  if (d.kind === 'function' || d.kind === 'method' || d.kind === 'class') {
    return { start: d.start, end: d.end };
  }
  if (d.kind === 'field' || d.kind === 'interfaceFunction') {
    const r = d.location?.range;
    if (!r) return null;
    return {
      start: r.start.line,
      end: r.end.line,
      startCol: r.start.character,
      endCol: r.end.character,
    };
  }
  return null;
}

function inRegion(occ, r) {
  if (occ.line < r.start || occ.line > r.end) return false;
  if (r.startCol === undefined) return true;
  const col = occ.col ?? 0;
  if (occ.line === r.start && col < r.startCol) return false;
  if (occ.line === r.end && col >= r.endCol) return false;
  return true;
}

/**
 * Is `occ` a real reference to `d`? Not if it is `d`'s own declaration or body,
 * and not if it sits in code already found dead (the transitive rule). Returns
 * the dead declaration that contains it, so a verdict can say where the only
 * references were.
 */
function discount(occ, d, ctx) {
  const srcPath = occ.file.srcPath;
  if (d.ownFiles?.has(srcPath)) return { self: true };
  if (srcPath === d.file.srcPath) {
    const own = deadRegionOf(d) || { start: d.line, end: d.line };
    if (inRegion(occ, own)) return { self: true };
  }
  const deadComp = ctx.deadFiles.get(srcPath);
  if (deadComp) return { dead: deadComp };
  for (const r of ctx.deadRegions.get(srcPath) || []) {
    if (inRegion(occ, r)) return { dead: r.decl };
  }
  return null;
}

// `collect`, when given, receives EVERY live reference instead of stopping at the
// first one (explain mode).
function liveness(d, ctx, collect) {
  const reachedFrom = new Set();
  const idx = ctx.index;
  const lname = d.name.toLowerCase();
  const lq = d.qname.toLowerCase();
  const underscore = lq.replace(/\./g, '_');

  // `via` names the index a reference was found in; explain mode records it so a
  // report can say which rule kept a declaration alive.
  const anyLive = (list, filter, via) => {
    for (const occ of list || []) {
      if (filter && !filter(occ)) continue;
      const why = discount(occ, d, ctx);
      if (!why) {
        if (!collect) return true;
        collect.push({ ...occ, via });
        continue;
      }
      if (why.dead) reachedFrom.add(why.dead.qname);
    }
    return false;
  };
  const prefixHit = (name) => {
    for (const p of idx.prefixes) {
      if (
        name.startsWith(p.prefix) &&
        name !== p.prefix &&
        anyLive([{ ...p.occ, prefix: p.prefix }], null, 'prefix')
      )
        return true;
    }
    return false;
  };
  const result = (live) => ({ live: live || !!collect?.length, reachedFrom: [...reachedFrom] });

  switch (d.kind) {
    case 'function':
    case 'const': {
      if (d.ns) {
        const q = qualifiedLive(d, ctx, anyLive);
        return result(prefixHit(underscore) || q);
      }
      // A codebehind function is reached by name only from the component scopes that
      // include its file. A `source/` function is reached by a bare call from
      // `source/` (one scope), or from a component whose scope imports its file: a
      // component that does not import it cannot call it, and a same-named function
      // of its own is what its call reaches (SearchTask's own searchMedia kept the
      // unreachable source/api one alive). A STRING naming a function is left
      // unscoped for `source/`: `functionName = "run"` names a function in the
      // target node's scope, not the writer's.
      const inScope = d.inSource ? null : ctx.scopeFilesOf.get(d.file.srcPath);
      const scoped = inScope ? (occ) => inScope.has(occ.file.srcPath) : null;
      const bareScoped = d.inSource
        ? (occ) =>
            isSourceScopeFile(occ.file) ||
            !!ctx.scopeFilesOf.get(occ.file.srcPath)?.has(d.file.srcPath)
        : scoped;
      return result(
        anyLive(idx.bare.get(lname), bareScoped, 'bare') ||
          (d.kind === 'function' &&
            (anyLive(idx.str.get(lname), scoped, 'str') ||
              anyLive(idx.xmlAttrWord.get(lname), scoped, 'xmlAttrWord') ||
              (isExposed(d, ctx) && anyLive(idx.callFunc.get(lname), null, 'callFunc')))) ||
          prefixHit(lname),
      );
    }
    case 'class':
    case 'enum':
    case 'enumMember':
      return result(qualifiedLive(d, ctx, anyLive));
    case 'method':
      return result(
        anyLive(idx.member.get(lname), null, 'member') || anyLive(idx.str.get(lname), null, 'str'),
      );
    // A component is named by an EXACT value — a tag, extends= / itemComponentName=,
    // or a whole string (CreateObject, createChild, a route) — never by a word
    // inside a longer string: "Registry section: " is not a use of Section, and
    // findNode("itemGrid") is not a use of ItemGrid.
    // Case-insensitive, although Roku documents component names as matched
    // case-sensitively (rokudev/dev-doc, scenegraph-compilation.md): the firmware
    // builds an ExtrasSlider from ItemDetails.xml's <extrasSlider>, which
    // ItemDetailsExtrasSlider.spec.bs pins on device. A findNode() argument is a node
    // ID, never a component name, so it does not count.
    case 'component': {
      const notNodeId = (occ) => !occ.nodeId;
      return result(
        anyLive(idx.xmlTag.get(lname), null, 'xmlTag') ||
          anyLive(idx.xmlComponentRef.get(lname), null, 'xmlComponentRef') ||
          anyLive(idx.str.get(lname), notNodeId, 'str') ||
          anyLive(idx.json.get(lname), null, 'json') ||
          prefixHit(lname),
      );
    }
    // `m.top.x` names the field on the file's OWN component (or an ancestor), so it
    // counts only for a component whose XML shares a scope with the file. Any other
    // `node.x` is matched by name, since the node's type is unknown.
    case 'field': {
      const sameScope = (occ) =>
        ctx.scopeFilesOf.get(occ.file.srcPath)?.has(d.file.srcPath) ?? true;
      return result(
        anyLive(idx.mTopMember.get(lname), sameScope, 'mTopMember') ||
          anyLive(idx.member.get(lname), null, 'member') ||
          anyLive(idx.aaKey.get(lname), null, 'aaKey') ||
          anyLive(idx.str.get(lname), null, 'str') ||
          anyLive(idx.xmlAttrName.get(lname), null, 'xmlAttrName') ||
          anyLive(idx.xmlAttrWord.get(lname), null, 'xmlAttrWord') ||
          anyLive(idx.json.get(lname), null, 'json') ||
          prefixHit(lname),
      );
    }
    // Only a call reaches an interface function: `callFunc("x")` / `@.x`. A test's
    // call keeps the exposure only while the app still runs a function behind it —
    // an exposure of code the app never runs is dead with that code.
    case 'interfaceFunction': {
      if (anyLive(idx.callFunc.get(lname), null, 'callFunc')) return result(true);
      // No implementation in scope is broken wiring, not dead code: leave it to the
      // test that calls it to fail.
      const impls = implementationsOf(d, ctx);
      const implLive = !impls.length || impls.some((f) => f.kept || f.alwaysLive || !f.dead);
      return result(implLive && anyLive(idx.testCallFunc?.get(lname), null, 'testCallFunc'));
    }
    default:
      return result(true);
  }
}

/**
 * A namespaced (or class / enum) declaration is referenced by a chain whose
 * leading part IS its qualified name — `imageSize.LOGO` or `imageSize.LOGO.width`
 * — or by a relative chain written inside an enclosing namespace: `LOGO` inside
 * `namespace imageSize`. Its transpiled `ns_name` spelling in a string is how a
 * callback names a namespaced function.
 */
function qualifiedLive(d, ctx, anyLive) {
  const idx = ctx.index;
  const lq = d.qname.toLowerCase();
  const segments = lq.split('.');
  for (let cut = 0; cut < segments.length; cut++) {
    const written = segments.slice(cut).join('.');
    const mustBeIn = segments.slice(0, cut).join('.');
    const filter = mustBeIn
      ? (occ) => occ.ns === mustBeIn || (occ.ns || '').startsWith(mustBeIn + '.')
      : null;
    if (anyLive(idx.chain.get(written), filter, 'chain')) return true;
  }
  if (d.kind === 'function') {
    const underscore = lq.replace(/\./g, '_');
    if (
      anyLive(idx.str.get(underscore), null, 'str') ||
      anyLive(idx.str.get(lq), null, 'str') ||
      anyLive(idx.callFunc.get(underscore), null, 'callFunc')
    )
      return true;
  }
  return false;
}

/**
 * Is `fn` exposed through an `<interface><function>` of a component whose scope
 * includes its file? Only then can a `callFunc` reach it.
 */
function isExposed(fn, ctx) {
  const scope = ctx.scopeFilesOf.get(fn.file.srcPath);
  if (!scope) return false;
  return (ctx.exposures.get(fn.name.toLowerCase()) || []).some((e) => scope.has(e.file.srcPath));
}

/** The functions that could run when interface function `e` is called. */
function implementationsOf(e, ctx) {
  const scope = ctx.scopeFilesOf.get(e.file.srcPath);
  if (!scope) return [];
  return (ctx.functionsByName.get(e.name.toLowerCase()) || []).filter((f) =>
    scope.has(f.file.srcPath),
  );
}

// ======================================================================================
// Reporting
// ======================================================================================

const KIND_LABEL = {
  function: 'function',
  method: 'method',
  class: 'class',
  const: 'const',
  enum: 'enum',
  enumMember: 'enum member',
  component: 'component',
  field: 'interface field',
  interfaceFunction: 'interface function',
};

// Where a name is written, for a message: `components/Foo.bs:12`.
function siteOf(occ, rootDir) {
  const rel = path.relative(rootDir, occ.file.srcPath || '').replace(/\\/g, '/');
  return `${rel.startsWith('..') ? occ.file.srcPath : rel}:${occ.line + 1}`;
}

// The near-misses a reader would otherwise take as proof the code is used: a call
// that cannot reach it, or a test that is its only caller.
function deadHint(d, ctx, rootDir) {
  const lname = d.name.toLowerCase();
  if (d.kind === 'function' && !d.ns && !isExposed(d, ctx)) {
    const call = ctx.index.callFunc.get(lname)?.[0];
    if (call) {
      return ` \`callFunc("${d.name}")\` is called (${siteOf(call, rootDir)}), but no component whose scope includes this file declares <function name="${d.name}" /> in its <interface>, so that call cannot reach it. If it should, the missing declaration is the bug.`;
    }
  }
  if (d.kind === 'interfaceFunction') {
    const test = ctx.index.testCallFunc?.get(lname)?.[0];
    if (test) {
      return ` Only a test calls it (${siteOf(test, rootDir)}), and the app never runs the function behind it.`;
    }
  }
  return '';
}

function deadMessage(d, ctx, rootDir) {
  const what = `${KIND_LABEL[d.kind]} '${d.qname}'`;
  const via = d.reachedFrom?.length
    ? ` Its only references are inside code that is itself dead (${d.reachedFrom.slice(0, 3).join(', ')}).`
    : deadHint(d, ctx, rootDir);
  const marker =
    d.kind === 'component' || d.kind === 'field' || d.kind === 'interfaceFunction'
      ? '<!-- bsc-disable-next-line dead-code keep: <kind>: <reason> -->'
      : "' bsc-disable-next-line dead-code keep: <kind>: <reason>";
  return (
    `The ${what} has no consumer in the app: no call, reference, string, XML attribute or packaged JSON that the app runs reaches it.${via} ` +
    `Delete it — or, if it is kept on purpose, say so above it: ${marker} (kinds: ${KEEP_KINDS.join(', ')}; a planned keep cites its issue). ` +
    `See docs/architecture/build-and-tooling.md#dead-code.`
  );
}

function baselineKey(d) {
  return `${d.kind} ${d.rel} ${d.qname}`;
}

function loadBaseline(relative, rootDir) {
  if (!relative) return { path: null, entries: new Set() };
  const file = path.resolve(rootDir, relative);
  try {
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      path: file,
      relative,
      entries: new Set(Array.isArray(json.entries) ? json.entries : []),
    };
  } catch (_e) {
    return { path: file, relative, entries: new Set() };
  }
}

function writeBaseline(file, keys) {
  const body = {
    '//': 'Dead code awaiting removal (#1072). The dead-code BSC plugin skips these entries and fails on any that is no longer dead, so this file cannot hold a stale entry. An added entry is a deliberate deferral, decided in review: never add one to silence a new finding. Delete the code, or mark it kept (see docs/architecture/build-and-tooling.md#dead-code).',
    entries: [...keys].sort(),
  };
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n');
}

function reportStaleBaseline(baseline, findings, decls, program, register) {
  if (!baseline.entries.size) return;
  const byKey = new Map(decls.map((d) => [baselineKey(d), d]));
  const anchor = program.getFile?.('manifest') || Object.values(program.files || {})[0];
  for (const key of baseline.entries) {
    if (findings.has(key)) continue;
    const d = byKey.get(key);
    register({
      code: BASELINE_CODE,
      message: d
        ? `'${d.qname}' is listed in ${baseline.relative} but is no longer dead. Remove the entry "${key}" from ${baseline.relative}.`
        : `${baseline.relative} lists "${key}", which no longer exists. Remove the entry.`,
      location: d?.location || fileStartLocation(anchor),
    });
  }
}

function reportKeepProblems({
  decls,
  markers,
  fileLevelMarkers,
  keepEntries,
  ctx,
  program,
  register,
}) {
  const declByMarker = new Map();
  for (const d of decls) if (d.marker) declByMarker.set(d.marker, d);

  for (const fileMarkers of markers.values()) {
    for (const marker of fileMarkers.values()) {
      const d = declByMarker.get(marker);
      const location = markerLocation(marker);
      if (!d) {
        // A debug-console function lives in an `#if debug` block that a release build
        // excludes, so its marker has no declaration there. That is not drift.
        if (marker.valid && marker.kind === 'debug-console' && marker.inConditional) continue;
        register({
          code: KEEP_CODE,
          message:
            'This dead-code marker is not directly above (or on the line of) a declaration, so it keeps nothing. Move it or remove it.',
          location,
        });
      } else if (!marker.valid) {
        register({
          code: KEEP_CODE,
          message: `This dead-code marker does not count: ${marker.problem}. Write it as "bsc-disable-next-line dead-code keep: <kind>: <reason>" (kinds: ${KEEP_KINDS.join(', ')}; a planned keep cites its issue).`,
          location,
        });
      } else if (liveness(d, ctx).live) {
        register({
          code: KEEP_CODE,
          message: `'${d.qname}' is used, so this dead-code keep marker is stale. Remove it.`,
          location,
        });
      }
    }
  }
  for (const f of fileLevelMarkers) {
    register({
      code: KEEP_CODE,
      message:
        "A file-level 'bsc-disable-file dead-code' keeps everything in the file, including code nobody meant to keep. Mark each declaration, or list a deliberate set in bsconfig.json's deadCode.keep with its reason.",
      location: lineLocation(f.file, f.line),
    });
  }
  const anchor = program.getFile?.('manifest') || Object.values(program.files || {})[0];
  for (const entry of keepEntries) {
    if (!entry.valid) {
      register({
        code: KEEP_CODE,
        message: `bsconfig.json deadCode.keep entry ${entry.index} does not count: ${entry.problem}.`,
        location: fileStartLocation(anchor),
      });
    } else if (!entry.used) {
      register({
        code: KEEP_CODE,
        message: `bsconfig.json deadCode.keep entry ${entry.index} (${JSON.stringify(entry.raw.files)}) matches no declaration. Remove it.`,
        location: fileStartLocation(anchor),
      });
    }
  }
}

function markerLocation(marker) {
  return lineLocation(marker.file, marker.markerLine);
}

function lineLocation(file, line) {
  const uri = brighterscript.util?.pathToUri
    ? brighterscript.util.pathToUri(file.srcPath)
    : 'file://' + file.srcPath;
  return { uri, range: { start: { line, character: 0 }, end: { line, character: 200 } } };
}

function fileStartLocation(file) {
  return lineLocation(file, 0);
}

module.exports.__internals = {
  parseKeep,
  globToRegExp,
  FIRMWARE_FIELDS,
  ENTRY_POINTS,
  // Accuracy tooling: the full analysis without registering diagnostics.
  analyze: (program, options) => analyzeProgram(program, () => {}, options),
  baselineKey,
  componentScopeMembership,
};

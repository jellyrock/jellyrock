/**
 * BrighterScript plugin: removes every `print` from the vendored ropm modules a bsconfig lists,
 * in every build.
 *
 * Why: roku-requests prints each request's URL and headers (the access token, the device ID and
 * the Roku's name) with no switch to turn it off, and a print never reaches the logger's masking.
 * Removing the statements at build time needs no patch to re-apply on each library upgrade: any
 * console output a module makes is a print, wherever a new version puts it.
 *
 * The shipped module then differs from the source in `source/roku_modules/`, and the build
 * fails rather than let that difference go wrong silently:
 *  - `vendor-print-module-missing`: a listed module matches no file (renamed or uninstalled),
 *  - `vendor-print-none`: a listed module holds no print (moved behind something this cannot see,
 *    or gone, in which case take it off the list),
 *  - `vendor-print-call`: a print to remove calls something not in `allowedCalls`, so removing
 *    it could change what the module does.
 *
 * Config, in bsconfig.json (inherited through `extends`):
 *   "stripVendorPrints": { "modules": ["rr"], "allowedCalls": ["GetURL"] }
 *
 * Every build config must load this plugin; tests/scripts/unit/bsc-plugins/
 * strip-vendor-prints.test.js fails when one does not.
 */
'use strict';

const brighterscript = require('brighterscript');

const NAME = 'strip-vendor-prints';
const CODE_MISSING = 'vendor-print-module-missing';
const CODE_NONE = 'vendor-print-none';
const CODE_CALL = 'vendor-print-call';

/** The ropm module a file belongs to (`source/roku_modules/rr/x.brs` gives `rr`), or undefined. */
function moduleOf(file) {
  const match = /(?:^|[\\/])(?:source|components)[\\/]roku_modules[\\/]([^\\/]+)[\\/]/i.exec(
    file.pkgPath ?? '',
  );
  return match ? match[1].toLowerCase() : undefined;
}

/** Each print statement in a file. */
function printsIn(file) {
  const prints = [];
  file.ast.walk(
    brighterscript.createVisitor({
      PrintStatement: (statement) => {
        prints.push(statement);
      },
    }),
    { walkMode: brighterscript.WalkMode.visitStatementsRecursive },
  );
  return prints;
}

/** The names of the calls inside a print's expressions (`urlTransfer.GetURL()` gives `GetURL`). */
function callsIn(statement) {
  const names = [];
  statement.walk(
    brighterscript.createVisitor({
      CallExpression: (call) => {
        const callee = call.callee;
        const name = callee?.tokens?.name?.text ?? callee?.name?.text;
        names.push({ name: name ?? '(an expression)', call });
      },
    }),
    { walkMode: brighterscript.WalkMode.visitExpressionsRecursive },
  );
  return names;
}

class StripVendorPrintsPlugin {
  constructor() {
    this.name = NAME;
  }

  settings(program) {
    const config = program.options.stripVendorPrints ?? {};
    return {
      modules: (config.modules ?? []).map((m) => String(m).toLowerCase()),
      allowedCalls: new Set((config.allowedCalls ?? []).map((c) => String(c).toLowerCase())),
    };
  }

  afterValidateProgram(event) {
    const { program } = event;
    program.diagnostics.clearForTag(NAME);
    const { modules, allowedCalls } = this.settings(program);
    if (modules.length === 0) return;

    const files = new Map(modules.map((m) => [m, []]));
    for (const file of Object.values(program.files)) {
      if (!brighterscript.isBrsFile(file)) continue;
      const module = moduleOf(file);
      if (files.has(module)) files.get(module).push(file);
    }

    // No location: bsconfig-base.json filters every diagnostic inside roku_modules, which would
    // drop a guard anchored there. Without one, BrighterScript reports it on the manifest, so the
    // message names the file and line itself.
    const report = (code, message) =>
      program.diagnostics.register({ code, severity: 1, source: NAME, message }, { tags: [NAME] });
    const where = (file, node) =>
      `${file.pkgPath}:${(node?.location?.range?.start?.line ?? 0) + 1}`;

    for (const [module, moduleFiles] of files) {
      if (moduleFiles.length === 0) {
        report(
          CODE_MISSING,
          `stripVendorPrints lists "${module}", but no file is under roku_modules/${module}/. Its prints would ship unremoved if it came back under another name: fix or remove the entry.`,
        );
        continue;
      }
      let count = 0;
      for (const file of moduleFiles) {
        for (const statement of printsIn(file)) {
          count++;
          for (const { name, call } of callsIn(statement)) {
            if (allowedCalls.has(name.toLowerCase())) continue;
            report(
              CODE_CALL,
              `The print at ${where(file, call)} calls ${name}(), and the build removes the whole print, so the call would no longer run. Check it only reads a value, then add it to stripVendorPrints.allowedCalls.`,
            );
          }
        }
      }
      if (count === 0) {
        report(
          CODE_NONE,
          `stripVendorPrints lists "${module}", but its files hold no print. If a new version writes to the console another way, this plugin no longer stops it; if it no longer prints, remove the entry.`,
        );
      }
    }
  }

  beforePrepareFile(event) {
    const { file, editor, program } = event;
    if (!brighterscript.isBrsFile(file)) return;
    const module = moduleOf(file);
    if (!module || !this.settings(program).modules.includes(module)) return;
    for (const statement of printsIn(file)) {
      editor.overrideTranspileResult(statement, '');
    }
  }
}

module.exports = () => new StripVendorPrintsPlugin();

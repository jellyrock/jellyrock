/**
 * BrighterScript plugin — JRScreen `destroy()` discipline.
 *
 * Flags any RSG component that extends `JRScreen` (transitively) and whose
 * codebehind BS file does not declare a top-level `destroy` function.
 *
 * Rationale: the base `destroy()` in `components/JRScreen.bs` is a no-op
 * virtual; forgetting to override it leaks observers and Tasks across
 * navigation. The companion `observe-without-destroy` plugin checks the
 * body of each subclass's destroy() for matching unobserve calls.
 *
 * Skips `components/JRScreen.xml` itself (the no-op base lives there by design).
 *
 * Escape hatch:
 *  - `' bsc-disable-file jrscreen-destroy` anywhere in the XML or its codebehind
 *    (rare — only for components that legitimately extend JRScreen but never
 *    own observers/Tasks; e.g. a thin pass-through wrapper).
 */
'use strict';

const brighterscript = require('brighterscript');

const TARGET_BASE = 'JRScreen';
const MAX_PARENT_CHAIN_DEPTH = 32;
const DISABLE_FILE_MARKER = /'\s*bsc-disable-file\s+jrscreen-destroy\b/i;

class JRScreenDestroyPlugin {
  constructor() {
    this.name = 'jellyrock-jrscreen-destroy';
  }

  afterValidateFile(event) {
    try {
      const file = event.file;
      if (!brighterscript.isXmlFile(file)) return;

      const componentName = file.componentName?.text;
      if (!componentName || componentName === TARGET_BASE) return;

      if (!descendsFromJRScreen(file)) return;

      const xmlContents = file.fileContents;
      if (typeof xmlContents === 'string' && DISABLE_FILE_MARKER.test(xmlContents)) return;

      const codebehind = findCodebehind(event.program, file);
      if (codebehind) {
        const bsContents = codebehind.fileContents;
        if (typeof bsContents === 'string' && DISABLE_FILE_MARKER.test(bsContents)) return;
        if (hasTopLevelDestroyFunction(codebehind)) return;
      }

      const location = file.componentName?.location;
      if (!location) return;

      event.program.diagnostics.register({
        code: 'jrscreen-destroy-required',
        severity: 2, // Warning
        source: this.name,
        message: `Component '${componentName}' extends JRScreen (transitively) but its codebehind does not declare a 'destroy' function. JRScreen subclasses must override destroy() to release observers and Tasks (otherwise they leak across navigation).`,
        location: location,
      });
    } catch (_e) {
      // Never crash the build — plugin is build-time advisory.
    }
  }
}

function descendsFromJRScreen(xmlFile) {
  let current = xmlFile;
  let depth = 0;
  while (current && depth < MAX_PARENT_CHAIN_DEPTH) {
    const parentName = current.parentComponentName?.text;
    if (!parentName) return false;
    if (parentName === TARGET_BASE) return true;
    current = current.parentComponent;
    depth++;
  }
  return false;
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

function hasTopLevelDestroyFunction(brsFile) {
  const statements = brsFile?.parser?.ast?.statements;
  if (!Array.isArray(statements)) return false;
  for (const stmt of statements) {
    if (!brighterscript.isFunctionStatement(stmt)) continue;
    const name = stmt.tokens?.name?.text;
    if (name && name.toLowerCase() === 'destroy') return true;
  }
  return false;
}

module.exports = () => new JRScreenDestroyPlugin();

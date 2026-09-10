// Shared harness for BSC-plugin tests.
//
// Wraps the BrighterScript Program API in a single function that takes a
// plugin factory + a map of {filePath: source} and returns the flat list of
// diagnostics the plugin emitted.
//
// The Program API surface used here:
//   - new Program({ rootDir })            instantiate the compiler
//   - program.plugins.add(pluginInstance) register the plugin
//   - program.setFile(path, content)      add a file with inline source
//   - program.validate()                  run validation (fires plugin hooks)
//   - program.getDiagnostics()            read what the plugin emitted
//
// Reference: @rokucommunity/bslint's testHelpers.spec.js uses the same shape.

import { Program } from 'brighterscript';

/**
 * Run a plugin against a set of synthetic files and return the diagnostics.
 *
 * @param {() => object} pluginFactory  Factory function exported by the plugin
 *                                       (the `module.exports = () => new X()` form).
 * @param {Record<string, string>} files Map of repo-relative path → BS/XML source.
 * @returns {Array} Flat list of BsDiagnostic objects emitted during validate.
 */
export function runPluginOnSource(pluginFactory, files) {
  const program = new Program({ rootDir: '/tmp/jellyrock-plugin-test' });
  program.plugins.add(pluginFactory());
  for (const [path, content] of Object.entries(files)) {
    program.setFile(path, content);
  }
  program.validate();
  return program.getDiagnostics();
}

/**
 * Run a plugin across a SEQUENCE of edits on ONE program, returning the
 * diagnostics after each step.
 *
 * WHY THIS EXISTS
 * ---------------
 * `runPluginOnSource` builds a program, validates ONCE, and reads the result. It
 * therefore cannot observe anything about a plugin's behaviour ACROSS
 * validations — and the whole stale-diagnostic bug class lives there: a plugin
 * that reads two files but anchors its finding in one will happily report the
 * right thing on a cold run and then fail to clear it when the OTHER file is
 * edited. `field-observer-wiring` shipped with 18 green tests and exactly that
 * defect, because no harness could express "edit this, then check again".
 *
 * Each step is a partial file map applied on top of the previous state, so a step
 * lists only what it changes. Editing a file means calling `setFile` with the new
 * contents, which is what the language server does on a keystroke — the point is
 * to exercise BSC's INCREMENTAL path, not to rebuild the program.
 *
 * @param {() => object} pluginFactory Factory exported by the plugin.
 * @param {Array<Record<string, string>>} steps One partial {path: source} map per step.
 * @returns {Array<Array>} Diagnostics after each step, in step order.
 */
export function runPluginOnEdits(pluginFactory, steps) {
  const program = new Program({ rootDir: '/tmp/jellyrock-plugin-test' });
  program.plugins.add(pluginFactory());
  return steps.map((files) => {
    for (const [path, content] of Object.entries(files)) {
      program.setFile(path, content);
    }
    program.validate();
    return program.getDiagnostics();
  });
}

/**
 * Filter a diagnostic list to entries emitted by a specific plugin (by code).
 * Useful when a test wants to ignore noise from other validators (`bslint`,
 * brighterscript core) and focus on the plugin under test.
 */
export function diagnosticsByCode(diagnostics, code) {
  return diagnostics.filter((d) => d.code === code);
}

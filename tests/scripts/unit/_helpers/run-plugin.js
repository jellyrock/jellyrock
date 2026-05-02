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
 * Filter a diagnostic list to entries emitted by a specific plugin (by code).
 * Useful when a test wants to ignore noise from other validators (`bslint`,
 * brighterscript core) and focus on the plugin under test.
 */
export function diagnosticsByCode(diagnostics, code) {
  return diagnostics.filter((d) => d.code === code);
}

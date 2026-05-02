// Tier 2 harness for BSC plugins that mutate the transpile pipeline
// (e.g. roku-log: AST edits via beforePrepareFile + post-serialization
// Buffer rewrites via afterSerializeFile).
//
// Why getTranspiledFileContents and not program.build():
//   getTranspiledFileContents internally runs program.build({files: [file]})
//   with a temporary beforeWriteFile plugin that marks every output as
//   processed, so the pipeline fires (beforeBuildProgram → beforePrepareFile
//   → afterSerializeFile) without writing to disk. afterBuildProgram undoes
//   editor edits between calls, so multi-file harness invocations stay clean.
//
// Plugin config flows through Program options: arbitrary keys (like rokuLog)
// survive util.normalizeConfig, so they're available on event.program.options
// when beforeBuildProgram fires.

import { Program } from 'brighterscript';

/**
 * Transpile inline-source files through a Tier 2 plugin and return the
 * transpiled output for each.
 *
 * @param {() => object} pluginFactory  Factory exported by the plugin
 *                                       (the `module.exports = () => new X()`
 *                                       form). A fresh instance is created
 *                                       per call — never share across calls.
 * @param {Record<string,string>} files Map of pkgPath → BS/XML source.
 * @param {object} [options]            Extra options merged into the Program
 *                                       constructor. Use this to pass plugin
 *                                       config (e.g. `{rokuLog: {strip: true}}`).
 * @returns {Promise<Record<string,string>>} Map of pkgPath → transpiled code.
 */
export async function transpileWithPlugin(pluginFactory, files, options = {}) {
  const program = new Program({
    rootDir: '/tmp/jellyrock-plugin-test',
    ...options,
  });
  program.plugins.add(pluginFactory());
  for (const [pkgPath, content] of Object.entries(files)) {
    program.setFile(pkgPath, content);
  }
  const out = {};
  for (const pkgPath of Object.keys(files)) {
    const result = await program.getTranspiledFileContents(pkgPath);
    out[pkgPath] = result.code;
  }
  return out;
}

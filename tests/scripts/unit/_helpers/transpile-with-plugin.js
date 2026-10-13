// Tier 2 harness for BSC plugins that mutate the transpile pipeline
// (for example roku-log: AST edits via beforePrepareFile + post-serialization
// Buffer rewrites via afterSerializeFile).
//
// Why getTranspiledFileContents and not program.build():
//   getTranspiledFileContents internally runs program.build({files: [file]})
//   with a temporary beforeWriteFile plugin that marks every output as
//   processed, so the pipeline fires (beforeBuildProgram, beforePrepareFile,
//   afterSerializeFile) without writing any files. afterBuildProgram undoes
//   editor edits between calls, so multi-file harness invocations stay clean.
//
// Each call still gets its own temp outDir. Program.write empties its outDir
// before it writes, and a Program with no outDir falls back to ./out under the
// cwd, which is the real checkout's out/ when the suite runs from the repo
// root. The temp dir is removed when the call ends.
//
// Plugin config flows through Program options: arbitrary keys (like rokuLog)
// survive util.normalizeConfig, so they're available on event.program.options
// when beforeBuildProgram fires.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Program } from 'brighterscript';

/**
 * Transpile inline-source files through a Tier 2 plugin and return the
 * transpiled output for each.
 *
 * @param {(() => object)|Array<() => object>} pluginFactory
 *        Factory exported by the plugin (the `module.exports = () => new X()`
 *        form), or an ARRAY of them to exercise a chain. A fresh instance is
 *        created per call: never share across calls. Array order is the order
 *        plugins run in, so mirror the `bsconfig.json` `plugins` order when a
 *        test is about how two injecting plugins interact.
 * @param {Record<string,string>} files Map of pkgPath to BS/XML source.
 * @param {object} [options]            Extra options merged into the Program
 *                                       constructor. Use this to pass plugin
 *                                       config (for example `{rokuLog: {strip: true}}`).
 *                                       An `outDir` here replaces the temp one.
 * @returns {Promise<Record<string,string>>} Map of pkgPath to transpiled code.
 */
export async function transpileWithPlugin(pluginFactory, files, options = {}) {
  const tempOutDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jellyrock-plugin-out-'));
  try {
    const program = new Program({
      rootDir: '/tmp/jellyrock-plugin-test',
      outDir: tempOutDir,
      ...options,
    });
    for (const factory of Array.isArray(pluginFactory) ? pluginFactory : [pluginFactory]) {
      program.plugins.add(factory());
    }
    for (const [pkgPath, content] of Object.entries(files)) {
      program.setFile(pkgPath, content);
    }
    const out = {};
    for (const pkgPath of Object.keys(files)) {
      const result = await program.getTranspiledFileContents(pkgPath);
      out[pkgPath] = result.code;
    }
    return out;
  } finally {
    fs.rmSync(tempOutDir, { recursive: true, force: true });
  }
}

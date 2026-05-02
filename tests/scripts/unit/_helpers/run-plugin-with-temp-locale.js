// Tier 2 harness for the translation-keys plugin: writes a synthetic locale
// JSON to a tmpdir, fakes the ProgramBuilder lifecycle around a real Program,
// lets the plugin generate its virtual namespace file, and returns the
// generated source so tests can assert on it.
//
// Why fake the lifecycle: beforeProvideProgram and afterProvideProgram are
// emitted from ProgramBuilder.loadPlugins() / createProgram(), not from
// `new Program(...)`. Running a full ProgramBuilder is overkill — the plugin
// only reads `event.builder.options.{rootDir,translationKeys}` and
// `event.program`. A two-property stub is sufficient.
//
// Read back the injected source via `program.getFile(VIRTUAL_PATH).fileContents`
// — this is the canonical accessor for the source text of an injected file.

import { Program } from 'brighterscript';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The plugin injects with `pkg:/source/translationKeys.bs`, but Program.getFile()
// looks up by srcPath/destPath (the `pkg:/` prefix is stripped by setFile).
const VIRTUAL_FILE_LOOKUP_PATH = 'source/translationKeys.bs';
const DEFAULT_BASE_FILE = 'locale/custom/en_US.json';

/**
 * Builder-style harness with explicit setup/teardown so tests can drive
 * regenerate() directly (e.g. to test the beforeValidateProgram fallback)
 * and use vitest beforeEach/afterEach for cleanup.
 *
 * @param {() => object} pluginFactory  Plugin factory (`module.exports = () => new X()`).
 * @returns {{
 *   setup: (opts?: {localeJson?: string, baseFile?: string}) => {program, plugin, source},
 *   regenerate: () => string,
 *   writeLocale: (json: string) => void,
 *   deleteLocale: () => void,
 *   teardown: () => void,
 * }}
 */
export function createTranslationKeysHarness(pluginFactory) {
  let tmpDir = null;
  let localePath = null;
  let plugin = null;
  let program = null;

  function readVirtual() {
    const file = program.getFile(VIRTUAL_FILE_LOOKUP_PATH);
    return file?.fileContents ?? '';
  }

  return {
    setup({ localeJson, baseFile = DEFAULT_BASE_FILE } = {}) {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jellyrock-tk-'));
      localePath = path.join(tmpDir, baseFile);

      if (localeJson !== undefined) {
        fs.mkdirSync(path.dirname(localePath), { recursive: true });
        fs.writeFileSync(localePath, localeJson);
      }

      plugin = pluginFactory();

      plugin.beforeProvideProgram({
        builder: {
          options: {
            rootDir: tmpDir,
            translationKeys: { baseFile },
          },
        },
      });

      program = new Program({ rootDir: tmpDir });
      plugin.afterProvideProgram({ program });

      return { program, plugin, source: readVirtual() };
    },

    /** Force the plugin to re-read locale + re-inject (exercises the
     * beforeValidateProgram fallback path). */
    regenerate() {
      plugin.beforeValidateProgram({ program });
      return readVirtual();
    },

    writeLocale(json) {
      fs.mkdirSync(path.dirname(localePath), { recursive: true });
      fs.writeFileSync(localePath, json);
    },

    deleteLocale() {
      try {
        fs.unlinkSync(localePath);
      } catch (_e) {
        // already gone
      }
    },

    teardown() {
      if (plugin) plugin.stopWatching();
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = localePath = plugin = program = null;
    },
  };
}

/**
 * BrighterScript compiler plugin that auto-generates a `translationKeys` namespace
 * with string constants from locale/custom/en-us.json.
 *
 * Gives compile-time safety (typos in key names become build errors) and IDE autocomplete.
 * The generated file is virtual (injected via program.setFile, not written to disk).
 *
 * Uses fs.watch to independently detect en_US.json changes in the language server,
 * since BrighterScript's Program.setFile only processes .bs/.brs/.xml files and
 * does not trigger revalidation for JSON file edits.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const VIRTUAL_FILE_PKG_PATH = 'pkg:/source/translationKeys.bs';
const DEFAULT_BASE_FILE = 'locale/custom/en_US.json';
const DEBOUNCE_MS = 150;

class TranslationKeysPlugin {
  constructor() {
    this.name = 'translation-keys-plugin';
    this.cachedJson = null;
    this.baseFilePath = null;
    this.program = null;
    this.watcher = null;
    this.debounceTimer = null;
  }

  /** Read config and resolve the base translation file path. */
  beforeProvideProgram(event) {
    const builder = event.builder;
    const config = builder.options.translationKeys || {};
    const baseFile = config.baseFile || DEFAULT_BASE_FILE;
    this.baseFilePath = path.resolve(builder.options.rootDir || process.cwd(), baseFile);
  }

  /** Generate translation key constants on initial program creation and start file watcher. */
  afterProvideProgram(event) {
    const program = event.program;
    this.program = program;
    this.generateAndInject(program);
    this.startWatching();
  }

  /** Regenerate if en_US.json changed since last generation (secondary path). */
  beforeValidateProgram(event) {
    const program = event.program;
    this.program = program;
    this.generateAndInject(program);
  }

  /** Clean up file watcher when the program is disposed. */
  beforeRemoveProgram(_event) {
    this.stopWatching();
    this.program = null;
  }

  /** Start watching en_US.json for changes via OS-level file events. */
  startWatching() {
    this.stopWatching();
    try {
      // persistent: false ensures this watcher doesn't keep the Node.js process alive
      this.watcher = fs.watch(this.baseFilePath, { persistent: false }, (_eventType) => {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
          if (this.program) {
            this.generateAndInject(this.program);
          }
        }, DEBOUNCE_MS);
      });
      this.watcher.on('error', () => {
        // File may have been deleted — watcher will be re-established
        // in generateAndInject when the file reappears
        this.stopWatching();
      });
    } catch (_err) {
      // File doesn't exist yet — beforeProgramValidate will handle it,
      // and the watcher will be started once the file appears
    }
  }

  /** Stop the file watcher and clear any pending debounce timer. */
  stopWatching() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  /**
   * Read en_US.json, generate the namespace source, and inject it into the program.
   * Only regenerates if the file content has changed since last run.
   */
  generateAndInject(program) {
    let json;
    try {
      json = fs.readFileSync(this.baseFilePath, 'utf8');
    } catch (err) {
      // File missing — emit empty namespace so references show as compile errors
      if (this.cachedJson !== '') {
        this.cachedJson = '';
        program.setFile(VIRTUAL_FILE_PKG_PATH, this.generateEmptyNamespace(err.message));
      }
      return;
    }

    // Re-establish watcher if it was lost (e.g. file was deleted and recreated)
    if (!this.watcher) {
      this.startWatching();
    }

    // Skip regeneration if content hasn't changed
    if (json === this.cachedJson) return;
    this.cachedJson = json;

    let keys;
    try {
      const parsed = JSON.parse(json);
      keys = Object.keys(parsed);
    } catch (err) {
      program.setFile(
        VIRTUAL_FILE_PKG_PATH,
        this.generateEmptyNamespace(`Invalid JSON: ${err.message}`),
      );
      return;
    }

    const code = this.generateNamespace(keys);
    program.setFile(VIRTUAL_FILE_PKG_PATH, code);
  }

  /** Generate the BrighterScript namespace source with one const per key. */
  generateNamespace(keys) {
    const lines = [
      `' Auto-generated from ${path.basename(this.baseFilePath)} — DO NOT EDIT`,
      'namespace translationKeys',
    ];

    for (const key of keys) {
      // Validate that the key is a valid BrighterScript identifier
      if (/^[a-zA-Z_]\w*$/.test(key)) {
        lines.push(`  const ${key} = "${key}"`);
      }
    }

    // Detect plural base keys (where XZero, XOne, XMany all exist but X does not)
    // These are used with translatePlural() for compile-time safety
    const keySet = new Set(keys);
    const pluralBases = new Set();
    const suffixes = ['Zero', 'One', 'Many'];
    for (const key of keys) {
      for (const suffix of suffixes) {
        if (key.endsWith(suffix)) {
          const base = key.slice(0, -suffix.length);
          if (!keySet.has(base) && !pluralBases.has(base)) {
            if (suffixes.every((s) => keySet.has(base + s))) {
              pluralBases.add(base);
            }
          }
          break;
        }
      }
    }

    if (pluralBases.size > 0) {
      lines.push('');
      lines.push("  ' Plural base keys — use with translatePlural()");
      for (const base of [...pluralBases].sort()) {
        if (/^[a-zA-Z_]\w*$/.test(base)) {
          lines.push(`  const ${base} = "${base}"`);
        }
      }
    }

    lines.push('end namespace');
    lines.push(''); // trailing newline
    return lines.join('\n');
  }

  /** Generate an empty namespace with a warning comment. */
  generateEmptyNamespace(reason) {
    return [
      `' Auto-generated — DO NOT EDIT`,
      `' WARNING: Could not read base translation file: ${reason}`,
      'namespace translationKeys',
      'end namespace',
      '',
    ].join('\n');
  }
}

module.exports = () => {
  return new TranslationKeysPlugin();
};

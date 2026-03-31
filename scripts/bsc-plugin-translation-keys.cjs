/**
 * BrighterScript compiler plugin that auto-generates a `translationKeys` namespace
 * with string constants from locale/custom/en-us.json.
 *
 * Gives compile-time safety (typos in key names become build errors) and IDE autocomplete.
 * The generated file is virtual (injected via program.setFile, not written to disk).
 */
'use strict';

const fs = require('fs');
const path = require('path');

const VIRTUAL_FILE_PKG_PATH = 'pkg:/source/translationKeys.bs';
const DEFAULT_BASE_FILE = 'locale/custom/en-us.json';

class TranslationKeysPlugin {
  constructor() {
    this.name = 'translation-keys-plugin';
    this.cachedJson = null;
    this.baseFilePath = null;
  }

  /** Read config and resolve the base translation file path. */
  beforeProgramCreate(builder) {
    const config = builder.options.translationKeys || {};
    const baseFile = config.baseFile || DEFAULT_BASE_FILE;
    this.baseFilePath = path.resolve(builder.options.rootDir || process.cwd(), baseFile);
  }

  /** Generate translation key constants on initial program creation. */
  afterProgramCreate(program) {
    this.generateAndInject(program);
  }

  /** Regenerate if en-us.json changed since last generation. */
  beforeProgramValidate(program) {
    this.generateAndInject(program);
  }

  /**
   * Read en-us.json, generate the namespace source, and inject it into the program.
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

    // Skip regeneration if content hasn't changed
    if (json === this.cachedJson) return;
    this.cachedJson = json;

    let keys;
    try {
      const parsed = JSON.parse(json);
      keys = Object.keys(parsed);
    } catch (err) {
      program.setFile(VIRTUAL_FILE_PKG_PATH, this.generateEmptyNamespace(`Invalid JSON: ${err.message}`));
      return;
    }

    const code = this.generateNamespace(keys);
    program.setFile(VIRTUAL_FILE_PKG_PATH, code);
  }

  /** Generate the BrighterScript namespace source with one const per key. */
  generateNamespace(keys) {
    const lines = [
      `' Auto-generated from ${path.basename(this.baseFilePath)} — DO NOT EDIT`,
      'namespace translationKeys'
    ];

    for (const key of keys) {
      // Validate that the key is a valid BrighterScript identifier
      if (/^[a-zA-Z_]\w*$/.test(key)) {
        lines.push(`  const ${key} = "${key}"`);
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
      ''
    ].join('\n');
  }
}

module.exports = () => {
  return new TranslationKeysPlugin();
};

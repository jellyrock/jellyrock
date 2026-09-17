// scripts/lib/env-config.cjs — where the tooling's environment comes from.
//
// Every script that needs a device or a secret reads it from `process.env`, and
// this module fills that in from two files, in this order:
//
//   1. the variables already set (your shell, or a parent process)   — always win
//   2. `.env` in the current checkout                                — per-checkout override
//   3. `$XDG_CONFIG_HOME/jellyrock/env` (default `~/.config/jellyrock/env`)
//                                                                    — per-user default
//
// The user file is what lets several checkouts of this repo share one device list
// and one set of credentials without a copy of `.env` in each. A checkout's `.env`
// still wins, so one folder can point at a different device without touching the
// shared file.
//
// Rules that are not obvious from the list above:
//
// - **An already-set variable is never overwritten**, even when it is empty. That is
//   dotenv's own rule, and `measure-devices.js` depends on it: it hands each child
//   process its own `ROKU_IP`, and a file must not be able to take that back.
// - **An EMPTY value in a file counts as unset.** `.env.example` ships keys like
//   `ROKU_DEVICES=` blank, so a `.env` copied from it would otherwise hide the user
//   file's list behind an empty string. To drop a user-level value for one checkout,
//   set it to something else there; to drop it everywhere, comment it out in the
//   user file. The exception is `EMPTY_IS_A_VALUE`: passwords for which blank means
//   "this account has no password", so a checkout can say so over a user-file value.
// - **Automated runs skip the user file.** Under GitHub Actions a run is configured by
//   its workflow alone, so a self-hosted runner's home directory cannot change it. The
//   scripts' unit tests set `JELLYROCK_USER_ENV=off` (vitest.config.js) for the same
//   reason; anyone can set it to run without the user file.
//
// Pure functions plus one loader. The pure half takes its inputs explicitly so the
// tests never read or write the real environment; `loadEnv()` is the only thing that
// touches `process.env`, and `load-env.cjs` is the one-line entry scripts import.
//
// `.cjs` per `scripts/CLAUDE.md`: required by `create-signed-package.cjs`.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dotenv = require('dotenv');

/** Marks a variable that was already set before any file was read. */
const PRESET = 'environment';

/**
 * Keys whose blank value is meaningful rather than "not set": each is a password where
 * blank means a passwordless account, and each consumer reads it with `?? ''`.
 * `.env.example` ships them commented out, so copying it does not set them.
 */
const EMPTY_IS_A_VALUE = new Set([
  'MEASURE_SIGNIN_PASSWORD',
  'RTA_SERVER_PASS',
  'JELLYFIN_VERSION_SERVERS_PASS',
]);

/**
 * The per-user file. `XDG_CONFIG_HOME` is honored when it is an absolute path, as the
 * XDG base-directory spec requires (empty or relative is ignored); otherwise `~/.config`.
 *
 * @param {Record<string, string|undefined>} env
 * @param {string} homedir
 * @returns {string}
 */
function userEnvPath(env, homedir) {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(homedir, '.config');
  return path.join(base, 'jellyrock', 'env');
}

/**
 * Whether this run should ignore the per-user file: under GitHub Actions, or when
 * `JELLYROCK_USER_ENV=off`.
 *
 * @param {Record<string, string|undefined>} env
 * @returns {boolean}
 */
function skipsUserFile(env) {
  return env.GITHUB_ACTIONS === 'true' || env.JELLYROCK_USER_ENV === 'off';
}

/**
 * The files to read, highest precedence first.
 *
 * @param {{ cwd: string, env: Record<string, string|undefined>, homedir: string }} where
 * @returns {string[]}
 */
function envFiles({ cwd, env, homedir }) {
  const files = [path.join(cwd, '.env')];
  if (!skipsUserFile(env)) files.push(userEnvPath(env, homedir));
  return files;
}

/**
 * Fill `env` from `files`, highest precedence first, without overwriting anything.
 *
 * @param {string[]} files
 * @param {Record<string, string|undefined>} env - mutated in place
 * @param {(file: string) => string|null} readFile - file contents, or null when absent
 * @returns {{ loaded: string[], sources: Record<string, string> }} the files that
 *   existed, and for every variable this call could have supplied, where its value
 *   came from (`'environment'` or a file path)
 */
function applyEnvFiles(files, env, readFile) {
  const loaded = [];
  const sources = Object.create(null);
  for (const file of files) {
    const text = readFile(file);
    if (text === null) continue;
    loaded.push(file);
    for (const [key, value] of Object.entries(dotenv.parse(text))) {
      if (key in sources) continue;
      if (Object.prototype.hasOwnProperty.call(env, key)) {
        sources[key] = PRESET;
        continue;
      }
      if (value === '' && !EMPTY_IS_A_VALUE.has(key)) continue;
      env[key] = value;
      sources[key] = file;
    }
  }
  return { loaded, sources };
}

const readIfPresent = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    // Rethrow the original (its code and stack) with the file named in the message.
    error.message = `Could not read env file ${file}: ${error.message}`;
    throw error;
  }
};

let result = null;

/**
 * Load the environment into `process.env`. Idempotent: every caller after the first
 * gets the first call's result, so importing it from several modules is safe.
 *
 * @returns {{ loaded: string[], sources: Record<string, string> }}
 */
function loadEnv() {
  if (!result) {
    result = applyEnvFiles(
      envFiles({ cwd: process.cwd(), env: process.env, homedir: os.homedir() }),
      process.env,
      readIfPresent,
    );
  }
  return result;
}

/**
 * Where `key` came from, for a human reading tool output: a file path, the literal
 * `'environment'`, or undefined when no file mentions it.
 *
 * @param {string} key
 * @returns {string|undefined}
 */
function envSource(key) {
  return loadEnv().sources[key];
}

module.exports = {
  PRESET,
  EMPTY_IS_A_VALUE,
  userEnvPath,
  skipsUserFile,
  envFiles,
  applyEnvFiles,
  readIfPresent,
  loadEnv,
  envSource,
};

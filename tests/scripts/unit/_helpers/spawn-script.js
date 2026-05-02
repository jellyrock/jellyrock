// Shared helper for spawning a script as a child process.
//
// Used by tests for non-plugin scripts that consume their CLI surface
// (process.argv, process.cwd, env vars) at module load. Spawning rather
// than require()'ing avoids "first call wins" issues with module state.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve the repo root once so tests can pass repo-relative script paths.
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');

/**
 * Run a Node script and return { exitCode, stdout, stderr }.
 *
 * @param {string} scriptPath  repo-relative path, e.g. 'scripts/generate/dev-index.cjs'
 * @param {string[]} [args]    CLI args to pass after the script
 * @param {object} [options]
 * @param {string} [options.cwd]  working dir for the spawned process
 * @param {object} [options.env]  env overrides (merged onto process.env)
 */
export function spawnScript(scriptPath, args = [], options = {}) {
  const fullPath = resolve(REPO_ROOT, scriptPath);
  const result = spawnSync('node', [fullPath, ...args], {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
  });
  return {
    exitCode: result.status ?? 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

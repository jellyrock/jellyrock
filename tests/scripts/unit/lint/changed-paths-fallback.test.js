// Tests for .github/actions/changed-paths/action.yml: the detect step must fall
// back to relevant=true when `gh pr diff` fails, like the push branch does when
// the compare API fails, and still skip when the diff says nothing matches.
//
// The step's `run:` script is parsed out of the YAML and run under bash with a
// fake `gh` first on PATH. The child gets an explicit minimal env so the
// runner's own GITHUB_* variables can't leak in.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');
const ACTION = join(REPO_ROOT, '.github', 'actions', 'changed-paths', 'action.yml');

const action = load(readFileSync(ACTION, 'utf8'));
const detect = action.runs.steps.find((s) => s.id === 'detect');
const SCRIPT = detect.run;

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'changed-paths-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// Run the detect script for a pull_request with a fake `gh` whose body is `ghBody`.
function runPr(ghBody) {
  const bin = join(dir, 'bin');
  const gh = join(bin, 'gh');
  const out = join(dir, 'github_output');
  writeFileSync(out, '');
  mkdirSync(bin);
  writeFileSync(gh, `#!/bin/bash\n${ghBody}\n`);
  chmodSync(gh, 0o755);
  const res = spawnSync('bash', ['-c', SCRIPT], {
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      FORCE: 'false',
      PR_NUMBER: '1202',
      EVENT_NAME: 'pull_request',
      PATTERN: '^source/',
      GITHUB_OUTPUT: out,
    },
    encoding: 'utf8',
  });
  return { status: res.status, output: readFileSync(out, 'utf8') };
}

describe('changed-paths detect step, pull_request', () => {
  it('falls back to relevant=true when gh pr diff fails', () => {
    const { status, output } = runPr('echo "HTTP 500: Server Error" >&2\nexit 1');
    expect(status).toBe(0);
    expect(output).toContain('relevant=true');
  });

  it('reports relevant=true when a changed path matches', () => {
    const { status, output } = runPr('printf "docs/a.md\\nsource/main.bs\\n"');
    expect(status).toBe(0);
    expect(output).toContain('relevant=true');
  });

  it('reports relevant=false when no changed path matches', () => {
    const { status, output } = runPr('printf "docs/a.md\\nREADME.md\\n"');
    expect(status).toBe(0);
    expect(output).toContain('relevant=false');
  });
});

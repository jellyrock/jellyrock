// Tests for .claude/hooks/log-tool-use.sh, the PostToolUse hook that appends one JSON line per
// tool call to the per-user telemetry log scripts/agent-telemetry-report.cjs reads.

import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitSafeEnv } from './_helpers/git-env.js';

const HOOK = resolve(
  fileURLToPath(import.meta.url),
  '..',
  '..',
  '..',
  '..',
  '.claude',
  'hooks',
  'log-tool-use.sh',
);
const EVENT = JSON.stringify({
  tool_name: 'Read',
  tool_input: { file_path: 'a.bs' },
  session_id: 's',
  cwd: '/x',
});

function runHook(env) {
  return spawnSync('bash', [HOOK], {
    input: EVENT,
    env: { ...gitSafeEnv(), ...env },
    encoding: 'utf8',
  });
}

describe('log-tool-use hook', () => {
  let home;

  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it('writes to $XDG_STATE_HOME/jellyrock/telemetry when no override is set', () => {
    home = mkdtempSync(join(tmpdir(), 'jellyrock-hook-home-'));
    const result = runHook({
      HOME: home,
      XDG_STATE_HOME: join(home, 'state'),
      JELLYROCK_TELEMETRY_DIR: '',
    });
    expect(result.status).toBe(0);
    const log = join(home, 'state', 'jellyrock', 'telemetry', 'tool-use.jsonl');
    expect(JSON.parse(readFileSync(log, 'utf8').trim())).toMatchObject({
      tool: 'Read',
      file: 'a.bs',
    });
    expect(existsSync(join(home, '.claude'))).toBe(false);
  });

  it('defaults to ~/.local/state/jellyrock/telemetry', () => {
    home = mkdtempSync(join(tmpdir(), 'jellyrock-hook-home-'));
    const result = runHook({ HOME: home, XDG_STATE_HOME: '', JELLYROCK_TELEMETRY_DIR: '' });
    expect(result.status).toBe(0);
    expect(
      existsSync(join(home, '.local', 'state', 'jellyrock', 'telemetry', 'tool-use.jsonl')),
    ).toBe(true);
  });

  it('writes to JELLYROCK_TELEMETRY_DIR when it is set', () => {
    home = mkdtempSync(join(tmpdir(), 'jellyrock-hook-home-'));
    const result = runHook({
      HOME: home,
      XDG_STATE_HOME: '',
      JELLYROCK_TELEMETRY_DIR: join(home, 'mine'),
    });
    expect(result.status).toBe(0);
    expect(existsSync(join(home, 'mine', 'tool-use.jsonl'))).toBe(true);
  });
});

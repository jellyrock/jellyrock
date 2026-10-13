// Tests for scripts/agent-telemetry-report.cjs.
//
// The script reads $JELLYROCK_TELEMETRY_DIR/tool-use.jsonl. We exploit
// the env-var override to point at a temp dir with synthetic events.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from './_helpers/spawn-script.js';

const SCRIPT = 'scripts/agent-telemetry-report.cjs';

function setupTelemetryDir(events = []) {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-agent-telemetry-'));
  if (events.length > 0) {
    const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
    writeFileSync(join(dir, 'tool-use.jsonl'), lines);
  }
  return dir;
}

const today = new Date().toISOString();
const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

describe('agent-telemetry-report', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('reports a friendly message when no log file exists', () => {
    dir = setupTelemetryDir([]);
    const { exitCode, stdout } = spawnScript(SCRIPT, [], {
      env: { JELLYROCK_TELEMETRY_DIR: dir },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/No telemetry log/);
  });

  it('summarises events that fall inside the time window', () => {
    dir = setupTelemetryDir([
      { timestamp: today, tool: 'Read', file: 'components/Foo.bs' },
      { timestamp: today, tool: 'Read', file: 'components/Foo.bs' },
      { timestamp: today, tool: 'Edit', file: 'components/Foo.bs' },
      { timestamp: today, tool: 'Grep', pattern: 'observeField' },
    ]);
    const { exitCode, stdout } = spawnScript(SCRIPT, [], {
      env: { JELLYROCK_TELEMETRY_DIR: dir },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/4 events in window/);
    expect(stdout).toMatch(/components\/Foo\.bs/);
    expect(stdout).toMatch(/observeField/);
  });

  it('reports "no events in window" when all events are outside the window', () => {
    dir = setupTelemetryDir([{ timestamp: yearAgo, tool: 'Read', file: 'components/Foo.bs' }]);
    const { exitCode, stdout } = spawnScript(SCRIPT, ['--days', '7'], {
      env: { JELLYROCK_TELEMETRY_DIR: dir },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/No events in window/);
  });

  it('honors --days override', () => {
    dir = setupTelemetryDir([{ timestamp: yearAgo, tool: 'Read', file: 'components/Foo.bs' }]);
    // 1000-day window includes events from a year ago.
    const { exitCode, stdout } = spawnScript(SCRIPT, ['--days', '1000'], {
      env: { JELLYROCK_TELEMETRY_DIR: dir },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/1 events in window/);
  });

  it('skips lines that fail to parse as JSON', () => {
    dir = setupTelemetryDir([]);
    writeFileSync(
      join(dir, 'tool-use.jsonl'),
      `not json\n${JSON.stringify({ timestamp: today, tool: 'Read', file: 'a.bs' })}\nalso garbage\n`,
    );
    const { exitCode, stdout } = spawnScript(SCRIPT, [], {
      env: { JELLYROCK_TELEMETRY_DIR: dir },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/1 events in window/); // only the valid line counted
  });
});

// Without JELLYROCK_TELEMETRY_DIR, the log lives in the per-user state folder
// (`$XDG_STATE_HOME/jellyrock/telemetry`, default `~/.local/state/jellyrock/telemetry`), where
// the hooks write it. Checkouts that have not pulled the move still write the old
// `~/.claude/jellyrock-telemetry`, so the report reads that log too while it exists.
describe('agent-telemetry-report: where the log is', () => {
  let home;

  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  function writeLog(folder, events) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, 'tool-use.jsonl'),
      events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    );
  }

  it('reads $XDG_STATE_HOME/jellyrock/telemetry when no override is set', () => {
    home = mkdtempSync(join(tmpdir(), 'jellyrock-telemetry-home-'));
    writeLog(join(home, 'state', 'jellyrock', 'telemetry'), [
      { timestamp: today, tool: 'Read', file: 'a.bs' },
    ]);
    const { exitCode, stdout } = spawnScript(SCRIPT, [], {
      env: { HOME: home, XDG_STATE_HOME: join(home, 'state'), JELLYROCK_TELEMETRY_DIR: '' },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/1 events in window/);
  });

  it('defaults to ~/.local/state/jellyrock/telemetry, and reads the old ~/.claude folder too', () => {
    home = mkdtempSync(join(tmpdir(), 'jellyrock-telemetry-home-'));
    writeLog(join(home, '.local', 'state', 'jellyrock', 'telemetry'), [
      { timestamp: today, tool: 'Read', file: 'a.bs' },
    ]);
    writeLog(join(home, '.claude', 'jellyrock-telemetry'), [
      { timestamp: today, tool: 'Read', file: 'b.bs' },
      { timestamp: today, tool: 'Edit', file: 'b.bs' },
    ]);
    const { exitCode, stdout } = spawnScript(SCRIPT, [], {
      env: { HOME: home, XDG_STATE_HOME: '', JELLYROCK_TELEMETRY_DIR: '' },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/3 events in window/);
    expect(stdout).toMatch(/\.claude\/jellyrock-telemetry/);
    expect(stdout).toMatch(/\bmv\b/);
  });

  it('reads the old folder alone when the new one has no log yet', () => {
    home = mkdtempSync(join(tmpdir(), 'jellyrock-telemetry-home-'));
    writeLog(join(home, '.claude', 'jellyrock-telemetry'), [
      { timestamp: today, tool: 'Read', file: 'b.bs' },
    ]);
    const { exitCode, stdout } = spawnScript(SCRIPT, [], {
      env: { HOME: home, XDG_STATE_HOME: '', JELLYROCK_TELEMETRY_DIR: '' },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/1 events in window/);
  });

  it('reads only the override folder when JELLYROCK_TELEMETRY_DIR is set', () => {
    home = mkdtempSync(join(tmpdir(), 'jellyrock-telemetry-home-'));
    writeLog(join(home, 'mine'), [{ timestamp: today, tool: 'Read', file: 'a.bs' }]);
    writeLog(join(home, '.claude', 'jellyrock-telemetry'), [
      { timestamp: today, tool: 'Read', file: 'b.bs' },
    ]);
    const { exitCode, stdout } = spawnScript(SCRIPT, [], {
      env: { HOME: home, XDG_STATE_HOME: '', JELLYROCK_TELEMETRY_DIR: join(home, 'mine') },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/1 events in window/);
    expect(stdout).not.toMatch(/\.claude\/jellyrock-telemetry/);
  });
});

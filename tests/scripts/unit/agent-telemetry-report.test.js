// Tests for scripts/agent-telemetry-report.cjs.
//
// The script reads $JELLYROCK_TELEMETRY_DIR/tool-use.jsonl. We exploit
// the env-var override to point at a temp dir with synthetic events.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

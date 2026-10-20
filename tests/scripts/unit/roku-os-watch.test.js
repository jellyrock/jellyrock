// Tests for scripts/roku-os-watch.js: the Roku OS release-review issue decision.
// Pure parts are driven directly; the CLI runs offline through --version.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from './_helpers/spawn-script.js';
import { decideRokuOs, renderRokuOsBody, rokuOsTitle } from '../../../scripts/roku-os-watch.js';

const SCRIPT = 'scripts/roku-os-watch.js';

describe('decideRokuOs', () => {
  it('is new, with no earlier version, when no issue exists', () => {
    expect(decideRokuOs({ version: '16.0', issues: [] })).toEqual({
      version: '16.0',
      title: '[roku-os] Roku OS 16.0 released',
      label: 'roku-os',
      since: null,
      exists: false,
    });
  });

  it('finds the newest earlier version by number, and ignores other titles', () => {
    const issues = [
      { title: rokuOsTitle('15.2') },
      { title: rokuOsTitle('15.10') },
      { title: rokuOsTitle('16.1') },
      { title: 'Roku OS 15.11 crash' },
    ];
    const d = decideRokuOs({ version: '16.0', issues });
    expect(d.since).toBe('15.10');
    expect(d.exists).toBe(false);
  });

  it('exists when this version already has an issue, open or closed', () => {
    expect(decideRokuOs({ version: '16.0', issues: [{ title: rokuOsTitle('16.0') }] }).exists).toBe(
      true,
    );
  });

  it('renders the review range from the earlier version', () => {
    expect(renderRokuOsBody({ version: '16.0', since: '15.3' })).toContain(
      'everything after Roku OS 15.3',
    );
  });
});

describe('CLI', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('prints the decision and writes the body offline', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-roku-os-'));
    const issues = join(dir, 'issues.json');
    const body = join(dir, 'body.md');
    writeFileSync(issues, JSON.stringify([{ title: rokuOsTitle('15.3') }]));
    const res = spawnScript(SCRIPT, ['--version', '16.0', '--issues', issues, '--body-out', body]);
    expect(res.exitCode).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({ version: '16.0', since: '15.3', exists: false });
    expect(readFileSync(body, 'utf8')).toContain('Roku OS 16.0');
  });
});

// Tests for scripts/generate/settings-docs.cjs.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';

const SCRIPT = 'scripts/generate/settings-docs.cjs';

function setupTemp(settings) {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-settings-docs-'));
  mkdirSync(join(dir, 'settings'), { recursive: true });
  writeFileSync(join(dir, 'settings', 'settings.json'), JSON.stringify(settings, null, 2));
  return dir;
}

describe('settings-docs', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('emits a top-level group with title and description', () => {
    dir = setupTemp([{ title: 'Playback', description: 'Playback options.', children: [] }]);
    const { exitCode } = spawnScript(SCRIPT, [], { cwd: dir });
    expect(exitCode).toBe(0);
    const out = readFileSync(join(dir, 'docs', 'user', 'app-settings.md'), 'utf8');
    expect(out).toMatch(/<h1 id="top">JellyRock App Settings<\/h1>/);
    expect(out).toMatch(/## Playback/);
    expect(out).toMatch(/Playback options\./);
  });

  it('emits a setting under its group with the details table', () => {
    dir = setupTemp([
      {
        title: 'Playback',
        children: [
          {
            title: 'Auto Play',
            settingName: 'autoPlay',
            type: 'boolean',
            default: true,
          },
        ],
      },
    ]);
    spawnScript(SCRIPT, [], { cwd: dir });
    const out = readFileSync(join(dir, 'docs', 'user', 'app-settings.md'), 'utf8');
    expect(out).toMatch(/id="autoPlay"/);
    expect(out).toMatch(/\| Setting Name \| `autoPlay` \|/);
    expect(out).toMatch(/\| Type \| `boolean` \|/);
    expect(out).toMatch(/\| Default \| `true` \|/);
  });

  it('emits the declared range for a bounded setting', () => {
    // The range is enforced at SAVE time in the app, so this page is the only place a user
    // can learn it without typing an out-of-range value and being told.
    dir = setupTemp([
      {
        title: 'User Interface',
        children: [
          {
            title: 'Home Row Size',
            settingName: 'uiHomeRowLimit',
            type: 'integer',
            default: '16',
            min: 1,
            max: 200,
          },
        ],
      },
    ]);
    spawnScript(SCRIPT, [], { cwd: dir });
    const out = readFileSync(join(dir, 'docs', 'user', 'app-settings.md'), 'utf8');
    expect(out).toMatch(/\| Range \| `1` to `200` \|/);
  });

  it('omits the range row when only one bound is declared', () => {
    // Half a range is not enforced by the app either — settingRangeBounds() requires both —
    // so printing one bound would document a rule that does not exist.
    dir = setupTemp([
      {
        title: 'User Interface',
        children: [{ title: 'Half Bounded', settingName: 'halfBounded', type: 'integer', min: 1 }],
      },
    ]);
    spawnScript(SCRIPT, [], { cwd: dir });
    const out = readFileSync(join(dir, 'docs', 'user', 'app-settings.md'), 'utf8');
    expect(out).not.toMatch(/\| Range \|/);
  });

  it('emits a radio-type options table', () => {
    dir = setupTemp([
      {
        title: 'Playback',
        children: [
          {
            title: 'Quality',
            settingName: 'quality',
            type: 'radio',
            default: 'auto',
            options: [
              { id: 'auto', title: 'Auto' },
              { id: 'high', title: 'High' },
            ],
          },
        ],
      },
    ]);
    spawnScript(SCRIPT, [], { cwd: dir });
    const out = readFileSync(join(dir, 'docs', 'user', 'app-settings.md'), 'utf8');
    expect(out).toMatch(/<td>Auto<\/td>.*<code>auto<\/code>/);
    expect(out).toMatch(/<td>High<\/td>.*<code>high<\/code>/);
  });

  it('honors --out flag for custom output path', () => {
    dir = setupTemp([{ title: 'Foo', children: [] }]);
    const customOut = 'custom/out.md';
    const { exitCode } = spawnScript(SCRIPT, ['--out', customOut], { cwd: dir });
    expect(exitCode).toBe(0);
    const out = readFileSync(join(dir, customOut), 'utf8');
    expect(out).toMatch(/Foo/);
  });

  it('errors when --out is provided without a path', () => {
    dir = setupTemp([{ title: 'Foo', children: [] }]);
    const { exitCode, stderr } = spawnScript(SCRIPT, ['--out'], { cwd: dir });
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/--out flag provided without a path/);
  });

  it('errors when settings.json is missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-settings-docs-'));
    const { exitCode, stderr } = spawnScript(SCRIPT, [], { cwd: dir });
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Failed to read/);
  });

  it('errors when settings.json is not an array of groups', () => {
    dir = setupTemp({ not: 'an array' });
    const { exitCode, stderr } = spawnScript(SCRIPT, [], { cwd: dir });
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Expected settings\.json to be an array/);
  });
});

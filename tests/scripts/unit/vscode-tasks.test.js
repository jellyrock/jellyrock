/**
 * The F5 device-lock wiring in `.vscode/launch.json` and `.vscode/tasks.json`.
 *
 * Nothing else checks these files, and the wiring is where F5 deployed over a busy
 * Roku: VS Code counts a background step as exit code 0 once its matcher goes idle,
 * so only the plain `device-lock: confirm` step stops the chain (see the F5 section
 * of `scripts/device-lock.js`). These pin that every launch config takes the lock,
 * confirms it before any build, and releases it, and that the hold task's patterns
 * match the lines `device-lock.js` prints.
 */
import fs from 'node:fs';
import path from 'node:path';

import { parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';

import { refusalLine } from '../../../scripts/device-lock.js';

const read = (file) => {
  const errors = [];
  const json = parse(fs.readFileSync(path.resolve(file), 'utf8'), errors, {
    allowTrailingComma: true,
  });
  expect(errors, `${file} parses`).toEqual([]);
  return json;
};

const launch = read('.vscode/launch.json');
const tasks = read('.vscode/tasks.json').tasks;
const task = (label) => tasks.find((t) => t.label === label);
const HOST_ARG = '--host=${config:brightscript.debug.host}';

describe('VS Code F5: every launch config takes the device lock', () => {
  it.each(launch.configurations.map((c) => [c.name, c]))(
    '%s: hold, then confirm, then its build, in sequence',
    (_name, config) => {
      const chain = task(config.preLaunchTask);
      expect(chain, `preLaunchTask "${config.preLaunchTask}" exists`).toBeDefined();
      expect(chain.dependsOrder).toBe('sequence');
      expect(chain.dependsOn.slice(0, 2)).toEqual(['device-lock: hold', 'device-lock: confirm']);
      for (const label of chain.dependsOn.slice(2)) {
        expect(task(label), `build task "${label}" exists`).toBeDefined();
        expect(task(label).isBackground ?? false).toBe(false);
      }
    },
  );

  it.each(launch.configurations.map((c) => [c.name, c]))(
    '%s: releases the lock when the session ends',
    (_name, config) => {
      expect(config.postDebugTask).toBe('device-lock: release');
    },
  );
});

describe('VS Code F5: the lock tasks', () => {
  it('confirms a plain task, so its exit code reaches VS Code', () => {
    const confirm = task('device-lock: confirm');
    expect(confirm.isBackground ?? false).toBe(false);
    expect(confirm.args).toEqual(['scripts/device-lock.js', 'confirm-hold', HOST_ARG]);
  });

  // VS Code keeps a `"close": true` task terminal open when its process exits nonzero,
  // yet offers it for reuse, and a run handed that terminal never starts
  // (1.142.0, `TerminalInstance.dispose()`). After one refusal, every F5 hung on
  // `device-lock: confirm`. These two can exit 1, so each gets its own terminal.
  it.each(['device-lock: confirm', 'device-lock: release'])(
    '%s: never "close": true, so a failed run does not hang the next F5',
    (label) => {
      expect(task(label).presentation.close).not.toBe(true);
      expect(task(label).presentation.panel).toBe('dedicated');
    },
  );

  it('holds and confirms the same Roku, the one F5 deploys to', () => {
    expect(task('device-lock: hold').args).toContain(HOST_ARG);
  });

  it("matches device-lock.js's ready and refusal lines", () => {
    const { pattern, background } = task('device-lock: hold').problemMatcher;
    const refusal = refusalLine(new Error('The Roku at 192.0.2.10 is in use by test:rta'));
    const ready = '[device-lock] ready: publisher on 192.0.2.10 for F5 debug session';

    expect(
      new RegExp(background.beginsPattern).test('[device-lock] acquiring 192.0.2.10 for F5'),
    ).toBe(true);
    expect(new RegExp(background.endsPattern).test(ready)).toBe(true);
    expect(new RegExp(background.endsPattern).test(refusal)).toBe(true);
    const match = new RegExp(pattern.regexp).exec(refusal);
    expect(match?.[pattern.file]).toBe('.vscode/launch.json');
    expect(match?.[pattern.message]).toMatch(/^The Roku at 192\.0\.2\.10 is in use by test:rta/);
  });
});

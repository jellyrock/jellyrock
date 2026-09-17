// Tests for scripts/lib/env-config.cjs — where the tooling's environment comes from.
//
// The pure half is driven with an explicit env object and an in-memory file table,
// so nothing here reads the developer's real `.env` or user file. The last block
// runs the real `load-env.cjs` in a child process against temp files, because the
// promise `measure-devices.js` rests on — an inherited `ROKU_IP` survives both
// files — is only worth something if it holds for the actual entry point.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  PRESET,
  userEnvPath,
  envFiles,
  applyEnvFiles,
} = require('../../../../scripts/lib/env-config.cjs');

const LOAD_ENV = fileURLToPath(new URL('../../../../scripts/lib/load-env.cjs', import.meta.url));

// Built with path.join so the expectations hold on any platform's separator.
const HOME = path.join(path.sep, 'home', 'dev');
const CFG = path.join(path.sep, 'cfg');
const CHECKOUT_DIR = path.join(path.sep, 'work', 'checkout');
const CHECKOUT = path.join(CHECKOUT_DIR, '.env');
const USER = path.join(HOME, '.config', 'jellyrock', 'env');

/** A readFile over a fixed table; a missing entry reads as an absent file. */
const files = (table) => (file) => (file in table ? table[file] : null);

describe('userEnvPath', () => {
  it('defaults to ~/.config/jellyrock/env', () => {
    expect(userEnvPath({}, HOME)).toBe(USER);
  });

  it('honors XDG_CONFIG_HOME', () => {
    expect(userEnvPath({ XDG_CONFIG_HOME: CFG }, HOME)).toBe(path.join(CFG, 'jellyrock', 'env'));
  });

  it('ignores an empty XDG_CONFIG_HOME, as the XDG spec requires', () => {
    expect(userEnvPath({ XDG_CONFIG_HOME: '' }, HOME)).toBe(USER);
  });
});

describe('envFiles', () => {
  it("lists the checkout's .env before the user file", () => {
    expect(envFiles({ cwd: CHECKOUT_DIR, env: {}, homedir: HOME })).toEqual([CHECKOUT, USER]);
  });
});

describe('applyEnvFiles', () => {
  it('fills a variable from the user file when the checkout has none', () => {
    const env = {};
    const { loaded, sources } = applyEnvFiles(
      [CHECKOUT, USER],
      env,
      files({ [USER]: 'ROKU_IP=10.0.0.7\n' }),
    );

    expect(env.ROKU_IP).toBe('10.0.0.7');
    expect(loaded).toEqual([USER]);
    expect(sources.ROKU_IP).toBe(USER);
  });

  it("lets the checkout's .env override the user file", () => {
    const env = {};
    const { sources } = applyEnvFiles(
      [CHECKOUT, USER],
      env,
      files({ [CHECKOUT]: 'ROKU_IP=10.0.0.1\n', [USER]: 'ROKU_IP=10.0.0.7\n' }),
    );

    expect(env.ROKU_IP).toBe('10.0.0.1');
    expect(sources.ROKU_IP).toBe(CHECKOUT);
  });

  it('never overwrites a variable that was already set', () => {
    const env = { ROKU_IP: '10.0.0.9' };
    const { sources } = applyEnvFiles(
      [CHECKOUT, USER],
      env,
      files({ [CHECKOUT]: 'ROKU_IP=10.0.0.1\n', [USER]: 'ROKU_IP=10.0.0.7\n' }),
    );

    expect(env.ROKU_IP).toBe('10.0.0.9');
    expect(sources.ROKU_IP).toBe(PRESET);
  });

  it('keeps an already-set variable even when it is empty', () => {
    const env = { ROKU_DEVICES: '' };
    applyEnvFiles([USER], env, files({ [USER]: 'ROKU_DEVICES=10.0.0.7,10.0.0.8\n' }));

    expect(env.ROKU_DEVICES).toBe('');
  });

  it('treats an empty value in a file as unset, so it cannot hide the user file', () => {
    // The shape of a .env copied verbatim from .env.example.
    const env = {};
    const { sources } = applyEnvFiles(
      [CHECKOUT, USER],
      env,
      files({ [CHECKOUT]: 'ROKU_DEVICES=\n', [USER]: 'ROKU_DEVICES=10.0.0.7,10.0.0.8\n' }),
    );

    expect(env.ROKU_DEVICES).toBe('10.0.0.7,10.0.0.8');
    expect(sources.ROKU_DEVICES).toBe(USER);
  });

  it('leaves a variable unset when every file has it empty', () => {
    const env = {};
    applyEnvFiles(
      [CHECKOUT, USER],
      env,
      files({ [CHECKOUT]: 'ROKU_DEVICES=\n', [USER]: 'ROKU_DEVICES=\n' }),
    );

    expect('ROKU_DEVICES' in env).toBe(false);
  });

  it('ignores commented-out lines, so a device can be parked without deleting it', () => {
    const env = {};
    applyEnvFiles(
      [USER],
      env,
      files({
        [USER]: '# ROKU_DEVICES=10.0.0.7,10.0.0.8,10.0.0.9\nROKU_DEVICES=10.0.0.7,10.0.0.8\n',
      }),
    );

    expect(env.ROKU_DEVICES).toBe('10.0.0.7,10.0.0.8');
  });

  it('reads nothing when neither file exists', () => {
    const env = {};
    const result = applyEnvFiles([CHECKOUT, USER], env, files({}));

    expect(result).toEqual({ loaded: [], sources: {} });
    expect(env).toEqual({});
  });
});

describe('load-env.cjs in a real process', () => {
  let dir;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jr-env-'));
    fs.mkdirSync(path.join(dir, 'checkout'));
    fs.mkdirSync(path.join(dir, 'config', 'jellyrock'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'checkout', '.env'), 'ROKU_IP=10.0.0.1\nROKU_DEVICES=\n');
    fs.writeFileSync(
      path.join(dir, 'config', 'jellyrock', 'env'),
      'ROKU_IP=10.0.0.7\nROKU_DEVICES=10.0.0.7,10.0.0.8\nROKU_PASSWORD=from-user-file\n',
    );
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = (extraEnv) => {
    const script =
      `require(${JSON.stringify(LOAD_ENV)});` +
      'process.stdout.write(JSON.stringify({ ip: process.env.ROKU_IP, devices: process.env.ROKU_DEVICES, ' +
      'password: process.env.ROKU_PASSWORD }))';
    // A minimal environment, so the developer's own variables cannot leak in.
    const env = {
      PATH: process.env.PATH,
      HOME: dir,
      XDG_CONFIG_HOME: path.join(dir, 'config'),
      ...extraEnv,
    };
    const child = spawnSync(process.execPath, ['-e', script], {
      cwd: path.join(dir, 'checkout'),
      env,
      encoding: 'utf8',
    });
    expect(child.status, child.stderr).toBe(0);
    return JSON.parse(child.stdout);
  };

  it('layers the checkout .env over the user file', () => {
    expect(run({})).toEqual({
      ip: '10.0.0.1',
      devices: '10.0.0.7,10.0.0.8',
      password: 'from-user-file',
    });
  });

  it('keeps a ROKU_IP handed down by a parent process, as measure-devices.js requires', () => {
    expect(run({ ROKU_IP: '10.0.0.8' }).ip).toBe('10.0.0.8');
  });
});

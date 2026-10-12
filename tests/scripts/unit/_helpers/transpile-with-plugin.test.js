// The transpile harness must not touch the checkout it runs from.
//
// BrighterScript's Program.write empties its outDir before writing, and a
// Program built without an outDir falls back to ./out relative to the cwd.
// This test chdirs into a tmpdir that holds a sentinel under out/ and checks
// the sentinel survives a transpile.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { transpileWithPlugin } from './transpile-with-plugin.js';

const noopPlugin = () => ({ name: 'noop' });
const SOURCE = { 'source/main.bs': 'sub main()\nend sub\n' };

describe('transpileWithPlugin', () => {
  let tmpDir;
  let cwd;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'transpile-with-plugin-'));
    cwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("leaves the cwd's out/ alone", async () => {
    fs.mkdirSync('out');
    fs.writeFileSync(path.join('out', 'SENTINEL'), 'keep');

    const result = await transpileWithPlugin(noopPlugin, SOURCE);

    expect(result['source/main.bs']).toContain('sub main()');
    expect(fs.readFileSync(path.join(tmpDir, 'out', 'SENTINEL'), 'utf8')).toBe('keep');
  });

  it('does not create out/ in the cwd', async () => {
    await transpileWithPlugin(noopPlugin, SOURCE);
    expect(fs.existsSync(path.join(tmpDir, 'out'))).toBe(false);
  });
});

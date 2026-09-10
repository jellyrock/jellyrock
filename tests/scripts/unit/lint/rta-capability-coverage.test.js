// Tests for scripts/lint/rta-capability-coverage.cjs — the gate that keeps the ODC
// capability inventory in tests/rta/CLAUDE.md in step with the installed
// roku-test-automation client.
//
// Two behaviours carry the weight and both are covered against a synthetic --root:
// UNCOVERED (the library ships a method the inventory never judged — what fires on a
// library upgrade) and STALE (an inventory TABLE row names a method the client dropped
// — what fires on a rename). The last test runs the real repo, so a row deleted from
// the real doc fails here as well as in the lint step.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';

const SCRIPT = 'scripts/lint/rta-capability-coverage.cjs';
const DTS_REL = 'node_modules/roku-test-automation/client/dist/OnDeviceComponent.d.ts';
const DOC_REL = 'tests/rta/CLAUDE.md';

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

/** A .d.ts whose class members mirror the real emitted shape (4-space indent). */
function dts(members) {
  return `export declare class OnDeviceComponent {\n${members.join('\n')}\n}\n`;
}

/** Non-capability members: the client's own config accessors, which must be ignored. */
const CONFIG_MEMBERS = [
  '    constructor(device: RokuDevice, config?: ConfigOptions);',
  '    setConfig(config: ConfigOptions): void;',
  '    getRtaConfig(): ConfigOptions;',
  '    getConfig(): import(".").OnDeviceComponentConfigOptions | undefined;',
];

const method = (name) => `    ${name}(args: any, options?: any): Promise<any>;`;

function setup({ members, doc }) {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-rta-caps-'));
  dirs.push(dir);
  mkdirSync(join(dir, DTS_REL, '..'), { recursive: true });
  writeFileSync(join(dir, DTS_REL), dts(members));
  mkdirSync(join(dir, DOC_REL, '..'), { recursive: true });
  writeFileSync(join(dir, DOC_REL), doc);
  return dir;
}

const block = (body) =>
  `# doc\n\n<!-- rta-capability-inventory:start -->\n\n${body}\n\n<!-- rta-capability-inventory:end -->\n`;

const run = (dir, args = []) => spawnScript(SCRIPT, ['--root', dir, ...args]);

describe('rta-capability-coverage', () => {
  it('passes when every client method carries a verdict', () => {
    const dir = setup({
      members: [...CONFIG_MEMBERS, method('getValues'), method('focusNode')],
      doc: block(
        '| Primitive | Why |\n|---|---|\n| `getValues` | used |\n| `focusNode` | banned |',
      ),
    });
    const r = run(dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('all 2 OnDeviceComponent methods');
  });

  it('fails when the library ships a method the inventory never judged', () => {
    const dir = setup({
      members: [...CONFIG_MEMBERS, method('getValues'), method('brandNewCapability')],
      doc: block('| Primitive | Why |\n|---|---|\n| `getValues` | used |'),
    });
    const r = run(dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('brandNewCapability');
    expect(r.stderr).toContain('no verdict');
  });

  it('fails when a table row names a method the client no longer ships', () => {
    const dir = setup({
      members: [...CONFIG_MEMBERS, method('getNodesInfo')],
      doc: block(
        '| Primitive | Why |\n|---|---|\n| `getNodesInfo` | used |\n| `getNodeReferences` | removed upstream |',
      ),
    });
    const r = run(dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('getNodeReferences');
    expect(r.stderr).toContain('no longer ships');
  });

  it('accepts a verdict given in prose rather than a table row', () => {
    // The family paragraphs are prose; requiring a table row for each of the ~25
    // not-applicable primitives is the bulk this inventory deliberately avoids.
    const dir = setup({
      members: [...CONFIG_MEMBERS, method('statPath')],
      doc: block('**Device filesystem — `statPath`.** Not a SceneGraph capability.'),
    });
    expect(run(dir).exitCode).toBe(0);
  });

  it('does not treat an incidental prose identifier as a stale claim', () => {
    // Only table cells are claims. A paragraph mentioning `getVals` — our own helper,
    // not a library method — must not be read as naming a dropped primitive.
    const dir = setup({
      members: [...CONFIG_MEMBERS, method('getValues')],
      doc: block(
        '| Primitive | Why |\n|---|---|\n| `getValues` | used |\n\nEvery wait routes through `getVals`, which batches them.',
      ),
    });
    expect(run(dir).exitCode).toBe(0);
  });

  it('counts a method whose parameters contain parens of their own', () => {
    // onFieldChange takes `callback: (response: …) => …`. A `\([^)]*\)` parameter regex
    // stops at that inner paren and silently drops the method — the failure that would
    // make this gate under-report the surface and pass.
    const dir = setup({
      members: [
        ...CONFIG_MEMBERS,
        '    onFieldChange(args: ODC.OnFieldChangeArgs, options: ODC.RequestOptions | undefined, callback: (response: ODC.OnFieldChangeResponse) => Promise<void> | void): Promise<() => Promise<void>>;',
      ],
      doc: block('nothing judged here'),
    });
    const r = run(dir);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('onFieldChange');
  });

  it('errors rather than passes when the inventory markers are missing', () => {
    const dir = setup({
      members: [...CONFIG_MEMBERS, method('getValues')],
      doc: '# doc\n\n| `getValues` | used |\n',
    });
    const r = run(dir);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('markers');
  });

  it('errors rather than passes when the .d.ts shape parses to zero methods', () => {
    const dir = setup({ members: ['  notAMember(): void;'], doc: block('empty') });
    const r = run(dir);
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('ZERO methods');
  });

  it('skips without failing when the client is not installed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jellyrock-rta-caps-'));
    dirs.push(dir);
    mkdirSync(join(dir, DOC_REL, '..'), { recursive: true });
    writeFileSync(join(dir, DOC_REL), block('nothing'));
    const r = run(dir);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('SKIP');
  });

  it('reports the real repo inventory as complete', () => {
    // Not a synthetic fixture: this is the assertion that fails when someone deletes a
    // row from the real tests/rta/CLAUDE.md, or bumps roku-test-automation to a version
    // with a capability nobody has judged.
    const r = spawnScript(SCRIPT, ['--json']);
    expect(r.exitCode).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.uncovered).toEqual([]);
    expect(out.stale).toEqual([]);
    expect(out.total).toBeGreaterThan(40);
  });
});

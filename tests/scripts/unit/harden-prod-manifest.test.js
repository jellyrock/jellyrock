// Tests for scripts/harden-prod-manifest.js.
//
// The script rewrites `build/manifest` so no development-only `bs_const` reaches a
// release artifact. It is the last thing standing between a `debug=true` working tree
// and the store, and nothing else in the repo reads the built manifest — so its
// behavior is worth pinning rather than eyeballing the build log.
//
// It resolves `build/manifest` from process.cwd(), so each case runs in a temp
// workspace and gets full behavioral coverage (not just "the script loaded").

import { describe, it, expect } from 'vitest';
import { spawnScript } from './_helpers/spawn-script.js';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = 'scripts/harden-prod-manifest.js';

/** Temp workspace with a build/manifest carrying `body`. */
function workspace(body) {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-harden-manifest-'));
  mkdirSync(join(dir, 'build'), { recursive: true });
  if (body !== undefined) writeFileSync(join(dir, 'build', 'manifest'), body);
  return {
    dir,
    manifest: () => readFileSync(join(dir, 'build', 'manifest'), 'utf8'),
    run: () => spawnScript(SCRIPT, [], { cwd: dir }),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

/** Pull the bs_const line's value out of a manifest body. */
function constLine(body) {
  return body.split(/\r?\n/).find((l) => l.startsWith('bs_const='));
}

describe('harden-prod-manifest', () => {
  it('forces every dev const off and reports what it flipped', () => {
    const ws = workspace(
      'title=JellyRock\nbs_const=debug=true;ENABLE_RTA=true;perfTiming=true\nmajor_version=2\n',
    );
    try {
      const { exitCode, stdout } = ws.run();
      expect(exitCode).toBe(0);
      expect(constLine(ws.manifest())).toBe(
        'bs_const=debug=false;ENABLE_RTA=false;perfTiming=false',
      );
      expect(stdout).toMatch(/debug/);
      expect(stdout).toMatch(/perfTiming/);
      expect(stdout).toMatch(/ENABLE_RTA/);
    } finally {
      ws.cleanup();
    }
  });

  it('is idempotent — an already-hardened manifest passes unchanged', () => {
    const body = 'title=JellyRock\nbs_const=debug=false;ENABLE_RTA=false;perfTiming=false\n';
    const ws = workspace(body);
    try {
      const { exitCode, stdout } = ws.run();
      expect(exitCode).toBe(0);
      expect(ws.manifest()).toBe(body);
      expect(stdout).toMatch(/already false/);
    } finally {
      ws.cleanup();
    }
  });

  // The backstop that matters: FORCED_OFF is a denylist, so a const added to the
  // manifest but never registered there would otherwise ship enabled. bsc does not
  // catch it (the const IS declared) and nothing else reads the built manifest.
  it('fails when an unregistered const is still true', () => {
    const ws = workspace(
      'bs_const=debug=false;ENABLE_RTA=false;perfTiming=false;verboseLogging=true\n',
    );
    try {
      const { exitCode, stderr } = ws.run();
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/verboseLogging/);
    } finally {
      ws.cleanup();
    }
  });

  it('leaves an unregistered const alone when it is already false', () => {
    const ws = workspace(
      'bs_const=debug=true;ENABLE_RTA=false;perfTiming=false;somethingElse=false\n',
    );
    try {
      const { exitCode } = ws.run();
      expect(exitCode).toBe(0);
      expect(constLine(ws.manifest())).toBe(
        'bs_const=debug=false;ENABLE_RTA=false;perfTiming=false;somethingElse=false',
      );
    } finally {
      ws.cleanup();
    }
  });

  it('preserves surrounding lines and the trailing newline', () => {
    const ws = workspace(
      'title=JellyRock\nbs_const=debug=true;ENABLE_RTA=false;perfTiming=true\nmajor_version=2\nminor_version=24\n',
    );
    try {
      expect(ws.run().exitCode).toBe(0);
      const out = ws.manifest();
      expect(out.startsWith('title=JellyRock\n')).toBe(true);
      expect(out.endsWith('minor_version=24\n')).toBe(true);
      expect(out.split('\n')).toHaveLength(5);
    } finally {
      ws.cleanup();
    }
  });

  it('does not mix line endings in a CRLF manifest', () => {
    const ws = workspace(
      'title=JellyRock\r\nbs_const=debug=true;ENABLE_RTA=false;perfTiming=true\r\nmajor_version=2\r\n',
    );
    try {
      expect(ws.run().exitCode).toBe(0);
      const out = ws.manifest();
      expect(out).toContain('bs_const=debug=false;ENABLE_RTA=false;perfTiming=false\r\n');
      expect(out.match(/[^\r]\n/g)).toBeNull();
    } finally {
      ws.cleanup();
    }
  });

  it('fails when the manifest has no bs_const line', () => {
    const ws = workspace('title=JellyRock\nmajor_version=2\n');
    try {
      const { exitCode, stderr } = ws.run();
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/bs_const/);
    } finally {
      ws.cleanup();
    }
  });

  it('fails when there is no built manifest at all', () => {
    const ws = workspace(undefined);
    try {
      const { exitCode, stderr } = ws.run();
      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/no manifest at/);
    } finally {
      ws.cleanup();
    }
  });
});

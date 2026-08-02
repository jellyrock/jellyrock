// Tests for scripts/lint/log-manager-init-check.js — the static guard on the
// roku-log manager's single initialization site.
//
// Pure layer: hand-written source strings exercise each rule. Plus a smoke pass
// over the REAL committed JRScene.bs / globals.bs / components tree, so moving
// the init call, adding a second one, or introducing a bootstrap-window Logger
// fails here. That last case has no other automated cover: bsconfig-tests-unit
// excludes source/Main.bs and BaseTestSuite provisions its own rLog, so a broken
// app-side init is invisible to Rooibos.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  check,
  bootstrapNodeTypes,
  SCENE_REL,
  GLOBALS_REL,
} from '../../../../scripts/lint/log-manager-init-check.js';

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..', '..');

const GOOD_SCENE = `
import "pkg:/source/roku_modules/log/LogMixin.brs"

sub init()
  ' a comment ahead of the call must not count as a statement
  #if debug
    log.initializeLogManager(["log_PrintTransport"], 4)
  #else
    log.initializeLogManager(["log_PrintTransport"], 2)
  #end if
  m.log = new log.Logger("JRScene")
  m.top.backgroundColor = m.global.constants.colorBackgroundPrimary
end sub
`;

const GOOD_GLOBALS = `
sub setGlobals()
  serverNode = CreateObject("roSGNode", "JellyfinServer")
  settingsNode = CreateObject("roSGNode", "JellyfinUserSettings")
  m.global.addFields({ server: serverNode })
end sub

sub setGlobalNodes()
  ' created AFTER show() — safe to log
  m.global.addFields({ sceneManager: CreateObject("roSGNode", "SceneManager") })
end sub
`;

/** Baseline inputs: one clean scene + globals, no other files. */
function baseline(extraFiles = {}) {
  const files = new Map([[SCENE_REL, GOOD_SCENE], ...Object.entries(extraFiles)]);
  return { files, globals: GOOD_GLOBALS, scene: GOOD_SCENE };
}

describe('bootstrapNodeTypes', () => {
  it('extracts only the node types created inside setGlobals()', () => {
    const types = bootstrapNodeTypes(GOOD_GLOBALS);
    expect([...types].sort()).toEqual(['JellyfinServer', 'JellyfinUserSettings']);
  });

  it('does not bleed into setGlobalNodes()', () => {
    expect(bootstrapNodeTypes(GOOD_GLOBALS).has('SceneManager')).toBe(false);
  });

  it('returns null when setGlobals() is absent', () => {
    expect(bootstrapNodeTypes('sub somethingElse()\nend sub\n')).toBeNull();
  });
});

describe('rule 1 — exactly one initializeLogManager call site', () => {
  it('passes on the canonical shape', () => {
    expect(check(baseline())).toEqual([]);
  });

  it('flags a second call site (the JRScreen fallback shape)', () => {
    const problems = check(
      baseline({
        'components/JRScreen.bs': `
sub init()
  log.initializeLogManager(["log_PrintTransport"], 2)
end sub
`,
      }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('components/JRScreen.bs');
    expect(problems[0]).toContain('second');
  });

  it('flags the manager going missing entirely', () => {
    const noInit = 'sub init()\n  m.log = new log.Logger("JRScene")\nend sub\n';
    const files = new Map([[SCENE_REL, noInit]]);
    const problems = check({ files, globals: GOOD_GLOBALS, scene: noInit });
    expect(problems.some((p) => p.includes('no `log.initializeLogManager` call'))).toBe(true);
  });

  it('is not satisfied by a mention inside a comment', () => {
    const commentedOut = `
sub init()
  ' log.initializeLogManager(["log_PrintTransport"], 2)
  m.log = new log.Logger("JRScene")
end sub
`;
    const files = new Map([[SCENE_REL, commentedOut]]);
    const problems = check({ files, globals: GOOD_GLOBALS, scene: commentedOut });
    expect(problems.some((p) => p.includes('no `log.initializeLogManager` call'))).toBe(true);
  });
});

describe('rule 2 — init call is the first statement', () => {
  it('flags a Logger constructed ahead of the manager', () => {
    const lateInit = `
sub init()
  m.log = new log.Logger("JRScene")
  log.initializeLogManager(["log_PrintTransport"], 2)
end sub
`;
    const files = new Map([[SCENE_REL, lateInit]]);
    const problems = check({ files, globals: GOOD_GLOBALS, scene: lateInit });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('not the first statement');
    expect(problems[0]).toContain('new log.Logger');
  });

  it('tolerates comments and #if/#else scaffolding before the call', () => {
    expect(check(baseline())).toEqual([]);
  });
});

describe('rule 3 — no Logger in the bootstrap window', () => {
  it('flags a NEW setGlobals() node that builds a Logger', () => {
    const globals = GOOD_GLOBALS.replace(
      'm.global.addFields({ server: serverNode })',
      'thing = CreateObject("roSGNode", "NewBootstrapThing")',
    );
    const problems = check({
      files: new Map([
        [SCENE_REL, GOOD_SCENE],
        [
          'components/data/NewBootstrapThing.bs',
          'sub init()\n  m.log = new log.Logger("NewBootstrapThing")\nend sub\n',
        ],
      ]),
      globals,
      scene: GOOD_SCENE,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('NewBootstrapThing');
    expect(problems[0]).toContain('before the log manager can exist');
  });

  it('does not flag the documented JellyfinUserSettings exception', () => {
    const problems = check(
      baseline({
        'components/data/jellyfin/JellyfinUserSettings.bs':
          'sub init()\n  m.log = new log.Logger("JellyfinUserSettings")\nend sub\n',
      }),
    );
    expect(problems).toEqual([]);
  });

  it('does not flag a node created in setGlobalNodes() (post-show)', () => {
    const problems = check(
      baseline({
        'components/data/SceneManager.bs':
          'sub init()\n  m.log = new log.Logger("SceneManager")\nend sub\n',
      }),
    );
    expect(problems).toEqual([]);
  });
});

describe('smoke — the real committed tree', () => {
  function collect(relDir, out) {
    for (const entry of readdirSync(join(REPO_ROOT, relDir))) {
      const rel = join(relDir, entry);
      if (statSync(join(REPO_ROOT, rel)).isDirectory()) {
        if (entry === 'roku_modules' || entry === 'vendor') continue;
        collect(rel, out);
      } else if (entry.endsWith('.bs')) {
        out.set(rel.split(sep).join('/'), readFileSync(join(REPO_ROOT, rel), 'utf8'));
      }
    }
    return out;
  }

  it('passes against the committed source', () => {
    const files = collect('components', new Map());
    collect('source', files);
    const problems = check({
      files,
      globals: readFileSync(join(REPO_ROOT, GLOBALS_REL), 'utf8'),
      scene: readFileSync(join(REPO_ROOT, SCENE_REL), 'utf8'),
    });
    expect(problems).toEqual([]);
  });

  it('JRScreen.bs really has no initializeLogManager call', () => {
    const src = readFileSync(join(REPO_ROOT, 'components/JRScreen.bs'), 'utf8');
    expect(src).not.toContain('initializeLogManager');
  });

  it('JellyfinUserSettings is still created in setGlobals (allowlist stays justified)', () => {
    const types = bootstrapNodeTypes(readFileSync(join(REPO_ROOT, GLOBALS_REL), 'utf8'));
    expect(types.has('JellyfinUserSettings')).toBe(true);
    expect(basename('components/data/jellyfin/JellyfinUserSettings.bs', '.bs')).toBe(
      'JellyfinUserSettings',
    );
  });
});

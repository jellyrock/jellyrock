// Tests for .claude/skills/audit-skill/extract-friction.cjs.
//
// The detectors operate on a normalized Turn shape derived from a Claude
// Code session JSONL. Tests construct synthetic transcripts with a known
// shape, run them through the helper, and assert on the categorized
// findings.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnScript } from '../_helpers/spawn-script.js';
import { createRequire } from 'node:module';

const SCRIPT = '.claude/skills/audit-skill/extract-friction.cjs';
const require = createRequire(import.meta.url);
const friction = require('../../../../.claude/skills/audit-skill/extract-friction.cjs');
// The 5 JellyRock repo-specific rule detectors + their matcher constants now
// live in the co-located consumer config (Option C: repo-agnostic core, all
// repo-specific config in extract-friction.config.cjs).
const config = require('../../../../.claude/skills/audit-skill/extract-friction.config.cjs');

// ────────────────────────────────────────────────────────────────────
// Fixture builders — produce JSONL strings + module-level Turn arrays.
// ────────────────────────────────────────────────────────────────────

let lineCounter = 0;
function nextUuid() {
  lineCounter += 1;
  return `uuid-${String(lineCounter).padStart(4, '0')}`;
}

function assistantTurn({ skill = 'demo', text = '', bash = [], edits = [], otherTools = [] }) {
  const content = [];
  if (text) content.push({ type: 'text', text });
  for (const bc of bash) {
    content.push({
      type: 'tool_use',
      id: bc.id || nextUuid(),
      name: 'Bash',
      input: { command: bc.command, run_in_background: !!bc.bg },
    });
  }
  for (const e of edits) {
    content.push({
      type: 'tool_use',
      id: e.id || nextUuid(),
      name: e.tool || 'Edit',
      input: { file_path: e.filePath },
    });
  }
  for (const o of otherTools) {
    content.push({ type: 'tool_use', id: nextUuid(), name: o, input: {} });
  }
  return {
    type: 'assistant',
    uuid: nextUuid(),
    timestamp: '2026-05-06T00:00:00Z',
    attributionSkill: skill,
    message: { content },
  };
}

function toolResultTurn({ toolUseId, isError = false, stdout = '', stderr = '' }) {
  return {
    type: 'user',
    uuid: nextUuid(),
    timestamp: '2026-05-06T00:00:00Z',
    attributionSkill: null,
    message: {
      content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError }],
    },
    toolUseResult: { stdout, stderr },
  };
}

function writeTranscript(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-audit-skill-'));
  const path = join(dir, 'fixture.jsonl');
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { dir, path };
}

function parseAndRange(jsonlPath, skill = 'demo') {
  const turns = friction.parseTranscript(jsonlPath);
  const ranges = friction.findInvocations(turns, skill);
  expect(ranges.length).toBeGreaterThan(0);
  return { turns, range: ranges[0] };
}

beforeEach(() => {
  lineCounter = 0;
});

// ────────────────────────────────────────────────────────────────────
// Detector unit tests
// ────────────────────────────────────────────────────────────────────

describe('extract-friction detectors', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  describe('repeated-command', () => {
    it('flags consecutive identical bash commands', () => {
      const lines = [
        assistantTurn({ bash: [{ command: 'ls -la' }] }),
        assistantTurn({ bash: [{ command: 'ls -la' }] }),
      ];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      const findings = friction.detectRepeatedCommand(turns, range, 2);
      expect(findings).toHaveLength(1);
      expect(findings[0].category).toBe('repeated-command');
      expect(findings[0].evidence.consecutiveCount).toBe(2);
    });

    it('does NOT flag non-consecutive identical commands', () => {
      const lines = [
        assistantTurn({ bash: [{ command: 'ls -la' }] }),
        assistantTurn({ bash: [{ command: 'cat foo' }] }),
        assistantTurn({ bash: [{ command: 'ls -la' }] }),
      ];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      expect(friction.detectRepeatedCommand(turns, range, 2)).toHaveLength(0);
    });
  });

  describe('failed-recovery', () => {
    it('flags a similar command tried after a failure', () => {
      const cmd1Id = 'cmd-1';
      const cmd2Id = 'cmd-2';
      const lines = [
        assistantTurn({ bash: [{ id: cmd1Id, command: 'npm run validate src/foo.bs' }] }),
        toolResultTurn({ toolUseId: cmd1Id, isError: true, stderr: 'syntax error' }),
        assistantTurn({ bash: [{ id: cmd2Id, command: 'npm run validate src/foo' }] }),
        toolResultTurn({ toolUseId: cmd2Id, isError: true }),
      ];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      const findings = friction.detectFailedRecovery(turns, range);
      expect(findings).toHaveLength(1);
      expect(findings[0].category).toBe('failed-recovery');
      expect(findings[0].evidence.retrySucceeded).toBe(false);
      expect(findings[0].severity).toBe('high'); // retry also failed
    });

    it('does NOT flag if the next command starts with a different word', () => {
      const cmd1Id = 'cmd-1';
      const cmd2Id = 'cmd-2';
      const lines = [
        assistantTurn({ bash: [{ id: cmd1Id, command: 'npm run validate' }] }),
        toolResultTurn({ toolUseId: cmd1Id, isError: true }),
        assistantTurn({ bash: [{ id: cmd2Id, command: 'cat package.json' }] }),
      ];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      expect(friction.detectFailedRecovery(turns, range)).toHaveLength(0);
    });
  });

  describe('confusion-marker', () => {
    it('flags a cluster when density >= threshold in a 10-turn window', () => {
      const lines = [
        assistantTurn({ text: 'let me check this' }),
        assistantTurn({ text: 'hmm, that is odd' }),
        assistantTurn({ text: 'wait, actually...' }),
      ];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      const findings = friction.detectConfusion(turns, range, 3);
      expect(findings).toHaveLength(1);
      expect(findings[0].category).toBe('confusion-marker');
      expect(findings[0].evidence.nMarkersInWindow).toBe(3);
    });

    it('does NOT flag below the density threshold', () => {
      const lines = [
        assistantTurn({ text: 'all good here' }),
        assistantTurn({ text: 'hmm let me see' }),
        assistantTurn({ text: 'easy fix' }),
      ];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      expect(friction.detectConfusion(turns, range, 3)).toHaveLength(0);
    });
  });

  describe('lint-spam', () => {
    it('flags a re-run of a successful lint command', () => {
      const cmd1Id = 'lint-1';
      const cmd2Id = 'lint-2';
      const lines = [
        assistantTurn({ bash: [{ id: cmd1Id, command: 'npm run lint' }] }),
        toolResultTurn({ toolUseId: cmd1Id, isError: false }),
        assistantTurn({ text: 'looks good' }),
        assistantTurn({ bash: [{ id: cmd2Id, command: 'npm run lint' }] }),
        toolResultTurn({ toolUseId: cmd2Id, isError: false }),
      ];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      const findings = config.detectLintSpam(turns, range, 10);
      expect(findings).toHaveLength(1);
      expect(findings[0].category).toBe('lint-spam');
      expect(findings[0].evidence.priorSucceeded).toBe(true);
    });

    it('does NOT flag if the prior lint failed (re-run is justified)', () => {
      const cmd1Id = 'lint-1';
      const cmd2Id = 'lint-2';
      const lines = [
        assistantTurn({ bash: [{ id: cmd1Id, command: 'npm run validate' }] }),
        toolResultTurn({ toolUseId: cmd1Id, isError: true, stderr: 'errors' }),
        assistantTurn({ text: 'fixing' }),
        assistantTurn({ bash: [{ id: cmd2Id, command: 'npm run validate' }] }),
        toolResultTurn({ toolUseId: cmd2Id, isError: false }),
      ];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      expect(config.detectLintSpam(turns, range, 10)).toHaveLength(0);
    });

    it('matches all lint shapes (lint, validate, build, format, raw bsfmt/bsc)', () => {
      const shapes = [
        'npm run lint',
        'npm run lint:bs',
        'npm run validate',
        'npm run build',
        'npm run check-formatting',
        'npm run format',
        'bsfmt --write src/foo.bs',
        'bsc --noEmit',
      ];
      for (const cmd of shapes) {
        expect(config.LINT_SHAPE.some((re) => re.test(cmd))).toBe(true);
      }
    });
  });

  describe('changelog-edit-attempt', () => {
    it('flags Edit on CHANGELOG.md', () => {
      const lines = [assistantTurn({ edits: [{ tool: 'Edit', filePath: '/repo/CHANGELOG.md' }] })];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      const findings = config.detectChangelogEditAttempt(turns, range);
      expect(findings).toHaveLength(1);
      expect(findings[0].category).toBe('changelog-edit-attempt');
      expect(findings[0].severity).toBe('high');
    });

    it('flags MultiEdit on CHANGELOG.md', () => {
      const lines = [assistantTurn({ edits: [{ tool: 'MultiEdit', filePath: 'CHANGELOG.md' }] })];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      expect(config.detectChangelogEditAttempt(turns, range)).toHaveLength(1);
    });

    it('does NOT flag edits on other files', () => {
      const lines = [assistantTurn({ edits: [{ tool: 'Edit', filePath: 'src/foo.bs' }] })];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      expect(config.detectChangelogEditAttempt(turns, range)).toHaveLength(0);
    });
  });

  describe('tasks-leakage', () => {
    it('flags `tasks/<path>` inside a git commit', () => {
      const lines = [
        assistantTurn({
          bash: [{ command: "git commit -m 'fix per tasks/notes.md plan'" }],
        }),
      ];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      const findings = config.detectTasksLeakage(turns, range);
      expect(findings).toHaveLength(1);
      expect(findings[0].category).toBe('tasks-leakage');
    });

    it('flags `tasks/<path>` inside a gh pr create body', () => {
      const lines = [
        assistantTurn({
          bash: [{ command: "gh pr create --title T --body 'see tasks/plan.md'" }],
        }),
      ];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      expect(config.detectTasksLeakage(turns, range)).toHaveLength(1);
    });

    it('does NOT flag the literal word "tasks" without a path segment', () => {
      const lines = [
        assistantTurn({ bash: [{ command: "git commit -m 'finish remaining tasks for v2'" }] }),
      ];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      expect(config.detectTasksLeakage(turns, range)).toHaveLength(0);
    });

    it('does NOT flag tasks/ in non-share commands (e.g. cat, grep)', () => {
      const lines = [assistantTurn({ bash: [{ command: 'cat tasks/notes.md' }] })];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      expect(config.detectTasksLeakage(turns, range)).toHaveLength(0);
    });
  });

  describe('test-claim-without-evidence', () => {
    it('flags "tests pass" claim with zero test commands in range', () => {
      const lines = [assistantTurn({ text: 'I implemented the fix and verified all tests pass.' })];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      const findings = config.detectTestClaimWithoutEvidence(turns, range);
      expect(findings).toHaveLength(1);
      expect(findings[0].category).toBe('test-claim-without-evidence');
    });

    it('does NOT flag if a test command exists in the range', () => {
      const cmdId = 'test-1';
      const lines = [
        assistantTurn({ bash: [{ id: cmdId, command: 'npm run test:tdd' }] }),
        toolResultTurn({ toolUseId: cmdId, isError: false }),
        assistantTurn({ text: 'verified — all tests pass' }),
      ];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      expect(config.detectTestClaimWithoutEvidence(turns, range)).toHaveLength(0);
    });
  });

  describe('hardware-claim-mismatch', () => {
    it('flags claim-of-tested when most-recent test failed and was not retried successfully', () => {
      const cmdId = 'test-1';
      const lines = [
        assistantTurn({ bash: [{ id: cmdId, command: 'npm run test:tdd' }] }),
        toolResultTurn({ toolUseId: cmdId, isError: true, stderr: 'no device' }),
        assistantTurn({ text: 'tested and verified the fix' }),
      ];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      const findings = config.detectHardwareClaimMismatch(turns, range);
      expect(findings).toHaveLength(1);
      expect(findings[0].category).toBe('hardware-claim-mismatch');
      expect(findings[0].severity).toBe('high');
    });

    it('does NOT flag if the failed test was retried successfully', () => {
      const c1 = 't1';
      const c2 = 't2';
      const lines = [
        assistantTurn({ bash: [{ id: c1, command: 'npm run test:tdd' }] }),
        toolResultTurn({ toolUseId: c1, isError: true }),
        assistantTurn({ bash: [{ id: c2, command: 'npm run test:tdd' }] }),
        toolResultTurn({ toolUseId: c2, isError: false }),
        assistantTurn({ text: 'tests pass now' }),
      ];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      expect(config.detectHardwareClaimMismatch(turns, range)).toHaveLength(0);
    });
  });
});

// ────────────────────────────────────────────────────────────────────
// Model-fit smoke
// ────────────────────────────────────────────────────────────────────

describe('extract-friction model_fit', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('summarizes a clean mechanical run', () => {
    const lines = [
      assistantTurn({ bash: [{ command: 'ls' }] }),
      assistantTurn({ bash: [{ command: 'cat foo' }] }),
      assistantTurn({ bash: [{ command: 'echo done' }] }),
      assistantTurn({ bash: [{ command: 'pwd' }] }),
    ];
    const { path, dir: d } = writeTranscript(lines);
    dir = d;
    const { turns, range } = parseAndRange(path);
    const fit = friction.buildModelFit(turns, range, 0, 0);
    expect(fit.profileSummary).toMatch(/clean mechanical run/);
  });

  it('flags verbose reasoning + sub-agent + askuser as judgment-heavy', () => {
    const long = 'a'.repeat(5000);
    const lines = [
      assistantTurn({ text: long, otherTools: ['Agent', 'AskUserQuestion', 'TodoWrite'] }),
    ];
    const { path, dir: d } = writeTranscript(lines);
    dir = d;
    const { turns, range } = parseAndRange(path);
    const fit = friction.buildModelFit(turns, range, 0, 0);
    expect(fit.profileSummary).toMatch(/sub-agent invocation/);
    expect(fit.profileSummary).toMatch(/AskUserQuestion call/);
    expect(fit.profileSummary).toMatch(/TodoWrite call/);
    expect(fit.profileSummary).toMatch(/verbose reasoning/);
  });
});

// ────────────────────────────────────────────────────────────────────
// CLI / locate-transcript end-to-end
// ────────────────────────────────────────────────────────────────────

describe('extract-friction CLI', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('exits 2 when transcripts dir does not exist', () => {
    const { exitCode, stderr } = spawnScript(SCRIPT, ['demo', '--transcripts-dir', '/no/such/dir']);
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/transcripts dir not found/);
  });

  it('exits 2 when no transcript contains the named skill', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-audit-skill-cli-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'fixture.jsonl'),
      JSON.stringify({
        type: 'assistant',
        uuid: 'u1',
        attributionSkill: 'other',
        message: { content: [] },
      }) + '\n',
    );
    const { exitCode, stderr } = spawnScript(SCRIPT, ['demo', '--transcripts-dir', dir]);
    expect(exitCode).toBe(2);
    expect(stderr).toMatch(/no transcript found/);
  });

  it('emits structured JSON on a clean run (exit 0)', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-audit-skill-cli-'));
    mkdirSync(dir, { recursive: true });
    const lines = [
      assistantTurn({ bash: [{ command: 'ls' }] }),
      assistantTurn({ text: 'looking good' }),
    ];
    writeFileSync(
      join(dir, 'fixture.jsonl'),
      lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    );
    const { exitCode, stdout } = spawnScript(SCRIPT, ['demo', '--transcripts-dir', dir]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.skill).toBe('demo');
    expect(parsed.summary.totalFindings).toBe(0);
    expect(parsed.findings).toEqual([]);
    expect(parsed.modelFit).toHaveLength(1);
  });

  it('reports findings + categorizes them in summary on a flawed run', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-audit-skill-cli-'));
    mkdirSync(dir, { recursive: true });
    const cmdId = 'lint-1';
    const lines = [
      assistantTurn({ bash: [{ id: cmdId, command: 'npm run lint' }] }),
      toolResultTurn({ toolUseId: cmdId, isError: false }),
      assistantTurn({ bash: [{ command: 'npm run lint' }] }),
      assistantTurn({ edits: [{ tool: 'Edit', filePath: 'CHANGELOG.md' }] }),
    ];
    writeFileSync(
      join(dir, 'fixture.jsonl'),
      lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    );
    const { exitCode, stdout } = spawnScript(SCRIPT, ['demo', '--transcripts-dir', dir]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.summary.totalFindings).toBeGreaterThanOrEqual(2);
    expect(parsed.summary.byCategory['lint-spam']).toBe(1);
    expect(parsed.summary.byCategory['changelog-edit-attempt']).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────
// Behavioral trace (dimension 1) — action-trace ordering, file-touch
// summary, tool/bash histograms, and bashCommandHead normalization.
//
// buildBehavioralTrace / bashCommandHead are core internals not exported on
// the module surface, so we drive them through the CLI (their output is the
// top-level `behavioralTrace` block).
// ────────────────────────────────────────────────────────────────────

describe('extract-friction behavioral trace', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function runTrace(lines) {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-audit-skill-trace-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'fixture.jsonl'),
      lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    );
    const { exitCode, stdout } = spawnScript(SCRIPT, ['demo', '--transcripts-dir', dir]);
    expect(exitCode).toBe(0);
    return JSON.parse(stdout).behavioralTrace[0];
  }

  it('records actions in transcript order', () => {
    const trace = runTrace([
      assistantTurn({ bash: [{ command: 'git status --short' }] }),
      assistantTurn({ edits: [{ tool: 'Edit', filePath: 'source/foo.bs' }] }),
      assistantTurn({ bash: [{ command: 'git commit -m wip' }] }),
    ]);
    expect(trace.actionTrace.map((a) => a.type)).toEqual(['bash', 'edit', 'bash']);
    expect(trace.actionTrace[0].detail).toBe('git status');
    expect(trace.actionTrace[1]).toMatchObject({
      type: 'edit',
      tool: 'Edit',
      detail: 'source/foo.bs',
    });
    expect(trace.actionTrace[2].detail).toBe('git commit');
  });

  it('summarizes file touches per path with their ops', () => {
    const trace = runTrace([
      assistantTurn({ edits: [{ tool: 'Edit', filePath: 'source/a.bs' }] }),
      assistantTurn({ edits: [{ tool: 'Write', filePath: 'source/a.bs' }] }),
      assistantTurn({ edits: [{ tool: 'Edit', filePath: 'source/b.bs' }] }),
    ]);
    expect(trace.nFilesTouched).toBe(2);
    expect(trace.filesTouched['source/a.bs'].sort()).toEqual(['modify', 'write']);
    expect(trace.filesTouched['source/b.bs']).toEqual(['modify']);
  });

  it('builds tool + bash-verb histograms', () => {
    const trace = runTrace([
      assistantTurn({ bash: [{ command: 'git status' }, { command: 'git commit -m x' }] }),
      assistantTurn({ bash: [{ command: 'git status' }], otherTools: ['Read'] }),
      assistantTurn({ edits: [{ tool: 'Edit', filePath: 'source/a.bs' }] }),
    ]);
    expect(trace.toolHistogram.Bash).toBe(3);
    expect(trace.toolHistogram.Edit).toBe(1);
    expect(trace.toolHistogram.Read).toBe(1);
    expect(trace.bashVerbs['git status']).toBe(2);
    expect(trace.bashVerbs['git commit']).toBe(1);
  });

  it('normalizes bash heads — drops flags, strips env vars + path prefixes', () => {
    const trace = runTrace([
      assistantTurn({ bash: [{ command: 'git status --short' }] }),
      assistantTurn({ bash: [{ command: 'FOO=1 ./scripts/build.sh --now' }] }),
      assistantTurn({ bash: [{ command: 'node scripts/x.cjs audit' }] }),
    ]);
    expect(trace.bashVerbs['git status']).toBe(1);
    expect(trace.bashVerbs['build.sh']).toBe(1);
    expect(trace.bashVerbs['node']).toBe(1);
  });
});

// ────────────────────────────────────────────────────────────────────
// Read-only over-capture correction — computeEffectiveRange /
// firstDownstreamMutation / readSkillAuditSpan.
// ────────────────────────────────────────────────────────────────────

describe('extract-friction read-only over-capture correction', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  function buildTurns(lines) {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-audit-skill-ro-'));
    const p = join(dir, 'fixture.jsonl');
    writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    return friction.parseTranscript(p);
  }

  it('does not cut a clean read-only span with no mutation', () => {
    const turns = buildTurns([
      assistantTurn({ bash: [{ command: 'git log --oneline -10' }] }),
      assistantTurn({ text: 'state loaded' }),
    ]);
    const range = [0, turns.length - 1];
    const eff = friction.computeEffectiveRange(turns, range, true);
    expect(eff.firstMutation).toBeNull();
    expect(eff.effRange).toEqual(range);
    expect(eff.overCaptureSuspected).toBe(false);
  });

  it('bounds the span at a downstream Edit', () => {
    const turns = buildTurns([
      assistantTurn({ text: 'loading' }),
      assistantTurn({ text: 'presenting' }),
      assistantTurn({ edits: [{ tool: 'Edit', filePath: 'source/foo.bs' }] }),
      assistantTurn({ bash: [{ command: 'echo more work' }] }),
    ]);
    const range = [0, turns.length - 1];
    const eff = friction.computeEffectiveRange(turns, range, true);
    expect(eff.firstMutation).not.toBeNull();
    expect(eff.firstMutation.idx).toBe(2);
    expect(eff.effRange).toEqual([0, 1]); // bounded before the Edit
    expect(eff.overCaptureSuspected).toBe(true);
  });

  it('bounds the span at a downstream git commit', () => {
    const turns = buildTurns([
      assistantTurn({ text: 'loading' }),
      assistantTurn({ bash: [{ command: 'git commit -m landed' }] }),
      assistantTurn({ text: 'more' }),
    ]);
    const range = [0, turns.length - 1];
    const eff = friction.computeEffectiveRange(turns, range, true);
    expect(eff.firstMutation).not.toBeNull();
    expect(eff.firstMutation.kind).toBe('deploy/commit bash');
    expect(eff.effRange).toEqual([0, 0]);
  });

  it('flags overCaptureSuspected when a clean read-only span exceeds the turn ceiling', () => {
    const ceiling = friction._internals.READONLY_LOAD_TURN_CEILING;
    const lines = [];
    for (let i = 0; i < ceiling + 2; i++) lines.push(assistantTurn({ text: `read step ${i}` }));
    const turns = buildTurns(lines);
    const range = [0, turns.length - 1];
    const eff = friction.computeEffectiveRange(turns, range, true);
    expect(eff.firstMutation).toBeNull(); // no mutation → no truncation
    expect(eff.effRange).toEqual(range);
    expect(eff.overCaptureSuspected).toBe(true);
    expect(eff.overCaptureReason).toMatch(/assistant turns/);
  });

  it('leaves a non-read-only range unchanged even with a downstream mutation', () => {
    const turns = buildTurns([
      assistantTurn({ text: 'work' }),
      assistantTurn({ edits: [{ tool: 'Edit', filePath: 'source/foo.bs' }] }),
    ]);
    const range = [0, turns.length - 1];
    const eff = friction.computeEffectiveRange(turns, range, false);
    expect(eff.effRange).toEqual(range);
    expect(eff.overCaptureSuspected).toBe(false);
  });

  it('readSkillAuditSpan reads the audit-span frontmatter value', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'jellyrock-audit-skill-fm-'));
    const skillDir = join(cwd, '.claude', 'skills', 'demo');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: demo\naudit-span: read-only\n---\n\n# Demo\n',
    );
    expect(friction.readSkillAuditSpan('demo', cwd)).toBe('read-only');
    rmSync(cwd, { recursive: true, force: true });
  });
});

// ────────────────────────────────────────────────────────────────────
// Cross-session aggregate rollup — buildAggregate.
// ────────────────────────────────────────────────────────────────────

describe('extract-friction buildAggregate', () => {
  it('rolls up median / p90 / cost across multiple invocations', () => {
    const perfList = [
      {
        durationSec: 10,
        costEstimateUSD: 0.1,
        totalOutputTokens: 100,
        cacheHitRatio: 0.5,
        avgOutputTokensPerTurn: 50,
        perModel: { 'claude-opus-4-8': {} },
      },
      {
        durationSec: 20,
        costEstimateUSD: 0.2,
        totalOutputTokens: 200,
        cacheHitRatio: 0.7,
        avgOutputTokensPerTurn: 80,
        perModel: { 'claude-opus-4-8': {} },
      },
      {
        durationSec: 30,
        costEstimateUSD: 0.3,
        totalOutputTokens: 300,
        cacheHitRatio: 0.9,
        avgOutputTokensPerTurn: 90,
        perModel: { 'claude-sonnet-4-6': {} },
      },
    ];
    const fitList = perfList.map(() => ({}));
    const findingsList = [
      { category: 'lint-spam', session: 's1' },
      { category: 'lint-spam', session: 's2' },
      { category: 'confusion-marker', session: 's1' },
    ];
    const invMeta = [
      { session: 's1', overCaptureSuspected: false },
      { session: 's2', overCaptureSuspected: false },
      { session: 's3', overCaptureSuspected: true },
    ];
    const agg = friction.buildAggregate(perfList, fitList, findingsList, invMeta);
    expect(agg.nInvocations).toBe(3);
    expect(agg.nSessions).toBe(3);
    expect(agg.durationSec.median).toBe(20);
    expect(agg.durationSec.p90).toBe(30);
    expect(agg.durationSec.max).toBe(30);
    expect(agg.costEstimateUSD.total).toBe(0.6);
    expect(agg.costEstimateUSD.median).toBe(0.2);
    expect(agg.totalOutputTokens.total).toBe(600);
    expect(agg.nOverCaptureSuspected).toBe(1);
    // lint-spam in 2 sessions → recurring; confusion-marker in 1 → not.
    expect(agg.recurringFriction['lint-spam'].recurring).toBe(true);
    expect(agg.recurringFriction['lint-spam'].inSessions).toBe(2);
    expect(agg.recurringFriction['confusion-marker'].recurring).toBe(false);
    expect(agg.modelsObserved.sort()).toEqual(['claude-opus-4-8', 'claude-sonnet-4-6']);
  });

  it('main() omits the aggregate for a single invocation (degenerate case)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jellyrock-audit-skill-agg-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'fixture.jsonl'),
      [assistantTurn({ bash: [{ command: 'ls' }] })].map((l) => JSON.stringify(l)).join('\n') +
        '\n',
    );
    const { exitCode, stdout } = spawnScript(SCRIPT, ['demo', '--transcripts-dir', dir]);
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout).aggregate).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });
});

// ────────────────────────────────────────────────────────────────────
// Config-fallback invariant (the Option-C architecture's key property):
// the core runs repo-agnostically when no co-located config is present —
// only the 4 core friction categories fire, none of the consumer detectors.
// We copy ONLY the core .cjs into a temp dir (no extract-friction.config.cjs
// beside it) and run it there, with a transcript that WOULD trip a consumer
// detector (a CHANGELOG.md edit) to prove the consumer layer is absent.
// ────────────────────────────────────────────────────────────────────

describe('extract-friction config fallback (repo-agnostic core)', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it('runs the 4 core detectors only when no consumer config is present', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const coreSrc = resolve(here, '../../../../.claude/skills/audit-skill/extract-friction.cjs');
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-audit-skill-nocfg-'));
    // Copy the repo-agnostic core + its util leaf (both always ship together),
    // but deliberately NO extract-friction.config.cjs — that's the optional
    // consumer layer this test proves is absent.
    const coreDst = join(dir, 'extract-friction.cjs');
    copyFileSync(coreSrc, coreDst);
    copyFileSync(
      resolve(here, '../../../../.claude/skills/audit-skill/extract-friction.util.cjs'),
      join(dir, 'extract-friction.util.cjs'),
    );
    const transcriptsDir = join(dir, 'transcripts');
    mkdirSync(transcriptsDir, { recursive: true });
    // A CHANGELOG.md edit + a repeated command: a consumer detector (changelog)
    // WOULD fire if the config were loaded; a core detector (repeated-command)
    // fires regardless.
    const lines = [
      assistantTurn({ bash: [{ command: 'ls -la' }] }),
      assistantTurn({ bash: [{ command: 'ls -la' }] }),
      assistantTurn({ edits: [{ tool: 'Edit', filePath: 'CHANGELOG.md' }] }),
    ];
    writeFileSync(
      join(transcriptsDir, 'fixture.jsonl'),
      lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    );
    const { spawnSync } = require('node:child_process');
    const res = spawnSync('node', [coreDst, 'demo', '--transcripts-dir', transcriptsDir], {
      encoding: 'utf8',
    });
    expect(res.status).toBe(0);
    const parsed = JSON.parse(res.stdout);
    const cats = Object.keys(parsed.summary.byCategory);
    // No consumer detector fired — the CHANGELOG edit was NOT flagged.
    expect(cats).not.toContain('changelog-edit-attempt');
    // Only the repo-agnostic core categories are possible.
    const coreCats = ['repeated-command', 'failed-recovery', 'confusion-marker', 'permission-gap'];
    for (const c of cats) expect(coreCats).toContain(c);
    // The core detector still fired.
    expect(parsed.summary.byCategory['repeated-command']).toBe(1);
  });
});

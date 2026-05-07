// Tests for .claude/skills/audit-skill/extract-friction.cjs.
//
// The detectors operate on a normalized Turn shape derived from a Claude
// Code session JSONL. Tests construct synthetic transcripts with a known
// shape, run them through the helper, and assert on the categorized
// findings.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';
import { createRequire } from 'node:module';

const SCRIPT = '.claude/skills/audit-skill/extract-friction.cjs';
const require = createRequire(import.meta.url);
const friction = require('../../../../.claude/skills/audit-skill/extract-friction.cjs');

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
      const findings = friction.detectLintSpam(turns, range, 10);
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
      expect(friction.detectLintSpam(turns, range, 10)).toHaveLength(0);
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
        expect(friction._internals.LINT_SHAPE.some((re) => re.test(cmd))).toBe(true);
      }
    });
  });

  describe('changelog-edit-attempt', () => {
    it('flags Edit on CHANGELOG.md', () => {
      const lines = [assistantTurn({ edits: [{ tool: 'Edit', filePath: '/repo/CHANGELOG.md' }] })];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      const findings = friction.detectChangelogEditAttempt(turns, range);
      expect(findings).toHaveLength(1);
      expect(findings[0].category).toBe('changelog-edit-attempt');
      expect(findings[0].severity).toBe('high');
    });

    it('flags MultiEdit on CHANGELOG.md', () => {
      const lines = [assistantTurn({ edits: [{ tool: 'MultiEdit', filePath: 'CHANGELOG.md' }] })];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      expect(friction.detectChangelogEditAttempt(turns, range)).toHaveLength(1);
    });

    it('does NOT flag edits on other files', () => {
      const lines = [assistantTurn({ edits: [{ tool: 'Edit', filePath: 'src/foo.bs' }] })];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      expect(friction.detectChangelogEditAttempt(turns, range)).toHaveLength(0);
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
      const findings = friction.detectTasksLeakage(turns, range);
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
      expect(friction.detectTasksLeakage(turns, range)).toHaveLength(1);
    });

    it('does NOT flag the literal word "tasks" without a path segment', () => {
      const lines = [
        assistantTurn({ bash: [{ command: "git commit -m 'finish remaining tasks for v2'" }] }),
      ];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      expect(friction.detectTasksLeakage(turns, range)).toHaveLength(0);
    });

    it('does NOT flag tasks/ in non-share commands (e.g. cat, grep)', () => {
      const lines = [assistantTurn({ bash: [{ command: 'cat tasks/notes.md' }] })];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      expect(friction.detectTasksLeakage(turns, range)).toHaveLength(0);
    });
  });

  describe('test-claim-without-evidence', () => {
    it('flags "tests pass" claim with zero test commands in range', () => {
      const lines = [assistantTurn({ text: 'I implemented the fix and verified all tests pass.' })];
      const { path, dir: d } = writeTranscript(lines);
      dir = d;
      const { turns, range } = parseAndRange(path);
      const findings = friction.detectTestClaimWithoutEvidence(turns, range);
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
      expect(friction.detectTestClaimWithoutEvidence(turns, range)).toHaveLength(0);
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
      const findings = friction.detectHardwareClaimMismatch(turns, range);
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
      expect(friction.detectHardwareClaimMismatch(turns, range)).toHaveLength(0);
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

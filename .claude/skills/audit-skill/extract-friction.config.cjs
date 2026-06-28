// Consumer config for extract-friction.cjs — the ONLY per-repo file here.
//
// extract-friction.cjs is repo-agnostic and synced verbatim from canonical;
// everything repo-specific lives in this file. It is CREATE-if-absent on
// onboarding and is NEVER overwritten by a re-sync, so your edits survive every
// core update. All four lists are optional — leave any empty (or delete the
// file entirely) to run the core's repo-agnostic audit alone.

'use strict';

// ──────────────────────────────────────────────────────────────────────
// JellyRock-specific bash/edit pattern matchers — feed the repo-specific
// rule detectors registered in ruleDetectors below.
// ──────────────────────────────────────────────────────────────────────

// Lint/validate/build/format invocations whose repetition triggers lint-spam
const LINT_SHAPE = [
  /^\s*npm\s+run\s+lint(:|\s|$)/,
  /^\s*npm\s+run\s+validate(\s|$)/,
  /^\s*npm\s+run\s+build(:|\s|$)/,
  /^\s*npm\s+run\s+check-formatting(:|\s|$)/,
  /^\s*npm\s+run\s+format(:|\s|$)/,
  /(?:^|\s|;|&&|\|)bsfmt\b/,
  /(?:^|\s|;|&&|\|)bsc\b/,
];

// Test invocations — used to satisfy `test-claim-without-evidence`
const TEST_SHAPE = [/\bnpm\s+run\s+test(:|\s|$)/, /\bnpm\s+test(\s|$)/, /\bnpx\s+vitest\b/];

// Test-claim phrases — case-insensitive, word-bounded
const TEST_CLAIM =
  /\b(tested|verified|tests?\s+pass(?:ing|ed)?|passing\s+tests?|all\s+tests?\s+pass)\b/i;

// CHANGELOG path detection — matches the file at the repo root or any
// nested location (defensive — JellyRock's is at root, but a copy in a
// subdir would still violate the rule)
const CHANGELOG_PATH = /(?:^|\/)CHANGELOG\.md$/i;

// tasks/ leakage detection — narrow to `tasks/<word>` to skip mentions
// of the literal word "tasks" in prose ("the tasks at hand"). Requires
// at least one path segment after `tasks/` to qualify as a path.
const TASKS_LEAKAGE = /\btasks\/[A-Za-z0-9._-]/;

// Shared pure helpers — imported from the co-located leaf module so the core
// and these detectors share one copy (the config can't require the core back:
// the core requires this config at load → that would be circular).
const { preview, findResultByToolUseId } = require('./extract-friction.util.cjs');

// ──────────────────────────────────────────────────────────────────────
// JellyRock repo-specific rule detectors
//
// Each maps one CLAUDE.md hard rule to a finding (with `ruleViolated` +
// `suggestedFix`). They run on the same projected turns as the core's portable
// detectors. Each is invoked as `detector(turns, effRange, cwd)`; returned
// findings are merged with the portable friction findings.
// ──────────────────────────────────────────────────────────────────────

function detectLintSpam(turns, range, windowSize) {
  // Walk assistant turns. Track lint-shape commands and whether the
  // immediately-prior lint command produced a successful tool_result.
  // If a second lint-shape command fires within `windowSize` turns AND
  // the prior one succeeded (no failure to fix between them), flag.
  const findings = [];
  let counter = 0;
  const lintEvents = []; // {idx, lineNo, uuid, timestamp, command, toolUseId}
  for (let i = range[0]; i <= range[1]; i++) {
    const t = turns[i];
    if (t.role !== 'assistant') continue;
    for (const bc of t.bashCommands) {
      if (LINT_SHAPE.some((re) => re.test(bc.command))) {
        lintEvents.push({
          idx: i,
          lineNo: t.lineNo,
          uuid: t.uuid,
          timestamp: t.timestamp,
          command: bc.command,
          toolUseId: bc.toolUseId,
        });
      }
    }
  }
  for (let k = 1; k < lintEvents.length; k++) {
    const prev = lintEvents[k - 1];
    const curr = lintEvents[k];
    // Check window distance — count assistant turns between prev.idx and curr.idx
    let assistantTurnsBetween = 0;
    for (let i = prev.idx + 1; i < curr.idx; i++) {
      if (turns[i].role === 'assistant') assistantTurnsBetween += 1;
    }
    if (assistantTurnsBetween >= windowSize) continue;
    // Check whether prev lint command succeeded — find its tool_result
    const prevResult = findResultByToolUseId(turns, prev.idx, prev.toolUseId, range);
    const prevSucceeded = prevResult ? !prevResult.isError : true; // missing result = treat as silent success (couldn't fail-recover)
    if (!prevSucceeded) continue; // Re-running after a real failure is justified
    counter += 1;
    findings.push({
      id: `lint-spam-${String(counter).padStart(3, '0')}`,
      category: 'lint-spam',
      severity: 'med',
      evidence: {
        transcriptLine: curr.lineNo,
        uuid: curr.uuid,
        timestamp: curr.timestamp,
        priorCommand: prev.command,
        priorLine: prev.lineNo,
        priorSucceeded: prevSucceeded,
        currentCommand: curr.command,
        assistantTurnsBetween,
      },
      ruleViolated: {
        anchor: 'CLAUDE.md#dont-compulsively-re-run-lint',
        summary:
          "Don't compulsively re-run lint / build / format mid-work. " +
          'These are already run by pre-commit / pre-push hooks and CI; ' +
          'editors surface BSC diagnostics live.',
      },
      suggestedFix: {
        kind: 'judgment-required',
        text:
          'Agent ran a lint/validate/build command after a prior one ' +
          'already succeeded — a pattern the load-bearing rule explicitly ' +
          'forbids. Either add a callout to the SKILL.md naming the ' +
          'anti-pattern, or examine whether the workflow legitimately ' +
          'needs the second invocation (then narrow the rule).',
      },
    });
  }
  return findings;
}

function detectChangelogEditAttempt(turns, range) {
  const findings = [];
  let counter = 0;
  for (let i = range[0]; i <= range[1]; i++) {
    const t = turns[i];
    for (const et of t.editTargets) {
      if (CHANGELOG_PATH.test(et.filePath)) {
        counter += 1;
        findings.push({
          id: `changelog-${String(counter).padStart(3, '0')}`,
          category: 'changelog-edit-attempt',
          severity: 'high',
          evidence: {
            transcriptLine: t.lineNo,
            uuid: t.uuid,
            timestamp: t.timestamp,
            tool: et.tool,
            filePath: et.filePath,
          },
          ruleViolated: {
            anchor: 'CLAUDE.md#cannot-modify-changelog',
            summary: 'CHANGELOG.md is CI-controlled — agents must not edit it.',
          },
          suggestedFix: {
            kind: 'mechanical',
            text:
              'Agent attempted to Edit/Write CHANGELOG.md, which is forbidden ' +
              'by the load-bearing rule (CHANGELOG is CI-managed). The skill ' +
              'should never produce this; if it did, the SKILL.md may be missing ' +
              'a clear callout naming this rule.',
          },
        });
      }
    }
  }
  return findings;
}

function detectTasksLeakage(turns, range) {
  const findings = [];
  let counter = 0;
  for (let i = range[0]; i <= range[1]; i++) {
    const t = turns[i];
    for (const bc of t.bashCommands) {
      // We care about commands that produce shared artifacts: git commit,
      // gh pr create, gh issue create. Match on the body argument.
      const isShareCmd =
        /\bgit\s+commit\b/.test(bc.command) ||
        /\bgh\s+pr\s+create\b/.test(bc.command) ||
        /\bgh\s+issue\s+create\b/.test(bc.command);
      if (!isShareCmd) continue;
      if (TASKS_LEAKAGE.test(bc.command)) {
        counter += 1;
        findings.push({
          id: `tasks-leak-${String(counter).padStart(3, '0')}`,
          category: 'tasks-leakage',
          severity: 'high',
          evidence: {
            transcriptLine: t.lineNo,
            uuid: t.uuid,
            timestamp: t.timestamp,
            command: bc.command,
          },
          ruleViolated: {
            anchor: 'CLAUDE.md#dont-reference-tasks-paths',
            summary:
              "tasks/ is gitignored; reviewers can't navigate there. Keep " +
              'it out of commit messages, PR bodies, and shared docs.',
          },
          suggestedFix: {
            kind: 'mechanical',
            text:
              'Agent referenced a tasks/ path inside a commit / PR / issue ' +
              'body. Strip the reference (tasks/ is local-only) and re-create ' +
              'the artifact. The SKILL.md should explicitly forbid this in ' +
              'its body-construction step.',
          },
        });
      }
    }
  }
  return findings;
}

function detectTestClaimWithoutEvidence(turns, range) {
  const findings = [];
  let counter = 0;
  // Sweep assistant text turns for test-claim phrases. For each match,
  // check whether ANY test command appears in the same invocation range.
  // The check is range-wide rather than turn-local because evidence may
  // come from a turn before the claim (the agent ran tests, then later
  // asserted "tests pass").
  const testCommandsInRange = [];
  for (let i = range[0]; i <= range[1]; i++) {
    for (const bc of turns[i].bashCommands) {
      if (TEST_SHAPE.some((re) => re.test(bc.command))) {
        testCommandsInRange.push({
          idx: i,
          lineNo: turns[i].lineNo,
          command: bc.command,
          toolUseId: bc.toolUseId,
        });
      }
    }
  }
  for (let i = range[0]; i <= range[1]; i++) {
    const t = turns[i];
    if (t.role !== 'assistant' || !t.textContent) continue;
    if (!TEST_CLAIM.test(t.textContent)) continue;
    // The claim is suspect if no test command exists in the range AT ALL
    if (testCommandsInRange.length === 0) {
      counter += 1;
      findings.push({
        id: `test-claim-${String(counter).padStart(3, '0')}`,
        category: 'test-claim-without-evidence',
        severity: 'high',
        evidence: {
          transcriptLine: t.lineNo,
          uuid: t.uuid,
          timestamp: t.timestamp,
          textPreview: preview(t.textContent, 300),
          testCommandsInRange: 0,
        },
        ruleViolated: {
          anchor: 'CLAUDE.md#run-tests-to-verify-fixes',
          summary:
            "Run tests to verify fixes — don't commit based on reasoning " +
            "alone. test:tdd / test:unit / test:scripts aren't auto-run " +
            'anywhere before commit.',
        },
        suggestedFix: {
          kind: 'judgment-required',
          text:
            'Assistant claimed a fix was tested / verified but no ' +
            'npm run test:* command appears in the invocation range. ' +
            'Either the test was actually skipped (skill should add a ' +
            'guard step), or the claim is overly confident phrasing — ' +
            'advise the SKILL.md to require evidence before stating ' +
            'outcomes.',
        },
      });
    }
  }
  return findings;
}

function detectHardwareClaimMismatch(turns, range) {
  const findings = [];
  let counter = 0;
  for (let i = range[0]; i <= range[1]; i++) {
    const t = turns[i];
    if (t.role !== 'assistant' || !t.textContent) continue;
    if (!TEST_CLAIM.test(t.textContent)) continue;
    // Find the most-recent test command before this turn (within range)
    let lastTestIdx = -1;
    let lastTestId = null;
    for (let j = i; j >= range[0]; j--) {
      for (const bc of turns[j].bashCommands) {
        if (TEST_SHAPE.some((re) => re.test(bc.command))) {
          lastTestIdx = j;
          lastTestId = bc.toolUseId;
          break;
        }
      }
      if (lastTestIdx !== -1) break;
    }
    if (lastTestIdx === -1) continue; // Handled by detectTestClaimWithoutEvidence
    const lastTestResult = findResultByToolUseId(turns, lastTestIdx, lastTestId, range);
    if (!lastTestResult || !lastTestResult.isError) continue; // Test passed: no mismatch
    // Check whether a follow-up successful test ran between lastTestIdx and i
    let recovered = false;
    for (let j = lastTestIdx + 1; j <= i; j++) {
      for (const bc of turns[j].bashCommands) {
        if (TEST_SHAPE.some((re) => re.test(bc.command))) {
          const followupResult = findResultByToolUseId(turns, j, bc.toolUseId, range);
          if (followupResult && !followupResult.isError) {
            recovered = true;
            break;
          }
        }
      }
      if (recovered) break;
    }
    if (recovered) continue;
    counter += 1;
    findings.push({
      id: `hw-claim-${String(counter).padStart(3, '0')}`,
      category: 'hardware-claim-mismatch',
      severity: 'high',
      evidence: {
        transcriptLine: t.lineNo,
        uuid: t.uuid,
        timestamp: t.timestamp,
        textPreview: preview(t.textContent, 300),
        failedTestCommand: turns[lastTestIdx].bashCommands.find((bc) => bc.toolUseId === lastTestId)
          ?.command,
        failedTestLine: turns[lastTestIdx].lineNo,
        stderrPreview: lastTestResult.stderrPreview || lastTestResult.stdoutPreview,
      },
      ruleViolated: {
        anchor: 'CLAUDE.md#hardware-not-reachable',
        summary:
          "When hardware isn't reachable, say so explicitly — don't claim " +
          'a fix was tested when only the build was verified.',
      },
      suggestedFix: {
        kind: 'judgment-required',
        text:
          'Assistant claimed tested but the most-recent npm run test:* ' +
          'invocation in the range failed (is_error: true) without a ' +
          'follow-up successful run. The SKILL.md should require explicit ' +
          'acknowledgment of hardware unavailability rather than letting ' +
          'the failure be papered over by a confident claim.',
      },
    });
  }
  return findings;
}

module.exports = {
  // Rule detectors — one per CLAUDE.md / AGENTS.md hard rule mechanically
  // caught. Each is a function (turns, range, cwd) => findings[]; findings are
  // merged with the core's repo-agnostic friction findings. Order matches the
  // pre-relocation CONSUMER_RULE_DETECTORS registration.
  ruleDetectors: [
    (turns, range) => detectLintSpam(turns, range, 10),
    detectChangelogEditAttempt,
    detectTasksLeakage,
    detectTestClaimWithoutEvidence,
    detectHardwareClaimMismatch,
  ],

  // Extra "work landed" deploy/apply verbs ORed into the read-only
  // first-mutation cut. JellyRock skills don't run deploy/apply orchestration —
  // git commit/push (the core default) is the only "work landed" signal.
  mutationBashPatterns: [],

  // Extra repo-internal top-level dirs (on top of the core defaults
  // .claude/ scripts/ tests/ hooks/). JellyRock's real source dirs.
  internalPrefixes: ['source/', 'components/', 'locale/'],

  // Extra subcommand-tools. JellyRock is a Roku app — it runs no ops/infra
  // orchestration tools, so the core's universal set suffices.
  subcommandTools: [],

  // Detector functions + matcher constants exported as named properties so the
  // test suite can require them directly from this module.
  detectLintSpam,
  detectChangelogEditAttempt,
  detectTasksLeakage,
  detectTestClaimWithoutEvidence,
  detectHardwareClaimMismatch,
  LINT_SHAPE,
  TEST_SHAPE,
  TEST_CLAIM,
  CHANGELOG_PATH,
  TASKS_LEAKAGE,
};

// Extract audit signals from a Claude Code session transcript for the
// /audit-skill flow.
//
// Reads a JSONL transcript at
// `~/.claude/projects/<sanitized-cwd>/<session>.jsonl`,
// filters to turns produced by a named skill (via the `attributionSkill`
// field), runs the JellyRock-relevant detectors over the Bash + text
// content, and emits a structured JSON document for the /audit-skill
// SKILL.md prose to classify with judgment.
//
// Output covers four dimensions; friction is one of them:
//   1. Friction findings (the detectors below)
//   2. Performance — clock time, token usage per model, cache-hit ratio,
//      cost estimate
//   3. Permission gaps — Bash invocations targeting repo-internal scripts
//      that aren't covered by .claude/settings.json's allow list
//   4. Model-fit profile — sub-agent / TodoWrite / AskUserQuestion / text
//      density, used to recommend opus / sonnet / haiku
//
// The fifth dimension — output accuracy — is not mechanizable; the
// auditor reads the audited skill's actual user-visible output and
// judges it. The SKILL.md prose owns that step.
//
// Detectors:
//     repeated-command       same Bash command in two consecutive tool_use
//                            calls
//     failed-recovery        is_error: true tool_result followed within 3
//                            turns by a meaningfully-similar command
//     confusion-marker       cluster of >=N self-narration markers in a
//                            10-turn window ("let me check", "hmm", etc.)
//     lint-spam              >=2 lint/validate/build/bsfmt/bsc invocations
//                            within a 10-turn window without a failure
//                            between them. Maps to CLAUDE.md's "Don't
//                            compulsively re-run lint / build / format
//                            mid-work" rule.
//     changelog-edit-attempt Edit/Write/MultiEdit on CHANGELOG.md. Maps
//                            to CLAUDE.md's "Cannot modify CHANGELOG.md"
//                            rule.
//     tasks-leakage          `tasks/` substring inside a `git commit`
//                            body or `gh pr create` body argument. Maps
//                            to CLAUDE.md's "Don't reference tasks/
//                            paths in shared artifacts" rule.
//     test-claim-without-evidence  assistant text claims a fix was
//                            tested but no `npm run test:*` Bash call
//                            appears in the turn range. Maps to
//                            CLAUDE.md's "Run tests to verify fixes"
//                            rule.
//     hardware-claim-mismatch  assistant claims tested but a recent
//                            `npm run test:*` exited with is_error:true
//                            and no follow-up successful run occurred.
//                            Maps to CLAUDE.md's "When hardware isn't
//                            reachable, say so explicitly" rule.
//     permission-gap         Bash invocation targeting a repo-internal
//                            script (scripts/, .claude/) that is NOT
//                            covered by .claude/settings.json's allow
//                            list. Maps to .claude/skills/CLAUDE.md's
//                            "When you change a skill" allowlist rule —
//                            our own repo files should be trusted, not
//                            permission-prompted.
//
// Exit codes:
//     0  findings produced (zero is valid)
//     1  parse error (malformed JSONL line)
//     2  bad inputs (transcript not found, skill never invoked, session
//        contains no turns with that attributionSkill)

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ──────────────────────────────────────────────────────────────────────
// Argv parsing — minimal, no deps. Supported:
//   <skill>                           positional, required
//   --session <id>                    override default-most-recent
//   --transcripts-dir <path>          override auto-derive
//   --invocation latest|all           default: latest
//   --repeated-min N                  default: 2
//   --confusion-min-density N         default: 3
//   --help / -h                       print usage and exit 0
// ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    skill: null,
    session: null,
    transcriptsDir: null,
    invocation: 'latest',
    repeatedMin: 2,
    confusionMinDensity: 3,
  };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    } else if (a === '--session') {
      args.session = rest[++i];
    } else if (a === '--transcripts-dir') {
      args.transcriptsDir = rest[++i];
    } else if (a === '--invocation') {
      args.invocation = rest[++i];
    } else if (a === '--repeated-min') {
      args.repeatedMin = parseInt(rest[++i], 10);
    } else if (a === '--confusion-min-density') {
      args.confusionMinDensity = parseInt(rest[++i], 10);
    } else if (!a.startsWith('--') && args.skill === null) {
      args.skill = a;
    } else {
      console.error(`error: unknown argument: ${a}`);
      process.exit(2);
    }
  }
  if (!args.skill) {
    console.error('error: skill name required');
    printUsage();
    process.exit(2);
  }
  return args;
}

function printUsage() {
  console.error('Usage: extract-friction.cjs <skill> [options]');
  console.error('Options:');
  console.error(
    '  --session <id>                  Session UUID (default: most-recent containing skill)',
  );
  console.error('  --transcripts-dir <path>        Override auto-derived dir');
  console.error('  --invocation latest|all         Which invocation to audit (default: latest)');
  console.error('  --repeated-min N                Min consecutive repeats to flag (default: 2)');
  console.error('  --confusion-min-density N       Markers/10-turn-window to flag (default: 3)');
}

// ──────────────────────────────────────────────────────────────────────
// Auto-derive transcripts dir from CWD. Claude Code stores transcripts
// at ~/.claude/projects/<sanitized-cwd>/, where sanitized = absolute
// path with `/` replaced by `-`. Works on any contributor's machine
// without configuration.
// ──────────────────────────────────────────────────────────────────────

function defaultTranscriptsDir() {
  const cwd = process.cwd();
  // Drop a leading `/` so `/home/x` → `home-x` not `-home-x`. But the
  // observed Claude Code convention KEEPS the leading `-`, so:
  //   /home/charlie/PROJECTS/JellyRock/jellyrock
  //   → -home-charlie-PROJECTS-JellyRock-jellyrock
  const sanitized = cwd.replace(/\//g, '-');
  return path.join(os.homedir(), '.claude', 'projects', sanitized);
}

// ──────────────────────────────────────────────────────────────────────
// Bash-command pattern matchers (used by detectors)
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

// Confusion markers — cluster detection
const CONFUSION_MARKER = new RegExp(
  '\\b(' +
    'let me (?:check|figure out|see|try|think|look)|' +
    'need to (?:figure out|understand|check|find)|' +
    'hmm\\b|' +
    'wait,|' +
    'actually,|' +
    "i'?m not sure|" +
    'on second thought|' +
    "that didn'?t work|" +
    "that('?s| was) odd|" +
    'strange\\b' +
    ')',
  'gi',
);

// ──────────────────────────────────────────────────────────────────────
// Turn projection — small projection of each transcript line so
// detectors don't have to know the raw JSONL shape.
//
// Schema:
//   {
//     lineNo, uuid, parentUuid, timestamp,
//     role,                            // "assistant" | "user" | other
//     attributionSkill,                // string or null
//     bashCommands: [{ toolUseId, command, runInBackground }],
//     editTargets:  [{ tool, filePath }],   // Edit/Write/MultiEdit/NotebookEdit
//     textContent: string,             // concatenated assistant text blocks
//     toolResults: [{ toolUseId, isError, stdoutPreview, stderrPreview }],
//     otherToolUses: [string],         // tool names other than Bash/Edit/Write/MultiEdit/NotebookEdit
//   }
// ──────────────────────────────────────────────────────────────────────

function parseTranscript(filePath) {
  const turns = [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (let lineNo = 1; lineNo <= lines.length; lineNo++) {
    const line = lines[lineNo - 1].trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      // engines.node range forbids the Error `cause` option (Node 16.9+);
      // the message string already includes e.message which is the only
      // diagnostic field that matters here (JSON.parse never carries a
      // meaningful stack).
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`failed to parse line ${lineNo} of ${filePath}: ${e.message}`);
    }
    turns.push(projectTurn(obj, lineNo));
  }
  return turns;
}

function projectTurn(obj, lineNo) {
  const msg = obj.message || {};
  const content = Array.isArray(msg.content) ? msg.content : null;
  const bashCommands = [];
  const editTargets = [];
  const textChunks = [];
  const toolResults = [];
  const otherToolUses = [];
  if (content) {
    for (const c of content) {
      if (!c || typeof c !== 'object') continue;
      const ctype = c.type;
      if (ctype === 'tool_use') {
        const name = c.name || '';
        if (name === 'Bash') {
          const inp = c.input || {};
          bashCommands.push({
            toolUseId: c.id || null,
            command: typeof inp.command === 'string' ? inp.command : '',
            runInBackground: Boolean(inp.run_in_background),
          });
        } else if (
          name === 'Edit' ||
          name === 'Write' ||
          name === 'MultiEdit' ||
          name === 'NotebookEdit'
        ) {
          const inp = c.input || {};
          editTargets.push({
            tool: name,
            filePath: typeof inp.file_path === 'string' ? inp.file_path : '',
          });
          otherToolUses.push(name);
        } else {
          otherToolUses.push(name);
        }
      } else if (ctype === 'text') {
        textChunks.push(c.text || '');
      } else if (ctype === 'tool_result') {
        const tur = obj.toolUseResult;
        let stdoutText = '';
        let stderrText = '';
        if (tur && typeof tur === 'object') {
          stdoutText = typeof tur.stdout === 'string' ? tur.stdout : '';
          stderrText = typeof tur.stderr === 'string' ? tur.stderr : '';
        } else if (typeof tur === 'string') {
          stdoutText = tur;
        }
        toolResults.push({
          toolUseId: c.tool_use_id || null,
          isError: Boolean(c.is_error),
          stdoutPreview: preview(stdoutText),
          stderrPreview: preview(stderrText),
        });
      }
    }
  }
  return {
    lineNo,
    uuid: obj.uuid || '',
    parentUuid: obj.parentUuid || null,
    timestamp: obj.timestamp || '',
    role: obj.type || '',
    attributionSkill: obj.attributionSkill || null,
    modelId: msg.model || null,
    usage: msg.usage || null,
    bashCommands,
    editTargets,
    textContent: textChunks.join('\n'),
    toolResults,
    otherToolUses,
  };
}

function preview(text, limit = 200) {
  if (typeof text !== 'string') return '';
  if (text.length <= limit) return text;
  return text.slice(0, limit) + '…';
}

// ──────────────────────────────────────────────────────────────────────
// Locate transcript + invocation ranges
// ──────────────────────────────────────────────────────────────────────

function locateTranscript(skill, sessionId, transcriptsDir) {
  if (!fs.existsSync(transcriptsDir) || !fs.statSync(transcriptsDir).isDirectory()) {
    throw new Error(`transcripts dir not found: ${transcriptsDir}`);
  }
  if (sessionId) {
    const sid = sessionId.endsWith('.jsonl') ? sessionId.slice(0, -'.jsonl'.length) : sessionId;
    const candidate = path.join(transcriptsDir, `${sid}.jsonl`);
    if (!fs.existsSync(candidate)) {
      throw new Error(`session file not found: ${candidate}`);
    }
    return candidate;
  }
  const allFiles = fs.readdirSync(transcriptsDir).filter((f) => f.endsWith('.jsonl'));
  const matches = [];
  for (const f of allFiles) {
    const fp = path.join(transcriptsDir, f);
    if (fileContainsSkill(fp, skill)) {
      matches.push({ mtime: fs.statSync(fp).mtimeMs, path: fp });
    }
  }
  if (matches.length === 0) {
    throw new Error(
      `no transcript found containing attributionSkill='${skill}'. ` +
        `searched ${allFiles.length} file(s) in ${transcriptsDir}`,
    );
  }
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches[0].path;
}

function fileContainsSkill(filePath, skill) {
  // Cheap substring scan — avoids full JSON parse for files that don't
  // mention the skill at all. Uses a buffer so we can search bytes.
  try {
    const needle = Buffer.from(`"attributionSkill":"${skill}"`, 'utf8');
    const buf = fs.readFileSync(filePath);
    return buf.indexOf(needle) !== -1;
  } catch {
    return false;
  }
}

function findInvocations(turns, skill) {
  // Contiguous (start, end) ranges where attribution_skill matches.
  // Contiguity is over assistant turns — interleaved user turns
  // (tool_results) don't break the range.
  const ranges = [];
  let inRange = false;
  let start = 0;
  let end = 0;
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.attributionSkill === skill) {
      if (!inRange) {
        start = i;
        inRange = true;
      }
      end = i;
    } else if (inRange && t.role === 'assistant') {
      ranges.push([start, end]);
      inRange = false;
    }
  }
  if (inRange) ranges.push([start, end]);
  return ranges;
}

// ──────────────────────────────────────────────────────────────────────
// Detectors
// ──────────────────────────────────────────────────────────────────────

function detectRepeatedCommand(turns, range, minCount) {
  const findings = [];
  let counter = 0;
  let lastNorm = null;
  let streak = 1;
  let streakStartLine = 0;
  let streakStartUuid = '';
  let streakStartTs = '';

  function flushStreak() {
    if (streak >= minCount && streak >= 2 && lastNorm) {
      counter += 1;
      const severity = streak >= 3 ? 'high' : 'med';
      findings.push({
        id: `repeat-${String(counter).padStart(3, '0')}`,
        category: 'repeated-command',
        severity,
        evidence: {
          transcriptLine: streakStartLine,
          uuid: streakStartUuid,
          timestamp: streakStartTs,
          command: lastNorm,
          consecutiveCount: streak,
        },
        ruleViolated: null,
        suggestedFix: {
          kind: 'judgment-required',
          text:
            'Friction signal — agent ran the same command repeatedly. ' +
            'Likely cause: missing context hint in the SKILL.md, or a cached ' +
            'result that stale-checked. Consider adding a one-line callout ' +
            'naming the right next step.',
        },
      });
    }
  }

  for (let i = range[0]; i <= range[1]; i++) {
    const t = turns[i];
    for (const bc of t.bashCommands) {
      const norm = normalizeCommand(bc.command);
      if (lastNorm !== null && norm === lastNorm) {
        streak += 1;
      } else {
        flushStreak();
        streak = 1;
        streakStartLine = t.lineNo;
        streakStartUuid = t.uuid;
        streakStartTs = t.timestamp;
      }
      lastNorm = norm;
    }
  }
  flushStreak();
  return findings;
}

function normalizeCommand(cmd) {
  return cmd.replace(/\s+/g, ' ').trim();
}

function detectFailedRecovery(turns, range) {
  // When a tool_result has is_error=true, look ahead 3 assistant turns
  // for a Bash with same first-word AND >=50% Jaccard overlap on the
  // remaining tokens. Flag as failed-recovery.
  const findings = [];
  let counter = 0;
  const bashById = new Map();
  for (let i = range[0]; i <= range[1]; i++) {
    for (const bc of turns[i].bashCommands) {
      if (bc.toolUseId) bashById.set(bc.toolUseId, { idx: i, command: bc.command });
    }
  }
  for (let i = range[0]; i <= range[1]; i++) {
    const t = turns[i];
    for (const tr of t.toolResults) {
      if (!tr.isError) continue;
      const origin = bashById.get(tr.toolUseId || '');
      if (!origin) continue;
      let aheadAssistant = 0;
      let aheadIdx = i + 1;
      while (aheadIdx <= range[1] && aheadAssistant < 3) {
        const at = turns[aheadIdx];
        if (at.role === 'assistant') {
          aheadAssistant += 1;
          for (const bc of at.bashCommands) {
            if (meaningfullySimilar(origin.command, bc.command)) {
              counter += 1;
              const nextFailed = nextResultFailed(turns, aheadIdx, bc.toolUseId, range);
              const severity = nextFailed ? 'high' : 'med';
              findings.push({
                id: `recover-${String(counter).padStart(3, '0')}`,
                category: 'failed-recovery',
                severity,
                evidence: {
                  transcriptLine: at.lineNo,
                  uuid: at.uuid,
                  timestamp: at.timestamp,
                  failedCommand: origin.command,
                  failedAtLine: turns[origin.idx].lineNo,
                  stderrPreview: tr.stderrPreview || tr.stdoutPreview,
                  retryCommand: bc.command,
                  retrySucceeded: !nextFailed,
                },
                ruleViolated: null,
                suggestedFix: {
                  kind: 'judgment-required',
                  text:
                    'Agent failed at a command then tried a similar one — ' +
                    "the skill didn't prevent the dead end. Add an anti-pattern " +
                    'callout to SKILL.md naming the failure shape so future ' +
                    'agents skip directly to the right approach.',
                },
              });
              break;
            }
          }
        }
        aheadIdx += 1;
      }
    }
  }
  return findings;
}

function meaningfullySimilar(a, b) {
  const aTokens = a.split(/\s+/).filter(Boolean);
  const bTokens = b.split(/\s+/).filter(Boolean);
  if (!aTokens.length || !bTokens.length) return false;
  if (aTokens[0] !== bTokens[0]) return false;
  const aRest = new Set(aTokens.slice(1));
  const bRest = new Set(bTokens.slice(1));
  if (aRest.size === 0 && bRest.size === 0) return true;
  const union = new Set([...aRest, ...bRest]);
  if (union.size === 0) return true;
  let inter = 0;
  for (const x of aRest) if (bRest.has(x)) inter += 1;
  return inter / union.size >= 0.5;
}

function nextResultFailed(turns, fromIdx, toolUseId, _range) {
  // The tool_result for an in-range Bash often lands on the very next user
  // turn, which by definition can be one index past range[1]. Don't bound by
  // range here — just walk ahead a few indices in the full turn list.
  if (!toolUseId) return false;
  const limit = Math.min(fromIdx + 5, turns.length);
  for (let j = fromIdx; j < limit; j++) {
    for (const tr of turns[j].toolResults) {
      if (tr.toolUseId === toolUseId) return tr.isError;
    }
  }
  return false;
}

function detectConfusion(turns, range, minDensity) {
  const findings = [];
  let counter = 0;
  // (assistantIdx, markerCount) pairs in the range
  const markerMap = new Map(); // assistantTurnIdx → markerCount
  for (let i = range[0]; i <= range[1]; i++) {
    const t = turns[i];
    if (t.role !== 'assistant' || !t.textContent) continue;
    CONFUSION_MARKER.lastIndex = 0;
    const matches = [...t.textContent.matchAll(CONFUSION_MARKER)];
    if (matches.length > 0) markerMap.set(i, matches.length);
  }
  if (markerMap.size === 0) return findings;
  // Build assistant-turn ordering and slide a 10-turn window
  const assistantIndices = [];
  for (let i = range[0]; i <= range[1]; i++) {
    if (turns[i].role === 'assistant') assistantIndices.push(i);
  }
  const windowSize = 10;
  const seenClusters = new Set();
  for (let aiPos = 0; aiPos < assistantIndices.length; aiPos++) {
    const wiIndices = assistantIndices.slice(aiPos, aiPos + windowSize);
    const clusterMarkerIndices = wiIndices.filter((i) => markerMap.has(i));
    if (clusterMarkerIndices.length >= minDensity) {
      const key = `${clusterMarkerIndices[0]}-${clusterMarkerIndices[clusterMarkerIndices.length - 1]}`;
      if (seenClusters.has(key)) continue;
      seenClusters.add(key);
      counter += 1;
      const sampleLines = clusterMarkerIndices.map((i) => turns[i].lineNo);
      const sampleMarkers = [];
      for (const i of clusterMarkerIndices) {
        CONFUSION_MARKER.lastIndex = 0;
        const m = turns[i].textContent.match(CONFUSION_MARKER);
        if (m && m[0]) sampleMarkers.push(m[0]);
      }
      findings.push({
        id: `confuse-${String(counter).padStart(3, '0')}`,
        category: 'confusion-marker',
        severity: 'low',
        evidence: {
          transcriptLine: turns[clusterMarkerIndices[0]].lineNo,
          uuid: turns[clusterMarkerIndices[0]].uuid,
          timestamp: turns[clusterMarkerIndices[0]].timestamp,
          nMarkersInWindow: clusterMarkerIndices.length,
          markerLines: sampleLines,
          markerSamples: sampleMarkers,
        },
        ruleViolated: null,
        suggestedFix: {
          kind: 'judgment-required',
          text:
            'Cluster of self-narration markers — agent may be floundering. ' +
            'Read the surrounding turns: if a SKILL.md addition would have ' +
            'shortcut the deliberation, propose it. If the markers are ' +
            'normal narration, drop.',
        },
      });
    }
  }
  return findings;
}

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

function findResultByToolUseId(turns, fromIdx, toolUseId, _range) {
  // Same reason as nextResultFailed — tool_results often land in the user
  // turn just past range[1]. Walk ahead in the full turn list.
  if (!toolUseId) return null;
  const limit = Math.min(fromIdx + 10, turns.length);
  for (let j = fromIdx; j < limit; j++) {
    for (const tr of turns[j].toolResults) {
      if (tr.toolUseId === toolUseId) return tr;
    }
  }
  return null;
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

// ──────────────────────────────────────────────────────────────────────
// Performance — clock time, token usage, cost estimate
//
// PRICING is in USD per 1M tokens for the active Claude family.
// Update when Anthropic publishes new pricing; keep verifiedDate current
// so future audits can flag a stale table.
// ──────────────────────────────────────────────────────────────────────

const PRICING = {
  verifiedDate: '2026-06-02',
  models: {
    // Opus 4.x all share the standard Opus rate. These figures are the public
    // list price; for a flat-fee plan (e.g. Claude Max) treat the dollar number
    // as a RELATIVE cost yardstick between skills, not a literal bill.
    'claude-opus-4-8': { input: 15.0, cacheWrite: 18.75, cacheRead: 1.5, output: 75.0 },
    'claude-opus-4-7': { input: 15.0, cacheWrite: 18.75, cacheRead: 1.5, output: 75.0 },
    'claude-opus-4-6': { input: 15.0, cacheWrite: 18.75, cacheRead: 1.5, output: 75.0 },
    'claude-sonnet-4-6': { input: 3.0, cacheWrite: 3.75, cacheRead: 0.3, output: 15.0 },
    'claude-sonnet-4-5': { input: 3.0, cacheWrite: 3.75, cacheRead: 0.3, output: 15.0 },
    'claude-haiku-4-5': { input: 1.0, cacheWrite: 1.25, cacheRead: 0.1, output: 5.0 },
  },
};

function modelKey(modelId) {
  // The JSONL stores model IDs like "claude-sonnet-4-6-20250929" with a
  // date suffix. Strip suffix to match PRICING keys.
  if (!modelId) return null;
  const m = modelId.match(/^(claude-(?:opus|sonnet|haiku)-\d+-\d+)/);
  return m ? m[1] : modelId;
}

function buildPerformance(turns, range) {
  let firstTs = null;
  let lastTs = null;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreate = 0;
  let nAssistantWithUsage = 0;
  const perModel = new Map(); // key → { input, output, cacheRead, cacheCreate }
  let costUSD = 0;
  let costUnknownTokens = 0;
  for (let i = range[0]; i <= range[1]; i++) {
    const t = turns[i];
    if (t.timestamp) {
      if (firstTs === null) firstTs = t.timestamp;
      lastTs = t.timestamp;
    }
    if (t.role !== 'assistant' || !t.usage) continue;
    nAssistantWithUsage += 1;
    const u = t.usage;
    const inp = u.input_tokens || 0;
    const out = u.output_tokens || 0;
    const cr = u.cache_read_input_tokens || 0;
    const cc = u.cache_creation_input_tokens || 0;
    totalInput += inp;
    totalOutput += out;
    totalCacheRead += cr;
    totalCacheCreate += cc;
    const key = modelKey(t.modelId);
    if (key) {
      const slot = perModel.get(key) || { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
      slot.input += inp;
      slot.output += out;
      slot.cacheRead += cr;
      slot.cacheCreate += cc;
      perModel.set(key, slot);
    }
    const price = PRICING.models[key];
    if (price) {
      costUSD +=
        (inp * price.input + out * price.output + cr * price.cacheRead + cc * price.cacheWrite) /
        1e6;
    } else {
      costUnknownTokens += inp + out + cr + cc;
    }
  }
  const durationSec =
    firstTs && lastTs
      ? Math.max(0, Math.round((Date.parse(lastTs) - Date.parse(firstTs)) / 1000))
      : 0;
  const totalContextIn = totalInput + totalCacheRead + totalCacheCreate;
  const cacheHitRatio =
    totalContextIn > 0 ? Math.round((totalCacheRead / totalContextIn) * 100) / 100 : 0;
  const perModelOut = {};
  for (const [k, v] of perModel) perModelOut[k] = v;
  return {
    durationSec,
    durationHuman: humanDuration(durationSec),
    nAssistantTurnsWithUsage: nAssistantWithUsage,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalCacheReadTokens: totalCacheRead,
    totalCacheCreationTokens: totalCacheCreate,
    cacheHitRatio,
    avgOutputTokensPerTurn:
      nAssistantWithUsage > 0 ? Math.round(totalOutput / nAssistantWithUsage) : 0,
    perModel: perModelOut,
    costEstimateUSD: Math.round(costUSD * 10000) / 10000,
    costUnknownTokens,
    pricingVerifiedDate: PRICING.verifiedDate,
  };
}

function humanDuration(sec) {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return mm ? `${h}h ${mm}m` : `${h}h`;
}

// ──────────────────────────────────────────────────────────────────────
// Permission-gap detection — repo-internal scripts that fall outside
// .claude/settings.json's allow list cause permission prompts. Surface
// each gap with a concrete allowlist line to add.
//
// Maps to .claude/skills/CLAUDE.md's "When you change a skill" rule —
// new helper scripts must land an allowlist entry in the same change set
// so the prompt doesn't fire mid-skill.
// ──────────────────────────────────────────────────────────────────────

// Repo-internal path prefixes — paths starting with these (or `./` +
// these) are project-owned and should never trigger a permission prompt.
const REPO_INTERNAL_PREFIXES = [
  'scripts/',
  '.claude/',
  'tests/',
  'source/',
  'components/',
  'locale/',
];

function loadAllowlist(cwd) {
  const out = [];
  for (const rel of ['.claude/settings.json', '.claude/settings.local.json']) {
    const fp = path.join(cwd, rel);
    if (!fs.existsSync(fp)) continue;
    try {
      const obj = JSON.parse(fs.readFileSync(fp, 'utf8'));
      const allow =
        obj.permissions && Array.isArray(obj.permissions.allow) ? obj.permissions.allow : [];
      for (const a of allow) if (typeof a === 'string') out.push(a);
    } catch {
      // Malformed settings file — skip rather than fail the audit.
    }
  }
  return out;
}

function bashIsAllowlisted(command, allowlist) {
  // Allowlist entries shaped `Bash(<pattern>)` where `<pattern>` may
  // contain `*` globs and `:*` trailing-arg wildcards. We translate to a
  // regex anchored at the start of `command` (Claude Code matches
  // prefixes for `:*`-style entries).
  for (const entry of allowlist) {
    const m = entry.match(/^Bash\((.+)\)$/);
    if (!m) continue;
    const raw = m[1];
    const trailingAny = raw.endsWith(':*');
    const core = trailingAny ? raw.slice(0, -2) : raw;
    const escaped = core.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const re = trailingAny
      ? new RegExp('^' + escaped + '(\\s|$)')
      : new RegExp('^' + escaped + '$');
    if (re.test(command.trim())) return true;
  }
  return false;
}

function repoInternalScriptTarget(command) {
  // Detect `node <path>` or direct `<path>` execution where `<path>` is
  // repo-internal. Returns the relative path, or null.
  const trimmed = command.trim();
  const nodeMatch = trimmed.match(/^node\s+(\S+)/);
  let target = null;
  if (nodeMatch) {
    target = nodeMatch[1];
  } else {
    const directMatch = trimmed.match(/^(\.\/|)(\S+\.(?:cjs|js|mjs|sh))(\s|$)/);
    if (directMatch) target = (directMatch[1] || '') + directMatch[2];
  }
  if (!target) return null;
  const stripped = target.replace(/^\.\//, '');
  for (const p of REPO_INTERNAL_PREFIXES) {
    if (stripped.startsWith(p)) return stripped;
  }
  return null;
}

function suggestAllowlistLine(command) {
  const trimmed = command.trim();
  const nodeMatch = trimmed.match(/^(node\s+\S+)/);
  if (nodeMatch) return `Bash(${nodeMatch[1]}:*)`;
  const directMatch = trimmed.match(/^(\.\/?\S+|\S+\.(?:cjs|js|mjs|sh))/);
  if (directMatch) return `Bash(${directMatch[1]}:*)`;
  return null;
}

function detectPermissionGap(turns, range, allowlist) {
  const findings = [];
  let counter = 0;
  const seenCommands = new Set();
  for (let i = range[0]; i <= range[1]; i++) {
    const t = turns[i];
    for (const bc of t.bashCommands) {
      const target = repoInternalScriptTarget(bc.command);
      if (!target) continue;
      if (bashIsAllowlisted(bc.command, allowlist)) continue;
      // De-dup on the suggested allowlist pattern — one finding per gap,
      // not one per invocation, since the fix is the same.
      const suggested = suggestAllowlistLine(bc.command);
      const dedupKey = suggested || bc.command;
      if (seenCommands.has(dedupKey)) continue;
      seenCommands.add(dedupKey);
      counter += 1;
      findings.push({
        id: `perm-gap-${String(counter).padStart(3, '0')}`,
        category: 'permission-gap',
        severity: 'med',
        evidence: {
          transcriptLine: t.lineNo,
          uuid: t.uuid,
          timestamp: t.timestamp,
          command: bc.command,
          repoTarget: target,
        },
        ruleViolated: {
          anchor: '.claude/skills/CLAUDE.md#when-you-change-a-skill',
          summary:
            'Repo-internal scripts should be allowlisted so the permission prompt ' +
            "doesn't fire mid-skill. Trust our own repo files.",
        },
        suggestedFix: {
          kind: 'mechanical',
          text:
            `Add ${suggested ? '`' + suggested + '`' : 'the corresponding allowlist line'} to ` +
            '`.claude/settings.json` under `permissions.allow`. The Bash invocation targets ' +
            `\`${target}\`, which is project-owned, but no existing allowlist entry covers it.`,
          allowlistLine: suggested,
        },
      });
    }
  }
  return findings;
}

// ──────────────────────────────────────────────────────────────────────
// Model-fit profile
// ──────────────────────────────────────────────────────────────────────

function buildModelFit(turns, range, confusionCount, failedRecoveryCount) {
  let nAssistant = 0;
  let nBash = 0;
  let nSubagent = 0;
  let nTodoWrite = 0;
  let nAskUser = 0;
  const editedFiles = new Set();
  let totalText = 0;
  for (let i = range[0]; i <= range[1]; i++) {
    const t = turns[i];
    if (t.role !== 'assistant') continue;
    nAssistant += 1;
    nBash += t.bashCommands.length;
    for (const tool of t.otherToolUses) {
      if (tool === 'Agent' || tool === 'Task') nSubagent += 1;
      else if (tool === 'TodoWrite') nTodoWrite += 1;
      else if (tool === 'AskUserQuestion') nAskUser += 1;
    }
    for (const et of t.editTargets) {
      if (et.filePath) editedFiles.add(et.filePath);
    }
    totalText += t.textContent.length;
  }
  const ratio = (nBash + nSubagent + nTodoWrite + nAskUser) / Math.max(1, nAssistant);
  return {
    nAssistantTurns: nAssistant,
    nBashCalls: nBash,
    nSubagentCalls: nSubagent,
    nTodoWriteCalls: nTodoWrite,
    nAskuserCalls: nAskUser,
    nDistinctFilesEdited: editedFiles.size,
    totalTextChars: totalText,
    nConfusionMarkers: confusionCount,
    nFailedRecoveries: failedRecoveryCount,
    toolToTextRatio: Math.round(ratio * 100) / 100,
    profileSummary: profileSummary({
      nAssistant,
      nSubagent,
      nTodoWrite,
      nAskUser,
      totalText,
      confusion: confusionCount,
      failed: failedRecoveryCount,
    }),
    judgmentRequired: true,
  };
}

function profileSummary({
  nAssistant,
  nSubagent,
  nTodoWrite,
  nAskUser,
  totalText,
  confusion,
  failed,
}) {
  const bits = [];
  if (nSubagent > 0) bits.push(`${nSubagent} sub-agent invocation(s)`);
  if (nTodoWrite > 0) bits.push(`${nTodoWrite} TodoWrite call(s)`);
  if (nAskUser > 0) bits.push(`${nAskUser} AskUserQuestion call(s)`);
  if (totalText > 4000) bits.push(`${totalText} chars of assistant text (verbose reasoning)`);
  if (confusion > 0) bits.push(`${confusion} confusion-marker cluster(s)`);
  if (failed > 0) bits.push(`${failed} failed-recovery event(s)`);
  if (bits.length === 0)
    bits.push(`clean mechanical run (${nAssistant} assistant turns, no reasoning-heavy tool use)`);
  return bits.join('; ');
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────

function main(argv) {
  const args = parseArgs(argv);
  const transcriptsDir = args.transcriptsDir || defaultTranscriptsDir();

  let transcriptPath;
  try {
    transcriptPath = locateTranscript(args.skill, args.session, transcriptsDir);
  } catch (e) {
    console.error(`error: ${e.message}`);
    return 2;
  }

  let turns;
  try {
    turns = parseTranscript(transcriptPath);
  } catch (e) {
    console.error(`error: ${e.message}`);
    return 1;
  }

  const invocations = findInvocations(turns, args.skill);
  if (invocations.length === 0) {
    const skills = new Set(turns.map((t) => t.attributionSkill).filter(Boolean));
    let msg = `error: session ${path.basename(transcriptPath)} contains no turns with attributionSkill='${args.skill}'.`;
    if (skills.size > 0) msg += ` Available skills: ${[...skills].sort().join(', ')}`;
    else msg += ' No attributionSkill turns at all.';
    console.error(msg);
    return 2;
  }

  const ranges = args.invocation === 'latest' ? [invocations[invocations.length - 1]] : invocations;

  const allowlist = loadAllowlist(process.cwd());

  const allFindings = [];
  const fits = [];
  const performance = [];
  const invocationMeta = [];

  for (const rng of ranges) {
    const repeatedFindings = detectRepeatedCommand(turns, rng, args.repeatedMin);
    const recoverFindings = detectFailedRecovery(turns, rng);
    const confuseFindings = detectConfusion(turns, rng, args.confusionMinDensity);
    const lintSpamFindings = detectLintSpam(turns, rng, 10);
    const changelogFindings = detectChangelogEditAttempt(turns, rng);
    const tasksFindings = detectTasksLeakage(turns, rng);
    const testClaimFindings = detectTestClaimWithoutEvidence(turns, rng);
    const hwClaimFindings = detectHardwareClaimMismatch(turns, rng);
    const permGapFindings = detectPermissionGap(turns, rng, allowlist);
    const rngFindings = [
      ...repeatedFindings,
      ...recoverFindings,
      ...confuseFindings,
      ...lintSpamFindings,
      ...changelogFindings,
      ...tasksFindings,
      ...testClaimFindings,
      ...hwClaimFindings,
      ...permGapFindings,
    ];
    allFindings.push(...rngFindings);
    let nAssistant = 0;
    for (let i = rng[0]; i <= rng[1]; i++) if (turns[i].role === 'assistant') nAssistant += 1;
    invocationMeta.push({
      startUuid: turns[rng[0]].uuid,
      endUuid: turns[rng[1]].uuid,
      startTs: turns[rng[0]].timestamp,
      endTs: turns[rng[1]].timestamp,
      startLine: turns[rng[0]].lineNo,
      endLine: turns[rng[1]].lineNo,
      nAssistantTurns: nAssistant,
    });
    fits.push(buildModelFit(turns, rng, confuseFindings.length, recoverFindings.length));
    performance.push(buildPerformance(turns, rng));
  }

  const byCategory = {};
  const bySeverity = {};
  for (const f of allFindings) {
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  }

  const output = {
    skill: args.skill,
    session: path.basename(transcriptPath, '.jsonl'),
    transcriptPath,
    invocationMode: args.invocation,
    invocations: invocationMeta,
    summary: {
      totalFindings: allFindings.length,
      byCategory,
      bySeverity,
    },
    performance,
    modelFit: fits,
    findings: allFindings,
  };
  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv));
}

module.exports = {
  parseTranscript,
  findInvocations,
  detectRepeatedCommand,
  detectFailedRecovery,
  detectConfusion,
  detectLintSpam,
  detectChangelogEditAttempt,
  detectTasksLeakage,
  detectTestClaimWithoutEvidence,
  detectHardwareClaimMismatch,
  detectPermissionGap,
  buildModelFit,
  buildPerformance,
  loadAllowlist,
  defaultTranscriptsDir,
  locateTranscript,
  // Internals exported for testability
  _internals: {
    normalizeCommand,
    meaningfullySimilar,
    bashIsAllowlisted,
    repoInternalScriptTarget,
    suggestAllowlistLine,
    humanDuration,
    modelKey,
    PRICING,
    LINT_SHAPE,
    TEST_SHAPE,
    TEST_CLAIM,
    CHANGELOG_PATH,
    TASKS_LEAKAGE,
    CONFUSION_MARKER,
    REPO_INTERNAL_PREFIXES,
  },
};

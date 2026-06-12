// Extract audit signals from a Claude Code session transcript for the
// /audit-skill flow.
//
// Reads a JSONL transcript at
// `~/.claude/projects/<sanitized-cwd>/<session>.jsonl`,
// filters to turns produced by a named skill (via the `attributionSkill`
// field), runs the repo-agnostic detectors over the Bash + text content,
// and emits a structured JSON document for the /audit-skill SKILL.md prose
// to classify with judgment.
//
// Output covers the mechanizable dimensions of skill-evaluation.md; friction
// is one of them:
//   1. Behavioral / action-trace (`behavioralTrace`) — the ordered sequence of
//      effects the run produced (tool calls, edits, sub-agent spawns, in
//      transcript order) + a per-path file-touch summary + tool/bash-verb
//      histograms. The backbone of /verify-skill's two-version differential.
//   2. Friction findings (the detectors below)
//   3. Performance — clock time, token usage per model, cache-hit ratio,
//      cost estimate
//   4. Permission gaps — Bash invocations targeting repo-internal scripts
//      that aren't covered by .claude/settings.json's allow list
//   5. Model-fit profile — sub-agent / TodoWrite / AskUserQuestion / text
//      density, used to recommend opus / sonnet / haiku
//
// Output accuracy — the dimension no extractor mechanizes — is left to the
// auditor, who reads the audited skill's actual user-visible output and
// judges it. The SKILL.md prose owns that step. So too the *labelling* of the
// action-trace into skill-specific concepts (gates / routing / stop-points):
// the extractor emits the raw trace, the model interprets it.
//
// Detectors (all repo-agnostic in this portable core):
//     repeated-command       same Bash command in two consecutive tool_use
//                            calls
//     failed-recovery        is_error: true tool_result followed within 3
//                            turns by a meaningfully-similar command
//     confusion-marker       cluster of >=N self-narration markers in a
//                            10-turn window ("let me check", "hmm", etc.)
//     permission-gap         Bash invocation targeting a repo-internal
//                            script (one of REPO_INTERNAL_PREFIXES, e.g.
//                            scripts/, tests/, .claude/) that is NOT covered
//                            by .claude/settings.json's allow list. Convention:
//                            trust your own repo files — they shouldn't fire a
//                            permission prompt mid-skill.
//
// Consumer rule detectors (the per-consumer layer that maps your repo's
// CLAUDE.md / AGENTS.md hard rules to mechanical findings) plug into the
// CONSUMER_RULE_DETECTORS seam near the bottom of this file. The portable
// core ships with that array EMPTY — a consumer with no repo-specific rule
// detectors runs the friction + perf + model-fit + accuracy audit alone.
// See the audit-skill SKILL.md (Step 3e) and rules/skill-design.md.
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
//   --session <id>                    audit exactly this session file
//   --last N                          scan the N most-recent sessions
//                                     containing the skill (cross-session)
//   --all                             scan EVERY session containing the skill
//   --transcripts-dir <path>          override auto-derive
//   --invocation latest|all           within each session, which invocation
//                                     range(s) (default: latest)
//   --repeated-min N                  default: 2
//   --confusion-min-density N         default: 3
//   --help / -h                       print usage and exit 0
//
// Two orthogonal selection axes:
//   sessionMode  (--last/--all)  → which transcript FILES (default: 1, latest)
//   invocation   (--invocation)  → within each file, which ranges
// They compose: `--last 5` keeps the per-file `--invocation` policy across the
// 5 newest sessions. `--session` pins one file and ignores --last/--all.
// ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    skill: null,
    session: null,
    transcriptsDir: null,
    invocation: 'latest',
    sessionMode: 'latest', // 'latest' | 'last' | 'all'
    lastN: 1,
    repeatedMin: 2,
    confusionMinDensity: 3,
    wholeTranscript: false, // treat the whole --session file as one run (no attributionSkill filter)
  };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    } else if (a === '--session') {
      args.session = rest[++i];
    } else if (a === '--last') {
      const n = parseInt(rest[++i], 10);
      if (!Number.isInteger(n) || n < 1) {
        console.error('error: --last requires a positive integer');
        process.exit(2);
      }
      args.sessionMode = 'last';
      args.lastN = n;
    } else if (a === '--all') {
      args.sessionMode = 'all';
    } else if (a === '--whole-transcript') {
      args.wholeTranscript = true;
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
  if (args.wholeTranscript && !args.session) {
    console.error(
      'error: --whole-transcript requires --session (point it at one isolated transcript)',
    );
    process.exit(2);
  }
  return args;
}

function printUsage() {
  console.error('Usage: extract-friction.cjs <skill> [options]');
  console.error('Options:');
  console.error(
    '  --session <id>                  Audit exactly this session (default: most-recent containing skill)',
  );
  console.error(
    '  --last N                        Scan the N most-recent sessions containing the skill',
  );
  console.error('  --all                           Scan every session containing the skill');
  console.error(
    '  --whole-transcript              Treat the whole --session file as one run (no attributionSkill filter; for an isolated sub-agent transcript)',
  );
  console.error('  --transcripts-dir <path>        Override auto-derived dir');
  console.error(
    '  --invocation latest|all         Per-session, which invocation range(s) (default: latest)',
  );
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
  // The observed Claude Code convention KEEPS the leading `-`:
  //   /home/you/PROJECTS/myrepo
  //   → -home-you-PROJECTS-myrepo
  const sanitized = cwd.replace(/\//g, '-');
  return path.join(os.homedir(), '.claude', 'projects', sanitized);
}

// ──────────────────────────────────────────────────────────────────────
// Consumer (JellyRock) bash/edit pattern matchers — feed the repo-specific
// rule detectors registered in CONSUMER_RULE_DETECTORS below.
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

// ──────────────────────────────────────────────────────────────────────
// Confusion markers — cluster detection
// ──────────────────────────────────────────────────────────────────────

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
//     editTargets:  [{ tool, filePath, newContent, oldContent }],  // Edit/Write/MultiEdit/NotebookEdit
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
  // Ordered tool_use sequence for THIS turn, in transcript content order. The
  // flat arrays above (bashCommands / editTargets / otherToolUses) lose the
  // relative order between a Bash call and an Edit call within one turn;
  // `actions` preserves it. This is the backbone of dimension 1 (behavioral /
  // action-trace) — see skill-evaluation.md and buildBehavioralTrace.
  const actions = [];
  if (content) {
    for (const c of content) {
      if (!c || typeof c !== 'object') continue;
      const ctype = c.type;
      if (ctype === 'tool_use') {
        const name = c.name || '';
        if (name === 'Bash') {
          const inp = c.input || {};
          const command = typeof inp.command === 'string' ? inp.command : '';
          const runInBackground = Boolean(inp.run_in_background);
          bashCommands.push({ toolUseId: c.id || null, command, runInBackground });
          actions.push({ type: 'bash', command, runInBackground });
        } else if (
          name === 'Edit' ||
          name === 'Write' ||
          name === 'MultiEdit' ||
          name === 'NotebookEdit'
        ) {
          const inp = c.input || {};
          const filePath = typeof inp.file_path === 'string' ? inp.file_path : '';
          editTargets.push({
            tool: name,
            filePath,
            // Content captured so consumer rule detectors (e.g. a raw-IP or
            // immutable-doc-edit detector) can inspect the *text* being
            // introduced/removed, not just the
            // path. `newContent` = text written into the file; `oldContent` = text
            // removed (Edit/MultiEdit only). Shapes differ per tool:
            //   Write        → content (new file body); no oldContent
            //   Edit         → new_string / old_string
            //   MultiEdit    → all edits' new_string / old_string concatenated
            //   NotebookEdit → new_source (new cell body); no oldContent
            ...editContent(name, inp),
          });
          otherToolUses.push(name);
          // op: Edit/MultiEdit modify an existing file in place; Write/NotebookEdit
          // write a full body (a new file, or an overwrite — indistinguishable
          // from the transcript, so we don't over-claim "create").
          actions.push({
            type: 'edit',
            tool: name,
            filePath,
            op: name === 'Edit' || name === 'MultiEdit' ? 'modify' : 'write',
          });
        } else {
          otherToolUses.push(name);
          actions.push({ type: 'tool', name });
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
    actions,
  };
}

function preview(text, limit = 200) {
  if (typeof text !== 'string') return '';
  if (text.length <= limit) return text;
  return text.slice(0, limit) + '…';
}

function editContent(tool, inp) {
  // Normalize the four edit-tool input shapes to { newContent, oldContent }.
  // Kept full-length (not previewed): detectors substring-match against it.
  const str = (v) => (typeof v === 'string' ? v : '');
  if (tool === 'Write') {
    return { newContent: str(inp.content), oldContent: '' };
  }
  if (tool === 'NotebookEdit') {
    return { newContent: str(inp.new_source), oldContent: '' };
  }
  if (tool === 'MultiEdit') {
    const edits = Array.isArray(inp.edits) ? inp.edits : [];
    const news = [];
    const olds = [];
    for (const e of edits) {
      if (e && typeof e === 'object') {
        news.push(str(e.new_string));
        olds.push(str(e.old_string));
      }
    }
    return { newContent: news.join('\n'), oldContent: olds.join('\n') };
  }
  // Edit
  return { newContent: str(inp.new_string), oldContent: str(inp.old_string) };
}

// ──────────────────────────────────────────────────────────────────────
// Locate transcript + invocation ranges
// ──────────────────────────────────────────────────────────────────────

function locateTranscripts(skill, sessionId, transcriptsDir, sessionMode = 'latest', lastN = 1) {
  if (!fs.existsSync(transcriptsDir) || !fs.statSync(transcriptsDir).isDirectory()) {
    throw new Error(`transcripts dir not found: ${transcriptsDir}`);
  }
  if (sessionId) {
    // Explicit session pin — ignore sessionMode/lastN, audit exactly this file.
    const sid = sessionId.endsWith('.jsonl') ? sessionId.slice(0, -'.jsonl'.length) : sessionId;
    const candidate = path.join(transcriptsDir, `${sid}.jsonl`);
    if (!fs.existsSync(candidate)) {
      throw new Error(`session file not found: ${candidate}`);
    }
    return [candidate];
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
  matches.sort((a, b) => b.mtime - a.mtime); // newest first
  let count;
  if (sessionMode === 'all') count = matches.length;
  else if (sessionMode === 'last') count = Math.min(lastN, matches.length);
  else count = 1; // 'latest' — single most-recent (backward-compatible default)
  return matches.slice(0, count).map((m) => m.path);
}

// Backward-compatible single-file resolver (kept for the exported contract +
// any caller wanting just the most-recent transcript).
function locateTranscript(skill, sessionId, transcriptsDir) {
  return locateTranscripts(skill, sessionId, transcriptsDir, 'latest', 1)[0];
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
// Sticky-attribution over-capture correction
//
// The harness stamps `attributionSkill` with the LAST-invoked skill and keeps
// it set on every subsequent autonomous assistant turn until either (a) the
// agent yields to a human (next human prompt resets attribution) or (b) a
// DIFFERENT skill is invoked. It does NOT clear when the skill's prose steps
// finish. So `findInvocations`' range = "every turn the agent produced under
// the skill's invocation WITHOUT yielding" — which for an INTERACTIVE run of a
// load/read-only skill (resume-project, catchup) equals the skill's own steps
// (the agent loads context, presents, and yields), but for an AUTONOMOUS run
// (the agent flows straight from the load into project work + /end-session
// under one prompt) over-captures all that downstream work and mis-attributes
// it to the load skill — inflating perf/cost AND manufacturing false
// rule-violations (a consumer rule-violation from later project work pinned to
// a read-only skill that could not have run it).
//
// Correction (only for skills that DECLARE `audit-span: read-only` in their
// SKILL.md frontmatter — i.e. skills whose own steps provably never mutate
// tracked state): bound the effective range at the FIRST downstream mutation
// (an Edit/Write/MultiEdit/NotebookEdit, or a deploy/commit bash). That is the
// provable point where the read-only skill's execution ended and real work
// began. Skills that legitimately mutate as their own job (focus writes a
// plan, start-project scaffolds a PLAN, deploy-service deploys) do NOT declare
// read-only and are never bounded — their first mutation IS their work.
//
// Evidence (resume-project across 39 sessions, 2026-05-30): every clean
// interactive load was ≤32 assistant turns with ZERO mutations; every
// over-captured autonomous span had its first edit/deploy at offset 33-164,
// targeting unmistakable downstream work (a config file, an ADR, even this
// extractor). Bounding at first mutation is zero-regression on the clean case
// (no mutation → no cut) and excludes the false rule-violations.
// ──────────────────────────────────────────────────────────────────────

// Clean interactive read-only loads observed at ≤32 assistant turns across 39
// resume-project sessions (2026-05-30). A read-only span exceeding this ceiling
// — even after a first-mutation cut — likely bled into autonomous downstream
// work, so we FLAG it (overCaptureSuspected) rather than silently trust it.
// This is a soft diagnostic only; it never truncates.
const READONLY_LOAD_TURN_CEILING = 35;

// Mutating commit/deploy bash — the "work landed" signal that marks the end of
// a read-only skill's own steps. `git commit` / `git push` is the universal
// portable signal; read-only subcommands (git log/status/diff) are excluded so
// a read-only skill's own state-check bash never triggers a spurious cut.
// CONSUMER SEAM: if your repo's skills deploy/apply infrastructure, add those
// mutating patterns here (e.g. a deploy wrapper, `ansible-playbook`,
// `docker[-\\s]compose (up|down|…)`, `systemctl (start|stop|…)`, `docker run`)
// so the first-run cut lands at the right point — read-only state-checks
// (docker ps, compose ps) must stay excluded.
const MUTATION_DEPLOY_BASH = new RegExp(
  '\\bgit\\s+(?:commit|push)\\b',
  // + '|\\bansible-playbook\\b|\\bsystemctl\\s+(?:start|stop|restart)\\b|...'
  'i',
);

// Return the first downstream mutation within `range` (the turn that marks the
// end of a read-only skill's own steps), or null. An Edit/Write/etc. tool use
// or a deploy/commit bash both qualify. Only assistant turns carry these.
function firstDownstreamMutation(turns, range) {
  for (let i = range[0]; i <= range[1]; i++) {
    const t = turns[i];
    if (t.role !== 'assistant') continue;
    if (t.editTargets && t.editTargets.length > 0) {
      const e = t.editTargets[0];
      return {
        idx: i,
        kind: `edit (${e.tool} ${e.filePath ? e.filePath.split('/').pop() : ''})`.trim(),
      };
    }
    for (const bc of t.bashCommands) {
      if (MUTATION_DEPLOY_BASH.test(bc.command || '')) {
        return { idx: i, kind: 'deploy/commit bash' };
      }
    }
  }
  return null;
}

function countAssistantTurns(turns, range) {
  let n = 0;
  for (let i = range[0]; i <= range[1]; i++) if (turns[i].role === 'assistant') n += 1;
  return n;
}

// Read the audited skill's own SKILL.md frontmatter for an `audit-span:` value.
// Returns the trimmed value (e.g. 'read-only') or null when absent/unreadable.
// The extractor is invoked as `<skill>` from the repo root, so the SKILL.md is
// deterministically at .claude/skills/<skill>/SKILL.md.
function readSkillAuditSpan(skill, cwd) {
  const fp = path.join(cwd, '.claude', 'skills', skill, 'SKILL.md');
  let text;
  try {
    text = fs.readFileSync(fp, 'utf8');
  } catch {
    return null;
  }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const line = m[1].split(/\r?\n/).find((l) => /^audit-span\s*:/.test(l));
  if (!line) return null;
  const val = line
    .replace(/^audit-span\s*:/, '')
    .trim()
    .replace(/^["']|["']$/g, '');
  return val || null;
}

// Given a raw attribution range and whether the skill is read-only, compute the
// effective (core) range detectors/perf should run on, plus the over-capture
// diagnostic. Non-read-only skills are returned unchanged (full backward-compat).
function computeEffectiveRange(turns, range, isReadOnly) {
  const fullAssistant = countAssistantTurns(turns, range);
  if (!isReadOnly) {
    return {
      effRange: range,
      fullAssistant,
      coreAssistant: fullAssistant,
      firstMutation: null,
      overCaptureSuspected: false,
      overCaptureReason: null,
    };
  }
  const firstMutation = firstDownstreamMutation(turns, range);
  let effRange = range;
  let overCaptureSuspected = false;
  const reasonParts = [];
  // Bound at first mutation (exclusive) when it lands after the span start.
  if (firstMutation && firstMutation.idx > range[0]) {
    effRange = [range[0], firstMutation.idx - 1];
    overCaptureSuspected = true;
    reasonParts.push(
      `downstream ${firstMutation.kind} at turn-offset ${firstMutation.idx - range[0]}; ` +
        'turns at/after it are downstream work, not this read-only skill — range bounded there',
    );
  }
  const coreAssistant = countAssistantTurns(turns, effRange);
  if (coreAssistant > READONLY_LOAD_TURN_CEILING) {
    overCaptureSuspected = true;
    reasonParts.push(
      `${firstMutation && firstMutation.idx > range[0] ? 'bounded core is' : 'read-only span is'} ` +
        `${coreAssistant} assistant turns (> ${READONLY_LOAD_TURN_CEILING}); ` +
        'likely an autonomous continuation — treat perf/cost as session-level, not skill-level, ' +
        'and re-confirm each rule-violation against its actual turn',
    );
  }
  return {
    effRange,
    fullAssistant,
    coreAssistant,
    firstMutation,
    overCaptureSuspected,
    overCaptureReason: reasonParts.length ? reasonParts.join('; ') : null,
  };
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

function findResultByToolUseId(turns, fromIdx, toolUseId, _range) {
  // tool_results often land in the user turn just past range[1]. Walk
  // ahead in the full turn list.
  if (!toolUseId) return null;
  const limit = Math.min(fromIdx + 10, turns.length);
  for (let j = fromIdx; j < limit; j++) {
    for (const tr of turns[j].toolResults) {
      if (tr.toolUseId === toolUseId) return tr;
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Performance — clock time, token usage, cost estimate
//
// PRICING is in USD per 1M tokens for the active Claude family.
// Update when Anthropic publishes new pricing; keep verifiedDate current
// so future audits can flag a stale table.
// ──────────────────────────────────────────────────────────────────────

const PRICING = {
  verifiedDate: '2026-05-30',
  models: {
    // claude-opus-4-8 uses the standard Opus 4.x rate (flat across 4.6/4.7/4.8:
    // $15 in / $75 out). CAVEAT: the 1M-context tier may carry a premium above
    // 200k input tokens that this flat table does NOT model — verify against
    // Anthropic pricing if a 1M-context opus run shows a surprising cost.
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
  // date suffix, or bare like "claude-opus-4-7". Strip any suffix to match
  // PRICING keys.
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
// Convention: your own repo files should be trusted, not permission-prompted.
// A new helper script should land an allowlist entry in committed
// .claude/settings.json in the same change set so the prompt doesn't fire
// mid-skill.
// ──────────────────────────────────────────────────────────────────────

// Repo-internal path prefixes — paths starting with these (or `./` +
// these) are project-owned and should never trigger a permission prompt.
// The defaults below are near-universal source dirs; CONSUMER SEAM: add your
// repo's own top-level dirs (e.g. `ansible/`, `compose/`, `src/`, `lib/`).
const REPO_INTERNAL_PREFIXES = [
  '.claude/',
  'scripts/',
  'tests/',
  'hooks/',
  // consumer (JellyRock): top-level source dirs
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
          anchor: 'CLAUDE.md#hard-rules',
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
// Consumer rule detectors (per-consumer seam)
//
// The portable detectors above flag *process* friction (repeated-command,
// failed-recovery, confusion-marker, permission-gap). THIS section is the
// per-consumer layer: one detector per hard rule in your repo's CLAUDE.md /
// AGENTS.md that you want mechanically caught. Each detector is a function
//   (turns, range, cwd) => findings[]
// where every finding carries a populated `ruleViolated` { anchor, summary }
// and `suggestedFix.kind: 'rule-violation'` — the default reading is "this
// broke a documented rule" (the auditor still confirms; a grep'd or quoted
// string is not an invocation, so tune detectors to favour recall).
//
// Register your detectors in CONSUMER_RULE_DETECTORS below. The array is EMPTY
// in this portable template: a consumer with no repo-specific rule detectors
// runs the portable friction + perf + model-fit + accuracy audit alone, and
// the extractor is fully runnable as-is. See the audit-skill SKILL.md
// (Step 3e) and rules/skill-design.md for how to author one.
//
// Example shape (copy, rename, adapt — maps one CLAUDE.md hard rule to a
// finding; this is the same shape a reference consumer uses for its raw-IP /
// compose-wrapper / immutable-doc / failed-deploy-claim detectors):
//
//   function detectExampleRuleViolation(turns, range, _cwd) {
//     const findings = [];
//     let counter = 0;
//     for (let i = range[0]; i <= range[1]; i++) {
//       const t = turns[i];
//       for (const bc of t.bashCommands) {
//         if (!/<your-rule-violation-pattern>/i.test(bc.command || '')) continue;
//         counter += 1;
//         findings.push({
//           id: `example-${String(counter).padStart(3, '0')}`,
//           category: 'example-rule',
//           severity: 'high',
//           evidence: {
//             transcriptLine: t.lineNo,
//             uuid: t.uuid,
//             timestamp: t.timestamp,
//             command: bc.command,
//           },
//           ruleViolated: {
//             anchor: 'CLAUDE.md#hard-rules',
//             summary: '<the rule this violates, in one sentence>',
//           },
//           suggestedFix: {
//             kind: 'rule-violation',
//             text: '<how the audited skill should change to prevent it>',
//           },
//         });
//       }
//     }
//     return findings;
//   }
//
// Each registered entry is invoked as `detector(turns, effRange, cwd)` and its
// returned findings are merged with the portable friction findings.

// ── JellyRock repo-specific rule detectors ─────────────────────────────
// Each maps one CLAUDE.md hard rule to a finding (with `ruleViolated` +
// `suggestedFix`). They run on the same projected turns as the portable
// detectors; `findResultByToolUseId` / `preview` are the shared helpers above.

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

const CONSUMER_RULE_DETECTORS = [
  (turns, range) => detectLintSpam(turns, range, 10),
  detectChangelogEditAttempt,
  detectTasksLeakage,
  detectTestClaimWithoutEvidence,
  detectHardwareClaimMismatch,
];

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
// Dimension 1 — behavioral / action-trace (skill-evaluation.md §1)
//
// Emits the MECHANICAL backbone of "what the run actually did": the ordered
// sequence of effects (tool calls, edits, sub-agent spawns, in transcript
// order), a per-path file-touch summary, and histograms of tools + bash verbs.
// This is the dimension /verify-skill diffs across two versions of a skill to
// answer "did behavior drift outside the intended change?".
//
// What this DELIBERATELY does NOT do: label the trace into skill-specific
// concepts — "this step is a gate", "this is the routing branch it took",
// "it honored the human stop-point". Those are judgment (the concepts are
// per-skill, the extractor can't name them generically), so they're the
// auditor/judge's job — hence judgmentRequired: true. The extractor gives
// the deterministic trace; the model reads it against the skill's declared
// behavior. (cost-efficiency.md: mechanics in the script, judgment in the model.)
// ──────────────────────────────────────────────────────────────────────

// Commands whose first ARG is a meaningful subcommand — include it in the
// normalized head so the trace distinguishes `git status` from `git commit`
// (a real behavioral difference) without drowning in full command strings
// (which vary run-to-run and would make every differential look "changed").
const SUBCOMMAND_TOOLS = new Set([
  'git',
  'docker',
  'docker-compose',
  'npm',
  'pnpm',
  'yarn',
  'gh',
  'cargo',
  'kubectl',
  'systemctl',
  'ansible-playbook',
  'ansible',
  'pip',
  'pip3',
  'apt',
  'apt-get',
  'make',
]);

function bashCommandHead(command) {
  // Normalize a bash command to a stable "verb" for the action trace:
  //   "git status --short"            → "git status"
  //   "FOO=1 ~/bin/deploy.sh --now"   → "deploy.sh"
  //   "node scripts/x.cjs audit"      → "node"
  // Strips leading VAR=val env assignments and any path prefix on the binary.
  const firstLine = String(command || '')
    .trim()
    .split('\n')[0]
    .trim();
  if (!firstLine) return '';
  const tokens = firstLine.split(/\s+/);
  let idx = 0;
  while (idx < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[idx])) idx++;
  const head = tokens[idx] || '';
  const base = head.replace(/^.*\//, ''); // /usr/bin/foo → foo, ~/bin/x.sh → x.sh
  const next = tokens[idx + 1];
  if (SUBCOMMAND_TOOLS.has(base) && next && !next.startsWith('-')) {
    return `${base} ${next}`;
  }
  return base;
}

function buildBehavioralTrace(turns, range) {
  const actionTrace = [];
  const filesTouched = new Map(); // path → Set of ops ('modify' | 'write')
  const toolHistogram = {}; // tool label → count
  const bashVerbs = {}; // normalized bash head → count
  let nSubagentCalls = 0;
  let nErrorResults = 0;

  for (let i = range[0]; i <= range[1]; i++) {
    const t = turns[i];
    const offset = i - range[0];
    if (t.role === 'assistant') {
      for (const a of t.actions) {
        if (a.type === 'bash') {
          toolHistogram.Bash = (toolHistogram.Bash || 0) + 1;
          const head = bashCommandHead(a.command);
          if (head) bashVerbs[head] = (bashVerbs[head] || 0) + 1;
          const step = { turn: offset, line: t.lineNo, type: 'bash', detail: head };
          if (a.runInBackground) step.background = true;
          actionTrace.push(step);
        } else if (a.type === 'edit') {
          toolHistogram[a.tool] = (toolHistogram[a.tool] || 0) + 1;
          if (a.filePath) {
            const ops = filesTouched.get(a.filePath) || new Set();
            ops.add(a.op);
            filesTouched.set(a.filePath, ops);
          }
          actionTrace.push({
            turn: offset,
            line: t.lineNo,
            type: 'edit',
            tool: a.tool,
            op: a.op,
            detail: a.filePath,
          });
        } else {
          // other tool_use (Agent/Task/TodoWrite/AskUserQuestion/Read/Grep/…)
          toolHistogram[a.name] = (toolHistogram[a.name] || 0) + 1;
          if (a.name === 'Agent' || a.name === 'Task') nSubagentCalls += 1;
          actionTrace.push({ turn: offset, line: t.lineNo, type: 'tool', detail: a.name });
        }
      }
    }
    // Error tool_results are a behavioral signal (a run that hit errors did
    // something different from one that didn't), independent of role.
    for (const tr of t.toolResults) {
      if (tr.isError) nErrorResults += 1;
    }
  }

  const filesTouchedOut = {};
  for (const p of [...filesTouched.keys()].sort()) {
    filesTouchedOut[p] = [...filesTouched.get(p)].sort();
  }

  return {
    nActions: actionTrace.length,
    nFilesTouched: Object.keys(filesTouchedOut).length,
    nSubagentCalls,
    nErrorResults,
    filesTouched: filesTouchedOut,
    toolHistogram,
    bashVerbs,
    actionTrace,
    // The trace itself is mechanical; turning it into "gates run / stop-points
    // honored / routing taken / scope held" is the auditor's judgment.
    judgmentRequired: true,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Cross-session aggregate rollup
//
// Only meaningful when >1 invocation was selected (--last N / --all, or a
// single session with multiple invocations under --invocation all). Converts
// N raw per-invocation blocks into the synthesis the SKILL.md prose needs to
// make a STRONG model-fit / friction call: median + p90 of duration, total +
// median cost, and — the load-bearing signal — a recurring-friction tally
// (a category seen across >=2 sessions is a real pattern, not a one-off).
// Computing this mechanically here keeps the opus layer from hand-tallying N
// blocks (which is exactly the expensive token profile this skill flags).
// ──────────────────────────────────────────────────────────────────────

function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function percentile(nums, p) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  // Nearest-rank: index = ceil(p/100 * N) - 1, clamped.
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

function sum(nums) {
  return nums.reduce((a, b) => a + b, 0);
}

function round4(n) {
  return Math.round(n * 10000) / 10000;
}

function buildAggregate(perfList, fitList, findingsList, invMeta) {
  const nInvocations = perfList.length;
  const nSessions = new Set(invMeta.map((m) => m.session)).size;
  const durations = perfList.map((p) => p.durationSec);
  const costs = perfList.map((p) => p.costEstimateUSD);
  const outTokens = perfList.map((p) => p.totalOutputTokens);
  const cacheRatios = perfList.map((p) => p.cacheHitRatio);
  const avgPerTurn = fitList.length ? perfList.map((p) => p.avgOutputTokensPerTurn) : [];

  // Recurring-friction tally: category → how many distinct SESSIONS it appears
  // in. >=2 sessions = recurring (a real pattern worth a SKILL.md fix); 1 = a
  // one-off worth noting but not over-weighting.
  const catSessions = new Map(); // category → Set(session)
  const catTotals = new Map(); // category → total occurrences
  for (const f of findingsList) {
    catTotals.set(f.category, (catTotals.get(f.category) || 0) + 1);
    if (!catSessions.has(f.category)) catSessions.set(f.category, new Set());
    catSessions.get(f.category).add(f.session);
  }
  const recurringFriction = {};
  for (const [cat, sessSet] of catSessions) {
    recurringFriction[cat] = {
      totalOccurrences: catTotals.get(cat),
      inSessions: sessSet.size,
      recurring: sessSet.size >= 2,
    };
  }

  const modelsObserved = new Set();
  for (const p of perfList) {
    for (const k of Object.keys(p.perModel || {})) modelsObserved.add(k);
  }

  // How many scanned invocations are flagged as over-captured (read-only skills
  // whose range bled into autonomous downstream work). When this is non-zero,
  // the duration/cost/recurringFriction rollups below are inflated/noisy for
  // those invocations — the SKILL.md prose tells the auditor to discount them.
  const nOverCaptureSuspected = invMeta.filter((m) => m.overCaptureSuspected).length;

  return {
    nSessions,
    nInvocations,
    nOverCaptureSuspected,
    durationSec: {
      median: Math.round(median(durations)),
      p90: percentile(durations, 90),
      max: durations.length ? Math.max(...durations) : 0,
    },
    costEstimateUSD: {
      total: round4(sum(costs)),
      median: round4(median(costs)),
    },
    totalOutputTokens: {
      total: sum(outTokens),
      median: Math.round(median(outTokens)),
    },
    avgOutputTokensPerTurn: {
      median: avgPerTurn.length ? Math.round(median(avgPerTurn)) : 0,
    },
    cacheHitRatio: {
      min: cacheRatios.length ? Math.min(...cacheRatios) : 0,
      median: Math.round(median(cacheRatios) * 100) / 100,
    },
    recurringFriction,
    nFindingsTotal: findingsList.length,
    modelsObserved: [...modelsObserved],
  };
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────

function main(argv) {
  const args = parseArgs(argv);
  const transcriptsDir = args.transcriptsDir || defaultTranscriptsDir();

  let transcriptPaths;
  try {
    transcriptPaths = locateTranscripts(
      args.skill,
      args.session,
      transcriptsDir,
      args.sessionMode,
      args.lastN,
    );
  } catch (e) {
    console.error(`error: ${e.message}`);
    return 2;
  }

  const cwd = process.cwd();
  const allowlist = loadAllowlist(cwd);
  // The audited skill may declare `audit-span: read-only` in its frontmatter —
  // its own steps never mutate, so sticky-attribution over-capture is corrected
  // by bounding each range at the first downstream mutation. See computeEffectiveRange.
  const auditSpan = readSkillAuditSpan(args.skill, cwd);
  // In --whole-transcript mode the file IS the isolated run, so there is no
  // "downstream" to bound against — skip the read-only over-capture correction.
  const isReadOnly = args.wholeTranscript ? false : auditSpan === 'read-only';

  const allFindings = [];
  const fits = [];
  const performance = [];
  const traces = [];
  const invocationMeta = [];
  const sessionsScanned = [];

  for (const transcriptPath of transcriptPaths) {
    const sessionId = path.basename(transcriptPath, '.jsonl');
    let turns;
    try {
      turns = parseTranscript(transcriptPath);
    } catch (e) {
      console.error(`error: ${e.message}`);
      return 1;
    }

    // --whole-transcript: the file is one isolated run (e.g. a dedicated
    // sub-agent that ran the skill-under-test). Sub-agent self-invocations do
    // NOT stamp attributionSkill, so the normal filter would find nothing —
    // here we scope the entire transcript as a single invocation instead.
    const invocations = args.wholeTranscript
      ? turns.length
        ? [[0, turns.length - 1]]
        : []
      : findInvocations(turns, args.skill);
    if (invocations.length === 0) {
      // Cross-session scans may surface a file that matched the cheap substring
      // prefilter but has no real invocation range — skip it silently when we
      // have other sessions; only hard-error when this is the ONLY file.
      if (transcriptPaths.length === 1) {
        const skills = new Set(turns.map((t) => t.attributionSkill).filter(Boolean));
        let msg = `error: session ${path.basename(transcriptPath)} contains no turns with attributionSkill='${args.skill}'.`;
        if (skills.size > 0) msg += ` Available skills: ${[...skills].sort().join(', ')}`;
        else msg += ' No attributionSkill turns at all.';
        console.error(msg);
        return 2;
      }
      continue;
    }
    sessionsScanned.push(sessionId);

    const ranges =
      args.invocation === 'latest' ? [invocations[invocations.length - 1]] : invocations;

    for (const rng of ranges) {
      // Correct sticky-attribution over-capture: for a read-only skill, bound
      // the range at the first downstream mutation so detectors/perf only see
      // the skill's own steps. Non-read-only skills get effRange === rng.
      const eff = computeEffectiveRange(turns, rng, isReadOnly);
      const effRange = eff.effRange;

      const repeatedFindings = detectRepeatedCommand(turns, effRange, args.repeatedMin);
      const recoverFindings = detectFailedRecovery(turns, effRange);
      const confuseFindings = detectConfusion(turns, effRange, args.confusionMinDensity);
      const permGapFindings = detectPermissionGap(turns, effRange, allowlist);
      // Consumer rule detectors (per-consumer seam; empty in the portable core)
      const consumerRuleFindings = CONSUMER_RULE_DETECTORS.flatMap((detector) =>
        detector(turns, effRange, cwd),
      );
      const rngFindings = [
        ...repeatedFindings,
        ...recoverFindings,
        ...confuseFindings,
        ...permGapFindings,
        ...consumerRuleFindings,
      ];
      // Tag each finding with its session so the cross-session rollup can count
      // recurrence across sessions, and multi-session output stays attributable.
      for (const f of rngFindings) f.session = sessionId;
      allFindings.push(...rngFindings);
      // Legacy startLine/endLine/nAssistantTurns point at the EFFECTIVE range
      // (what detectors + perf actually ran on) so findings stay aligned; the
      // raw sticky span is preserved under fullSpan for transparency (segment,
      // don't silently truncate).
      invocationMeta.push({
        session: sessionId,
        auditSpan,
        startUuid: turns[effRange[0]].uuid,
        endUuid: turns[effRange[1]].uuid,
        startTs: turns[effRange[0]].timestamp,
        endTs: turns[effRange[1]].timestamp,
        startLine: turns[effRange[0]].lineNo,
        endLine: turns[effRange[1]].lineNo,
        nAssistantTurns: eff.coreAssistant,
        fullSpan: {
          startLine: turns[rng[0]].lineNo,
          endLine: turns[rng[1]].lineNo,
          nAssistantTurns: eff.fullAssistant,
        },
        firstDownstreamMutation: eff.firstMutation
          ? {
              offset: eff.firstMutation.idx - rng[0],
              line: turns[eff.firstMutation.idx].lineNo,
              kind: eff.firstMutation.kind,
            }
          : null,
        overCaptureSuspected: eff.overCaptureSuspected,
        overCaptureReason: eff.overCaptureReason,
      });
      fits.push({
        session: sessionId,
        ...buildModelFit(turns, effRange, confuseFindings.length, recoverFindings.length),
      });
      performance.push({ session: sessionId, ...buildPerformance(turns, effRange) });
      traces.push({ session: sessionId, ...buildBehavioralTrace(turns, effRange) });
    }
  }

  if (invocationMeta.length === 0) {
    console.error(
      `error: no usable invocation of attributionSkill='${args.skill}' across ${transcriptPaths.length} scanned session(s).`,
    );
    return 2;
  }

  const byCategory = {};
  const bySeverity = {};
  for (const f of allFindings) {
    byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
  }

  // The aggregate rollup is only meaningful across >1 invocation. For a single
  // invocation (the backward-compatible default) it's degenerate, so omit it.
  const aggregate =
    invocationMeta.length > 1
      ? buildAggregate(performance, fits, allFindings, invocationMeta)
      : null;

  const output = {
    skill: args.skill,
    auditSpan,
    sessionMode: args.sessionMode,
    invocationMode: args.invocation,
    sessionsScanned,
    nSessions: sessionsScanned.length,
    nInvocations: invocationMeta.length,
    // Single-session compatibility: keep the legacy `session`/`transcriptPath`
    // top-level fields pointing at the most-recent scanned session.
    session: sessionsScanned[0],
    transcriptPath: transcriptPaths[0],
    invocations: invocationMeta,
    summary: {
      totalFindings: allFindings.length,
      byCategory,
      bySeverity,
    },
    aggregate,
    performance,
    modelFit: fits,
    behavioralTrace: traces,
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
  detectPermissionGap,
  // JellyRock repo-specific rule detectors
  detectLintSpam,
  detectChangelogEditAttempt,
  detectTasksLeakage,
  detectTestClaimWithoutEvidence,
  detectHardwareClaimMismatch,
  buildModelFit,
  buildPerformance,
  buildAggregate,
  loadAllowlist,
  defaultTranscriptsDir,
  locateTranscript,
  locateTranscripts,
  firstDownstreamMutation,
  computeEffectiveRange,
  readSkillAuditSpan,
  countAssistantTurns,
  // Internals exported for testability
  _internals: {
    normalizeCommand,
    median,
    percentile,
    sum,
    meaningfullySimilar,
    bashIsAllowlisted,
    repoInternalScriptTarget,
    suggestAllowlistLine,
    humanDuration,
    modelKey,
    findResultByToolUseId,
    editContent,
    PRICING,
    CONFUSION_MARKER,
    REPO_INTERNAL_PREFIXES,
    MUTATION_DEPLOY_BASH,
    READONLY_LOAD_TURN_CEILING,
    // JellyRock detector patterns
    LINT_SHAPE,
    TEST_SHAPE,
    TEST_CLAIM,
    CHANGELOG_PATH,
    TASKS_LEAKAGE,
  },
};

# Investigation contract — issue triage

This is the contract followed in main thread once `/issue-triage` has done its prep. The skill ran on opus; the prep packet was written to `.claude/handoffs/issue-<N>-<timestamp>.md` and is also in conversation context (until compaction). You're investigating: validate the report, identify root cause, either implement a controlled fix or surface architectural tradeoffs.

## Where the prep lives

If conversation context is intact, the prep is right there (gh issue view results, classification, file context list from the skill's tool calls). If the conversation has compacted or you're resuming in a fresh session, `Read .claude/handoffs/issue-<N>-<timestamp>.md` for the consolidated packet. The packet has the shape:

```text
Issue #N: <title>
Status: <open / closed>
Labels: bug, needs-triage (etc.)
Reporter: @<login>

Classification: bug | feature | enhancement | arch-decision-needed
Probable area: <e.g., components/video, source/api>
Initial file context:
  - <path>:<line range> — <one-line why-relevant>
  - ...

Issue body:
  <full body, untruncated>

Comments:
  <@author>: <body>
  <@author>: <body>
```

Do NOT re-fetch via `gh`. The prep is authoritative. If the packet looks malformed or the classification is clearly wrong (e.g., the issue is a question rather than a bug), surface that and stop — don't paper over it.

## Operating contract — semi-auto for bugs

Your default operating mode is **semi-auto**:

- For a clear repro + clear root cause + isolated fix: implement the code change, write or update tests, run the relevant test command, **STOP before committing**. Show the user the working-tree diff and the test output. The user owns the commit decision.
- For an architectural decision (multiple valid approaches with real tradeoffs): present 2-3 tradeoff'd options. Wait for the user's pick. Do NOT implement until the user chooses an approach.

Do NOT autonomously commit, push, or open a PR. The user reviews the diff first. Once they approve, they commit; the user invokes `/pr` separately when ready.

## Step 1 — Validate the report

Read the issue body + comments + cited code. Answer four questions in order:

1. **Is this a real bug?** Some reports are user error, misunderstanding of how a feature works, or behavior-by-design. Check the [`docs/user/app-settings.md`](../../docs/user/app-settings.md) and [`docs/user/jellyfin-server-feature-matrix.md`](../../docs/user/jellyfin-server-feature-matrix.md) — the answer might already be there.
2. **Is it reproducible?** Read the repro steps. Are they specific enough? If not, the right action is to comment on the issue requesting clarification, not to fix something blindly.
3. **Is it already fixed?** Search recent commits + closed PRs for the same area. If a fix landed but the user is on an old version, the right answer is "upgrade to >= X.Y.Z," not a new fix.
4. **What's the actual scope?** Just the cited file? The cited area? Cross-cutting? Surface the scope honestly — don't shrink the fix to "minimal" if the bug reveals a broader pattern.

Surface your validation in 3-5 sentences before diving into root-cause work.

## Step 2 — Root-cause analysis

For a real-and-reproducible bug, identify the root cause. Not "missing null check" — "this entire pattern assumes the API always returns a `MediaSources` array, but Live TV channels return null, and the call site doesn't guard." If the same root cause likely exists elsewhere in the codebase, search to confirm and surface those sites as a separate scope question.

Honor the JellyRock-specific lenses:

- **Render thread safety** — direct API calls from component code (vs Task Nodes) are render-thread-unsafe. See [`source/api/CLAUDE.md`](../../source/api/CLAUDE.md).
- **Component scoping** — XML+BS pairs auto-scope; `source/` files need imports.
- **Task Node patterns** — fields-as-vehicle dodge for SceneGraph event coalescing.
- **Global state** — `m.global.app` / `m.global.user` / `m.global.device` patterns; don't proliferate ad-hoc globals.
- **Event handling** — `onKeyEvent` return values control bubble behavior.
- **Registry migrations** — settings changes need migration scripts per [`docs/dev/registry-migrations.md`](../../docs/dev/registry-migrations.md).
- **Logging discipline** — invoke the dedicated `log-reviewer` agent if a fix would touch logging; never blanket-add.

## Step 3a — Implement (semi-auto path, for clear bugs)

If the diagnosis points at a single isolated fix:

1. Apply the code change via `Edit` (or `Write` for new files).
2. Write or update tests. Use [`docs/dev/unit-tests-tdd.md`](../../docs/dev/unit-tests-tdd.md) for TDD-style, [`docs/dev/unit-tests.md`](../../docs/dev/unit-tests.md) for full-suite. The right test command depends on the change:
   - BS unit tests on Roku hardware: `npm run test:tdd` (single-spec, fastest)
   - BSC plugin / scripts changes: `npm run test:scripts` (Vitest, no hardware)
3. Run the test. Report the result honestly: pass, fail, or "hardware not reachable" (don't claim tested if hardware was unavailable — say so explicitly).
4. **Stop here.** Show the user:
   - One-line summary of the fix
   - The diff (or a `git diff` invocation summary)
   - Test output
   - Any deferred follow-ups (link a [tech-debt slug](../../docs/architecture/tech-debt.md) if the bug reveals scope beyond this fix)
5. Ask: "Review the diff and let me know if you want changes. When ready, commit and `/pr` separately."

Do NOT commit. Do NOT push. Do NOT invoke `/pr`. The user owns those steps.

## Step 3b — Present options (architectural-decision path)

If the diagnosis surfaces multiple valid approaches with real tradeoffs (e.g., "fix here vs refactor the calling pattern" or "tighten the API contract vs handle the null at the call site"), present 2-3 tradeoff'd options:

For each option:

- **Approach** (one-line description)
- **Pros / Cons** specific to JellyRock conventions (cite the rule: scoped CLAUDE.md, architecture doc, decisions.md slug)
- **Complexity estimate** (small / medium / large + concrete file count if relevant)
- **Impact on existing functionality**
- **Tests / migrations required**

Make a recommendation with reasoning. Cite JellyRock conventions concretely — "Per `components/video/CLAUDE.md`'s player-invariant rule, Option A respects the single-player-component invariant; Option B would create a parallel player which is the explicit anti-pattern."

End with: "Which approach would you like? Or should I investigate further?" **Wait. Do not implement.**

Once the user picks an approach, drop into Step 3a (semi-auto implementation) for that approach.

## Step 4 — Capture deferred follow-ups

If the fix scope had to be narrowed (the bug revealed a broader pattern that's out-of-scope for this issue), don't let it evaporate. Surface it as a candidate `tech-debt.md` slug:

> **Out of scope for this fix** (suggest filing as tech-debt slug `<kebab-name>`):
> <one-paragraph description of the remaining work and why it was deferred>

The user can either run `/tech-debt-scan` later or add the entry directly. The CLAUDE.md "PR follow-ups land in tech-debt.md" rule applies.

## Critical constraints

Repo-wide rules in root [`CLAUDE.md`](../../../CLAUDE.md) still apply (CHANGELOG is CI-controlled, no `tasks/` leakage in shared artifacts, hardware-reachable claim discipline, pre-push hook discipline). Flow-specific constraints:

- NEVER commit, push, or open a PR. The user owns those steps after reviewing the diff.
- NEVER suggest solutions that violate render-thread requirements.
- NEVER re-fetch via `gh` — the skill's prep is authoritative; if it's wrong, surface and stop.
- NEVER blanket-add logging. If a fix would benefit from a single targeted log on a critical-error path, propose it; otherwise invoke `log-reviewer` for an audit.

## When you're done

Summarize at the end:

> Issue #N investigation complete.
>
> - Diagnosis: <one-line root cause>
> - Action: <fix applied locally / options presented / report invalid>
> - Tests: <pass / fail / hardware unavailable>
> - Next: <user reviews diff and commits / user picks option / user comments on issue requesting clarification>
> - Cleanup: if `.claude/handoffs/issue-<N>-*.md` exists, `rm` it now to clear the pending marker (otherwise it'll surface in `/catchup` until the 30-day auto-prune).

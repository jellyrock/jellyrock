---
name: snag
model: sonnet
effort: low
description: Reactive flaw-remediation for JellyRock — fires the moment a defect, bug, gap, or regression surfaces mid-work, BEFORE you hack a first-draft fix. Triages the flaw by size (blast radius + judgment required, NOT line count) and routes it behind a confirm gate: trivial → fix now with zero ceremony; small/medium → a structured in-session fix carrying RCA gates (confirm root cause / weigh ≥2 fixes / right-size the artifact / regression+dogfood via `npm run validate`/`test:scripts`/`test:tdd` / human gate), optionally delegated to an Opus sub-agent to preserve main-thread context; large → escalate to tracked work (`/log followup` or `/start-project`). Recommend-then-confirm, flat disclosure, non-mandatory — self-demotes so it never taxes a 2-line fix. Reuses `/focus`'s triage→route architecture but is distinct by TRIGGER: `/focus` is proactive session-start backlog triage; `/snag` is reactive triage of a flaw found mid-work. Use when something turns out broken and you want to handle it at the right size instead of reflexively patching. NOT for picking the next task (use `/focus`), and NOT for a known crash/CI/issue investigation that already has a dedicated flow (`/runtime-triage`, `/ci-triage`, `/issue-triage`).
---

# /snag — reactive triage → route (fix-now / structured-fix / escalate)

## Contract

**Goal.** Turn the moment a flaw surfaces mid-work into the right-sized response instead of a reflexive first-draft patch. When a defect, bug, gap, or regression is found — by the agent or surfaced by the user — `/snag` **triages its size and routes** it behind a confirm gate, mirroring the proven proactive-triage architecture (triage → recommend → route behind a confirm gate; flat disclosure; non-mandatory; recommend-then-confirm). The three routes: **fix-now** (trivial — a typo, a one-line correction the agent never gets wrong — applied immediately with zero ceremony); **structured-fix** (small/medium — carries the RCA gates below, optionally delegated to a sub-agent so the main thread keeps its context); **escalate** (large — hand off to tracked work because the flaw deserves its own triage, not an in-place hack). The skill **operationalizes** the workflow's standing norms (iterate-on-evidence, dogfood-changes, cost-efficiency) as an *active gate* that fires at flaw-discovery time — the rules state the "why," the skill is the "when + how." It ships at the cost-efficient tier: triage and the trivial/escalate routes are light judgment, and the one genuinely judgment-heavy sub-step — naming a subtle root cause on a structured fix — is carried by an escalated sub-agent (judgment tier) only when the cause isn't obvious, so the common case never pays the expensive tier.

**Inputs.** `$ARGUMENTS` is an optional short description of the flaw just found (e.g. `the keep-list guard let the sweep clobber protected files`). If absent, the skill triages the most recently surfaced defect in the working context. The skill expects to be invoked **the moment a flaw is found, before any fix is drafted** — its whole value is interposing a triage step between discovery and patch. It reads the working state needed to size the flaw (the failing artifact, its blast radius, what depends on it) but does not require a prior `/catchup`.

**Outputs.**

- A `Triage` block surfaced to the user: the flaw in one line, its **size** (trivial / small-medium / large) with a one-line rationale grounded in *blast radius + judgment required*, and the **route** that size implies. Surfaced behind a confirm gate before any fix is applied (except a genuinely trivial fix, which may apply directly — see Success criteria).
- **On fix-now:** the trivial correction applied directly, no ceremony, no human gate.
- **On structured-fix:** the five gates walked and their outputs surfaced for the human gate — the confirmed root cause, the ≥2 candidate fixes weighed with the chosen one and why, the fix's footprint (sized to match the defect), and a regression/dogfood result proving the fix works on a real target before "done." The fix's RCA narrative (root cause + chosen fix + alternatives rejected) lands in the commit body, not a separate artifact.
- **On escalate:** a hand-off to tracked work — a `/log followup` capturing the flaw + its suspected cause, or a `/start-project` scaffold when it's multi-session-shaped — and the skill stops without fixing in place.
- A `Captures for /log` tail listing any residual followups or decisions that surfaced during the fix but aren't yet captured. Omit if nothing surfaced; do not pad.

**Success criteria.**

- The flaw is sized by **blast radius + judgment required, not line count** — a one-line change to a shared mechanism that fans out to many targets is *not* trivial; a ten-line change isolated to one throwaway spot may be. The size determines exactly one route.
- The **trivial route is genuinely zero-ceremony** — the skill self-demotes and never taxes a 2-line fix with gates, sub-agents, or a human-gate question. If the triage is hesitating over whether a fix is trivial, that hesitation *is* the signal it's not.
- The **structured-fix route walks all five gates** in order: (1) confirm the *actual* root cause, not the first symptom; (2) weigh ≥2 candidate fixes and pick on merit; (3) right-size the artifact so its footprint matches the defect; (4) regression+dogfood the fix on a real target before declaring done; (5) human gate — surface root cause + chosen fix + footprint for confirmation before applying anything beyond trivial.
- A **destructive or fan-out mechanism is verified on ONE target before it's applied across many** — a sweep, a multi-file `sed`, a batch transform proves itself on a single instance first.
- The **escalate route hands off rather than fixing in place** — a large flaw becomes tracked work, not an in-session hack that skips its own triage.
- The skill **reuses the routing architecture but is distinct by trigger** — proactive next-move triage stays with the session-start orchestrator; `/snag` owns reactive flaw triage. No duplication of the rules' content: the skill is the active gate, the rules remain the rationale.

**Failure modes to avoid.**

- **Hacking the first-draft fix.** Shipping the first remedy that comes to mind, commit-as-you-go, with no gate forcing confirm-root-cause / weigh-alternatives / check-regressions. This is the exact failure the skill exists to interpose against — if you find yourself editing before you've triaged, stop and triage.
- **Fan-out before verifying the mechanism on one target.** Running a destructive batch operation (a multi-file `sed`, a sweep, a scripted transform) across many targets without proving the mechanism on a single one first. A silently-failing guard can corrupt every target at once. Verify on one, confirm the result, *then* fan out.
- **Over-sizing the artifact.** Answering a two-sentence behavioral gap with a multi-paragraph edit, or a one-file defect with a cross-cutting refactor. The fix's footprint must match the defect's — gate 3 exists precisely to catch this. Bloat is a regression, not thoroughness.
- **Asserting comprehensiveness without verifying the vectors.** Declaring "this makes every case safe" / "there's zero risk" without having checked the cases. A known-shaped error class shrugged off as "probably fine" is the defer-clause inversion — name the vectors and verify them, or don't claim coverage.
- **Skipping the human gate on a non-trivial fix.** Applying a structured fix unilaterally — root cause, chosen fix, and footprint never surfaced for confirmation. Beyond the trivial route, the human gate is mandatory; the agent classifies and proposes, the human confirms before anything lands.
- **Taxing a trivial fix with ceremony.** The inverse failure — running the full gate sequence, spawning a sub-agent, or opening a human-gate question for a typo. The trivial route must stay frictionless or the skill becomes something people route *around*.
- **Sizing by line count instead of blast radius.** Treating a small diff as automatically trivial. The metric is what the change can break and how much judgment the cause needs — not how many lines move.
- **Restating the rules instead of operationalizing them.** The skill is the active trigger and the gate sequence; it does not re-explain *why* evidence beats taste or *why* dogfooding matters. Those live in the rules. If the skill starts lecturing the rationale, it's drifted out of its lane.

**When NOT to use.**

- **Picking what to work on next.** Proactive, session-start, "what should I do now" triage is the session-start orchestrator's job (`/focus`), not `/snag`. `/snag` fires reactively on a flaw already found.
- **A flaw that's actually planned new work.** If the "flaw" is really a missing feature or a deliberate design gap, that's a project or a quick-fix plan — route through the lifecycle/triage skills, not the remediation gate.
- **Shipping a known, already-scoped change.** A config deploy, a secret rotation, a routine update — those have their own dedicated skills with their own verification gates. `/snag` is for *unexpected* defects, not planned changes.
- **Mid-fix on a snag already triaged.** Once `/snag` has routed a flaw and you're executing the structured fix, don't re-invoke it on the same flaw — that's just continuing the work.

## Implementation

### Step 1 — Triage the flaw's size

Name the flaw in one line. Then size it by **blast radius + judgment required, not line count**:

- **Trivial** — a single obvious correction with no judgment on the cause: a typo, a wrong literal, an off-by-one in a comment, a broken link. Blast radius is the one spot; reversible at a glance; you never get it wrong. → **fix-now.**
- **Small / medium** — *any* of: the root cause is non-obvious, ≥2 viable fixes exist, the change touches a **shared mechanism** others depend on (a tool, rule, skill, script, hook, schema), or the fix fans out across multiple files/targets. Fits in this session. → **structured-fix.** *(Note: a one-line edit can land here — a guard in a hook that fans out to many consumers is small in diff but wide in blast radius.)*
- **Large** — needs its own design, spans multiple sessions, crosses a phase/decision boundary, or the root cause itself needs investigation before any fix can be scoped. → **escalate.**

When size is genuinely ambiguous between trivial and structured, the hesitation itself is the signal — treat it as structured. When ambiguous between structured and large, default to structured and let the work prove it needs escalation; don't over-escalate a fixable defect.

Surface the triage in this block (real names from the working context; never invent):

```text
**Snag:** <one-line description of the flaw>

**Size:** <trivial | small-medium | large> — <one line: the blast radius + judgment that sets the size>

**Route:** <fix-now | structured-fix | escalate> — <one line: what this route does next>
```

For **trivial**, you MAY apply the fix directly and report it without waiting — zero ceremony is the contract. For **structured-fix** and **escalate**, STOP and wait for the user to confirm the route, pick a different size, or redirect.

### Step 2 — Branch on the confirmed route

- **fix-now** → apply the one-line correction. Done. (If it touched a tool/rule/skill/script, the standing dogfood-changes norm still applies — exercise the changed tool once — but that's the general rule, not skill ceremony.)
- **structured-fix** → walk the five gates (Step 3). Decide inline-vs-sub-agent there.
- **escalate** → capture the flaw as tracked work: `/log followup` with the flaw + its suspected cause for a single-shape defect, or invoke `/start-project` when it's multi-session-shaped. Then STOP — do not fix in place.

### Step 3 — The structured-fix gates (small/medium path)

Walk these in order. Each is a checkpoint, not a ritual — keep the footprint light.

1. **Confirm the root cause.** Reproduce or verify the defect; name the *actual* cause, not the first symptom. If the cause is non-obvious enough to need real reasoning across components, this is the one sub-step worth the judgment tier — delegate it to a sub-agent with a model override (see `## Sub-agent invocation`).
2. **Weigh ≥2 candidate fixes.** Generate at least two; pick on merit and state why the others lost. Don't ship the first idea unexamined.
3. **Right-size the artifact.** Make the fix's footprint match the defect. A two-sentence behavioral gap gets a two-sentence fix, not a rewrite. Trim before you commit.
4. **Regression + dogfood.** Verify the fix works on a **real target** before declaring done — run the changed tool, exercise the path, re-trigger the failure and watch it not happen. For a code fix this means the relevant JellyRock gate (`npm run validate` for a typecheck, `npm run test:scripts` for the vitest suite, `npm run test:tdd` for the Roku TDD suite, `npm run lint` for the lint chain) goes green on the actual change. If the fix is a destructive/fan-out mechanism, prove it on ONE target before applying it across many.
5. **Human gate.** Surface the root cause + chosen fix + footprint and get confirmation before applying anything beyond trivial. The agent proposes; the human confirms.

When delegating the fix to a sub-agent (to preserve main-thread context, or because the root cause needs deep reading): hand it the confirmed root cause, the chosen approach, the gates to honor, and the capture clause. If the sub-agent writes files in parallel with other work, give it worktree isolation. Spawn it at the judgment tier only when the root cause is non-obvious; a mechanical structured fix runs fine at the default tier.

Land the fix as a commit whose body carries the RCA narrative — root cause, chosen fix, alternatives rejected. That commit IS the record; do not also write a separate RCA note. If a residual tail surfaced (a related defect, a followup the fix exposed), capture it via `/log` at Step 4.

### Step 4 — Capture residuals

If the fix surfaced followups or decisions not yet captured, invoke `/log` for each, one at a time, per the capture convention. Then stop. Don't pad with captures that don't exist.

## Sub-agent invocation

`/snag` delegates the **structured fix** to a sub-agent when the root cause needs deep reading or the main thread should keep its context. Parent passes (set the Task `model` to the judgment tier only when the root cause is non-obvious; give the agent worktree isolation if it writes files in parallel with other work):

`A flaw was found: <one-line flaw>. The confirmed (or suspected) root cause is <cause>. Apply a structured fix honoring these gates: weigh ≥2 candidate fixes and pick on merit; right-size the artifact to the defect (don't over-edit); verify the fix on a real target before declaring done, and if the fix is a destructive/fan-out mechanism prove it on ONE target before fanning out. Do NOT commit — surface the chosen fix, the alternatives rejected, the footprint, and the dogfood result back to me for the human gate. If you discover any decisions or followups during this work, surface them at the end of your report as a "Captures for /log" section with one bullet per item. I'll invoke /log for each. Do not write to journals directly.`

Sub-agents NEVER commit, enter plan mode, or write to journals directly (Sub-agent capture rule) — they propose; the parent runs the human gate and lands the commit.

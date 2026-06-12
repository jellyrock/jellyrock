# Skill-evaluation criteria — the shared dimensions a skill execution is judged on

> **Single source of truth.** Both `/audit-skill` (evaluates ONE run for health) and `/verify-skill` (compares TWO versions of a skill across the same dimensions for behavioral regression) judge a skill execution against the dimensions below. They share this one definition so their notions of "what a skill run looks like" cannot drift apart. When you change a dimension here, both consumers inherit it.

This file is provenance-sterile reference, not a behavioral rule — it states the evaluation surface, not a norm to follow. The co-located mechanical extractor (`extract-friction.cjs`) is the deterministic half: it already emits friction, performance, and model-fit keyed on these dimensions, and is **generalized to emit the full execution profile** (including a unified behavioral action-trace) so both consumers read the same machine-extracted base. Deterministic mechanics cost no tokens; the model is reserved for the one dimension no extractor can mechanize (output accuracy / semantic equivalence). That split is the whole point: machine does the trace, model does the judgment.

## The five dimensions

A skill execution is fully characterized by these five groups. Each names what it captures and how it is obtained (mechanical extraction vs. auditor judgment) so a consumer knows which findings are deterministic and which carry model uncertainty.

### 1. Behavioral / action-trace — *what the run actually did*

The observable sequence of effects the skill produced: which files it touched (created / edited / deleted, and which paths), which tools it invoked and in what order, which gates or checks it ran, which stop-points it honored (did it halt for a human gate, or run past one), which routing decision it took (when the skill branches — e.g. a triage that chooses one of several paths), and which banners / structured outputs it fired. Scope discipline lives here too: did the run touch only what the task warranted, or reach into unrelated surfaces. This is the dimension that answers "did behavior change" — it is the backbone of `/verify-skill`'s differential. Mechanically extractable in large part (tool calls, edit targets, bash commands, sub-agent invocations are all in the transcript), but the *labelling* of a trace into "gates run / stop-points honored / routing taken" is partly judgment because those are skill-specific concepts the extractor cannot name generically.

### 2. Output accuracy — *did it produce the correct result*

Whether the run's actual output is the right one for its input: the correct files changed in the intended way, the correct decision reached, the briefing factually matching real state, no hallucinated content, no silently-wrong result that nonetheless "ran clean." **This is the one dimension no extractor mechanizes** — it requires an auditor (the model, or a human) to compare the output against what *should* have happened. It is therefore the dimension that most needs judgment and carries the most uncertainty, and the one a clean mechanical profile can still fail.

### 3. Performance — *what the run cost*

Wall-clock duration, output tokens (total and per-model), cache-hit ratio, and an estimated cost. Fully mechanical. Used by `/audit-skill` to spot a perf anomaly or a wrong model pin, and by `/verify-skill` to catch a regression where a change made the same behavior markedly more expensive (e.g. a restructure that doubled the token cost for identical output).

### 4. Friction — *where the run struggled*

The stumbles: repeated identical commands, failed-then-retried recoveries, confusion clusters (self-narration density spiking), permission-prompt gaps (an internal tool invoked without allowlist coverage), and any repo-specific rule violations a consumer's detectors flag. Mostly mechanical (the extractor's portable detectors), plus a consumer-extension seam for repo-specific rule detectors. Friction present on even a *single* run is real signal — it does not require many runs to surface (only *recurring*-friction statistics need a multi-run sample).

### 5. Model-fit — *was the right model used*

The reasoning-load profile of the run — tool-to-text ratio, sub-agent use, distinct-files-edited, confusion/recovery counts, a human-readable profile summary — weighed against the skill's pinned `model:`. Mechanically profiled; the *verdict* ("this is over/under-modelled") is judgment. A **confident** model-fit call needs a multi-run sample (one run is a weak basis for re-pinning); a single run yields at most a `watch` flag, not a re-pin.

## How the two consumers use these dimensions

| | `/audit-skill` | `/verify-skill` |
|---|---|---|
| Operation | Evaluate ONE run against all five dimensions | Compare TWO versions' runs *across* the five dimensions |
| Behavioral / action-trace | Is the trace sane (no thrash, scope held)? | **Same trace modulo intended changes?** (the core differential) |
| Output accuracy | Is the result correct? | Is the result *equivalent* to the prior version's? |
| Performance | Anomaly vs. the pin? | Regression (same behavior, worse cost)? |
| Friction | Present on this run? | New friction the change introduced? |
| Model-fit | Right pin (confident only with a sample)? | Did the change shift the reasoning load? |

Single-run signal (dimensions 1, 2, 3, 4) is detectable on *one* run — including a first run. Cross-run statistics (recurring-friction tally, a confident model-fit re-pin) need a sample. That distinction is what keeps a first-run-with-friction legitimately auditable while withholding only the claims that genuinely need many runs. **For `/audit-skill` (detecting whether signal is present on a run) this single-run rule holds; for `/verify-skill` (attributing a delta to a version change) it does not — see "Differential attribution" below, because the differential's harder question is whether a delta is caused by the version or by run-to-run variance.**

## Non-determinism — judge behavior, never text

These executions are LLM runs: the *same* version run twice produces different prose. So neither consumer diffs raw transcript text. `/audit-skill` reads the mechanical profile + judges accuracy. `/verify-skill` compares the two profiles on dimensions 1/3/4/5 (largely mechanical) and uses the model to judge dimension 2 (accuracy / semantic equivalence) — and, critically, judges every behavioral delta **against the declared intended-change-list** for the change under test: a delta inside the intended-change-list is expected (pass); a delta outside it is a regression finding. Without that declared oracle the differential is meaningless, because *some* behavioral change was the whole point.

## Differential attribution — structural deltas vs judgment deltas (the single-pair trap)

Non-determinism does not stop at prose. `/verify-skill` compares two versions on one fixture, but **a single OLD-vs-NEW pair cannot attribute every delta to the version change** — because some deltas are produced by the LLM at run time, not by the version. Sort each delta by how it is produced:

- **Structurally-deterministic deltas** — a file genuinely touched or not, a hard-coded gate honored or not, a tool the procedure unconditionally runs, the token/cost figures. These are version-locked: if they differ across the pair, the *version* differs. A single pair attributes them reliably.
- **Judgment / discretion deltas** — anything an LLM decides at run time: a verdict value (a model-fit `keep`/`watch` call, a finding classification), *which results it chooses to surface or emphasize*, the depth it investigates to. These carry **intra-version variance** — the *same* version run twice can produce them differently — so a single pair cannot separate a version-systematic shift from run-to-run noise.

So a behavioral delta is only safely read from one pair when it is structural. For any delta touching judgment or agent discretion, attribute it by **replication**: run each version N times (N≥3) on the same fixture and ask whether the delta is *systematic* (consistent across replicates → version-attributable; then classify expected/regression against the oracle) or *sporadic* (varies within a version → non-determinism, not a regression). Judge such deltas on their **shape**, not their **value** — "did a recommendation of the right form get produced?", never "is the verdict identical." This is the same weak-single-sample logic that already gates a confident model-fit re-pin (dimension 5): one sample yields at most a `watch`, not a verdict.

Cost-aware default: **one pair first; escalate to N-replication only when a surfaced delta lands in a judgment/discretion dimension or outside the oracle.** The cheap common case stays a single pair; pay for replication only when the cheap signal is ambiguous.

A second trap is **fixture contamination across a coupled artifact set.** A change often spans more than its named file — a SKILL.md step that reports data a co-located helper/extractor produces. Versioning only the named file while pinning the helper at the new version leaks the new behavior into the OLD run, so the differential silently compares new-against-new and a real delta looks absent. Check out the change's *whole* artifact set together. When a "doc-only" change in fact depends on a co-evolved helper, recognize that the differential is then a **reliability/frequency** comparison (does the new version do it *reliably*), not a presence/absence one — and size the sample accordingly.

A third trap is **host-session catalog contamination.** The controlled-re-run sub-agent inherits the host session's skill descriptions as injected context; when those descriptions narrate the NEW behavior, the OLD-version sub-agent can absorb it from context rather than from the OLD SKILL.md it was told to follow, so the delta vanishes. This is dimension-selective: file-driven *structural* behavior is immune (the sub-agent reads it from the Implementation steps), but *judgment-dimension* behavior — a significance gate, a routing classification, a decline-as-trivia call — is exposed, because that is exactly what a catalog description narrates. The acute case is verifying one repo's skill from a *different* repo's session whose catalog advertises the converged form. Drive the differential from a session whose catalog matches the OLD version — for a cross-repo convergence, an in-repo session of the consumer, not a foreign host — and treat any judgment delta whose OLD run cites the injected description as contaminated: re-run in a clean host before classifying.

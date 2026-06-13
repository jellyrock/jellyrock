# Skill-evaluation criteria — the dimensions a skill execution is judged on

This file is reference, not a behavioral rule — it states the evaluation surface `/audit-skill` judges a run against, not a norm to follow. The co-located mechanical extractor (`extract-friction.cjs`) is the deterministic half: it emits friction, performance, model-fit, and a unified behavioral action-trace keyed on these dimensions, so the skill reads one machine-extracted base. Deterministic mechanics cost no tokens; the model is reserved for the one dimension no extractor can mechanize (output accuracy). That split is the whole point: machine does the trace, model does the judgment.

## The five dimensions

A skill execution is fully characterized by these five groups. Each names what it captures and how it is obtained (mechanical extraction vs. auditor judgment) so you know which findings are deterministic and which carry model uncertainty.

### 1. Behavioral / action-trace — *what the run actually did*

The observable sequence of effects the skill produced: which files it touched (created / edited / deleted, and which paths), which tools it invoked and in what order, which gates or checks it ran, which stop-points it honored (did it halt for a human gate, or run past one), which routing decision it took (when the skill branches — e.g. a triage that chooses one of several paths), and which banners / structured outputs it fired. Scope discipline lives here too: did the run touch only what the task warranted, or reach into unrelated surfaces. Mechanically extractable in large part (tool calls, edit targets, bash commands, sub-agent invocations are all in the transcript), but the *labelling* of a trace into "gates run / stop-points honored / routing taken" is partly judgment because those are skill-specific concepts the extractor cannot name generically.

### 2. Output accuracy — *did it produce the correct result*

Whether the run's actual output is the right one for its input: the correct files changed in the intended way, the correct decision reached, the briefing factually matching real state, no hallucinated content, no silently-wrong result that nonetheless "ran clean." **This is the one dimension no extractor mechanizes** — it requires an auditor (the model, or a human) to compare the output against what *should* have happened. It is therefore the dimension that most needs judgment and carries the most uncertainty, and the one a clean mechanical profile can still fail.

### 3. Performance — *what the run cost*

Wall-clock duration, output tokens (total and per-model), cache-hit ratio, and an estimated cost. Fully mechanical. Used to spot a perf anomaly or a wrong model pin.

### 4. Friction — *where the run struggled*

The stumbles: repeated identical commands, failed-then-retried recoveries, confusion clusters (self-narration density spiking), permission-prompt gaps (an internal tool invoked without allowlist coverage), and any repo-specific rule violations the detectors flag. Mostly mechanical (the extractor's detectors), plus a seam for repo-specific rule detectors that map to this repo's `CLAUDE.md` hard rules. Friction present on even a *single* run is real signal — it does not require many runs to surface (only *recurring*-friction statistics need a multi-run sample).

### 5. Model-fit — *was the right model used*

The reasoning-load profile of the run — tool-to-text ratio, sub-agent use, distinct-files-edited, confusion/recovery counts, a human-readable profile summary — weighed against the skill's pinned `model:`. Mechanically profiled; the *verdict* ("this is over/under-modelled") is judgment. A **confident** model-fit call needs a multi-run sample (one run is a weak basis for re-pinning); a single run yields at most a `watch` flag, not a re-pin.

## Single-run signal vs. cross-run statistics

Single-run signal (dimensions 1, 2, 3, 4) is detectable on *one* run — including a first run. Cross-run statistics (recurring-friction tally, a confident model-fit re-pin) need a sample. That distinction is what keeps a first-run-with-friction legitimately auditable while withholding only the claims that genuinely need many runs.

## Non-determinism — judge behavior, never text

These executions are LLM runs: the *same* version run twice produces different prose. So never diff raw transcript text — read the mechanical profile and judge accuracy against what *should* have happened.

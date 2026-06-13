# Cost and context are first-class — accuracy first, then minimize spend

The standing priority on every project: **accuracy is the first, non-negotiable goal; once a result is accurate, cost and context size are the next thing to minimize — always, on every invocation, regardless of how rare the operation is.** An equal-accuracy result produced more cheaply is not a wash — it is the win. Treating "the result would be the same" as a reason *not* to make something cheaper is exactly backwards: same accuracy at lower cost is the goal.

**But "accuracy first" includes value-to-the-goal when you're choosing *which* deliverable to build — not just whether a given output is correct.** When two candidate outputs (which feature / dimension / model / approach to ship) are both accurate but differ in worth to the goal, cost does NOT break the tie toward the cheaper one: the bar is **cheaper-at-equal-*value*, not cheaper-at-any-value** — a cheaper deliverable worth less to the goal is a loss dressed up as a saving. The tell to catch yourself: you name the higher-value option, then argue into the cheaper one for ease ("it's enough" / "same outcome for the gate" / "less work"). That's ease wearing the cost-efficiency badge — stop and pick on value.

## The core lever: mechanical work by scripts, judgment by the model

Deterministic mechanical work — operations with exactly one correct output given their inputs (create a directory, copy a template, fill dated frontmatter, append a table row, renumber a list, build a fixed-shape commit) — should be done by **scripts**, not by the model re-improvising them every run. Scripts cost **nothing** in tokens, are **deterministic** (so accuracy is held or improved — no fat-fingered field, no forgotten step, real dates from `date` instead of a model guess), are **regression-testable**, and run by **humans and bots alike**. Reserve the model — especially the expensive tier — for genuine **judgment**: scoping, classifying, weighing tradeoffs, writing prose a human will read.

So when a skill or task bundles a judgment step inside procedural bulk, the lever is usually NOT "pin the whole thing to the expensive model" — it is "let a script carry the mechanics and the model carry the judgment." Right-shape before you right-size the model.

## The boundary — don't over-rotate

Extract to a script when the mechanics are **genuinely deterministic** AND either **multi-step / error-prone** or **run often**. A single trivial command the model never gets wrong isn't worth a new file to maintain — wrapping it would add cost, not remove it. The test is the same accuracy-first-then-cost calculus: does the script lower *lifetime* cost (tokens + context, recurring) by more than it adds (maintenance + a file to understand, one-time)? Usually yes for a real procedure; usually no for a one-liner.

## This is not the "mechanism" that convention-over-mechanism warns against

Preferring convention over heavy machinery rejects elaborate coordination layers (a bespoke plugin framework, a code-generation pipeline, a custom build orchestrator where a simple config or Makefile target would do). It does **not** mean "prefer model-prose to a deterministic script." A script doing mechanical work at zero token cost is the cost-efficient default, not over-engineering. Don't invoke that preference to justify making the model redo deterministic work.

## How to apply

At every skill design or audit, before tuning anything within the current shape, ask: **"What here is deterministic mechanics the model is needlessly doing, and can a zero-cost script do it accurately?"** If yes, that shape is cheaper at equal accuracy — take it.

## Why this rule exists

This is the deliberate counterweight to the tree's brake-rules (`isolate-the-fix`, `reuse-existing-tooling`, `iterate-on-evidence`'s anti-speculation clause): those guard against over-building, but without a rule that makes cost something to *pursue*, the default silently becomes "simplest to write" instead of "cheapest at equal accuracy." The tell it's missing: an agent defending a wasteful shape with "the result would be the same."

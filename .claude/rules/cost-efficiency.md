# Cost and context are first-class — accuracy first, then minimize spend

The standing priority: **accuracy is the first, non-negotiable goal; once a result is accurate, cost and context size are the next thing to minimize — on every invocation, however rare.** An equal-accuracy result produced more cheaply is the win, not a wash. Treating "the result would be the same" as a reason *not* to make it cheaper is exactly backwards.

**"Accuracy first" includes value-to-the-goal when you're choosing *which* deliverable to build, not just whether an output is correct.** When two candidates (which feature, model, or approach to ship) are both accurate but differ in worth to the goal, cost does NOT break the tie toward the cheaper one: the bar is **cheaper-at-equal-*value*, not cheaper-at-any-value**. The tell: you name the higher-value option, then talk yourself into the cheaper one for ease ("it's enough" / "less work"). That's ease disguised as cost discipline — stop and pick on value.

## The core lever: mechanical work by scripts, judgment by the model

Deterministic mechanical work — operations with exactly one correct output given their inputs (create a directory, copy a template, fill dated frontmatter, renumber a list, build a fixed-shape commit) — should be done by **scripts**, not by the model re-improvising them every run. Scripts cost nothing in tokens, are deterministic (so accuracy is held or improved — no fat-fingered field, no forgotten step, real dates from `date` instead of a guess), are regression-testable, and run by humans and bots alike. Reserve the model — especially the expensive tier — for genuine **judgment**: scoping, classifying, weighing tradeoffs, writing prose a human will read. So when a task bundles judgment inside procedural bulk, the lever is usually NOT "pin the whole thing to the expensive model" — it is "let a script carry the mechanics, the model carry the judgment." Right-shape before you right-size the model.

## The boundary — don't over-rotate

Extract to a script when the mechanics are **genuinely deterministic** AND either **multi-step / error-prone** or **run often**. A single trivial command the model never gets wrong isn't worth a file to maintain. The test: does the script lower *lifetime* cost (tokens + context, recurring) by more than it adds (maintenance, one-time)? Usually yes for a real procedure; no for a one-liner. (Choosing a simple script here is not over-engineering — "prefer convention over heavy machinery" warns against elaborate coordination layers, not against a deterministic script over model-prose.)

## How to apply

Before tuning anything within a current shape, ask: **"What here is deterministic mechanics the model is needlessly doing, and can a zero-cost script do it accurately?"** If yes, that shape is cheaper at equal accuracy — take it. This rule is the deliberate counterweight to the other rules that guard against over-building (`isolate-the-fix`, `reuse-existing-tooling`, `iterate-on-evidence`): without a rule that makes cost something to actively *pursue*, the default silently becomes "simplest to write" instead of "cheapest at equal accuracy."

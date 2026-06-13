# Iterate on evidence, not on taste

Changes to the workflow — SKILL.md bodies, the Contract+Implementation convention, the rules tree, the project lifecycle — must be backed by **cited evidence from real sessions**, not by aesthetic preference or speculation about how things "should" work. If you can't point at a session transcript, an audit finding, or a concrete friction event, the change isn't ready.

**Counterweight — read this bar together with the carve-out at the bottom.** The evidence gate targets *speculative features*. It does **not** gate a fix for a defect or duplication that **already exists**, nor an optimization against a standing objective (cost, context, a known error class, DRY-drift) — those are evidence-backed by the standing goal itself and act *now*. Before you cite this opening paragraph to defer or decline anything, read "the defer-clause inversion" below: the brake-first ordering of this rule is exactly what tempts an agent to arm the brake before reaching the carve-out.

## Why

The workflow is a living artifact that touches every session across multiple repos. Drift in any direction (over-engineered, under-specified, mechanism where convention would do, convention where mechanism is needed) compounds across hundreds of invocations. The only signal that survives selection-bias is **evidence**: what actually happened, in what session, with what cost.

## How to apply

Before proposing a workflow change, write down:

- **The evidence.** Which session? Which audit? Which friction event? Cite a transcript line, an `AUDIT-LOG.md` entry, or a `/audit-skill` output. "I think it would be nicer if…" is not evidence.
- **The cost.** What does the change cost in machinery, file count, audit complexity, onboarding overhead, runtime overhead? Be concrete.
- **The benefit.** What does the change buy? Which real problem does it solve? Tie back to the evidence.
- **The simpler alternative.** What's the convention-only version? Often "just write a rule" or "just add a Contract bullet." If the mechanism wins, name why convention isn't enough.

Then propose the change. The audit cycle catches drift; this rule catches drift-at-design-time.

## The two anti-patterns

- **Speculative future-proofing.** "We might need this later if we add a fourth consumer." Defer it until the fourth consumer surfaces concrete friction. Future-proofing accumulates as dead weight.
- **Aesthetic refactor.** "This file's structure feels inconsistent with that one." If the inconsistency hasn't produced a friction event, leave it. Cosmetic cleanup is fine as a sidecar to a real change; it's not its own justification.

## Standing objectives are evidence — the defer-clause inversion

Not every proactive change is speculative. A change that serves a *standing, always-on objective* — reducing cost or context at equal accuracy, removing a known error class, improving accuracy — is evidence-backed by that objective and does **not** wait for a future friction event. The "defer until friction" counsel targets *speculative features*, not *optimizations against a goal we already hold* (see [`cost-efficiency.md`](cost-efficiency.md): an equal-accuracy cost reduction is mandatory, not optional).

The recurring misfire — the **defer-clause inversion** — is citing "no friction story yet" to block a fix for a *known-shaped, predictable* error class. **The test:** if you can describe the failure's shape and roughly when it will hit (an 80%-knowable edge case, not a vague "someday"), the prediction **is** the evidence — act on it. **The tell:** you find yourself *naming* the likely failure and then shrugging it off — that's the minimalism brake wearing a discipline costume. Default to *anticipate-and-act* on a clearly-shaped failure; reserve "defer until friction" for genuinely speculative features.

**The inversion also fires in the *present tense* — and this is the form that slips the net most easily.** The test above reads future ("when it *will* hit"), which tempts the rationalization "but nothing's broken *yet*." That rationalization is false when the defect is **already on disk**: copy-pasted boilerplate across N files that will drift, a duplication you can point at right now, a known bug sitting in the tree. An already-materialized defect needs **no future friction story — it *is* the friction.** If you can point at it in the code, the defect is the evidence; fix it now, right-sized per [`isolate-the-fix.md`](isolate-the-fix.md). "Wait for a divergence event" applied to duplication that already exists is the inversion wearing its most convincing costume.

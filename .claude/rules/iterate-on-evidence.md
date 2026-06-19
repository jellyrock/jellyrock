# Iterate on evidence, not on taste

Workflow and tooling changes — skill bodies, conventions, the rules tree, lifecycle — must be backed by **real evidence**: a session transcript, an audit finding, a concrete friction event. Aesthetic preference or speculation about how things "should" work is not evidence. Drift compounds across hundreds of invocations, and evidence is the only signal that survives selection bias.

## The carve-out — what the gate does NOT block

The gate targets **speculative features** ("we might need this if we add a fourth consumer"). It does **not** gate these — act now:

- **A defect or duplication that already exists** — copy-pasted boilerplate that will drift, a bug already in the code. If you can point at it, the defect *is* the evidence.
- **An optimization against a standing goal** — lower cost/context at equal accuracy, removing a known error class. The goal is the evidence.
- **A predictable, clearly-shaped failure** — if you can describe its shape and roughly when it hits, the prediction is the evidence.

## Operative test

Before proposing a change, answer: **Evidence** (which session/audit/friction event?) — **Cost** (machinery, files, maintenance, runtime?) — **Benefit** (which real problem?) — **Simpler alternative** (the convention-only version; if the heavier option wins, why isn't convention enough?). If "evidence" is "none, but it'd be cleaner" — and it isn't an existing defect or a standing-goal optimization — defer it.

## The tell

You catch yourself **naming a likely failure, then shrugging it off** — citing "no friction story yet" to defer a fix whose shape you can already describe, or a defect you can already point at. Default to act on a clearly-shaped or already-present problem; reserve "defer until friction" for genuinely speculative features. (Cosmetic cleanup riding along with a real change is fine — it just can't be the whole justification.)

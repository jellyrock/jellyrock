# Prove a surprising result benign; don't explain it away

When you check work against a reference, a spec, or an expectation — a test result, a number that should match a known value, output measured against a requirement — and it comes back **off**, the deviation is **real and load-bearing until you prove otherwise**. The default is not "probably fine."

**Why:** the lowest-friction move when a check surprises you is to narrate it away — "within tolerance," "negligible," "edge case," "it cancels out," "good enough for the gate." The story costs nothing and lets you keep moving toward done, but a plausible narrative is not evidence — it's the easy option wearing the costume of analysis. Accuracy-first is already the standing bar (a result must be *correct*, not merely *shippable*); this rule is the tripwire that makes it fire at the moment it's most often overridden — when an inconvenient result surfaces and the work feels almost finished.

**The tell:** you're about to write "harmless," "negligible," "within tolerance," "edge case," "cancels out," or "fine for X" about a result you did **not** expect. That sentence is the stop signal — you've named an anomaly and are reaching for a reason not to deal with it.

**How to apply:**
- **Invert the burden of proof.** A measured deviation is presumed real; to dismiss it, *demonstrate the mechanism with a second measurement* rather than argue it. "It cancels out" → measure the residual after it cancels and show it's ~zero. If you can't measure it benign, it isn't benign yet.
- **Prefer a gate to an eyeball.** A result is *rationalizable* precisely because the check is a manual judgment — where the property can be encoded as an automated check (a test, an assertion, an invariant), do that; a red/green gate has nothing to narrate around. Turning a recurring "I eyeballed it" into a binary check is the durable fix.
- **Distrust close-out momentum.** The dismissal is likeliest when the work is mentally done — validated "well enough," and a late surprise reads as a footnote to wrap up rather than a finding to chase. The closer you are to shipping, the *more* scrutiny a surprise earns, not less.

**Counterweight:** this is not a mandate to chase every rounding artifact to ground. A deviation you've *already* proven benign — measured, bounded, mechanism understood — is closed; record the proof and move on. The rule bites the *unproven* dismissal, not the documented one.

This is the *post*-evidence companion to [`verify-dont-assume.md`](verify-dont-assume.md): that rule says don't *assert* before you have ground truth; this one says don't *dismiss* the ground truth once a check hands it to you.

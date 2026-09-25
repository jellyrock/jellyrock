# Default to uniform rules; carve out only explicitly

Uniform enforcement with no carve-out is the better decade default. When you adopt a standard — a linter rule, a test-coverage bar, a type-check, a CI gate — apply it uniformly to every subject it covers. A carve-out is a deliberate, **recorded** exception, never a silent default.

**Why:** an exception scoped to convenience ("this case is laborious," "leave the rest for later") quietly erodes the standard's value for all future code — the next violation of that class ships unchallenged. The worst kind is the *silent* carve-out: a rule left half-applied with no recorded reason, so nobody decided it on purpose and nobody revisits it. Silent exceptions compound over a codebase's lifetime; the cost is paid years later, by someone who can't tell whether the gap was intentional. The textbook shape: a linter with sixty rules where forty are quietly set to "warn, don't block" and no one wrote down which or why — half of them have zero violations and could be enforced for free, but the blob reads as "handled" so nobody looks.

**The operative test:** when you're about to exempt a case, ask *"is the rule genuinely wrong here, or am I just avoiding work?"* Only "the rule is wrong here" justifies a carve-out. Then classify and record it as exactly one of:

- **justified-permanent** — the rule's default is wrong for this case; record the reason *at the exception site* (an allowlist entry with a comment, not a blanket disable).
- **tracked-for-removal** — a temporary exception; file a followup so it's eliminated, not forgotten.
- **deferred-pending-evidence** — not yet worth adopting here; leave a one-line note, escalate when evidence of value arrives.

A carve-out that fits none of these is a defect. Prefer a positive opt-in allowlist (enable exactly these) over enable-everything-then-silently-ignore-some — the allowlist makes every non-adoption an explicit choice.

**The tell:** you're reaching for an exception to avoid effort rather than because the rule is wrong — or you're leaving a standard half-applied (a pile of un-enforced rules, a directory excluded from the type-checker, a test suite marked non-blocking) with no recorded reason for each gap. "We'll just leave those as warnings for now," with no note on *which* and *why*, is the silent carve-out forming.

**Counterweight:** this is not "adopt every available rule." *Which* standards to take on is governed by [`iterate-on-evidence.md`](iterate-on-evidence.md) — adopt on evidence of value, not speculatively. This rule governs how you treat a standard *once adopted* (apply it uniformly) and demands that any non-adoption be an explicit, classified decision rather than a silent default. The two compose: adopt on evidence; enforce uniformly; record every exception. It is also the config-surface companion to [`prove-dont-dismiss.md`](prove-dont-dismiss.md) — a silent carve-out is a deviation dismissed without proof it's benign.

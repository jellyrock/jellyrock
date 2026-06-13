# Isolate the fix from unrelated tweaks

When fixing a bug, change only what's necessary to fix it. Don't relax/tighten a cadence, rename things, or restructure adjacent logic unless there's a **concrete reason tied to the bug**.

**Why:** "while we're here" tweaks add drift risk for no benefit. The example that named it: a proposal to loosen a passing test's timeout while fixing a bug in the code under test — when the *code*, not the timeout, was broken. Cosmetic dislike (e.g. "this path looks ugly") is not a reason to refactor a working convention either.

**How to apply:** before touching anything adjacent to the bug, ask "would this change be justified on its own merits?" If no, leave it alone — state the bug fix and only the bug fix. If you do think an adjacent change is worth it, propose it **explicitly** so the human can decide; don't fold it in silently.

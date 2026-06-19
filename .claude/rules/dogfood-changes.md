# Dogfood changes — validate by using, not by inspecting

When you change a tool (a skill definition, a script, a rule, a settings/config hook — anything the workflow uses), the very next action that tool would normally handle MUST invoke the tool, not do the work manually by hand.

**Why:** inspecting the change in the file (or re-reading the diff) proves only that the prose looks right. It does NOT prove the change works as designed, with the real call shape, against real state. Using it is the only signal that it does what you meant. Skip that and do the work by hand and you ship an unverified change — usually not noticing the bug until sessions later when someone (often you) hits it.

**The failure shape:** revise a skill, then do the next instance of that skill's job by hand instead of re-invoking it. The revised definition is technically in place but never exercised, so whether it works end-to-end stays unknown.

**How to apply:**

- **Revised a skill:** the next action it would handle gets the skill invocation, not a manual equivalent. Revised the skill that opens a PR? The next PR goes through the skill, not a hand-assembled one.
- **Added or revised a script:** the next time you'd run something it handles, run the script — even if it's slower than typing the manual sequence.
- **Revised a hook** (e.g. session-start, pre-commit): trigger its event to exercise the new shape. If you can't trigger it naturally, force a synthetic invocation (start a new session, make a trivial commit) to verify it fires and behaves.
- **Exception — destructive/irreversible operations:** if the dogfood would commit to an irreversible action (delete data, push to production, send external messages), keep the safety gates AND dogfood in a non-production scope first (a throwaway copy, a staging service, a dry-run flag). Redirect it to a safe target; don't skip it.
- **Exception — unavailable dependencies:** if the tool needs something the environment can't satisfy (a service that's down, hardware elsewhere), defer with an explicit tracked followup — never silently skip and claim the change works.

**The tell:** "I'll just do it manually since I already know the output," or "it was just edited, no need to test it." Both are the failure mode — the edit is exactly the reason testing matters.

When dogfooding surfaces friction or broken behavior, capture the finding, revise, and dogfood again (see [`iterate-on-evidence.md`](iterate-on-evidence.md)). Two or three cycles in one session is healthy; the pathology is shipping a revision unvalidated, not iterating.

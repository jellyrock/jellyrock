# Dogfood changes — validate by using, not by inspecting

When you change a tool (a `.claude/skills/<name>/SKILL.md`, a `scripts/<name>.sh`, a CLAUDE.md rule, a settings.json hook, anything that the workflow uses), the very next action that the tool would normally handle MUST invoke the tool — not do the work manually by hand.

**Why:** inspecting the change in the file (or by re-reading the diff) proves only that the prose looks right. It does NOT prove the change actually works as designed in the harness, with the real call shape, against real state. The dogfood is the only signal that the change does what you meant it to. When you skip it and do the work manually, you keep the project moving but you ship an unverified change — and you usually don't notice until the third session later, when someone (often you) hits the bug.

**The failure shape:** revise a skill, then do the next instance of that skill's job by hand instead of re-invoking it. The revised SKILL.md is technically in place but never exercised — whether it works end-to-end stays unknown, and the bug surfaces sessions later.

**How to apply:**

- **When you revise a SKILL.md**: the next action that skill would handle gets the skill invocation, not a manual equivalent. Revised the skill that opens a PR? The next PR goes through the skill, not a hand-assembled one. Revised the skill that captures a note for later? The next note goes through it, not a manual file edit.
- **When you add or revise a script** (e.g. a `scripts/<name>.sh`): the next time you'd run something the script handles, run the script — even if it's slower than the manual sequence you'd otherwise type.
- **When you revise a hook** (e.g. a SessionStart hook, a pre-commit hook): the next trigger of that hook event should exercise the new shape — if you can't trigger it naturally, force a synthetic invocation (start a new session, make a trivial commit) to verify it fires + behaves.
- **Exception — destructive or irreversible operations**: if the dogfood would commit to an irreversible action (delete data, push to production, send external messages), keep the safety gates AND dogfood in a non-production scope first (a worktree, a staging service, a dry-run flag). Don't skip the dogfood; redirect it to a safe target.
- **Exception — physical dependencies**: if the tool depends on something the current environment can't satisfy (a service that's down, hardware that's elsewhere), defer the dogfood with an explicit tracked followup — never silently skip and claim the change works.

**Anti-pattern signals.** If you catch yourself thinking:
- "I'll just do it manually since I already know what the output should be" → STOP. That's the failure mode.
- "The skill was just edited, no need to test it" → STOP. The edit is exactly the reason testing matters.
- "Dogfooding adds ceremony to this small task" → the ceremony is the cost of knowing the change works. Pay it.

**The corrective loop.** When dogfooding surfaces friction, broken behavior, or wrong outputs: that's iterate-on-evidence territory (see [`iterate-on-evidence.md`](iterate-on-evidence.md)). Capture the finding, revise the tool, then dogfood the revision. Two-or-three iteration cycles in a single session is normal and healthy; that's the SOP working as designed. The pathology is shipping a revision UN-validated, not iterating multiple times.

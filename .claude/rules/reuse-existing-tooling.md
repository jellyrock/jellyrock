# Reuse existing tooling before writing new

Before writing new orchestration/ops scripts, search what already exists — your `scripts/` dir, deployed wrappers, the project's existing helper tooling. Prefer **extending an existing script with a flag or code path** over creating a sibling script.

**Why:** parallel scripts inevitably drift. The textbook shape: when one script already owns a multi-step orchestration chain — the full command sequence, orphan/error handling, notifications, the environment-specific exclusions — reach for *that* script and extend it with a flag, rather than inlining a raw command that re-implements half the chain and silently skips the rest. Reviewers push back when new logic duplicates something that already exists.

**How to apply:** when a task needs orchestration logic, first ask "does a script in `scripts/` (or an existing wrapper) already do most of this?" If yes, extend it and match its style (logging, exit codes, arg parsing). If you genuinely need a new script, say why the existing one couldn't be extended.

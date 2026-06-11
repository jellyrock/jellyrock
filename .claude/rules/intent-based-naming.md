# Name by intent, not mechanism

Name user-facing things (skills, slash commands) by the user's **intent/goal**, not the underlying **mechanism**.

**Why:** a name you can only recall if you remember the implementation has failed. The crispest statement of it — a parallel-work helper named for the goal (*a parallel session*) over the mechanism (*worktree*): if "worktree" were memorable, you wouldn't need the helper at all.

**How to apply:** lead with intent-named options (`/deploy-service`, not `/run-compose-up`). Mechanism-level names are fine for low-level helpers users don't invoke directly (e.g. a `worktree` dev script).

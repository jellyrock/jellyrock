# A flaw found mid-work goes through `/snag`, not a patch

When you find a defect, bug, gap or regression while doing other work, and it is not a one-spot slip you would never get wrong (a typo, a broken link), **do not start fixing it**, and do not leave it for the user to pick up. Finish the step in hand if the flaw does not block it (working around the flaw is fine). Then, **before you hand back to the user, start `/snag` yourself** with the flaw in one line (what is wrong, and where) and follow its steps. Its decision screen is your closing message: the user replies to it.

**Why:** the first fix that comes to mind skips the cause, the alternatives and the check that it worked, and it lands inside work it has nothing to do with. `/snag` investigates before anything is decided (reproduce, root cause, the history of the broken lines), the user chooses the fix and when, and the fix is its own commit, never pushed. A flaw only mentioned in a report, or handed over as a command to type, is one the user has to chase.

**How to apply:**

- **You start it; the user does not type it.** That its screen needs the user's reply is no reason to hold back: you are handing back anyway, and the screen is what they reply to.
- **Report the task first, then the screen.** Say what you finished in a few lines, then `/snag`'s screen, in the same closing message.
- **During `/focus`, the flaw is a candidate, not a `/snag` run.** `/focus` exists to pick the next move: it ranks the flaw with the rest and prints `/snag <the flaw in one line>` as its command. You type it when you choose it, so `/snag` runs at its own pin and its fix in its own session, never inside the triage.
- **One `/snag` per flaw.** With two flaws, run the one that matters more and name the other in one line.
- **If you cannot start it** (a sub-agent, or a session without the skill), say what you found in one line and print the command, alone in its own block:

```text
/snag <the flaw in one line: what is wrong, and where>
```

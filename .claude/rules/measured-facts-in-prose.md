# A measured fact in prose is a limit, a scale, a dated observation, or live

When you write down a number someone measured about a system (how long a step takes, how much memory or free disk a machine has, how many tests or rows there are, how large a build or a download is) in a code comment, a doc or an instruction file, it is exactly one of four kinds:

- **Limit:** the number changes what someone does, such as a timeout to set, a size budget or a threshold to alert on. Give it headroom over what was measured, and keep it where it is enforced (the script, the config) rather than restated in prose.
- **Scale:** the number only gives a sense of size. Write an order of magnitude ("a few minutes", "tens of thousands of rows", "under a gigabyte"), which stays true as the system grows.
- **Dated observation:** a precise number with the date and the command or source that produced it ("41 s for 5,900 tests, measured 2026-03-02 with `time make test`"). It records that day, so it ages but never goes stale.
- **Live:** the reader needs today's value, so name the command that prints it instead of writing the number.

**Why:** a precise, undated figure is true the day it is typed and silently wrong after. Nothing marks it stale, and the next reader, often an agent, plans on it. Runtimes, memory sizes, free disk and test counts all drift this way, and some turn out wrong, not merely old.

**The operative test:** before writing the number, ask *"what will the reader do with it?"* If they will act on it, it is a Limit; if they need a feel for size, a Scale; if they need what it was then, a Dated observation; if they need what it is now, Live. If none fits, leave the number out.

**What it covers:** measured facts, not chosen ones. A configured timeout, a retention period, a schedule or a port number is the setting itself, not a claim about the system. Records that carry their own date (a changelog, a decision record, a journal entry, a commit message) are dated observations already.

**The tell:** you're typing `~`, "about" or a bare precise figure next to a unit (`s`, `min`, `GB`, `tests`) with no date in the sentence and no command behind it, or copying such a number from an older doc.

**How to apply:**

- Date a figure to when it was measured, not when you typed it. For an old undated figure, the commit that introduced it is the best date there is (`git blame -w -C -C -M`; plain blame dates a moved line by its move).
- Keep the date in the same sentence as the figure, so a later edit or rewrap does not separate them.
- Apply it to the lines you write or edit; don't sweep files for old figures as a side change (see [`isolate-the-fix.md`](isolate-the-fix.md)). Whether a repo also checks for them, and how, is that repo's choice.

This rule is how ground truth is written down so it stays true. [`verify-dont-assume.md`](verify-dont-assume.md) says to get that ground truth before asserting, and [`prove-dont-dismiss.md`](prove-dont-dismiss.md) says that when a fresh measurement disagrees with the written figure, the figure is wrong until shown otherwise.

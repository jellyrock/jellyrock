# Waits

A followup or a project can wait on something: another followup, a project or one of its phases, a time, or another repo's project. While a wait is unmet, the item is held: `/catchup` lists it and never offers it as the next move. When every wait is met, the item comes back by itself.

## Write a wait

- **A followup:** `journal.sh add … --waits-on "<list>"`, or `journal.sh replace <fid> --waits-on "<list>"` (an empty list clears it). It is kept as a `[waits-on: …]` marker in the entry's heading.
- **A project:** the `waits-on:` line in its PLAN's frontmatter.

The list is comma-separated, with the same values in both:

| Value | Met when |
|---|---|
| `fid:<id>` | that followup closes |
| `<slug>` | that project completes or is archived |
| `<slug>:<phase>` | that phase is ✅ in the project's Phase progress |
| `after:<date>` | that day starts, at 00:00 UTC (`after:2026-11-07`) |
| `after:<time>` | that time passes; it needs `Z` or an offset (`after:2026-11-07T20:00-05:00`), never a zone name |
| `<owner>/<name>/<slug>` | another repo's project completes (`acme/app/billing`), or its phase is ✅ (`acme/app/billing:B`); read where the setting `projects.<owner>.home` keeps that repo's projects, and not checkable here anywhere else |

A project's `[external-gate: <reason>]` tag in its Status is a wait as well: only a person or an outside event clears it.

## Give a re-check date to a wait no script can check

A person's answer, an outside event (a release, an upgrade), or another repo's project this machine cannot read: no script can tell when these are met. Add an `after:` date to the same list as the day to check on it again. On that day the item comes back as "check on it". Without a date, `/catchup` flags the item as debt, since nobody would look again. When the date passes and the wait still holds, set a later date.

## Due dates

A due date is a date set from outside that the work must be done by, with a consequence if it is missed: a vendor retires an API on 2027-03-31, a certificate expires, a season starts. A target you set yourself is not one: leave it out, or pin the followup.

It differs from `after:`. An `after:` wait says not before that day (a hold). A due date says no later than that day (a deadline). An item that cannot start before one date and must be done by another takes both.

- `journal.sh add … --due 2027-03-31`, or `journal.sh replace <fid> --due 2027-03-31` (an empty value clears it). It is kept as a `[due: …]` marker in the entry's heading, after `[waits-on: …]` and before `[pinned]`.
- Not before 2026-12-01 and done by 2027-03-31: `--waits-on "after:2026-12-01" --due 2027-03-31`.
- The value is a date only. A deadline with a time of day has no instance here.

From `due_soon_days` before the date (14 by default; set it in `journal.conf`), `/catchup` ranks the followup as overdue: due soon, then past due every day after. A pinned followup stays one pin line, with its due date added to the title. A held followup still warns, with its wait named. One whose re-check date passed or whose waits are all met is that one line, not a second. `journal.sh due` lists what is inside the window.

`/catchup` flags a followup title that says by, before, deadline, due or no later than with a full date and has no marker as debt (`due-in-prose`): add the date, or reword a title that only tells what happened.

## What `/catchup` shows for each state

| State | Means | Shown as |
|---|---|---|
| held | a wait is still unmet | listed under Held, never a candidate |
| free | every wait is met | a pinned followup is a pin again; an unpinned followup ranks as overdue; a project ranks as work to resume |
| recheck | only waits no script can check are left, and their re-check date has passed | overdue: check on it, then set a later date or clear the wait |
| unchecked | a wait no script can check, with no re-check date | held, plus a debt line |
| broken | a wait names nothing found, or a project that was abandoned | overdue: fix the wait |

`/done` on a followup names each followup that waited on it, and whether it is now free.

## When to write one

Write a wait whenever the text says the item cannot move yet: "after", "once", "until", "blocked on", "waiting on" or "not before". `/catchup` flags a followup title that names a date or a time after one of those words and has no marker: add the wait, or reword a title that only tells what happened.

## The clocks

`after:` waits read the clock. `WAITS_NOW=<time>` stands in for it, taking any time `date -d` reads. `/catchup`'s own date comes from `CATCHUP_TODAY`. The two are separate, so a test or a dry run that moves the date sets both.

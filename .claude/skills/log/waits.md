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

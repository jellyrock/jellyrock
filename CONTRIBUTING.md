# Contributing to JellyRock

Thanks for your interest in contributing! JellyRock is a free and open-source
Jellyfin client for Roku, and contributions of all kinds are welcome — bug
reports, fixes, features, translations, and docs.

This project ships its development workflow as a set of `/`-skills in
[`.claude/skills/`](.claude/skills/) — running them is the easiest way to
contribute changes that match the project's conventions. You don't have to use
them, but they encode the house style, so issues, pull requests, and tracked
work come out consistently shaped.

## Getting started

1. Fork and clone the repo.
2. Install dependencies with `npm install`. (If npm scripts are disabled in your
   environment, run `npm run ropm` manually to pull the Roku dependencies.) You
   need [`node`](https://nodejs.org) 16 or later.
3. Build the app with `npm run build` (or `npm run build:prod`).
4. Lint everything with `npm run lint`, and run the Node-side tooling tests with
   `npm run test:scripts` — neither needs a device.
5. The on-device test suites (`npm run test:unit`, `npm run test:integration`)
   require a Roku in Developer Mode. See the [Dev Guide](docs/dev/DEVGUIDE.md)
   and [Unit Tests](docs/dev/unit-tests.md) to set that up.

## Using the skills

Open the repo in [Claude Code](https://claude.com/claude-code) and the workflow
skills load automatically. The ones you'll reach for most:

- **`/focus`** — works out what to tackle next and routes it.
- **The project lifecycle** (`/start-project`, `/resume-project`,
  `/end-session`) — for any change that spans more than one sitting. The
  in-flight `PLAN.md` it tracks is local agent-continuity (gitignored, like
  `.claude/handoffs/`), but the durable project state it feeds *is* committed
  in-repo — decisions as [ADRs](docs/adr/README.md), progress in
  [`docs/progress.md`](docs/progress.md), deferred work in
  [tech-debt](docs/architecture/tech-debt.md) and
  [signals](docs/signals-backlog.md) — so the next contributor inherits the
  context even though the scratchpad PLAN stays local.
- **Forge workflow** (`/create-issue`, `/pr`, `/pr-review`, `/issue-triage`,
  `/ci-triage`) — for filing issues, opening and reviewing pull requests, and
  triaging issues and failing CI runs.
- **Recipe skills** (`/new-setting`, `/new-migration`, `/new-api-version`,
  `/translation-add`) — guided, step-by-step procedures for the common change
  shapes, each wrapping the matching guide under [`docs/dev/`](docs/dev/).

You're welcome to contribute by hand too. The skills are a convenience, not a
requirement.

## AI assistance

This project welcomes AI-assisted contributions, with two expectations:

- **A human reviews before submitting.** You — a person — must have read the
  change, understand what it does, and be able to explain and defend it in
  review. Don't open a PR you couldn't walk through yourself.
- **You're accountable for it.** AI assistance doesn't change authorship
  responsibility: the same correctness, licensing, and quality bar applies as
  for hand-written code.

The bar isn't AI vs. human — it's owned, reviewed work vs. unreviewed slop. Use
whatever tools you like; just stand behind the result.

## Pull requests

- Keep each PR focused on one change.
- Branch off `main` and open the PR against `main`.
- Run `npm run lint` and `npm run test:scripts` before requesting review; the
  GitHub Actions build and lint checks must be green.
- If your change is user-facing, add an entry to [CHANGELOG.md](CHANGELOG.md).
- New strings should be translatable — see [Translations](docs/dev/translations.md).

## Security

Found a vulnerability? Please don't open a public issue — follow the
[Security Policy](SECURITY.md) to report it privately.

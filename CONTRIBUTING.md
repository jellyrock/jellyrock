# Contributing to JellyRock

Thanks for your interest in contributing. JellyRock is a free and open-source Jellyfin client for Roku, and every kind of contribution is welcome: bug reports, fixes, features, translations and docs.

The project's development workflow ships as a set of `/` skills in [`.claude/skills/`](.claude/skills/). Running them is the easiest way to make changes that match the project's conventions. You don't have to use them, but they hold the house style, so issues, pull requests and tracked work come out in a consistent shape.

## Getting started

1. Fork and clone the repo.
2. Install dependencies with `npm install`. You need [`node`](https://nodejs.org) 22 (22.22.1 or later), 24, or 26 and later. If npm scripts are turned off in your environment, run `npm run prepare && npm run postinstall` yourself. That installs the git hooks, pulls the Roku dependencies and applies the dependency patches.
3. Build the app with `npm run build` (or `npm run build:prod`).
4. Lint everything with `npm run lint`, and run the tests for the Node tooling with `npm run test:scripts`. Neither needs a Roku.
5. The test suites that run on a Roku (`npm run test:unit`, `npm run test:integration`) need a Roku in Developer Mode. See the [Dev Guide](docs/dev/DEVGUIDE.md) and [Unit Tests](docs/dev/unit-tests.md) to set one up.

## Using the skills

Open the repo in [Claude Code](https://claude.com/claude-code) and the workflow skills load on their own. The ones you'll use most:

- **`/focus`** works out what to do next and points you to the skill for it.
- **The project skills** (`/start-project`, `/resume-project`, `/end-session`) are for any change that takes more than one sitting. The `PLAN.md` they keep is a local working file and is not committed, like `.claude/handoffs/`. What lasts is committed: decisions as [ADRs](docs/adr/README.md), progress in [`docs/progress.md`](docs/progress.md), deferred work in [tech-debt](docs/architecture/tech-debt.md) and [signals](docs/signals-backlog.md). So the next contributor gets the context, even though the PLAN stays on your machine.
- **The GitHub skills** (`/create-issue`, `/pr`, `/issue-triage`, `/ci-triage`) file issues, open pull requests, and look into issues and failed CI runs.
- **The recipe skills** (`/new-setting`, `/new-migration`, `/new-api-version`, `/translation-add`) walk you step by step through the common kinds of change. Each one follows the matching guide in [`docs/dev/`](docs/dev/).

You're welcome to work by hand too. The skills are a convenience, not a requirement.

## AI assistance

AI-assisted contributions are welcome, with two expectations:

- **A person reviews the change before submitting it.** You must have read it, understand what it does, and be able to explain and defend it in review. Don't open a PR you couldn't walk through yourself.
- **You are accountable for it.** AI assistance doesn't change who is responsible. The same bar for correctness, licensing and quality applies as for code you wrote by hand.

The line is not AI or human. It is work someone owns and reviewed, or work nobody did. Use whatever tools you like, and stand behind the result.

## Pull requests

- Keep each PR to one change.
- Branch from `main` and open the PR against `main`.
- Run `npm run lint` and `npm run test:scripts` before you ask for review. The GitHub Actions build and lint checks must pass.
- Title the PR `type: Summary`, for example `fix: Keep the resume point when a video fails to start`. The title becomes the commit on `main`. Its type decides whether and where the change appears in [CHANGELOG.md](CHANGELOG.md), which is generated, so don't edit it. CI checks the title and lists the types if it fails. The types are defined in [`scripts/lib/pr-title.js`](scripts/lib/pr-title.js).
- Make new on-screen text translatable. See [Translations](docs/dev/translations.md).

## Security

Found a vulnerability? Don't open a public issue. Report it privately as the [security policy](SECURITY.md) describes.

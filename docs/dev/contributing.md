---
topic: contributing
related-files:
  - package.json
  - scripts/lib/pr-title.js
  - .claude/skills/
last-reviewed: 2026-10-25
---

# Contributing to the app

This page covers what is specific to the JellyRock app repository. The [organization's contributing guide](https://github.com/jellyrock/.github/blob/main/CONTRIBUTING.md) covers the rest: questions, bug reports, translations, pull requests in general and AI-assisted contributions.

## Get started

1. Fork the repo, then follow the [Dev guide](DEVGUIDE.md) to clone it, install the dependencies and run the app on your Roku. If npm scripts are turned off in your environment, run `npm run prepare && npm run postinstall` yourself after `npm install`. That installs the git hooks, pulls the Roku dependencies and applies the dependency patches.
2. Build the app with `npm run build` (or `npm run build:prod`).
3. Lint everything with `npm run lint`, and run the tests for the Node tooling with `npm run test:scripts`. Neither needs a Roku.
4. The test suites that run on a Roku (`npm run test:unit`, `npm run test:integration`) need a Roku in Developer Mode. See [Unit tests](unit-tests.md) to set one up.

## Use the skills

The project's development workflow ships as a set of `/` skills in [`.claude/skills/`](../../.claude/skills/). Running them is the easiest way to make changes that match the project's conventions. You don't have to use them, but they hold the house style, so issues, pull requests and tracked work come out in a consistent shape.

Open the repo in [Claude Code](https://claude.com/claude-code) and the workflow skills load on their own. The ones you'll use most:

- **`/focus`** works out what to do next and points you to the skill for it.
- **The project skills** (`/start-project`, `/resume-project`, `/end-session`) are for any change that takes more than one sitting. The `PLAN.md` they keep is a local working file and is not committed, like `.claude/handoffs/`. What lasts is committed: decisions as [ADRs](../adr/README.md), progress in [`docs/progress.md`](../progress.md) and deferred work in [tech-debt](../architecture/tech-debt.md). So the next contributor gets the context, even though the PLAN stays on your machine.
- **The GitHub skills** (`/create-issue`, `/pr`, `/issue-triage`, `/ci-triage`) file issues, open pull requests, and look into issues and failed CI runs.
- **The recipe skills** (`/new-setting`, `/new-migration`, `/new-api-version`, `/translation-add`) walk you step by step through the common kinds of change. Each one follows the matching guide in `docs/dev/`.

You're welcome to work by hand too. The skills are a convenience, not a requirement.

## Open a pull request

- Run `npm run lint` and `npm run test:scripts` before you ask for review. The GitHub Actions build and lint checks must pass.
- Title the PR `type: Summary`, for example `fix: Keep the resume point when a video fails to start`. The title becomes the commit on `main`. Its type decides whether and where the change appears in [CHANGELOG.md](../../CHANGELOG.md), which is generated, so don't edit it. CI checks the title and lists the types if it fails. The types are defined in [`scripts/lib/pr-title.js`](../../scripts/lib/pr-title.js).
- Make new on-screen text translatable. See [Translations](translations.md).

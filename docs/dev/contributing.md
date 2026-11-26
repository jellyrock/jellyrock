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

1. Fork the repo, then follow the [Dev guide](DEVGUIDE.md) to clone it, install the dependencies and run the app on your Roku.
2. Build the app with `npm run build` (or `npm run build:prod`).
3. Lint everything with `npm run lint`, and run the tests for the Node tooling with `npm run test:scripts`. Neither needs a Roku.
4. The test suites that run on a Roku (`npm run test:unit`, `npm run test:integration`) need a Roku in Developer Mode. See [Unit tests](unit-tests.md) to set one up.

## Use the skills

The repo ships a few `/` skills for [Claude Code](https://claude.com/claude-code) in [`.claude/skills/`](../../.claude/skills/). They load on their own when you open the repo there. They hold the house style, so issues and pull requests come out in the shape the project asks for:

- **`/report-issue`** drafts a bug report or feature request from the repo's issue forms, checks for duplicates, and opens the form in your browser with the draft filled in.
- **`/open-pr`** drafts a pull request from the template and the title rule, and opens GitHub's new pull request page with the draft filled in.
- **The recipe skills** (`/new-setting`, `/new-migration`, `/new-api-version`, `/translation-add`) walk you step by step through the common kinds of change. Each one follows the matching guide in `docs/dev/`.

You're welcome to work by hand too. The skills are a convenience, not a requirement.

## Open a pull request

- Run `npm run lint` and `npm run test:scripts` before you ask for review. The GitHub Actions build and lint checks must pass.
- Title the PR `type: Summary`, for example `fix: Keep the resume point when a video fails to start`. The title becomes the commit on `main`. Its type decides whether and where the change appears in [CHANGELOG.md](../../CHANGELOG.md), which is generated, so don't edit it. CI checks the title and lists the types if it fails. The types are defined in [`scripts/lib/pr-title.js`](../../scripts/lib/pr-title.js). The line credits you as the PR's author, and your first merged PR lists you under New Contributors in that release.
- Make new on-screen text translatable. See [Translations](translations.md).

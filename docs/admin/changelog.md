# Changelog

`CHANGELOG.md` is generated from the commits on `main`. Nobody edits its `[Unreleased]` section by hand: every sync rebuilds it from scratch.

## Where an entry comes from

The repo squash-merges, so every PR becomes one commit on `main` whose first line is the PR title followed by `(#N)`. [`scripts/changelog-syncer.js`](../../scripts/changelog-syncer.js) turns each of those commits into one changelog line:

- **The text** is the PR's current title, read from GitHub rather than from the commit, with its type removed. A scope stays in front: `fix(skills): Make X` becomes `(skills) Make X`. A commit with no PR (a direct push) uses its own first line.
- **The section** comes from the title's type. Every type and its section are defined once, in [`scripts/lib/pr-title.js`](../../scripts/lib/pr-title.js) (`TITLE_TYPES`). Some types stay out of the changelog entirely (tooling, CI, tests, docs).
- **A PR labeled as a dependency update** (Renovate's `dependencies`) goes to Dependencies, where updates to the same package become one line.
- **A title with no known type** goes to Changed. Its words are not used to guess a section.
- **The credit** after "by" is the PR's author, never the commit's: a merge commit names whoever merged it, and a squash commit can carry an email linked to no account. A commit with no PR is credited to the GitHub account its email is linked to, or to its git name, unlinked, when there is none. A bot links to its app page, since `github.com/<bot>` can be an unrelated account. A combined dependency line credits each author once.
- **A PR an app opened**, an AI agent's included, credits that app, the same rule for every agent. GitHub's own notes differ for its Copilot agent: they credit the person who started it, "with @Copilot".

The sections, in order: Added, Changed, Fixed, Removed, Dependencies. **New Contributors** follows them: everyone whose first merged PR or commit on `main` is in that release, oldest first. Bots are never listed.

A login is written as a link (`[@login](https://github.com/login)`), because in a repo file `@login` is plain text. The release notes turn each person's link back into `@login`, which GitHub shows as a mention.

If GitHub cannot answer a lookup (a PR, a commit's account, an earlier contribution), the sync fails and writes nothing, rather than drop a credit.

A PR cannot merge without a known type. `pr-body-check.js` fails the title in CI (the `precheck` job of `Journal Sync Precheck (PR-time)`) and lists the types. So an untyped line reaches `main` only through a direct push or an admin bypassing the check.

## When it syncs

| Trigger | Workflow | Result |
| --- | --- | --- |
| Any push to `main` | `sync-changelog` job in [`jellyrock-bot.yml`](../../.github/workflows/jellyrock-bot.yml) | `[Unreleased]` rebuilt from the commits since the latest tag |
| A manual run of that workflow | Same | Same. Use it to sync again without a new push. |
| A release tag | `jellyrock-bot.yml` and [`release-build.yml`](../../.github/workflows/release-build.yml) | `[Unreleased]` renamed to the version, with the release's summary copied to its top. From then on, that section stays fixed. |

## Fixing a wrong entry

- **Not released yet:** edit the merged PR's title on GitHub (its type or its wording), then sync again: push anything to `main`, or run the JellyRock Bot workflow by hand. Editing `[Unreleased]` in `CHANGELOG.md` does not work, because the next sync overwrites it.
- **Already released:** edit that version's section in `CHANGELOG.md` by hand. Released sections are never regenerated. The sections up to 3.3.1 got their credits in one pass afterwards, by the same rules. That pass credited a commit ported from the upstream fork with no account to the author of the upstream PR it came in. Publishing copies the release's `### Summary` to the top of its section, where later `/release-summary` runs read it as an example.
- **A direct-push commit** has no PR title to edit. Fix it by hand once it is released.

## Commands

Each reads PRs from GitHub, so `gh` must be signed in (in CI, the step needs `GH_TOKEN`). `sync-release` reads none while an `[Unreleased]` section exists.

```bash
npm run changelog:status           # latest tag, commits since it
npm run changelog:sync-unreleased  # rebuild [Unreleased]
npm run changelog:sync-release 1.21.3
npm run changelog:validate
```

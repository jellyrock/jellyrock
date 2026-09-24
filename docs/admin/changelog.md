# Automatic Changelog System

`CHANGELOG.md` is generated from the commits on `main`. Nobody edits its `[Unreleased]`
section by hand: it is rebuilt from scratch on every sync.

## Where an entry comes from

The repo squash-merges, so every PR becomes one commit on `main` whose first line is the
PR title followed by `(#N)`. [`scripts/changelog-syncer.js`](../../scripts/changelog-syncer.js)
turns each of those commits into one changelog line:

- **The text** is the PR's **current** title — read from GitHub, not from the commit —
  with its type removed. A scope stays in front: `fix(skills): Make X` becomes
  `(skills) Make X`. A commit with no PR (a direct push) uses its own first line.
- **The section** comes from the title's type. Every type and its section are defined once,
  in [`scripts/lib/pr-title.js`](../../scripts/lib/pr-title.js) (`TITLE_TYPES`). Some types
  are left out of the changelog entirely (tooling, CI, tests, docs).
- **A PR labeled as a dependency update** (Renovate's `dependencies`) goes to Dependencies,
  where updates to the same package are consolidated into one line.
- **A title with no known type** goes to Changed. Its words are not used to guess a section.

The sections, in order: Added, Changed, Fixed, Removed, Dependencies.

A PR cannot merge without a known type: `pr-body-check.js` fails the title in CI
(`Journal Sync Precheck (PR-time)` → `precheck`) and lists the types. So an untyped
line only reaches `main` by a direct push or an admin bypassing the check.

## When it syncs

| Trigger | Workflow | Result |
|---|---|---|
| Any push to `main` | `sync-changelog` job in [`jellyrock-bot.yml`](../../.github/workflows/jellyrock-bot.yml) | `[Unreleased]` rebuilt from the commits since the latest tag |
| Manual run of that workflow | same | same — use it to re-sync without a new push |
| A release tag | `jellyrock-bot.yml` and [`release-build.yml`](../../.github/workflows/release-build.yml) | `[Unreleased]` renamed to the version; the section is fixed from then on |

## Fixing a wrong entry

- **Not released yet:** edit the merged PR's title on GitHub (fix its type or its wording), then
  re-sync — push anything to `main`, or run the JellyRock Bot workflow by hand. Editing
  `[Unreleased]` in `CHANGELOG.md` does not work: the next sync overwrites it.
- **Already released:** edit that version's section in `CHANGELOG.md` by hand. Released
  sections are never regenerated.
- **A direct-push commit** has no PR whose title you can edit; fix it by hand once it is released.

## Commands

```bash
npm run changelog:status           # latest tag, commits since it
npm run changelog:sync-unreleased  # rebuild [Unreleased] (needs `gh` auth for PR titles/labels)
npm run changelog:sync-release 1.21.3
npm run changelog:validate
```

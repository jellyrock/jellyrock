---
name: new-setting
description: Guided workflow for adding a new user setting or global setting to JellyRock. Walks the canonical recipe from docs/dev/new-user-setting.md (pick the bucket, add to settings/settings.json, wire JellyfinUserSettings, surface in the settings UI, write a registry migration if the schema changes, write tests, regenerate the settings docs). Stops at each step to verify and gives the user the relevant file paths. Use when adding a new toggle / dropdown / numeric setting that the user can change in the JellyRock Settings screen.
model: sonnet
effort: low
---

# /new-setting — guided workflow

Wraps [`docs/dev/new-user-setting.md`](../../../docs/dev/new-user-setting.md) as a step-by-step. The doc is the source of truth — this skill is a launcher that ensures none of the steps get skipped.

## Step 0 — Confirm a setting is the right answer

JellyRock has three types of "settings"-shaped state. Make sure you're adding the right one:

1. **User Settings** — registry per-user, managed by JellyRock. Stored under the user's session-keyed registry section. Examples: playback preferences, UI choices.
2. **Global Settings** — registry per-device, applies to all users on this Roku. Examples: developer mode, debug flags.
3. **User Configuration** — server-authoritative from Jellyfin API. **NEVER** stored in JellyRock's registry. Read live from `m.global.user`.

If the value is server-authoritative (anything Jellyfin already tracks per-user), STOP — don't add it as a setting. Read it from `m.global.user` directly. Only proceed if the user controls the value from inside JellyRock.

## Step 1 — Pick the bucket (User vs Global)

User Settings ⇔ "this is a personal preference and changes per signed-in user." Global Settings ⇔ "this applies to the device and survives user changes." If unsure, default to User Settings — it's the more common case.

## Step 2 — Add the default to `settings/settings.json`

This is the **single source of truth** for defaults. Defaults are loaded at app startup via `user.settings.SaveDefaults()`. Defaults are NEVER written to registry — only user-set values are persisted.

Pick a stable kebab-case key. Match the JSON shape of nearby existing entries (type, default value, optional description). Read [`settings/settings.json`](../../../settings/settings.json) before editing to confirm the shape.

## Step 3 — Wire it into `JellyfinUserSettings`

Edit [`components/data/jellyfin/JellyfinUserSettings.xml`](../../../components/data/jellyfin/JellyfinUserSettings.xml) and the `.bs` sibling. The XML declares the field's type (`assocarray` / `node` / `nodearray` / `string` / `int` / `float` / `boolean`); the BS reads the default from `settings.json` and exposes the field for downstream observation.

[`source/data/SessionDataTransformer.bs`](../../../source/data/SessionDataTransformer.bs) reads the user's registry section at login and overlays saved values on top of the defaults. Confirm your new field flows through it.

## Step 4 — Surface in the Settings UI (if user-facing)

Add the toggle / dropdown / numeric input to the relevant Settings screen under [`components/`](../../../components/) (typically a screen under `components/data/` or a Settings-prefixed component). Use the existing settings controls as templates — don't invent a new control unless none of the existing shapes fit.

## Step 5 — Write a registry migration (only if schema changes)

If you're RENAMING an existing setting key, REMOVING one, or changing the data shape, write a registry migration via the [`/new-migration`](../new-migration/SKILL.md) skill. Brand-new settings DO NOT need a migration — they get their default from `settings.json` for users who haven't changed them.

## Step 6 — Write tests

Per [`docs/dev/unit-tests.md`](../../../docs/dev/unit-tests.md): registry-touching tests use `test-*` section names so they don't pollute production data. Set `m.needsRegistrySetup = true` in the suite's setup so the BaseTestSuite clears `test-*` between tests.

Tests should cover: default value loaded correctly when registry is empty; saved value persists across the autoSync mechanism; setting affects the downstream behavior it's supposed to.

## Step 7 — Regenerate the settings docs

```bash
npm run docs:settings
```

This generates [`docs/user/app-settings.md`](../../../docs/user/app-settings.md) from `settings.json`. Run it after editing `settings.json`. The pre-push hook also runs it, but better to land it in the same commit as the new setting.

## Step 8 — Verify end-to-end

```bash
npm run lint:bs
npm run validate
npm run lint:docs
```

Then on hardware (if reachable):

```bash
npm run test:tdd
```

If hardware isn't reachable, say so explicitly — don't claim "tested" without a green run.

## Common pitfalls (from the doc)

- **Forgetting to add the default** to `settings.json`. Without it, the field reads a Roku-default (empty string / 0) and downstream code may misbehave.
- **Writing the default to registry**. Defaults belong only in `settings.json`. Writing them to registry breaks the "saved-vs-default" distinction the migration system relies on.
- **Not setting `m.needsRegistrySetup = true`** in test suites that touch the registry. Cross-test leakage will produce flaky failures.
- **Committing without running `npm run docs:settings`**. The hook auto-runs but committing it explicitly makes the diff cleaner.

## When NOT to use

- The value is server-authoritative — read from `m.global.user` directly.
- You're renaming an existing setting — use `/new-migration` for the rename, not `/new-setting`.
- You're adding a developer-only debug flag — see [`docs/dev/debug-flags.md`](../../../docs/dev/debug-flags.md); flags are different infrastructure.

## Sub-agent invocation

To invoke from a sub-agent: parent passes `Read .claude/skills/new-setting/SKILL.md and follow the steps for adding $ARGUMENTS=<setting-name>; surface each step's file paths and the diffs to apply but do NOT commit` in the Task prompt.

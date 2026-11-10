---
name: new-migration
description: Guided workflow for writing a registry migration in JellyRock when a setting key is renamed, removed, or its data shape changes. Walks docs/dev/registry-migrations.md (add a version constant, add the migration's function and its gated call in the runner for the right scope in source/migrations.bs, update the code that used the old name, write a real-registry integration test, run it on hardware). Use when an existing setting changes shape; brand-new settings don't need migrations and should use /new-setting instead.
model: sonnet
effort: low
---

# /new-migration: a guided workflow

Wraps [`docs/dev/registry-migrations.md`](../../../docs/dev/registry-migrations.md) as a step-by-step. The guide is the source of truth and has the full examples; read its section for each step before doing it. `Main()` in [`source/main.bs`](../../../source/main.bs) runs the migrations before it creates the scene, so once a migration has run, the rest of the app sees only the new names.

## Step 0: Confirm a migration is needed

You need one only when you change something users have already stored ([the guide's list](../../../docs/dev/registry-migrations.md#when-you-need-one)):

- **Rename** a setting.
- **Change its values** (`"auto"` and `"aac"` became `"eac3"`).
- **Remove** a setting, or data that now comes from the server.
- **Store it differently**, such as one key split in two.

You don't need one to add a setting (use [`/new-setting`](../new-setting/SKILL.md)), to change a default, or to change a label or description. If none of the triggers apply, stop.

## Step 1: Pick the scope

`Main()` calls two runners in [`source/migrations.bs`](../../../source/migrations.bs), in this order:

- **`runGlobalMigrations()`** for the global `JellyRock` section: settings whose name starts with `global`.
- **`runRegistryUserMigrations()`** for every user's section: every other setting. It passes each migration `reg` (the user's section) and `section` (its name).

## Step 2: Add a version constant

Each migration is a named function that the runner calls behind a version constant ([the guide's step 1](../../../docs/dev/registry-migrations.md#1-add-a-version-constant)). At the top of `source/migrations.bs`, after the last constant, add one with a comment saying what changed:

```brighterscript
' client version when homeSection settings were removed from registry (now server-authoritative via DisplayPreferences)
const HOMESECTION_CLEANUP_VERSION = "2.13.0"
```

- Name it for what it does, in `UPPER_SNAKE_CASE` ending in `_VERSION` (the existing ones end in `_MIGRATION_VERSION`, `_CLEANUP_VERSION` or `_REMOVAL_VERSION`).
- Its value is the release the change ships in, which must be above the version in `manifest`. If you're unsure which release that is, ask the user. A section already on the constant's version skips the migration, so a value at or below the manifest's would never migrate users who installed that release.

## Step 3: Add the function and its gated call

Write the migration as its own function below the runner, taking `reg` and `section`, so its spec can call it alone and a later migration can never change what that spec sees. Then add the gated call at the end of the runner for your scope, so the gates stay in version order. It runs when the section was last used by an older version:

```brighterscript
if isValid(lastRunVersion) and not versionChecker(lastRunVersion, MY_CHANGE_VERSION)
  m.wasMigrated = true
  migrateMyChange(reg, section)
end if
```

`runGlobalMigrations()` still keeps its blocks inline; give a global migration a function the same way when it needs a spec of its own. Copy the shape of [the guide's example](../../../docs/dev/registry-migrations.md#2-add-the-function-and-its-gated-call) (`migrateAudioCodecSetting`), and follow its rules:

- The gate sets `m.wasMigrated = true`, so `Main()` prints the registry afterward.
- Write only what the user had. When the old key is missing, write nothing: the default comes from `settings/settings.json`.
- Delete the old key once its value is written under the new one.
- Call `reg.flush()` when you wrote or deleted something, and only then.
- Print one line for what you did and one for when nothing was needed.
- Decide what happens when a section has both the old and the new key. The guide's example doesn't cover it, so ask the user; the test table needs the answer.
- Make it safe to run twice: a section with no `LastRunVersion` runs every migration, and a sideloaded build runs the user migrations at every launch.

## Step 4: Update the code that used the old name

After a rename, nothing may read the old name ([the guide's step 3](../../../docs/dev/registry-migrations.md#3-update-the-code-that-uses-the-old-name)):

1. `settings/settings.json`: change the `settingName`.
2. `components/data/jellyfin/JellyfinUserSettings.xml`: change the field's `id`, since a registry key with no field of the same name is never loaded.
3. Everything else outside `source/migrations.bs`, docs and agent files included:

   ```bash
   git grep -n "<old-name>" -- source components settings tests docs .claude ':!source/migrations.bs'
   ```

   Leave alone what is meant to keep the old name: earlier migrations' mappings in `source/migrations.bs`, legacy inputs in the migration specs and mocks, and `docs/user/app-settings.md`, which is generated.
4. Existing cases that go through the runner from an old `LastRunVersion` (the version-gate cases, and the whole-chain case in `SettingsMigration.spec.bs`) now run your migration too. One that reads the setting you changed (`GlobalSettingsCleanup.spec.bs`, `SplashSettingRemoval.spec.bs`) needs its assertions moved to the new name.

## Step 5: Write the integration test

Follow [the guide's Test it](../../../docs/dev/registry-migrations.md#test-it). The test goes in `tests/source/integration/migration/`, in a spec named for the migration. In short:

- Tag the suite `@tags("migration")` and set `m.needsRegistrySetup = true` before `super.setup()`.
- Name each section `test-<something>`, unique to its test, and write `serverId` into it: the runner skips a section without one.
- Call your function on your section for the cases about what the migration does: `migrateMyChange(CreateObject("roRegistrySection", testUserId), testUserId)`. Call the runner (`runRegistryUserMigrations([testUserId])`) only for the version-boundary cases: it runs every later migration too, so assert there on something later migrations leave alone.
- Use a real `roRegistrySection`; don't mock the registry.
- Cover the cases in the guide's table (the old key there or missing, each value changed or kept, both keys present, the version boundary, running twice, two users).
- In `SettingsMigration.spec.bs`, make the "migrates all user settings from old to new names" test cover your change: add the old key, or, if an earlier migration already writes it, change that test's final assertion to the new name.

## Step 6: Run it on hardware

Run `npm run device:check` first. The `migration` and `registry` tags keep those suites out of `test:all` and `test:integration`, and that includes every existing spec Step 4 changed ([the guide's Run the tests](../../../docs/dev/registry-migrations.md#run-the-tests)), so run them one of two ways:

- your spec alone: list it in your TDD config (copy `bsconfig-tdd-sample.json` to `bsconfig-tdd.json` first if you have none: [`unit-tests-tdd.md`](../../../docs/dev/unit-tests-tdd.md#1-create-your-tdd-config)) and run `npm run test:tdd`;
- every suite, migrations included: `npm run test:complete` (it records coverage, so it is slow).

Then try it with real data: sideload the last release, store the old key, sideload your build over it, and watch the console. If the probe fails, say the probe failed: a migration that builds can still fail at runtime.

## Step 7: Record a non-obvious rename (optional)

If the reason for the new name isn't obvious, invoke `/log decision` with a slug like `rename-<old>-to-<new>`.

## When not to use

- A new setting: use `/new-setting`.
- A changed default: update `settings/settings.json`; existing users keep their saved value.
- A changed label or description: nothing in the registry changes.

## Sub-agent invocation

To run it from a sub-agent, the parent passes `Read .claude/skills/new-migration/SKILL.md and follow the steps for the change <rename-or-removal-description>; surface each step's diff but do not commit` in the Agent prompt.

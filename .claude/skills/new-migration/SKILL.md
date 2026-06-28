---
name: new-migration
description: Guided workflow for writing a registry migration in JellyRock when a setting key is renamed, removed, or its data shape changes. Walks docs/dev/registry-migrations.md (pick next version, write migration in source/migrations.bs for the right scope, register the runner, write a real-registry integration test, run on hardware to verify). Use when an existing setting changes shape; brand-new settings don't need migrations and should use /new-setting instead.
model: sonnet
effort: low
---

# /new-migration — guided workflow

Wraps [`docs/dev/registry-migrations.md`](../../../docs/dev/registry-migrations.md) as a step-by-step. Migrations run in [`source/main.bs`](../../../source/main.bs) BEFORE any data transformer or session loading; once a migration runs, the registry has only NEW names and downstream code can assume the new shape.

## Step 0 — Confirm a migration is needed

You need a migration ONLY when:

- An existing setting key is being **renamed** (registry name changes).
- An existing setting key is being **removed** (cleanup).
- A setting's **data shape is changing** (e.g., string → JSON-encoded object, or one field split into two).

You DO NOT need a migration when:

- Adding a brand-new setting (defaults flow from `settings.json` automatically; existing users get the default the first time they touch the new field). Use [`/new-setting`](../new-setting/SKILL.md) instead.
- Changing a setting's default value (existing users keep their saved value; new users get the new default).
- Changing UI labels / descriptions (no registry-shape impact).

If none of the migration triggers apply, STOP — don't add a migration.

## Step 1 — Pick the migration scope

JellyRock runs two migration loops in sequence:

- **Global migrations** ([`runGlobalMigrations()`](../../../source/migrations.bs)) — operate on the `JellyRock` registry section (device-level). Run for global settings, dev flags, and cross-user state.
- **User migrations** ([`runRegistryUserMigrations()`](../../../source/migrations.bs)) — operate on each user's registry section. Run per-user at session-load time.

Pick the matching scope based on which section your setting lives in. If you're not sure, the User Settings screen is per-user (use user migrations); the Global Settings screen is per-device (use global migrations).

## Step 2 — Determine the next version number

Read [`source/migrations.bs`](../../../source/migrations.bs) and find the highest existing migration version in your scope. The next migration is `prevMax + 1`.

Migration versions are stored in the registry under a known key (see the doc) so the runner knows which migrations to skip on subsequent runs.

## Step 3 — Write the migration function

The migration function takes the registry section (a `roRegistrySection`) and applies the change. Common shapes:

**Rename:**
```brightscript
sub migrateRenameAutoplay(section as object)
  oldVal = section.Read("autoplay")
  if oldVal <> "" then
    section.Write("playbackAutoplayEnabled", oldVal)
    section.Delete("autoplay")
  end if
end sub
```

**Remove:**
```brightscript
sub migrateDropDeprecatedFlag(section as object)
  section.Delete("deprecatedFlag")
end sub
```

**Reshape:**
```brightscript
sub migrateSplitVolumeSettings(section as object)
  oldVal = section.Read("audioVolume")
  if oldVal <> "" then
    parsed = ParseJson(oldVal)
    section.Write("audioVolumeMain", str(parsed.main))
    section.Write("audioVolumeSurround", str(parsed.surround))
    section.Delete("audioVolume")
  end if
end sub
```

Always guard against the missing-key case (`<empty string>` from `Read`) — partial migrations from interrupted runs are real.

## Step 4 — Register the migration

Add the function to the migration runner array in `source/migrations.bs` at the right index (matches the version number you picked). The runner walks the array in order; missing indices are gaps the runner skips.

## Step 5 — Update downstream code

Once the migration runs, the OLD key is gone from registry. Update every reader and writer of the old key to use the new key:

```bash
grep -rn "<old-key>" components/ source/ | grep -v migrations.bs
```

The migration file itself keeps the old key name (that's where the rename lives) — every other reference should use the new name.

## Step 6 — Write a registry-isolated integration test

Per [`tests/CLAUDE.md`](../../../tests/CLAUDE.md): integration tests for migrations live in `tests/source/integration/migration/`. Use a `test-` prefixed registry section (the BaseTestSuite clears `test-*` between tests automatically when `m.needsRegistrySetup = true`).

The test should:
1. Pre-write the OLD key to a `test-*` section.
2. Invoke the migration function directly.
3. Assert the OLD key is gone.
4. Assert the NEW key has the migrated value.

Don't mock the registry — use a real `roRegistrySection`. The integration is the point.

## Step 7 — Run on hardware to verify

```bash
npm run test:integration
```

The integration suite runs on the Roku and exercises real registry I/O. If hardware isn't reachable, say so explicitly — migrations that pass build but fail at runtime are a real risk.

## Step 8 — Capture the rename in a decisions.md entry (optional)

If the rename is non-obvious (e.g., the new name is shorter or follows a new convention), invoke `/log decision` with a slug like `rename-<old>-to-<new>` so future-you knows why.

## Common pitfalls (from the doc)

- **Forgetting to update downstream readers** — the migration moves the data but readers still try to read the old key, getting empty strings. Test on hardware to catch.
- **Not handling the missing-key case** — a partially-completed prior migration can leave the registry in an unexpected state.
- **Mocking the registry in tests** — defeats the integration. Use real `test-*` sections.
- **Skipping `m.needsRegistrySetup = true`** — cross-test leakage masks real failures.

## When NOT to use

- Brand-new setting → `/new-setting`, not `/new-migration`.
- Changing a default value → no migration needed, just update `settings/settings.json`.
- UI label / description change → no migration needed.

## Sub-agent invocation

To invoke from a sub-agent: parent passes `Read .claude/skills/new-migration/SKILL.md and follow the steps for $ARGUMENTS=<rename-or-removal-description>; surface each step's diff but do NOT commit` in the Task prompt.

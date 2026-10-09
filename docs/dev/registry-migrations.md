---
topic: registry-migrations
related-files:
  - source/migrations.bs
  - source/utils/config.bs
  - source/main.bs
  - tests/source/integration/migration/SettingsMigration.spec.bs
last-reviewed: 2026-10-09
---

# Registry migrations

How to write a registry migration: the code in `source/migrations.bs` that changes what users already have stored when a setting is renamed, removed or stored differently. For how the runner works (the version gate, test mode, the sections it skips), see [`migrations.md`](../architecture/migrations.md).

## When you need one

Write a migration when you change something users have already stored:

- **Rename a setting:** `playbackPreferredAudioCodec` became `playbackPreferredMultichannelCodec`.
- **Change its values:** `"auto"` and `"aac"` became `"eac3"`.
- **Remove a setting**, or data that now comes from the server (`homeSection0` to `homeSection6`).
- **Store it differently**, such as one key split in two.

You don't need one to add a setting (its default comes from `settings/settings.json`), to change a default, or to add data the server owns. Adding a setting is [`new-user-setting.md`](new-user-setting.md).

## How a migration runs

`Main()` in `source/main.bs` calls `runGlobalMigrations()` for the global `JellyRock` section, then `runRegistryUserMigrations()` for every user section, before it creates the scene. Each migration is a block guarded by a version:

```brighterscript
if isValid(lastRunVersion) and not versionChecker(lastRunVersion, AUDIO_CODEC_MIGRATION_VERSION)
```

`versionChecker(a, b)` is true when `a` is at least `b`, so the block runs when the section was last used by a version older than the constant. A user several versions behind runs every block they missed, in file order.

Write each migration so it can run more than once:

- **A user section with no `LastRunVersion` is treated as `0.0.0`**, so every migration runs on it.
- **Only a production build records the version a user ran.** On a sideloaded build, the user migrations run again at every launch.

Running twice must change nothing the first run didn't. Check before you write, the way the theme migration skips a user who already has `uiTheme`.

## Write the migration

### 1. Add a version constant

At the top of `source/migrations.bs`, after the last one, with a comment saying what changed:

```brighterscript
' client version when homeSection settings were removed from registry (now server-authoritative via DisplayPreferences)
const HOMESECTION_CLEANUP_VERSION = "2.13.0"
```

Name it for what it does, in `UPPER_SNAKE_CASE` ending in `_VERSION`: the existing ones end in `_MIGRATION_VERSION`, `_CLEANUP_VERSION` or `_REMOVAL_VERSION`.

The value is the release the change ships in. `manifest` holds the last released version, and the release workflow raises it. So the constant must be above the manifest's version: a section already on the constant's version skips the block, and any user who installed the release before your change would never be migrated.

### 2. Add the block

Put it at the end of the function for your scope, so the blocks stay in version order:

- **A user setting:** `runRegistryUserMigrations()`. Inside it, `reg` is the user's section and `section` its name.
- **A global setting** (in the `JellyRock` section): `runGlobalMigrations()`.

A rename that also changes values, from `AUDIO_CODEC_MIGRATION_VERSION`:

```brighterscript
' AUDIO_CODEC_MIGRATION_VERSION - Rename and migrate audio codec preference
if isValid(lastRunVersion) and not versionChecker(lastRunVersion, AUDIO_CODEC_MIGRATION_VERSION)
  m.wasMigrated = true

  oldSettingName = "playbackPreferredAudioCodec"
  newSettingName = "playbackPreferredMultichannelCodec"

  if reg.exists(oldSettingName)
    print `Migrating audio codec settings to v${AUDIO_CODEC_MIGRATION_VERSION} for userid: ${section}`
    oldValue = reg.read(oldSettingName)

    ' Migrate deprecated values (auto, aac) to eac3, otherwise preserve existing value
    newValue = "eac3"
    if isValid(oldValue) and oldValue <> "" and oldValue <> "auto" and oldValue <> "aac"
      newValue = oldValue
    end if

    reg.write(newSettingName, newValue)
    reg.delete(oldSettingName)
    print `Migrated ${oldSettingName}='${oldValue}' to ${newSettingName}='${newValue}'`
    reg.flush()
  else
    print `No audio codec migration needed for userid: ${section} (setting not found)`
  end if
end if
```

Every block follows the same rules:

- **Set `m.wasMigrated = true`.** `Main()` then prints the registry, so the console shows what changed.
- **Write only what the user had.** When the old key is missing, write nothing: the default comes from `settings/settings.json`. A default written to the registry stops a later change to the default from reaching that user.
- **Delete the old key** once its value is written under the new one.
- **Call `reg.flush()` when you wrote or deleted something**, and only then.
- **Print one line for what you did and one for when nothing was needed.** The console is how a migration on someone's device gets debugged.

### 3. Update the code that uses the old name

After a rename, only the new name exists, so nothing may read the old one:

1. **`settings/settings.json`:** change the setting's `settingName`. The `jellyrock-bot` workflow regenerates [`docs/user/app-settings.md`](../user/app-settings.md) from it; never edit that file by hand.
2. **`components/data/jellyfin/JellyfinUserSettings.xml`:** change the field's `id`. `user.Login()` loads each registry key into the settings field with the same name, so a key with no field is never loaded.
3. **Everything else:** search for the old name and change each hit outside `source/migrations.bs`:

   ```bash
   git grep -n "<old-name>" -- source components settings tests ':!source/migrations.bs'
   ```

## Test it

A migration test is an integration test under `tests/source/integration/migration/`, one spec per migration, named for it (`AudioCodecMigration.spec.bs`). The rules for registry tests are in [`unit-tests.md`](unit-tests.md#test-the-registry). For a migration:

- **Tag the suite `@tags("migration")`** and set `m.needsRegistrySetup = true` before `super.setup()`.
- **Name each section `test-<something>`**, unique to its test. In test mode the runner migrates only `test-` sections, so a real user's data is never touched.
- **Write `serverId`.** The runner skips a section without one as an unfinished login, so a test that leaves it out passes without running the migration.
- **Pass the section to the runner:** `runRegistryUserMigrations([testUserId])`, so other tests' sections stay out of it.

```brighterscript
@it("migrates playbackPreferredAudioCodec to playbackPreferredMultichannelCodec")
function _()
  testUserId = "test-audio-migration-001"

  reg = CreateObject("roRegistrySection", testUserId)
  reg.write("serverId", m.global.server.id)
  reg.write("LastRunVersion", "1.1.4")
  reg.write("playbackPreferredAudioCodec", "eac3")
  reg.flush()

  runRegistryUserMigrations([testUserId])

  reg = CreateObject("roRegistrySection", testUserId)
  m.assertEqual(reg.read("playbackPreferredMultichannelCodec"), "eac3")
  m.assertFalse(reg.exists("playbackPreferredAudioCodec"))
end function
```

Cover these cases:

| Case | What to check |
| --- | --- |
| The old key is there | The new key holds its value, and the old key is gone |
| Each value the migration changes | It becomes the new value |
| A value it keeps | It is unchanged |
| The old key is missing | Nothing is written |
| Old and new keys both there | The result is what you decided, and the old key is gone |
| `LastRunVersion` at the constant's version | The block does not run |
| `LastRunVersion` just below it | The block runs |
| The block runs twice | The second run changes nothing |
| Two users | Each keeps their own value |

Also add your old keys to `"migrates all user settings from old to new names"` in [`SettingsMigration.spec.bs`](../../tests/source/integration/migration/SettingsMigration.spec.bs). It starts a user at `1.0.0` and runs every migration in order, which catches one migration undoing another.

### Run the tests

The `migration` tag keeps these suites out of `test:all` and `test:integration`. Run them one of two ways:

- **Your spec alone:** list it in your TDD config and run `npm run test:tdd` ([`unit-tests-tdd.md`](unit-tests-tdd.md)).
- **Every suite, migrations included:** `npm run test:complete`. It records code coverage, so it takes much longer.

Then try it on a device with real data. Sideload a build from before your change (`git switch --detach <last-release-tag>`), sign in and change the setting so the old key is stored. Then sideload your build over it and watch the console (`telnet <roku-ip> 8085`): it prints your migration's lines, then the registry.

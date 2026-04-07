# Registry Migrations Guide

This guide documents the complete process for creating and testing registry migrations in JellyRock. Follow these steps carefully to ensure data integrity and avoid overlooking critical updates.

## Table of Contents

1. [Overview](#overview)
2. [When to Create a Migration](#when-to-create-a-migration)
3. [Migration Implementation](#migration-implementation)
4. [Code Updates Required](#code-updates-required)
5. [Test Implementation](#test-implementation)
6. [Mock Data Organization](#mock-data-organization)
7. [Best Practices](#best-practices)
8. [Common Pitfalls](#common-pitfalls)

---

## Overview

Registry migrations run in `source/main.bs` **before** any data transformers or session loading occurs. This means:

- Migrations execute once per app version update
- By the time `SessionDataTransformer` loads, **only NEW names exist** in the registry
- Default values come from `settings/settings.json` and are **never** written to registry unless explicitly changed by the user
- Registry cleanup between tests is **automatic** via `BaseTestSuite` when `m.needsRegistrySetup = true`

**Migration Flow:**

```text
Main.bs startup
  → runGlobalMigrations() (for "JellyRock" section)
  → runRegistryUserMigrations() (for user sections)
  → Session loading starts
  → SessionDataTransformer reads registry (NEW names only)
```

---

## When to Create a Migration

Create a migration when:

1. **Renaming settings**: Changing registry key names (e.g., `playback.preferredAudioCodec` → `playbackPreferredMultichannelCodec`)
2. **Migrating values**: Transforming setting values (e.g., `"auto"` → `"eac3"`, deprecated values)
3. **Removing settings**: Deleting obsolete or server-authoritative data from registry
4. **Schema changes**: Restructuring how data is stored (e.g., flat → nested)

**Do NOT create migrations for:**

- Adding new settings (defaults handle this)
- Server-authoritative data (policy, configuration) - these should never be in registry
- Temporary/session data

---

## Migration Implementation

### Step 1: Add Version Constant

Add a new constant at the top of `source/migrations.bs`:

```brighterscript
' client version when [description of what changed]
const YOUR_MIGRATION_VERSION = "X.Y.Z"
```

**Naming Convention:**

- Use `SCREAMING_SNAKE_CASE`
- End with `_MIGRATION_VERSION` suffix
- Be descriptive (e.g., `AUDIO_CODEC_MIGRATION_VERSION`, `SETTINGS_MIGRATION_VERSION`)

**Example:**

```brighterscript
' client version when audio codec preference was renamed and migrated
const AUDIO_CODEC_MIGRATION_VERSION = "1.1.5"
```

### Step 2: Add Migration Block

Add a new migration block in **chronological order** (by version) in the appropriate function:

- **Global settings** (`globalRememberMe`, etc.) → Add to `runGlobalMigrations()`
- **User settings** (everything else) → Add to `runRegistryUserMigrations()`

**Template for User Settings Migration:**

```brighterscript
' YOUR_MIGRATION_VERSION - [Description]
if isValid(lastRunVersion) and not versionChecker(lastRunVersion, YOUR_MIGRATION_VERSION)
  m.wasMigrated = true

  ' [Describe what this migration does]
  oldSettingName = "oldName"
  newSettingName = "newName"

  if reg.exists(oldSettingName)
    print `Migrating [description] to v${YOUR_MIGRATION_VERSION} for userid: ${section}`
    oldValue = reg.read(oldSettingName)

    ' [Optional] Transform value if needed
    newValue = oldValue
    if oldValue = "deprecatedValue"
      newValue = "newDefaultValue"
    end if

    reg.write(newSettingName, newValue)
    reg.delete(oldSettingName)
    print `Migrated ${oldSettingName}='${oldValue}' to ${newSettingName}='${newValue}'`
    reg.flush()
  else
    print `No migration needed for userid: ${section} (setting not found)`
  end if
end if
```

**Version Checking Logic:**

```brighterscript
not versionChecker(lastRunVersion, YOUR_MIGRATION_VERSION)
```

This returns `true` when `lastRunVersion < YOUR_MIGRATION_VERSION`, meaning the migration should run.

**Example:** User on v1.1.4 with `AUDIO_CODEC_MIGRATION_VERSION = "1.1.5"`:

- ✅ Migration runs because `1.1.4 < 1.1.5`

**Important:** Multiple migrations can run in sequence! A user on v1.0.0 will run ALL migrations where `1.0.0 < MIGRATION_VERSION`.

### Step 3: Handle Value Migrations

When migrating **values** (not just names), apply transformation logic:

```brighterscript
' Migrate deprecated values to new defaults
newValue = "defaultValue"  ' Set default first

if isValid(oldValue) and oldValue <> "" and oldValue <> "deprecatedValue1" and oldValue <> "deprecatedValue2"
  ' User had a valid non-deprecated value - preserve it
  newValue = oldValue
end if
```

**⚠️ Critical Rule:** Never write default values to registry! Only write values that the user explicitly set or that are being migrated from old values.

---

## Code Updates Required

When a migration renames a setting, update these files:

### 1. `settings/settings.json`

Update the `settingName` field:

```json
{
  "title": "Setting Display Name",
  "description": "Setting description",
  "settingName": "newSettingName",  // ← Update this
  "type": "radio",
  "default": "defaultValue"
}
```

### 2. `components/data/jellyfin/JellyfinUserSettings.xml`

Update the field `id`:

```xml
<field id="newSettingName" type="string" alwaysNotify="true" />
```

**Note:** Field type must match the setting type (boolean, integer, string).

### 3. `source/data/SessionDataTransformer.bs`

Update the transformer to read the **NEW** name:

```brighterscript
' WRONG - reads old name (migrations already ran!)
settingsNode.oldSettingName = settingsData["oldSettingName"] ?? ""

' CORRECT - reads new name (after migrations)
settingsNode.newSettingName = settingsData["newSettingName"] ?? ""
```

**⚠️ Critical:** `SessionDataTransformer` runs AFTER migrations, so it must use NEW names only. No backward compatibility needed!

### 4. Other Code References

Search the codebase for any other references to the old setting name:

```bash
grep -r "oldSettingName" source/ components/
```

Common places to check:

- `source/utils/deviceCapabilities.bs` - Device profile logic
- `source/showScenes.bs` - Scene configuration
- Component logic that reads settings directly

**Example:**

```brighterscript
' WRONG
preferredCodec = globalUserSettings.oldSettingName

' CORRECT
preferredCodec = globalUserSettings.newSettingName
```

### 5. Update Setting Count Comments

Update the comment in `source/migrations.bs` that documents total settings:

```brighterscript
' Define all XX setting migrations (old dotted name → new camelCase name)
```

Count should include ALL settings in the migrations object, including auth settings like `token` and `primaryimagetag`.

---

## Test Implementation

### Test File Location

Create or update test files in `tests/source/integration/migration/`:

- `SettingsMigration.spec.bs` - Comprehensive test for ALL migrations (update this when adding new migrations)
- `[YourFeature]Migration.spec.bs` - Focused tests for your specific migration

### Required Test Structure

```brighterscript
namespace tests

  @suite("Your Migration - vX.Y.Z")
  @tags("migration")
  class YourMigrationTests extends tests.BaseTestSuite

    protected override sub setup()
      m.needsRegistrySetup = true  ' ← Enables automatic cleanup
      super.setup()
    end sub

    ' Tests here...

  end class

end namespace
```

### Required Test Categories

#### 1. Basic Migration Test

Test that the migration runs and transforms settings correctly:

```brighterscript
@it("migrates oldName to newName")
function _()
  testUserId = "test-your-migration-001"

  reg = CreateObject("roRegistrySection", testUserId)
  reg.write("LastRunVersion", "X.Y.Z-1") ' Version before your migration
  reg.write("oldSettingName", "testValue")
  reg.flush()

  ' WHEN: Migration runs (isolated to this user)
  runRegistryUserMigrations([testUserId])

  ' THEN: New setting exists with correct value
  reg = CreateObject("roRegistrySection", testUserId)
  m.assertTrue(reg.exists("newSettingName"))
  m.assertEqual(reg.read("newSettingName"), "testValue")

  ' AND: Old setting is deleted
  m.assertFalse(reg.exists("oldSettingName"))
end function
```

**⚠️ Test Isolation:** Always pass `[testUserId]` array to `runRegistryUserMigrations()` for edge case tests to prevent cross-test contamination.

#### 2. Value Migration Tests (if applicable)

Test that deprecated values are transformed:

```brighterscript
@it("migrates deprecated value 'auto' to 'newDefault'")
function _()
  testUserId = "test-value-migration-001"

  reg = CreateObject("roRegistrySection", testUserId)
  reg.write("LastRunVersion", "X.Y.Z-1")
  reg.write("oldSettingName", "auto")
  reg.flush()

  runRegistryUserMigrations([testUserId])

  reg = CreateObject("roRegistrySection", testUserId)
  m.assertEqual(reg.read("newSettingName"), "newDefault")
end function
```

Test that valid values are preserved:

```brighterscript
@it("preserves valid value during migration")
function _()
  testUserId = "test-preserve-value-001"

  reg = CreateObject("roRegistrySection", testUserId)
  reg.write("LastRunVersion", "X.Y.Z-1")
  reg.write("oldSettingName", "validValue")
  reg.flush()

  runRegistryUserMigrations([testUserId])

  reg = CreateObject("roRegistrySection", testUserId)
  m.assertEqual(reg.read("newSettingName"), "validValue")
end function
```

#### 3. Edge Cases

Test partial/missing settings:

```brighterscript
@it("handles missing old setting gracefully")
function _()
  testUserId = "test-missing-001"

  reg = CreateObject("roRegistrySection", testUserId)
  reg.write("LastRunVersion", "X.Y.Z-1")
  ' Don't write the old setting
  reg.flush()

  runRegistryUserMigrations([testUserId])

  reg = CreateObject("roRegistrySection", testUserId)
  m.assertFalse(reg.exists("newSettingName"))
  m.assertFalse(reg.exists("oldSettingName"))
end function
```

Test mixed old/new settings (interrupted migration scenario):

```brighterscript
@it("handles mixed old and new settings (old overwrites new)")
function _()
  testUserId = "test-mixed-001"

  reg = CreateObject("roRegistrySection", testUserId)
  reg.write("LastRunVersion", "X.Y.Z-1")
  reg.write("oldSettingName", "oldValue")
  reg.write("newSettingName", "newValue")  ' Already exists!
  reg.flush()

  runRegistryUserMigrations([testUserId])

  reg = CreateObject("roRegistrySection", testUserId)
  m.assertEqual(reg.read("newSettingName"), "oldValue", "Old value should overwrite new")
  m.assertFalse(reg.exists("oldSettingName"))
end function
```

#### 4. Version Checking

Test that migration skips when already run:

```brighterscript
@it("skips migration when version already >= vX.Y.Z")
function _()
  testUserId = "test-skip-001"

  reg = CreateObject("roRegistrySection", testUserId)
  reg.write("LastRunVersion", "X.Y.Z")  ' Already on this version
  reg.write("oldSettingName", "value")
  reg.flush()

  runRegistryUserMigrations([testUserId])

  reg = CreateObject("roRegistrySection", testUserId)
  m.assertTrue(reg.exists("oldSettingName"), "Old setting should remain (no migration)")
  m.assertFalse(reg.exists("newSettingName"), "New setting should not exist")
end function
```

Test that migration runs for older versions:

```brighterscript
@it("runs migration for version vX.Y.Z-1")
function _()
  testUserId = "test-run-001"

  reg = CreateObject("roRegistrySection", testUserId)
  reg.write("LastRunVersion", "X.Y.Z-1")
  reg.write("oldSettingName", "value")
  reg.flush()

  runRegistryUserMigrations([testUserId])

  reg = CreateObject("roRegistrySection", testUserId)
  m.assertTrue(reg.exists("newSettingName"))
  m.assertFalse(reg.exists("oldSettingName"))
end function
```

#### 5. Multi-User Independence

Test that multiple users migrate independently:

```brighterscript
@it("migrates multiple users independently with different values")
function _()
  user1 = "test-multi-user-001"
  user2 = "test-multi-user-002"

  reg1 = CreateObject("roRegistrySection", user1)
  reg1.write("LastRunVersion", "X.Y.Z-1")
  reg1.write("oldSettingName", "value1")
  reg1.flush()

  reg2 = CreateObject("roRegistrySection", user2)
  reg2.write("LastRunVersion", "X.Y.Z-1")
  reg2.write("oldSettingName", "value2")
  reg2.flush()

  ' Migrate both users
  runRegistryUserMigrations([user1, user2])

  reg1 = CreateObject("roRegistrySection", user1)
  m.assertEqual(reg1.read("newSettingName"), "value1")

  reg2 = CreateObject("roRegistrySection", user2)
  m.assertEqual(reg2.read("newSettingName"), "value2")
end function
```

#### 6. ALL Migrations Test (Update when adding new migrations)

**⚠️ Critical:** Update `SettingsMigration.spec.bs` test "migrates all user settings from old to new names" to include your new migration. This ensures that running ALL migrations in sequence doesn't corrupt data.

Example:

```brighterscript
@it("migrates all user settings from old to new names")
function _()
  testUserId = "test-migration-user-001"

  reg = CreateObject("roRegistrySection", testUserId)
  reg.write("LastRunVersion", "1.0.0")  ' Old version - runs ALL migrations

  ' Write OLD setting names for ALL migrations
  reg.write("playback.preferredAudioCodec", "ac3")  ' v1.1.0 migration
  reg.write("your.old.setting", "value")             ' Your new migration
  reg.flush()

  runRegistryUserMigrations()  ' Run ALL migrations

  reg = CreateObject("roRegistrySection", testUserId)

  ' Verify settings migrated through ALL versions correctly
  m.assertTrue(reg.exists("playbackPreferredMultichannelCodec"))  ' After v1.1.0 AND v1.1.5
  m.assertEqual(reg.read("playbackPreferredMultichannelCodec"), "ac3")
  m.assertFalse(reg.exists("playbackPreferredAudioCodec"), "Intermediate should be deleted")

  m.assertTrue(reg.exists("yourNewSettingName"))
  m.assertEqual(reg.read("yourNewSettingName"), "value")
end function
```

### Test Registry Section Naming

**⚠️ Always use `"test-"` prefix for test registry sections:**

```brighterscript
' CORRECT - auto-detected as test mode
testUserId = "test-migration-user-001"
testUserId = "test-audio-codec-001"

' WRONG - might touch production data!
testUserId = "migration-user-001"
```

The migration code automatically detects test mode when ANY section starts with `"test-"` and will ONLY migrate test sections in that scenario.

### Automatic Cleanup

Cleanup is **automatic** when you set `m.needsRegistrySetup = true` in `setup()`:

```brighterscript
protected override sub setup()
  m.needsRegistrySetup = true  ' ← Triggers automatic cleanup via BaseTestSuite
  super.setup()
end sub
```

**Manual cleanup should NEVER be needed** unless testing global sections like `"test-global"` (which are explicitly skipped by migrations). In that case:

```brighterscript
' Cleanup for explicitly skipped sections
testGlobalReg.delete("settingName")
testGlobalReg.delete("LastRunVersion")
testGlobalReg.flush()
```

---

## Mock Data Organization

### Directory Structure

Organize mock data by data source and category:

```text
tests/source/mocks/
├── api/                          # Jellyfin Server API responses
│   ├── deviceProfiles/          # Device profile mocks
│   │   ├── device-profile-8ch-passthrough.json
│   │   ├── device-profile-stereo-only.json
│   │   └── device-profile-aac-only.json
│   └── items/                   # Item metadata mocks
│       ├── movie-basic.json
│       ├── episode-basic.json
│       └── series-basic.json
├── registry/                    # Roku Registry data
│   └── userSettings/            # User settings from registry
│       ├── user-settings-all-new-names.json
│       └── user-settings-all-old-names.json
├── roku/                        # Roku Device API responses
│   ├── deviceInfo/              # Device info mocks
│   └── capabilities/            # Capability mocks
├── devices/                     # Existing device mocks
├── servers/                     # Existing server mocks
└── users/                       # Existing user mocks
```

### Loading Mock Data in Tests

**⚠️ Critical: Use centralized `MockDataLoader` functions only!**

All mock data loading helpers MUST be in `tests/source/shared/MockDataLoader.bs`. Never create duplicate helper functions in individual test files. This ensures consistency and maintainability.

**Available `MockDataLoader` functions:**

```brighterscript
' Load item mocks (movies, episodes, series, programs)
mockItem = MockDataLoader.LoadItem("movie-basic")

' Load device profile mocks
mockProfile = MockDataLoader.LoadDeviceProfile("device-profile-8ch-passthrough")

' Load registry user settings mocks
mockSettings = MockDataLoader.LoadRegistryUserSettings("user-settings-all-new-names")

' Load Roku device info mocks
mockDeviceInfo = MockDataLoader.LoadRokuDeviceInfo("roku-ultra-capabilities")

' Load Roku capabilities mocks
mockCapabilities = MockDataLoader.LoadRokuCapabilities("audio-codecs-full")

' Load server/user/device test fixtures (existing functions)
mockServer = MockDataLoader.LoadServer("default")
mockUser = MockDataLoader.LoadUser("admin")
mockDevice = MockDataLoader.LoadDevice("roku-ultra")
```

**If you need a new mock loading function:**

1. Add it to `tests/source/shared/MockDataLoader.bs` namespace
2. Follow the naming convention: `Load[Category](name as string) as object`
3. Use the pattern: `filePath = "pkg:/source/tests/mocks/[source]/[category]/" + name + ".json"`
4. Update this documentation to include the new function

### Creating New Mock Files

When creating mocks for a migration:

1. Create `*-old-names.json` with settings using OLD names (pre-migration state)
2. Create `*-new-names.json` with settings using NEW names (post-migration state)
3. Place in appropriate subfolder based on data source

**Example:**

```text
tests/source/mocks/registry/userSettings/
├── user-settings-all-old-names.json      # Pre-migration (dotted names)
└── user-settings-all-new-names.json      # Post-migration (camelCase names)
```

---

## Best Practices

### 1. Migration Design

- ✅ **DO** keep migrations simple and focused on one change
- ✅ **DO** add migrations in chronological order by version
- ✅ **DO** preserve user data whenever possible
- ✅ **DO** print log messages for debugging (visible in test output and production logs)
- ❌ **DON'T** combine multiple unrelated changes in one migration
- ❌ **DON'T** write default values to registry (let `settings.json` handle defaults)
- ❌ **DON'T** add backward compatibility to transformers (migrations handle this)

### 2. Version Management

- Use semantic versioning (MAJOR.MINOR.PATCH)
- Migration versions should match the app version where they were introduced
- Test that migrations run correctly when jumping multiple versions (e.g., v1.0.0 → v1.2.0 should run all intermediate migrations)

### 3. Testing Strategy

- Test in isolation (one user at a time with `[testUserId]` parameter)
- Test with multiple users to verify independence
- Test version boundaries (version before migration, at migration, after migration)
- Update the comprehensive "all migrations" test when adding new migrations
- Always use `"test-"` prefix for test registry sections

### 4. Code Organization

- Keep migration logic in `source/migrations.bs` only
- Update transformers to use NEW names only (no backward compatibility)
- Use descriptive constant names for migration versions
- Document what each migration does in comments

### 5. Registry Best Practices

- **NEVER** write default values to registry (only write user changes)
- **ALWAYS** delete old setting names after migration
- **ALWAYS** flush registry after writes (`reg.flush()`)
- **VERIFY** that server-authoritative data (policy, configuration) is NOT in registry

---

## Common Pitfalls

### 1. ❌ Transformer Reading Old Names

**Problem:**

```brighterscript
' SessionDataTransformer.bs
settingsNode.oldSettingName = settingsData["oldSettingName"] ?? ""
```

**Why this fails:** Migrations run BEFORE transformers. By the time the transformer runs, only NEW names exist in the registry.

**Solution:**

```brighterscript

```brighterscript
settingsNode.newSettingName = settingsData["newSettingName"] ?? ""
```

### 2. ❌ Writing Default Values to Registry

**Problem:**

```brighterscript
if not reg.exists("newSettingName")
  reg.write("newSettingName", "defaultValue")  ' ❌ WRONG!
end if
```

**Why this fails:** Default values come from `settings/settings.json`. Writing them to registry defeats the purpose of having a single source of truth.

**Solution:**

```brighterscript
' Only write when migrating from an existing old value
if reg.exists("oldSettingName")
  oldValue = reg.read("oldSettingName")
  reg.write("newSettingName", oldValue)
  reg.delete("oldSettingName")
end if
' If old setting doesn't exist, don't write anything!
```

### 3. ❌ Test Registry Section Naming

**Problem:**

```brighterscript
testUserId = "migration-test-001"  ' ❌ Missing "test-" prefix
```

**Why this fails:** Migration code won't detect test mode and might process production registry sections.

**Solution:**

```brighterscript
testUserId = "test-migration-001"  ' ✅ Starts with "test-"
```

### 4. ❌ Not Isolating Tests

**Problem:**

```brighterscript
' Edge case test
runRegistryUserMigrations()  ' ❌ Runs on ALL sections!
```

**Why this fails:** Test data from previous tests accumulates, causing cross-test contamination.

**Solution:**

```brighterscript

```brighterscript
runRegistryUserMigrations([testUserId])  ' ✅ Isolated to one user
```

### 5. ❌ Forgetting to Update ALL Migrations Test

**Problem:** Adding a new migration but not updating the comprehensive test in `SettingsMigration.spec.bs`.

**Why this fails:** Multi-version upgrades (e.g., v1.0.0 → v1.2.0) might not be tested, leading to data corruption when multiple migrations run in sequence.

**Solution:** Always update the "migrates all user settings from old to new names" test to include your new migration's settings.

### 6. ❌ Incorrect Version Skip Logic

**Problem:**

```brighterscript
@it("skips migration when version already migrated (v1.1.0+)")
function _()
  reg.write("LastRunVersion", "1.1.0")  ' ❌ Only skips v1.1.0, NOT v1.1.5!
```

**Why this fails:** If there are multiple migrations (e.g., v1.1.0 and v1.1.5), setting `LastRunVersion = "1.1.0"` will skip v1.1.0 but still run v1.1.5.

**Solution:**

```brighterscript
@it("skips all migrations when version already migrated (v1.1.5+)")
function _()
  reg.write("LastRunVersion", "1.1.5")  ' ✅ Skips ALL migrations up to v1.1.5
```

### 7. ❌ Not Searching for All Code References

**Problem:** Updating the migration and transformer but missing a reference in `deviceCapabilities.bs` that still uses the old name.

**Solution:** Always grep the entire codebase:

```bash
grep -r "oldSettingName" source/ components/
```

---

## Task Checklist

When implementing a registry migration, use this checklist to ensure nothing is overlooked.

> **Note:** Checklist states are for local tracking only. Please reset all checkboxes to `[ ]` before committing changes to this file.

### Phase 1: Migration Code

- [ ] Add version constant to `source/migrations.bs` (SCREAMING_SNAKE_CASE with `_MIGRATION_VERSION` suffix)
- [ ] Add migration block in chronological order in appropriate function (`runGlobalMigrations()` or `runRegistryUserMigrations()`)
- [ ] Implement value transformation logic (if migrating values, not just names)
- [ ] Add print statements for debugging and production logs
- [ ] Verify migration uses `reg.flush()` after writes
- [ ] Verify old setting names are deleted after migration

### Phase 2: Code Updates

- [ ] Update `settings/settings.json` with new `settingName`
- [ ] Update `components/data/jellyfin/JellyfinUserSettings.xml` field `id`
- [ ] Update `source/data/SessionDataTransformer.bs` to read NEW name only
- [ ] Search codebase for other references: `grep -r "oldSettingName" source/ components/`
- [ ] Update any component logic that reads the setting directly
- [ ] Update setting count comment in `source/migrations.bs`
- [ ] Verify no default values are being written to registry

### Phase 3: Test Implementation

- [ ] Create or update test file in `tests/source/integration/migration/`
- [ ] Extend `tests.BaseTestSuite` with `m.needsRegistrySetup = true` in `setup()`
- [ ] Add basic migration test (old name → new name)
- [ ] Add value migration tests (if applicable): deprecated values and preserved values
- [ ] Add edge case tests: missing setting, empty registry, mixed old/new settings
- [ ] Add version checking tests: skip when already migrated, run for older versions
- [ ] Add multi-user independence test
- [ ] Update `SettingsMigration.spec.bs` "migrates all user settings" test to include new migration
- [ ] Verify all test registry sections use `"test-"` prefix
- [ ] Verify edge case tests use isolated execution: `runRegistryUserMigrations([testUserId])`

### Phase 4: Mock Data

- [ ] Create mock data files in appropriate `tests/source/mocks/` subfolder (i.e. `api/`, `registry/`, `roku/`)
- [ ] Create `*-old-names.json` mock (pre-migration state)
- [ ] Create `*-new-names.json` mock (post-migration state)
- [ ] If new helper function needed, add to `tests/source/shared/MockDataLoader.bs` (NOT individual test files)
- [ ] Verify mock data structure matches actual API/registry responses
- [ ] Update documentation if new `MockDataLoader` function added

### Phase 5: Testing & Validation

- [ ] Format code: `npm run format`
- [ ] Verify no new IDE code errors introduced
- [ ] Test locally on device with real registry data (if possible)
- [ ] Verify logs show migrations running correctly

### Phase 6: Documentation & Commit

- [ ] Add descriptive commit message following conventional commits format
- [ ] Update this document if any new patterns or pitfalls were discovered
- [ ] Reset this checklist to unchecked state before committing
- [ ] Create PR with comprehensive description of migration and testing

---

## Questions or Issues?

If you encounter issues not covered in this guide:

1. Check the git history for similar migrations: `git log --all --grep="migration"`
2. Search test files for patterns: `grep -r "@suite.*Migration" tests/`
3. Review existing migration blocks in `source/migrations.bs`
4. Ask for clarification in PR reviews or team discussions

**Remember:** When in doubt, isolate tests, verify version logic, and always check that only NEW names are used after migrations run!

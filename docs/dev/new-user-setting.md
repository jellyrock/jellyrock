# Adding User Settings Guide

This guide documents the complete process for adding new user settings to JellyRock. Follow these steps carefully to ensure consistency, proper data flow, and avoid common pitfalls.

## Table of Contents

1. [Overview](#overview)
2. [When to Add a Setting](#when-to-add-a-setting)
3. [Settings Architecture](#settings-architecture)
4. [Implementation Steps](#implementation-steps)
5. [Testing Requirements](#testing-requirements)
6. [Best Practices](#best-practices)
7. [Common Pitfalls](#common-pitfalls)
8. [Task Checklist](#task-checklist)

---

## Overview

JellyRock has three types of settings:

1. **User Settings** - Stored in registry per-user, managed by JellyRock (Settings → Playback, UI, etc.)
2. **Global Settings** - Stored in global registry section, apply to all users on the device (Settings → Global)
3. **User Configuration** - Server-authoritative from Jellyfin API, **NEVER** stored in registry

This guide covers **User Settings** and **Global Settings**.

**Key Principles:**

- Default values come from `settings/settings.json` (single source of truth)
- Defaults are **NEVER** written to registry (only user changes are saved)
- Settings are loaded at app startup via `SessionDataTransformer`
- All settings must have proper type safety and validation

**Data Flow:**

```text
App Startup
  → SessionDataTransformer reads registry
  → Loads defaults from settings.json for missing values
  → Populates JellyfinUserSettings node
  → Application code reads from m.global.user.settings
```

---

## When to Add a Setting

Add a **user setting** when:

1. **Per-device preference**: Users need different values on Roku vs other Jellyfin clients
2. **JellyRock specific feature**: Setting controls Roku-only functionality
3. **Override server settings**: Users want to override web client preferences on Roku

Add a **global setting** when:

1. **Device-wide behavior**: Setting affects all users on the Roku device
2. **Login/session behavior**: Setting controls authentication or user selection
3. **Shared device configuration**: Setting should persist regardless of which user is logged in

**Examples:**

- ✅ "Remember Me?" (`globalRememberMe`) - Device-wide setting to remember active user
- ✅ "Play Default Audio Track" - Per-user override of web client audio preference
- ✅ "Cinema Mode" - Per-user enable/disable of Roku-specific pre-roll feature
- ✅ "Custom Subtitles" - Per-user toggle of Roku-specific subtitle rendering

**Do NOT add user settings for:**

- ❌ Server-authoritative data (policy, configuration) - these come from API only
- ❌ Temporary session data - use global variables instead
- ❌ Device capabilities - these are detected automatically

---

## Settings Architecture

### File Locations

```text
jellyrock/
├── settings/
│   └── settings.json                              # Setting definitions & defaults
├── components/data/jellyfin/
│   └── JellyfinUserSettings.xml                   # ContentNode field definitions
├── source/data/
│   └── SessionDataTransformer.bs                  # Registry → Node transformer
└── tests/source/unit/
    └── [feature]/[FeatureName].spec.bs           # Unit tests
```

### Setting Types

| Type | Description | Example Values |
| ------ | ------------- | ---------------- |
| `bool` | Boolean toggle | `true`, `false` |
| `integer` | Numeric value | `0`, `30`, `1920` |
| `string` | Free-form text | `"auto"`, `"enabled"` |
| `radio` | Single selection from options | `"webclient"`, `"enabled"`, `"disabled"` |
| `text` | Free-form text input | `"FF5733"`, `"0D1117"` |

**Note:** Radio buttons with options are the most common for override settings.

### Conditional Visibility (`visibleWhen`)

Any setting can declare a `visibleWhen` condition to only appear in the UI when another setting has a specific value. This is fully declarative in `settings.json` — no code changes needed.

```json
{
  "settingName": "uiThemeColorPrimary",
  "type": "text",
  "visibleWhen": { "settingName": "uiTheme", "value": "custom" }
}
```

The setting above only appears when `uiTheme` equals `"custom"`. When the controlling setting changes, the menu automatically refreshes to show/hide dependent items.

**How it works in code:**

- `LoadMenu()` builds a `filteredChildren` array by evaluating each item's `visibleWhen` condition via `isSettingVisible()`
- All menu index lookups use `filteredChildren[]` instead of `children[]` to ensure correct mapping
- `radioSettingChanged()` calls `refreshCurrentMenu()` when the changed setting has dependent siblings (detected by `hasDependentVisibility()`)

### Preset Values (`presetValues`)

Radio options can declare `presetValues` — a map of setting names to values that are bulk-applied when that option is selected. This lets a single radio selection update multiple settings at once.

```json
{
  "title": "Theme",
  "settingName": "uiTheme",
  "type": "radio",
  "options": [
    {
      "title": "JellyRock",
      "id": "jellyrock",
      "presetValues": {
        "uiThemeColorPrimary": "8B5CF6",
        "uiThemeColorBackgroundPrimary": "0D1117"
      }
    },
    {
      "title": "Custom",
      "id": "custom"
    }
  ]
}
```

When a preset option is selected, all its `presetValues` are saved via `user.settings.Save()`. Options without `presetValues` (like "Custom" above) just set the radio value itself.

### Global Settings vs User Settings

#### Registry Storage Behavior (CRITICAL)

Settings are automatically routed to different registry sections based on their `settingName` prefix:

- **Global Settings** - Any setting with `settingName` starting with `"global"` (e.g., `globalRememberMe`)
  - Stored in global registry section (`"JellyRock"` in production, `"test-global"` in tests)
  - Apply to **ALL users** on the device
  - Shared across user accounts
  - Example: "Remember Me?" setting that persists the active user

- **User Settings** - All other settings (e.g., `playbackCinemaMode`, `uiRowLayout`)
  - Stored in user-specific registry section (user ID as section name)
  - Apply to **one user** only
  - Isolated per user account
  - Example: Playback preferences, UI preferences

**How It Works:**

The routing is automatic based on the `settingName` prefix. When a setting field changes:

1. `JellyfinUserSettings.bs` checks if the field name starts with `"global"`
2. If yes → saves to global registry section using `set_setting()`
3. If no → saves to user registry section using `set_user_setting()`

**Naming Convention:**

- Global settings: `global*` (e.g., `globalRememberMe`, `globalThemeName`)
- User settings: `category*` (e.g., `playback*`, `ui*`, `itemGrid*`)

**Use global settings sparingly** - only for settings that truly need to apply to all users on the device.

---

## Implementation Steps

### Step 1: Add Setting Definition to `settings/settings.json`

Add your setting to the appropriate category (Playback, User Interface, etc.):

```json
{
  "title": "Setting Display Name",
  "description": "Clear description of what this setting does.",
  "settingName": "categorySettingName",
  "type": "radio",
  "default": "defaultValue",
  "options": [
    {
      "title": "Option 1 Display",
      "id": "value1"
    },
    {
      "title": "Option 2 Display",
      "id": "value2"
    }
  ]
}
```

**Optional Properties:**

| Property | Description |
| -------------- | ----------------------------------------------------------------- |
| `visibleWhen` | Condition to show/hide this setting based on another setting's value. See [Conditional Visibility](#conditional-visibility-visiblewhen). |
| `presetValues` | (Radio options only) Map of setting names to values applied when this option is selected. See [Preset Values](#preset-values-presetvalues). |

**Naming Conventions:**

- Use `camelCase` for `settingName`
- Prefix with category: `playback*`, `ui*`, `itemGrid*`, `display*`
- Be descriptive: `playbackPlayDefaultAudioTrack` not `playbackAudio`

**Alphabetical Order:**

Settings **MUST** be kept in alphabetical order by **`title`** (NOT `settingName`) within each category's `children` array. This ensures the UI settings list is always alphabetically sorted for users.

**Example (Play Default Audio Track):**

```json
{
  "title": "Play Default Audio Track",
  "description": "Override web client audio preference. When enabled, use the IsDefault flag to select audio track. When disabled, prefer language match and ignore IsDefault.",
  "settingName": "playbackPlayDefaultAudioTrack",
  "type": "radio",
  "default": "webclient",
  "options": [
    {
      "title": "Use Web Client Setting",
      "id": "webclient"
    },
    {
      "title": "Enabled",
      "id": "enabled"
    },
    {
      "title": "Disabled",
      "id": "disabled"
    }
  ]
}
```

**Common Override Pattern:**

For settings that override web client behavior, use this three-option pattern:

- `"webclient"` (default) - Use server setting
- `"enabled"` - Force enable
- `"disabled"` - Force disable

### Step 2: Add Field to `JellyfinUserSettings.xml`

Add a field definition in the appropriate section (Playback Settings, UI Settings, etc.):

```xml
<field id="categorySettingName" type="string" alwaysNotify="true" />
```

**Field Types:**

| Setting Type | XML Type |
| ------------- | ---------- |
| `bool` | `type="boolean"` |
| `integer` | `type="integer"` |
| `string` or `radio` | `type="string"` |

**Important:**

- Always use `alwaysNotify="true"` for settings
- Field `id` must match `settingName` from settings.json
- Do NOT set `value` attribute (defaults come from settings.json)
- Keep fields organized by category with XML comments

**Example:**

```xml
<!-- Playback Settings -->
<field id="playbackBitrateMaxLimited" type="boolean" alwaysNotify="true" />
<field id="playbackPlayNextEpisode" type="string" alwaysNotify="true" />
<field id="playbackPlayDefaultAudioTrack" type="string" alwaysNotify="true" />
```

### Step 3: Update `SessionDataTransformer.bs`

Add code to load the setting from registry in `transformUserSettings()`:

```brighterscript
' [Category] Settings
settingsNode.categorySettingName = settingsData["categorySettingName"] ?? ""
```

**Type Conversion:**

```brighterscript
' Boolean settings
settingsNode.settingName = toBoolean(settingsData["settingName"])

' Integer settings
if settingsData.DoesExist("settingName")
  settingsNode.settingName = Val(settingsData["settingName"])
end if

' String/radio settings
settingsNode.settingName = settingsData["settingName"] ?? ""
```

**Why `DoesExist` for integers only?** `Val(invalid)` returns `0`, which could be a valid setting value. Without the check, you can't tell if the user never set it (should use default) or explicitly set it to `0`. For booleans and strings, `toBoolean(invalid)` and `?? ""` already handle missing values safely.

**Important:**

- Use `??` operator for default fallback (empty string for strings)
- Use `toBoolean()` helper for boolean settings
- Use `Val()` for integer settings (with `DoesExist` check)
- Do NOT hardcode default values (they come from settings.json)

**Example:**

```brighterscript
' Playback Settings
settingsNode.playbackPlayNextEpisode = settingsData["playbackPlayNextEpisode"] ?? ""
settingsNode.playbackPlayDefaultAudioTrack = settingsData["playbackPlayDefaultAudioTrack"] ?? ""
settingsNode.playbackPreferredMultichannelCodec = settingsData["playbackPreferredMultichannelCodec"] ?? ""
```

### Step 4: Implement Setting Logic (If Needed)

**Note:** Most simple settings (booleans, direct values) don't need helper functions. Helper functions are most commonly needed for settings that override web client behavior.

If your setting requires complex resolution logic (e.g., choosing between JellyRock override and web client fallback), create a helper function:

```brighterscript
' resolveSettingName: Resolves the setting value
'
' Checks JellyRock override setting first, then falls back to web client setting.
' Ensures a valid [type] is always returned.
'
' @param {object} userSettings - JellyfinUserSettings node (JellyRock settings)
' @param {object} userConfig - JellyfinUserConfiguration node (web client settings)
' @returns {[type]} - Resolved setting value (guaranteed valid)
function resolveSettingName(userSettings as object, userConfig as object) as [type]
  ' Default to [safe value] if we can't determine the value
  defaultValue = [safeDefault]

  ' Try to get web client setting (type is guaranteed by XML field definition)
  if isValid(userConfig) and isValid(userConfig.webClientFieldName)
    defaultValue = userConfig.webClientFieldName
  end if

  ' Check for JellyRock override setting
  if isValid(userSettings) and isValid(userSettings.categorySettingName) and userSettings.categorySettingName <> ""
    if userSettings.categorySettingName = "enabled"
      return [enabledValue]
    else if userSettings.categorySettingName = "disabled"
      return [disabledValue]
      ' else "webclient" or other - use web client setting
    end if
  end if

  return defaultValue
end function
```

**Key Points:**

- Provide safe defaults when values are invalid
- Document the resolution logic clearly
- **Type validation:** User config values are automatically type-validated by Roku's Scene Graph XML field definitions. Values in `JellyfinUserConfiguration` node are guaranteed to match their declared types, so additional runtime type checking is not required

**Example (Play Default Audio Track):**

```brighterscript
function resolvePlayDefaultAudioTrack(userSettings as object, userConfig as object) as boolean
  ' Default to true if we can't determine the value
  defaultValue = true

  ' Try to get web client setting (type is guaranteed by XML field definition)
  if isValid(userConfig) and isValid(userConfig.playDefaultAudioTrack)
    defaultValue = userConfig.playDefaultAudioTrack
  end if

  ' Check for JellyRock override setting
  if isValid(userSettings) and isValid(userSettings.playbackPlayDefaultAudioTrack) and userSettings.playbackPlayDefaultAudioTrack <> ""
    if userSettings.playbackPlayDefaultAudioTrack = "enabled"
      return true
    else if userSettings.playbackPlayDefaultAudioTrack = "disabled"
      return false
      ' else "webclient" or other - use web client setting
    end if
  end if

  return defaultValue
end function
```

**Then use the helper consistently:**

```brighterscript
' Get user settings for audio selection
localUser = m.global.user

' Resolve setting (JellyRock override or web client)
playDefault = resolvePlayDefaultAudioTrack(localUser.settings, localUser.config)

' Use resolved value
selectedIndex = findBestAudioStreamIndex(mediaStreams, playDefault, preferredLanguage)
```

### Step 5: Update All Usage Sites

Search the codebase for where the setting should be used:

```bash
# Search for related functionality
grep -r "oldRelatedCode" source/ components/
```

**Update all locations:**

1. Component logic that needs the setting
2. Utility functions that use the setting
3. Task nodes that process the setting
4. Any hardcoded behavior that should now be configurable

**Example Locations:**

- `components/movies/MovieDetails.bs` - Movie playback logic
- `components/tvshows/TVListDetails.bs` - TV episode logic
- `source/utils/quickplay.bs` - Quick play functionality
- `components/ItemGrid/LoadVideoContentTask.bs` - Background tasks

**Pattern:**

```brighterscript
' Get local reference (minimize rendezvous)
localUser = m.global.user

' Resolve setting
resolvedValue = resolveSettingName(localUser.settings, localUser.config)

' Use value
doSomething(resolvedValue)
```

---

## Testing Requirements

### Unit Tests for Helper Functions

If you created a helper function, write unit tests. See the [Unit Testing Guide](unit-tests.md) for complete testing patterns and framework details.

**File Location:** `tests/source/unit/[category]/[helperName].spec.bs`

**Test Scenarios for User Settings:**

1. **Override logic** - Test all override values work correctly (`"enabled"`, `"disabled"`, `"webclient"`)
2. **Fallback logic** - Test web client setting is used when override is empty/`"webclient"`
3. **Invalid inputs** - Test handles `invalid` settings/config objects gracefully
4. **Edge cases** - Test empty strings, unexpected values, missing fields

**Example test structure:**

```brighterscript
import "pkg:/source/utils/yourFile.bs"

namespace tests

  @suite("yourFile - resolveSettingName()")
  class ResolveSettingNameTests extends tests.BaseTestSuite

    protected override function setup()
      super.setup()
    end function

    @describe("Override setting tests")
    @it("returns enabled value when setting is 'enabled'")
    @it("returns disabled value when setting is 'disabled'")
    @it("uses web client value when setting is 'webclient' or empty")

    @describe("Invalid input handling")
    @it("returns safe default when both settings and config are invalid")
    @it("returns safe default when config field is invalid")

  end class

end namespace
```

### Manual Testing Checklist

Test the setting manually on a real Roku device:

1. ✅ Navigate to Settings → [Category] → [Setting Name]
2. ✅ Verify all options display correctly
3. ✅ Change setting and verify change is saved (close app, reopen)
4. ✅ Verify setting affects behavior as expected
5. ✅ Test with web client setting at different values
6. ✅ Verify default value works correctly for new users
7. ✅ Check logs for any errors during setting load/save

---

## Best Practices

### 1. Setting Design

- ✅ **DO** provide clear, user-friendly option titles
- ✅ **DO** write helpful descriptions that explain what the setting does
- ✅ **DO** use "Use Web Client Setting" as default for override settings
- ✅ **DO** keep option IDs simple and consistent (`enabled`, `disabled`, `webclient`)
- ❌ **DON'T** use technical jargon in user-facing text
- ❌ **DON'T** create settings for features that should be automatic

### 2. Code Organization

- ✅ **DO** create helper functions for complex setting resolution logic
- ✅ **DO** validate types before using values (prevent crashes)
- ✅ **DO** minimize rendezvous by caching local references
- ✅ **DO** use consistent naming across files (same name everywhere)
- ❌ **DON'T** repeat resolution logic in multiple places (use DRY)
- ❌ **DON'T** hardcode default values (they come from settings.json)
- ❌ **DON'T** write defaults to registry (only user changes)

### 3. Type Safety

- ✅ **DO** provide safe defaults when values are invalid
- ✅ **DO** use `??` operator for fallback values
- ✅ **DO** trust XML field type validation for config/policy nodes
- ❌ **DON'T** add redundant type checking for Scene Graph node fields (already validated by Roku)

### 4. Documentation

- ✅ **DO** document helper functions with clear JSDoc style comments
- ✅ **DO** explain the resolution priority in comments
- ✅ **DO** add inline comments for non-obvious logic
- ✅ **DO** update relevant documentation when adding settings
- ❌ **DON'T** include hardcoded counts in comments (e.g., "Playback Settings (13)") - they require manual updates and get outdated
- ❌ **DON'T** leave outdated comments

### 5. Testing

- ✅ **DO** test all possible setting values
- ✅ **DO** test invalid/missing values don't crash
- ✅ **DO** test web client fallback works
- ✅ **DO** verify setting persists across app restarts
- ❌ **DON'T** skip edge case testing (empty strings, wrong types, etc.)

---

## Common Pitfalls

### 1. ❌ Hardcoding Default Values

**Problem:**

```brighterscript
' SessionDataTransformer.bs
settingsNode.categorySettingName = settingsData["categorySettingName"] ?? "hardcodedDefault"  ' ❌ WRONG!
```

**Why this fails:** Default should come from settings.json, not code. This creates two sources of truth.

**Solution:**

```brighterscript
' SessionDataTransformer.bs - Use empty string, actual default comes from settings.json
settingsNode.categorySettingName = settingsData["categorySettingName"] ?? ""  ' ✅ CORRECT
```

### 2. ❌ Writing Defaults to Registry

**Problem:**

```brighterscript
if not reg.exists("categorySettingName")
  reg.write("categorySettingName", "defaultValue")  ' ❌ WRONG!
end if
```

**Why this fails:** Defeats the purpose of having defaults in settings.json. Pollutes registry.

**Solution:**

```brighterscript
' Don't write defaults! Only write when user changes the setting.
' The transformer will pick up defaults from settings.json automatically.
```

### 3. ❌ Repeating Resolution Logic

**Problem:**

```brighterscript
' MovieDetails.bs
if userSettings.categorySettingName = "enabled"
  value = true
else if userSettings.categorySettingName = "disabled"
  value = false
else
  value = userConfig.webClientField
end if

' TVListDetails.bs - SAME CODE REPEATED!
if userSettings.categorySettingName = "enabled"
  value = true
...
```

**Why this fails:** Code duplication, maintenance nightmare, inconsistent behavior.

**Solution:**

```brighterscript
' Create ONE helper function
function resolveSetting(userSettings, userConfig) as boolean
  ' ... resolution logic once ...
end function

' Use everywhere
value = resolveSetting(localUser.settings, localUser.config)
```

### 4. ❌ Wrong XML Field Type

**Problem:**

```xml
<!-- Setting is radio/string but using boolean type -->
<field id="playbackPlayDefaultAudioTrack" type="boolean" alwaysNotify="true" />
```

**Why this fails:** Type mismatch between settings.json and XML causes errors.

**Solution:**

```xml
<!-- Radio/string settings use string type -->
<field id="playbackPlayDefaultAudioTrack" type="string" alwaysNotify="true" />
```

### 5. ❌ Forgetting to Update All Usage Sites

**Problem:** Adding setting but only updating one of four places that need it.

**Solution:** Always grep the codebase:

```bash
grep -r "relatedFunctionality" source/ components/
```

### 6. ❌ Not Testing Edge Cases

**Problem:** Only testing happy path (`"enabled"`, `"disabled"`) but not invalid values.

**Solution:** Test:

- Empty strings
- Unexpected values
- Missing fields
- Invalid user/config objects

---

## Task Checklist

When implementing a new user setting, use this checklist to ensure nothing is overlooked.

> **Note:** Checklist states are for local tracking only. Please reset all checkboxes to `[ ]` before committing changes to this file.

### Phase 1: Setting Definition

- [ ] Add setting to appropriate category in `settings/settings.json`
- [ ] Choose appropriate type (`bool`, `integer`, `string`, `radio`)
- [ ] Write clear user-friendly title and description
- [ ] Use `camelCase` naming with category prefix (e.g., `playback*`, `ui*`, `global*`)
- [ ] Set appropriate default value (use `"webclient"` for override settings)
- [ ] Define all options for radio type (with clear titles and simple IDs)
- [ ] **IMPORTANT:** Insert setting in alphabetical order by `title` within the category's `children` array

### Phase 2: Schema Definition

- [ ] Add field to `components/data/jellyfin/JellyfinUserSettings.xml`
- [ ] Use correct XML type (`boolean`, `integer`, or `string`)
- [ ] Field `id` matches `settingName` from settings.json exactly
- [ ] Add `alwaysNotify="true"` attribute
- [ ] Do NOT set `value` attribute (defaults come from settings.json)
- [ ] Place in appropriate category section with XML comments

### Phase 3: Data Transformer

- [ ] Add loading code to `source/data/SessionDataTransformer.bs` in `transformUserSettings()`
- [ ] Use appropriate type conversion (`toBoolean()`, `Val()`, or `??`)
- [ ] Do NOT hardcode default values (use `?? ""` for strings)
- [ ] Place in correct category section

### Phase 4: Implementation Logic

**Note:** Some settings don't need helper functions - they may just modify existing logic (e.g., adding to a condition). Skip helper-specific checkboxes if not applicable.

- [ ] Create helper function if setting has complex resolution logic (most common for web client overrides) OR modify existing logic to use the setting
- [ ] Provide safe defaults for invalid/missing values
- [ ] Document implementation with clear comments
- [ ] Use DRY principle - create ONE function, use everywhere (if applicable)
- [ ] Update all usage sites to use the setting consistently
- [ ] Search codebase for related code: `grep -r "relatedTerm" source/ components/`

### Phase 5: Testing

- [ ] Create unit test file in `tests/source/unit/[category]/[helperName].spec.bs` (if helper function exists)
- [ ] Extend `tests.BaseTestSuite` with `super.setup()` call
- [ ] Test all override values (`"enabled"`, `"disabled"`, `"webclient"`)
- [ ] Test web client fallback when no override
- [ ] Test invalid inputs (invalid objects, empty strings)
- [ ] Test edge cases (unexpected values, missing fields)
- [ ] Update existing comprehensive tests (e.g., `Transformers.spec.bs` settings coverage test)
- [ ] Update test mock data files (e.g., `user-settings-all-new-names.json`)
- [ ] Verify all tests pass: `npm run build:tests-unit`

### Phase 6: Manual Testing

- [ ] Test on real Roku device if possible
- [ ] Navigate to setting in UI and verify it displays correctly
- [ ] Change setting and verify change persists (close/reopen app)
- [ ] Test all option values work as expected
- [ ] Test with different web client setting values
- [ ] Verify default value works for new users
- [ ] Check logs for errors during load/save

### Phase 7: Code Quality

- [ ] Verify no new IDE errors introduced
- [ ] Remove any debug code or console logs
- [ ] Verify all comments are accurate and helpful

### Phase 8: Documentation & Commit

- [ ] Add descriptive commit message following conventional commits format
- [ ] Update relevant documentation if needed
- [ ] Reset this checklist to unchecked state before committing
- [ ] Create PR with clear description of setting and behavior

---

## Questions or Issues?

If you encounter issues not covered in this guide:

1. Check recent commits for similar settings: `git log --all --grep="setting"`
2. Review existing settings in `settings/settings.json` for patterns
3. Search for usage examples: `grep -r "userSettings\." source/ components/`
4. Ask for clarification in PR reviews or team discussions

**Remember:** When in doubt, validate types, avoid hardcoded defaults, and test edge cases thoroughly!

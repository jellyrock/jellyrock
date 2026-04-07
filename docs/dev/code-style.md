# Code Style Guide

## Overview

This document defines the naming conventions, formatting rules, and code patterns for the JellyRock codebase. All contributors must follow these rules. Naming conventions are enforced by code review (bslint does not support naming rules).

**Core principle**: PascalCase = type definitions. `lowerCamelCase` = everything else. UPPER_SNAKE_CASE = immutable predefined values.

---

## Naming Conventions

### Variables & Parameters

**`lowerCamelCase`** for all variables, parameters, and local references.

```brighterscript
audioStreamIdx = 1
fullUrl = serverUrl + "/" + path
preferredLang = resolveSubtitleLanguagePreference(settings, config)
```

### Functions, Methods & Subs

**`lowerCamelCase`** for all function and sub names.

```brighterscript
function getSetting(key, defaultValue = invalid)
sub registryWrite(key, value, section = invalid)
function buildAuthHeader() as string
```

### Classes

**PascalCase** for class names.

```brighterscript
class ApiClient
  private global = invalid

  sub new()
    m.global = GetGlobalAA().global
  end sub
end class
```

### Enums

**PascalCase** for enum names (they are type definitions). **UPPER_SNAKE_CASE** for enum members (they are immutable predefined values — constants).

```brighterscript
enum MediaSegmentType
  UNKNOWN = "Unknown"
  INTRO = "Intro"
  OUTRO = "Outro"
end enum

enum SubtitleSelection
  NOT_SET = -2
  NONE = -1
end enum

' Usage
if segment.type = MediaSegmentType.INTRO
```

Enum **values** (the right side of `=`) must match external API contracts where applicable. Only the member **names** follow our convention.

### Components

**PascalCase** for component names in XML, matching the file name.

```xml
<component name="ItemDetails" extends="JRScreen">
```

### Namespaces

**`lowerCamelCase`** for namespace names. Namespaces are containers, not types.

```brighterscript
namespace imageSize
  const POSTER_SM = { width: 108, height: 162 }
end namespace

namespace sdk
  function getItems(params as object)
  end function
end namespace
```

### Constants

**UPPER_SNAKE_CASE** for all `const` declarations and namespace level constants.

```brighterscript
const QUOTE = Chr(34)

namespace itemTypeOrder
  const SEARCH = ["Movie", "Series", "Episode"]
  const NO_RESUME = ["MusicAlbum", "MusicArtist"]
end namespace
```

### Booleans

Boolean variables and fields **must** use a prefix: `is`, `has`, `should`, `can`, or `enable`.

```brighterscript
' Correct
isFolder = true
hasSubtitles = false
shouldAutoPlay = true
canDelete = item.canDelete
enableNextEpisodeAutoPlay = true

' Incorrect
folder = true
subtitles = false
autoPlay = true
```

### Boolean Naming Exceptions

The following boolean fields are exempt from the prefix rule:

- **Signal fields**: XML fields with `alwaysNotify="true"` used purely as observable event triggers (e.g., `backPressed`, `refreshItemDetailsData`). The value is irrelevant; the write event itself is the message. Examples: `backPressed`, `exit`, `submit`, `reset`, `closeSidePanel`, `optionSelected`, `reloadHomeRequested`, `requestFocusReturn`.
- **API-mirrored fields**: Fields in `JellyfinUserConfiguration` and `JellyfinUserPolicy` that mirror Jellyfin server API property names exactly (e.g., `playDefaultAudioTrack`, `enableNextEpisodeAutoPlay`). These are external contracts.
- **Settings/registry keys**: `JellyfinUserSettings` field IDs that are 1:1 with Roku registry keys (e.g., `playbackCinemaMode`, `uiFontFallback`). Renaming requires a registry migration to avoid user data loss.

### Private Class Members

Use the `private` keyword only. Do **not** use an underscore prefix — in BrighterScript, `_` prefix means "unused parameter."

```brighterscript
class MyClass
  ' Correct
  private global = invalid
  private imageDefaults = {}

  ' Incorrect — _ means "unused", not "private"
  private _global = invalid
end class
```

### Unused Parameters

Use `_` prefix for parameters that must exist in a signature but are not used.

```brighterscript
function onKeyEvent(key as string, _press as boolean) as boolean
  ' _press is unused — only key matters here
  return key = "back"
end function
```

---

## File Naming

### Class, Component & Enum Files → PascalCase

Files containing type definitions (classes, components, enums) use PascalCase.

```text
source/api/ApiClient.bs          ' class ApiClient
source/enums/MediaSegmentType.bs ' enum MediaSegmentType
components/ItemDetails.xml       ' component ItemDetails
components/ItemDetails.bs        ' companion script
```

### Utility & Function Files → `lowerCamelCase`

Files containing only functions, subs, or namespace definitions use `lowerCamelCase`. Single-word names are naturally valid.

```text
source/utils/config.bs           ' utility functions
source/utils/nodeHelpers.bs      ' namespace nodeHelpers
source/api/baseRequest.bs        ' utility functions
source/constants/imageSize.bs    ' namespace imageSize
```

### XML + BS Pairing

Component XML and BS files must share the same PascalCase base name. BrighterScript auto-scopes them together.

```text
components/video/VideoPlayerView.xml
components/video/VideoPlayerView.bs
```

---

## XML Conventions

### Interface Field IDs → `lowerCamelCase`

```xml
<interface>
  <field id="baseTitle" type="string" />
  <field id="configKey" type="string" />
  <field id="valueIndex" type="integer" />
  <field id="globalSetting" type="boolean" value="false" />
</interface>
```

### Child Element IDs → `lowerCamelCase`

```xml
<children>
  <LabelSecondarySmaller id="videoCodec" />
  <LabelSecondarySmallest id="videoCodecCount" />
</children>
```

### `onChange` Callbacks

`onChange` values are string references to function names. They must match the function definition exactly.

```xml
<field id="choices" type="array" onChange="updateTitle" />
```

```brighterscript
' Must match exactly — mismatch fails silently at runtime
sub updateTitle()
  m.top.title = m.top.baseTitle + ": " + m.top.choices[m.top.valueIndex].display
end sub
```

---

## Formatting

### Indentation & Whitespace

- **2 spaces** — no tabs (enforced by `.editorconfig` and `bsfmt.json`)
- **`LF`** line endings (Unix-style)
- Trim trailing whitespace
- Insert final newline

### Strings & Comments

- **Double quotes** for string values: `"hello"`
- **Single quote** (`'`) for comments: `' This is a comment`
- Never use `REM` or `//` for comments

### Operators

Single space around all binary operators:

```brighterscript
result = a + b
if isValid(item) and item.type = "Movie"
url = serverUrl + "/" + path
value = apiData.Id ?? ""
```

### Import Ordering

Imports are sorted alphabetically (enforced by `bsfmt.json` with `sortImports: true`).

```brighterscript
import "pkg:/source/api/baseRequest.bs"
import "pkg:/source/utils/config.bs"
import "pkg:/source/utils/misc.bs"
```

### Line Length

**120 characters** is the guideline. Not currently enforced by tooling — use developer judgment.

---

## Comments

### JSDoc Style for Functions

Every public function should have a JSDoc style comment describing its purpose, parameters, and return value.

```brighterscript
' Filter registry keys to find those that should be deleted during a settings reset
' Preserves session/identity keys, deletes everything else
' @param allKeys - associative array of all registry key-value pairs
' @param preserveKeys - array of key names to preserve
' @return array of key names that should be deleted
function getSettingKeysToDelete(allKeys as object, preserveKeys as object) as object
```

### Inline Comments

Use inline comments for complex logic, Roku-specific oddities, and non-obvious decisions.

```brighterscript
' ContentNode fields return "" instead of invalid, so check both
if not isValid(serverUrl) or serverUrl = "" then return invalid
```

### Section Dividers

Use decorated comment blocks for major logical sections within large files.

```brighterscript
' ════════════════════════════════════════
' SECTION NAME
' ════════════════════════════════════════
```

---

## BrightScript Specific Rules

### Associative Array Key Casing

BrightScript stores AA keys in **lowercase** regardless of source code casing. `{ maxWidth: 1920 }` stores the key as `"maxwidth"`. This is a language limitation, not a convention violation.

When writing AA literals, still use `lowerCamelCase` in source for readability:

```brighterscript
params = {
  maxWidth: 1920,
  imageType: "Primary"
}
' At runtime, keys are "maxwidth" and "imagetype"
```

When checking AA keys by string, use lowercase:

```brighterscript
if params.DoesExist("maxwidth")  ' correct — matches runtime storage
```

### ContentNode Field Defaults

ContentNode fields cannot be `invalid` — they get type defaults when declared in XML. Use the "default = no data" pattern:

- Empty string `""` = no data
- `0` = no data
- `false` = no data
- Check `item.type` for layout decisions, check field values for display decisions

### API Boundary

The Jellyfin API uses PascalCase field names (`Id`, `Name`, `Type`). These are transformed to `lowerCamelCase` at the API boundary in `JellyfinDataTransformer`. Never use PascalCase for internal data — the transformer is the conversion point.

```brighterscript
' In JellyfinDataTransformer (the boundary)
item.id = apiData.Id ?? ""          ' PascalCase → `lowerCamelCase`
item.name = apiData.Name ?? ""
item.type = apiData.Type ?? ""

' In API request bodies (external contract — PascalCase required)
FormatJson({ "Username": username, "Pw": password })
```

### Registry Keys — Do Not Rename

Registry keys like `"saved_servers"` and `"active_user"` are persisted on user devices. Renaming them requires a registry migration to avoid data loss. Treat existing registry key strings as frozen.

### `function` vs `sub`

Use `function` when returning a value. Use `sub` when performing a side effect with no return value.

```brighterscript
function getSetting(key) as dynamic    ' returns a value
  return registryRead(key, section)
end function

sub setSetting(key, value)             ' side effect only
  registryWrite(key, valueToString(value), section)
end sub
```

### `Goto` Labels

Use `lowerCamelCase` for `goto` labels. These are control flow markers, not constants or types.

```brighterscript
startLogin:
  serverUrl = getSetting("server")
  ...
  goto startLogin
```

---

## Tooling

| Tool | Config File | What It Enforces |
| ---- | ----------- | ---------------- |
| bsfmt | `bsfmt.json` | Formatting (indentation, comment style, import sorting) |
| bslint | `bslint.json` | Case sensitivity, unused variables, unreachable code |
| `.editorconfig` | `.editorconfig` | Indent style, line endings, trailing whitespace |

**Not currently enforced by tooling**: naming conventions (code review only), line length.

Run `npm run lint` to check formatting, linting, and compilation. Run `npm run format` to auto-fix formatting.

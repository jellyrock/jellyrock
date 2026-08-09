---
topic: code-style
related-files:
  - bslint.json
  - .editorconfig
last-reviewed: 2026-05-03
---

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

### Event-handler & Lifecycle Functions — `on*` Prefix

Functions registered as the callback target of an event-handler binding **should** start with `on` followed by an uppercase letter (camelCase). The bindings this convention applies to:

1. XML `<field ... onChange="X" />` — `X` is invoked when the field changes.
2. `observeField(<field>, "X")` — `X` is invoked when the field changes (Roku Scene Graph two-argument string-callback form).
3. The `JRScreen` lifecycle hook `onDestroy()` — required for every `JRScreen` subclass; enforced by the `jellyrock-jrscreen-on-destroy` BSC plugin.

```brighterscript
' Preferred
sub onContentChanged() ...
sub onItemSelectedChanged() ...
sub onDestroy() ...
```

```xml
<!-- Preferred -->
<field id="content" type="node" onChange="onContentChanged" />
```

**Not covered by this rule** (intentional — these are not callback registrations):

- `init()` — universal Roku component constructor.
- `populate*`, `setup*`, `handle*`, `reset*`, `cleanup*` — internal helpers, not callback registrations.
- `callFunc(<name>, ...)` invocations — general-purpose remote-procedure-call across the component graph; targets are setters / getters / methods, not event handlers.
- `observeField` overloads passing a port or function reference (non-string-literal) — not a callback name registration.

This is **convention, not strict enforcement** outside of the `onDestroy()` lifecycle hook. The codebase has historical action-shaped callbacks (`setColors`, `getData`, `updateMessage`, etc.) that deliberately preserve their semantic names. Prefer `on*` for new callbacks; nudge existing ones at review time when they're touched anyway. A binding-based BSC plugin to enforce this strictly was tried and dropped — the marginal value didn't justify the friction of either renaming legacy action-shaped callbacks or sprinkling escape-hatch comments.

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

### What doesn't belong in a comment

**Length is not the defect.** Comment-line share runs 30–65% in the files carrying the most platform knowledge (`source/utils/tasks.bs`, `source/api/apiPipeline.bs`, `components/ItemGrid/GridItem.bs`), and that is deliberate — a long comment holding a measured Roku behavior you cannot derive from the code earns every line. The test is: **would the next person need this to change the code correctly?**

Three things fail that test and belong elsewhere:

- **Revision history** — "it used to be set here", "this previously read 400". `git blame` and the commit message already hold it, and unlike the comment they can't go stale.
- **The reproduction or measurement that produced the fix** — the device, the stubbed sub, the run counts. That's commit-body or journal material (`docs/progress.md`, [`tech-debt.md`](../architecture/tech-debt.md), a decision record). Keep the *rule* the measurement produced; drop the narrative that got you there.
- **Restating the code** — a comment that paraphrases the line under it.

Two copies of the same evidence is not thoroughness. It's a drift hazard, and the comment is the copy nobody updates.

Agent-facing counterpart: [`.claude/rules/prove-dont-dismiss.md`](../../.claude/rules/prove-dont-dismiss.md) ("Where the proof goes").

### Section Dividers

Use decorated comment blocks for major logical sections within large files.

```brighterscript
' ════════════════════════════════════════
' SECTION NAME
' ════════════════════════════════════════
```

---

## BrightScript Specific Rules

### Roku Built-In Function & Method Casing

BrightScript is **case-insensitive** for all identifiers, keywords, and function/method names. `inStr()`, `Instr()`, and `INSTR()` are identical at runtime. However, we use **`lowerCamelCase`** for Roku built-in functions and methods, consistent with our project-wide naming convention.

```brighterscript
' Correct — lowerCamelCase
pos = myString.inStr("search")
idx = inStr(1, locale, "_")

' Incorrect — PascalCase / lowercase
pos = myString.Instr("search")
idx = Instr(1, locale, "_")
```

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

---

## Tooling

| Tool | Config File | What It Enforces |
| ---- | ----------- | ---------------- |
| bsfmt | `bsfmt.json` | Formatting (indentation, comment style, import sorting) |
| bslint | `bslint.json` | Case sensitivity, unused variables, unreachable code |
| `.editorconfig` | `.editorconfig` | Indent style, line endings, trailing whitespace |

**Not currently enforced by tooling**: naming conventions (code review only), line length.

The IDE runs validate + bslint live; the `.husky/pre-push` hook runs the full lint suite on the files in your push range, with bsfmt auto-applied. You don't need to run `npm run lint` manually except to debug a specific failure.

---

## Markdown conventions

These apply to `.md` files in `docs/`, every `CLAUDE.md`, `AGENTS.md`, and the root `README.md`.

### Wrap code identifiers in backticks

Anything that is *code* — variable / function / class / type / event names, file paths, environment variable names, `npm` script names, hook event names, file extensions, command names — goes in single backticks for inline references or fenced blocks for multi-line snippets. Plain English does not.

Concretely, the following are code and must be wrapped: `Stop`, `sessionEnd`, `PostToolUse`, `stdout`, `stderr`, `JELLYROCK_TELEMETRY_DIR`, `.claude/settings.json`, `check-touched-lint.cjs`, `force: true`, `workflow_call`, `lint:docs`.

**Why this matters:** the spell-checker (`spellchecker-cli` with `retext-spell`) treats text inside backticks as code and skips it, but flags the same identifier appearing in prose as a misspelling. Forgetting to wrap an identifier is the most common reason a previously-clean doc fails spell-check after an edit. The end-of-turn lint hook ([`scripts/lint/check-touched-lint.cjs`](../../scripts/lint/check-touched-lint.cjs)) surfaces the failure the moment it happens, with a hint pointing back here.

### When to add to `dictionary.txt` instead

Add a word to `dictionary.txt` only when it's a real English word the spell-checker doesn't know — typically a legitimate technical or domain term (e.g., `idempotence`, `untracked`, `transcoder`). Code identifiers (e.g., `sessionEnd`, `JRScreen`, `apiPool`) should *not* be added — wrap them in backticks in prose instead. Putting identifiers in the dictionary defeats the spell-checker for any *actual* misspelling that happens to collide with an identifier.

Enforced by [`scripts/lint/dictionary-audit.cjs`](../../scripts/lint/dictionary-audit.cjs) (`npm run lint:dictionary`) — a CI-blocking lint that flags PascalCase / camelCase / file-extension / path-shaped entries. Legitimate proper nouns (product names, brands, CS-domain conventions like `camelCase`) live in the script's `ALLOWLIST`; acronym plurals (`URIs`, `APIs`, `PNGs`) and possessives (`BSC's`) are recognized via pattern. The end-of-turn lint hook surfaces the failure with a targeted "wrap in backticks" hint when the failing word looks identifier-shaped.

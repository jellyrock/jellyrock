---
topic: code-style
related-files:
  - bslint.json
  - bsfmt.json
  - .editorconfig
last-reviewed: 2026-10-09
---

# Code style

How JellyRock code is named, formatted and commented. The formatter and linter enforce part of it ([Tooling](#tooling)); code review enforces the rest, including every naming rule.

**The core rule:** PascalCase for type definitions, `UPPER_SNAKE_CASE` for constants, `lowerCamelCase` for everything else.

## Names

### Variables, parameters and functions

Use `lowerCamelCase` for variables, parameters, functions and subs:

```brighterscript
audioStreamIdx = 1
preferredLang = resolveSubtitleLanguagePreference(settings, config)

function getSetting(key, defaultValue = invalid)
sub registryWrite(key, value, section = invalid)
```

### Classes, components and enums

Use PascalCase for a class, a component or an enum: each is a type.

```brighterscript
class ApiClient
  private global = invalid
end class
```

```xml
<component name="ItemDetails" extends="JRScreen">
```

The members of an enum are constants, so they use `UPPER_SNAKE_CASE`. The values on the right of `=` match the external API where there is one; only the member names follow our rule.

```brighterscript
enum MediaSegmentType
  UNKNOWN = "Unknown"
  INTRO = "Intro"
  OUTRO = "Outro"
end enum

if segment.type = MediaSegmentType.INTRO
```

### Namespaces and constants

Use `lowerCamelCase` for a namespace: it is a container, not a type. Use `UPPER_SNAKE_CASE` for every `const`:

```brighterscript
namespace imageSize
  const POSTER_SM = { width: 180, height: 270 }
end namespace

namespace itemTypeOrder
  const NO_RESUME = ["MusicAlbum", "MusicArtist"]
end namespace
```

### Booleans

Start a boolean's name with `is`, `has`, `should`, `can` or `enable`:

```brighterscript
isFolder = true
hasSubtitles = false
shouldAutoPlay = true
canDelete = item.canDelete
```

Not `folder`, `subtitles` or `autoPlay`.

Three kinds of boolean field keep the name they have:

- **Signal fields.** An XML field with `alwaysNotify="true"` that exists to be observed: the write is the message and the value means nothing. For example `exit`, `submit`, `reset`, `optionSelected`, `closeSidePanel`, `reloadHomeRequested`, `requestFocusReturn`.
- **Fields that mirror the server.** The fields of `JellyfinUserConfiguration` and `JellyfinUserPolicy` use the Jellyfin API's names (`playDefaultAudioTrack`, `enableNextEpisodeAutoPlay`).
- **Settings.** A `JellyfinUserSettings` field is named after its registry key (`playbackCinemaMode`, `uiFontFallback`). Renaming one needs a registry migration, or users lose the setting.

### Callbacks start with `on`

Name a function `on<Something>` when the platform calls it for an event:

- the `onChange` of an XML field;
- the string callback of `observeField(field, "callback")`;
- the `JRScreen` lifecycle hook `onDestroy()`, which every `JRScreen` subclass needs.

```xml
<field id="content" type="node" onChange="onContentChanged" />
```

```brighterscript
sub onContentChanged()
```

The rule does not cover `init()`, helpers such as `populate*`, `setup*`, `handle*`, `reset*` and `cleanup*`, functions reached through `callFunc`, or an `observeField` that passes a port.

Only `onDestroy()` is checked by a tool (the `jrscreen-on-destroy` build plugin). Older callbacks with action names (`setColors`, `getData`, `updateMessage`) stay as they are. Use `on*` for a new callback, and rename an old one when you are changing it anyway.

### Private members and unused parameters

Mark a private class member with `private`, never an `_` prefix. In BrighterScript, `_` means "unused":

```brighterscript
class MyClass
  private imageDefaults = {}
end class
```

Use the `_` prefix for a parameter the signature needs but the body does not use:

```brighterscript
function onKeyEvent(key as string, _press as boolean) as boolean
  return key = "back"
end function
```

## File names

- **A file that defines a type** (a class, a component or an enum) uses PascalCase: `source/api/ApiClient.bs`, `source/enums/MediaSegmentType.bs`, `components/ItemDetails.xml`.
- **A file of functions or one namespace** uses `lowerCamelCase`: `source/utils/config.bs`, `source/utils/nodeHelpers.bs`, `source/constants/imageSize.bs`.
- **A component's script** shares its XML file's base name: `components/video/VideoPlayerView.xml` and `components/video/VideoPlayerView.bs`. BrighterScript pairs them by name.

## XML

Field IDs and child IDs use `lowerCamelCase`:

```xml
<interface>
  <field id="baseTitle" type="string" />
  <field id="valueIndex" type="integer" />
</interface>
<children>
  <LabelSecondarySmallest id="videoCodecCount" />
</children>
```

An `onChange` value names a function in the component's script and must match it exactly.

## Formatting

The formatter and the editor config handle most of it:

- Indent with 2 spaces, never tabs.
- `LF` line endings, no trailing whitespace, a newline at the end of the file.
- Sort imports alphabetically.
- Use double quotes for strings, and `'` for comments, never `REM`.
- Put one space around binary operators: `a + b`, `apiData.Id ?? ""`.
- Write a condition without parentheses: `if isValid(item)`, not `if (isValid(item))`.
- Keep lines under 120 characters. No tool checks this.

## Comments

A comment holds what the code can't say: the reason, the platform quirk, the trap. Long comments are fine when they carry Roku behavior the code can't show; some of the files richest in platform knowledge are mostly comments, on purpose. The test is: **would the next person need this to change the code correctly?**

Three things fail that test and belong elsewhere:

- **History**, such as "this used to be set here" or "this previously read 400". `git blame` and the commit message hold it.
- **The proof**: the reproduction, the device, the measurement behind a fix. Put it in the commit message or a journal entry (`docs/progress.md`, [`tech-debt.md`](../architecture/tech-debt.md), a decision record). Keep the rule the measurement produced.
- **A restatement** of the line below.

A copy of the evidence in a comment is a second copy, and it is the one nobody updates. The agents' version of this rule is [`prove-dont-dismiss.md`](../../.claude/rules/prove-dont-dismiss.md).

Comments follow the house voice too: no em dashes, no words in capitals for emphasis. See [`writing-style.md`](writing-style.md#in-code-comments).

### Document a public function

Give a public function a comment that says what it does, its parameters and what it returns:

```brighterscript
' Filter registry keys to find those that should be deleted during a settings reset
' Preserves session/identity keys, deletes everything else
' @param {object} allKeys - associative array of all registry key-value pairs
' @param {object} preserveKeys - array of key names to preserve
' @return {object} - array of key names that should be deleted
function getSettingKeysToDelete(allKeys as object, preserveKeys as object) as object
```

### Mark sections in a long file

```brighterscript
' ════════════════════════════════════════
' SECTION NAME
' ════════════════════════════════════════
```

## BrightScript

### `function` returns a value, `sub` does not

Use `function` when it returns a value and `sub` when it does not. The linter fails the build on a `function` that returns nothing (`missing-sub-keyword`).

```brighterscript
function getSetting(key, defaultValue = invalid)
  value = registryRead(key, getGlobalRegistrySection())
  if not isValid(value) then return defaultValue
  return value
end function

sub setSetting(key, value)
  registryWrite(key, valueToString(value), getGlobalRegistrySection())
end sub
```

### Built-in names in `lowerCamelCase`

BrightScript ignores case in names, so `inStr()`, `Instr()` and `INSTR()` are the same call. Write Roku's built-in functions and methods in `lowerCamelCase` like our own: `inStr(1, locale, "_")`, `myString.inStr("search")`. No tool checks this.

### Associative array keys

An unquoted key in an AA literal is stored in lowercase, and a quoted key keeps its case. A lookup ignores case either way:

```brighterscript
params = { maxWidth: 1920, "QuotedKey": 1 }
params.Keys()                ' ["maxwidth", "QuotedKey"]
params.DoesExist("maxWidth") ' true, as is "maxwidth"
```

So write keys in `lowerCamelCase` and look them up the same way. When the case reaches the outside, through `FormatJson()` or `Keys()`, quote the key. A request body for the Jellyfin API is the usual case:

```brighterscript
FormatJson({ "Username": username, "Pw": password })
```

### Empty values in content node fields

A `string`, `integer` or `boolean` field on a node is never `invalid`: it holds its type's default, and setting it to `invalid` leaves it a string, integer or boolean. Treat `""`, `0` and `false` as "no data". A `node` or `assocarray` field starts as `invalid` until something sets it.

```brighterscript
' A string field holds "" for no data, so check both
if not isValid(serverUrl) or serverUrl = "" then return invalid
```

Use `item.type` to choose a layout and the field values to choose what to show.

### The API boundary

The Jellyfin API uses PascalCase field names (`Id`, `Name`, `Type`). `JellyfinDataTransformer` converts them to `lowerCamelCase` node fields, and app code uses only those:

```brighterscript
item.id = apiData.Id ?? ""
```

### Registry keys never change

Registry keys such as `"saved_servers"` and `"active_user"` are stored on users' devices. Renaming one needs a registry migration ([`registry-migrations.md`](registry-migrations.md)), or users lose the data.

## Tooling

| Tool | Config | Checks |
| --- | --- | --- |
| bsfmt | `bsfmt.json` | Indentation, comment style, import order |
| bslint | `bslint.json` and its defaults | `function` and `sub`, parentheses around conditions, inconsistent variable casing, unused variables, unreachable code, `STOP` statements, duplicate `roRegex` patterns |
| `.editorconfig` | `.editorconfig` | Indentation, line endings, trailing whitespace, final newline |

Naming and line length have no tool: review checks them.

`bslint.json` raises some rules to errors; the others run at the defaults, listed in its [README](https://github.com/rokucommunity/bslint#rules). The editor shows BrighterScript diagnostics as you type. The pre-push hook runs the lint chain on the files you push and applies bsfmt itself, so you rarely need `npm run lint` except to chase a failure.

## Markdown

These apply to the markdown in `docs/`, the `CLAUDE.md` and `AGENTS.md` files and the root `README.md`.

### Put code in backticks

Wrap anything that is code in backticks: a variable, function, class or event name, a file path, an environment variable, an `npm` script, a command, a file extension. For example `sessionEnd`, `stdout`, `JELLYROCK_TELEMETRY_DIR`, `.claude/settings.json`, `workflow_call`, `lint:docs`.

The spell checker (`spellchecker-cli`) skips text in backticks but flags the same identifier in prose. A missing pair of backticks is the most common reason a clean doc fails `npm run lint:spelling` after an edit. The end-of-turn hook ([`check-touched-lint.cjs`](../../scripts/lint/check-touched-lint.cjs)) reports the failure as soon as it happens.

### When to add to `dictionary.txt` instead

Add a word to `dictionary.txt` only when it is a real word the spell checker doesn't know, such as `idempotence`, `untracked` or `transcoder`. Never add a code identifier (`sessionEnd`, `JRScreen`, `apiPool`): put it in backticks. A dictionary entry for an identifier also hides any real misspelling that happens to match it.

`npm run lint:dictionary` ([`dictionary-audit.cjs`](../../scripts/lint/dictionary-audit.cjs)) fails CI on an entry shaped like an identifier: PascalCase, camelCase, a file extension or a path. Real proper nouns go in the script's `ALLOWLIST`. Plurals of acronyms (`URIs`, `APIs`) and possessives (`BSC's`) pass on their own.

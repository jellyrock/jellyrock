---
topic: global-state
related-files:
  - source/utils/globals.bs
  - components/data/jellyfin/JellyfinUser.xml
  - components/data/jellyfin/JellyfinUserSettings.xml
  - components/data/jellyfin/JellyfinUserSettings.bs
  - components/data/jellyfin/JellyfinServer.xml
  - components/data/jellyfin/Constants.xml
  - components/data/jellyfin/AppInfo.xml
  - components/data/jellyfin/DeviceInfo.xml
last-reviewed: 2026-05-01
---

# Global State

What hangs off `m.global`, when each piece is initialized, who mutates it.

## The shape of `m.global`

`m.global` is Roku's app-wide global node — a single shared `roSGNode` reachable from every thread (render and Task). JellyRock builds a deep tree of typed `ContentNode` subclasses on it, so reads are typed at the BSC level and the structure is documented by the XML files in `components/data/jellyfin/`.

```brightscript
m.global  (the global roSGNode)
│
├── appLoaded         bool                                  ← phase 1
├── app               AppInfo node                          ← phase 1, populated by SaveAppToGlobal()
│   ├── appId         string
│   ├── version       string                                ← from manifest
│   ├── isDev         bool
│   └── lastRunVersion string                               ← read from registry, used by migrations
│
├── device            DeviceInfo node                       ← phase 1, populated by SaveDeviceToGlobal()
│   ├── id, uuid      string                                ← roDeviceInfo.GetChannelClientID / GetRandomUUID
│   ├── name, friendlyName, model, modelType, modelDetails
│   ├── osVersion     assocarray
│   ├── locale        string                                ← roDeviceInfo.GetCurrentLocale()
│   ├── clockFormat   string
│   ├── isAudioGuideEnabled, hasVoiceRemote                 bool
│   ├── displayType, displayMode  string
│   ├── uiResolution  array                                 ← [width, height]
│   ├── videoMode     string                                ← raw from roDeviceInfo
│   ├── videoHeight, videoWidth, videoRefresh, videoBitDepth integer
│   └── isLowMemoryDevice bool                              ← computed from LOW_MEMORY_DEVICE_PREFIXES in globals.bs
│
├── server            JellyfinServer node                   ← phase 1
│   ├── serverUrl, name, version, id, apiVersion, isConnected
│   ├── isQuickConnectEnabled bool                          ← fail-open default true; QuickConnectEnabledTask sets false
│   └── ...
│
├── user              JellyfinUser node                     ← phase 1
│   ├── id, name, authToken
│   ├── settings      JellyfinUserSettings (child node)     ← THE per-user config — see "User settings" below
│   ├── config        JellyfinUserConfiguration             ← server-authoritative profile (avatar URL, etc.)
│   ├── policy        JellyfinUserPolicy                    ← server-authoritative permissions
│   └── fontScaleFactor float                               ← computed from default-vs-fallback font widths if uiFontFallback=true
│
├── constants         Constants node                        ← phase 1, populated by setConstants() → loadThemeColorDefaults()
│   ├── colorPrimary, colorSecondary, colorTextPrimary, ...  string  (theme — read from settings.json defaults)
│   ├── colorYellow, colorTextError, colorSuccess, ...       string  (semantic, hard-coded)
│   ├── alpha60, alpha40, ...                                 string  (alpha hex, append to colors)
│   └── ...UI sizes, durations, etc. — see Constants.xml
│
├── translations          assoc array                       ← phase 1 (loaded by loadTranslations(locale))
├── translationsFallback  assoc array                       ← always en_US
├── translationLocale     string                            ← locale code (e.g. "fr_CA")
│
├── apiPool0          ApiTask node                          ← phase 2 (control = "RUN")
├── apiPool1          ApiTask node                          ← phase 2 (control = "RUN")
├── apiPool2          ApiTask node                          ← phase 2 (control = "RUN")
├── apiQueue          ApiQueueTask node                     ← phase 2 (control = "RUN") — FIFO coordinator
├── sideEffectTask    SideEffectTask node                   ← phase 2 (re-RUN per request)
│
├── sceneManager      SceneManager node                     ← phase 2
├── queueManager      QueueManager node                     ← phase 2
├── audioPlayer       AudioPlayer node (extends Video)      ← phase 2 — the audio playback engine
│
└── debug             DebugFlags node                       ← phase 2, ONLY in #if debug builds
    ├── shouldForceFiltersFail   bool
    ├── shouldForceFavoriteFail  bool
    └── shouldForceWatchedFail   bool
```

"Phase 1" and "Phase 2" refer to `setGlobals()` (before `screen.show()`) and `setGlobalNodes()` (after) respectively — see `bootstrap.md`.

## Why typed `ContentNode` subclasses

Each XML file in `components/data/jellyfin/` declares a typed shape:

```xml
<component name="JellyfinUser" extends="ContentNode">
  <interface>
    <field id="id" type="string" />
    <field id="name" type="string" />
    <field id="authToken" type="string" />
    <field id="settings" type="node" />
    <field id="config" type="node" />
    <field id="policy" type="node" />
    <field id="fontScaleFactor" type="float" />
    ' ... etc
  </interface>
</component>
```

This gives:

- **BSC validation** — assigning the wrong type to a field is a compile error.
- **Documentation** — the XML *is* the schema. Reading `JellyfinUser.xml` tells you exactly what's available without grepping the codebase.
- **Auto-conversion** — Roku coerces strings to the declared field type on assignment.

The full set is small enough to enumerate:

| File | Purpose |
|---|---|
| `AppInfo.xml` | App metadata from `roAppInfo` |
| `DeviceInfo.xml` | Device facts from `roDeviceInfo` |
| `JellyfinBaseItem.xml` | The big one — fields for every Jellyfin item type (Movie, Episode, Audio, etc.) |
| `JellyfinServer.xml` | Server identity and connection state |
| `JellyfinUser.xml` | User identity + child-node references |
| `JellyfinUserSettings.xml` | Per-user UI/playback settings — see below |
| `JellyfinUserConfiguration.xml` | Server-side profile (avatar tag, display preferences, home section ordering) |
| `JellyfinUserPolicy.xml` | Server-side permissions (can record, can sync, etc.) |

`JellyfinBaseItem.xml` is the largest because Jellyfin's `BaseItemDto` is itself a polymorphic mega-shape — JellyRock represents that as one wide ContentNode with optional fields, populated by `source/data/JellyfinDataTransformer.bs`.

## User settings — `m.global.user.settings`

The `JellyfinUserSettings` node is the runtime home for everything a user can change in Settings: theme colors, playback bitrate cap, subtitle preferences, UI behavior, etc.

**Defaults do not live in the XML.** The XML field declarations omit `value=` attributes deliberately. Defaults are loaded at runtime from `settings/settings.json` via `user.settings.SaveDefaults()` during startup. This avoids drift between two sources of truth.

Lifecycle:

1. **Phase 1** — `setGlobals()` creates the empty `JellyfinUserSettings` node and parents it under `m.global.user`.
2. **Bootstrap** — `main.bs` calls `user.settings.SaveDefaults()`, which reads `settings/settings.json` and writes the default value of every setting onto the node.
3. **Bootstrap** — `m.global.user.settings.callFunc("enableAutoSync")` turns on the auto-sync behavior: any subsequent write to a settings field automatically writes through to the user's registry section.
4. **Login** — `SessionDataTransformer` (`source/data/SessionDataTransformer.bs`) reads the per-user registry section and overlays any saved values on top of the defaults.
5. **Steady state** — Reads happen from `m.global.user.settings.<field>` directly. Writes go through the same field assignment, and the auto-sync observer persists them to the registry.

`JellyfinUserSettings.bs` (the BS backing file) implements `SaveDefaults`, `enableAutoSync`, and the per-field observer logic. Settings are categorized by prefix:

| Prefix | Purpose |
|---|---|
| `global*` | Device-wide (e.g. `globalRememberMe`, `globalSplashScreen`) |
| `playback*` | Video/audio playback (`playbackBitrateLimit`, `playbackCinemaMode`, `playbackPreserveDovi`, `playbackSubsCustom`, ...) |
| `ui*` | UI behavior + theme (`uiTheme`, `uiThemeColorPrimary`, `uiFontFallback`, `displayShowTitles`, ...) |
| `network*` | Network behavior (`networkRequirements`) |

Read-only server-authoritative children — `user.config` and `user.policy` — are populated from `/Users/{userId}` API responses on login and never written back to.

## Constants — `m.global.constants`

`components/data/Constants.xml` is the central typed registry of UI constants. Two flavors:

- **Theme colors** (`colorPrimary`, `colorSecondary`, `colorTextPrimary`, `colorTextSecondary`, `colorTextDisabled`, `colorBackgroundPrimary`, `colorBackgroundSecondary`) — declared with **no value**; populated at runtime by `loadThemeColorDefaults()` from `settings/settings.json`.
- **Semantic / hard-coded colors and sizes** (`colorYellow`, `colorTextError`, `colorSuccess`, alphas, durations) — declared with their values inline.

All colors are 6-hex (no alpha, no `0x` prefix in `settings.json`). At load time, `globals.bs` prepends `0x` and uppercases. Alpha is a separate constant (`alpha60`, `alpha40`, etc.) you concatenate at the use site:

```brightscript
node.color = m.global.constants.colorPrimary                          ' fully opaque
node.color = m.global.constants.colorBlack + m.global.constants.alpha60  ' 60% black
```

### Theme override flow

When the user changes a theme color:

1. They write to a setting (e.g. `m.global.user.settings.uiThemeColorPrimary = "8b5cf6"`).
2. The auto-sync observer persists it to registry.
3. Nothing else happens automatically — the change isn't visible until something rebuilds the affected nodes.
4. The Settings screen, on exit, calls `applyThemeColorOverrides(userSettings)` (in `globals.bs`) which reads valid hex values from settings and writes them onto `m.global.constants`. Then it calls `sceneManager.refreshThemeColors()` to walk the overhang tree and re-apply colors, and `sceneManager.reloadHome()` to trigger a home-screen rebuild.

This is a known wart — the cascade is manual, not declarative. Components that cache theme colors at construction time (rather than reading from `m.global.constants` in event handlers) won't pick up changes without a rebuild. See `tech-debt.md`.

## App + device info

`m.global.app` is read from Roku's `roAppInfo` interface (`SaveAppToGlobal`). The `lastRunVersion` field comes from the registry — it's how `migrations.bs` decides which migrations to run on this launch.

`m.global.device` is read from `roDeviceInfo` (`SaveDeviceToGlobal`). The most-consulted fields are:

- `model` — used by `checkIsLowMemoryDevice()` to set `isLowMemoryDevice` based on the hardcoded `LOW_MEMORY_DEVICE_PREFIXES` list of 512MB models (Streaming Stick, Express, certain TVs).
- `videoHeight` / `videoWidth` / `videoBitDepth` — used by `LoadVideoContentTask.bs` when computing transcode parameters.
- `locale` — initial translation locale before login.

`isLowMemoryDevice` is the gate for several memory-conserving paths: trickplay tile pre-fetching is reduced, large texture grids are downscaled, etc.

## Manager nodes — `sceneManager`, `queueManager`, `audioPlayer`

All three are SceneGraph nodes. They expose their behavior via `callFunc("methodName", args)` rather than direct field manipulation:

```brightscript
m.global.sceneManager.callFunc("pushScene", myGroup)
m.global.queueManager.callFunc("push", queueItem)
m.global.queueManager.callFunc("playQueue")
m.global.audioPlayer.control = "play"          ' direct field, since audioPlayer extends Video
```

`sceneManager` and `queueManager` are documented elsewhere (`navigation.md`, `playback.md`). `audioPlayer` is interesting: it's a globally-mounted `AudioPlayer` node (extends Roku's native `Video` for audio playback) that exists for the entire app lifetime. The visible "now playing" screen — `components/music/AudioPlayerView.xml` — references it indirectly. Having the player itself global allows audio to keep playing while the user navigates other screens.

## Debug flags — `m.global.debug`

Compiled out in production builds via `bs_const=debug=false`. In debug builds, `setGlobalNodes()` creates a `DebugFlags` node and prints helper instructions to the BrightScript console:

```brightscript
[DEBUG] DebugFlags node initialized on m.global.debug
[DEBUG] Toggle flags from BrightScript console (port 8085):
[DEBUG]   m.global.debug.shouldForceFiltersFail = true
[DEBUG]   m.global.debug.shouldForceFavoriteFail = true
[DEBUG]   m.global.debug.shouldForceWatchedFail = true
```

Code paths that check these flags are wrapped in `#if debug` so they have zero runtime cost in production. See `debug-tools.md`.

## Cruft callouts

- **Manual theme color cascade.** As above — settings change → applyThemeColorOverrides → refreshThemeColors → reloadHome is a chain that any new themed component must opt into. There's no general "this constant changed, refresh the tree" mechanism.
- **No type guard for `m.global.user.settings.<x>` typos.** BSC validates the field name at compile time *for the typed ContentNode*, but only if the access is properly typed. Untyped accesses (the common case in older code) fall through silently and return `invalid`, which can mask bugs.
- **`fontScaleFactor` is conditional.** Only computed if `uiFontFallback` is enabled (which downloads a fallback font for non-Latin scripts and computes a scale factor so layouts don't break). This adds a multi-step startup path with several observer points; a small but real source of complexity.
- **`m.global.app.lastRunVersion` straddles two concerns.** It's both a read-from-registry value (used by migrations) AND a write-on-startup value (set to `m.global.app.version` once migrations finish). The window between read and write is brief, but you have to know that "lastRunVersion" means different things at different times in startup.

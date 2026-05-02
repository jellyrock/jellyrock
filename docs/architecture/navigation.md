---
topic: navigation
related-files:
  - components/data/SceneManager.bs
  - components/JRScreen.bs
  - components/JRScreen.xml
  - components/JRGroup.xml
  - components/JRScene.bs
  - components/JRScene.xml
last-reviewed: 2026-05-01
---

# Scene Stack & Navigation

How JellyRock manages screens, where focus lives during transitions, and how the persistent overhang stays in sync.

## The component triad

Three base classes form the screen hierarchy. Every UI component inherits from one of them.

```brightscript
roSGNode
  └─ Group
      └─ JRGroup           ← components/JRGroup.xml (interface only, no .bs)
          ├─ <any sub-panel or dialog>
          └─ JRScreen      ← components/JRScreen.xml/.bs (full-screen scenes)
              ├─ Home
              ├─ ItemDetails
              ├─ BaseGridView
              ├─ Settings
              ├─ VideoPlayerView
              ├─ AudioPlayerView
              └─ ...

Scene
  └─ JRScene               ← components/JRScene.xml/.bs (the one persistent root)
```

### `JRGroup` — `components/JRGroup.xml`

Pure interface declaration. No BrighterScript backing file. Adds these fields to every group:

| Field | Type | Purpose |
|---|---|---|
| `backPressed` | bool (alwaysNotify) | Set to true when child wants to handle back internally |
| `lastFocus` | node | The element that had focus when this group was last shown |
| `overhangTitle` | string | Title to display in the top bar |
| `overhangTabs` | array | Tab definitions for the top bar |
| `selectedTabId` | string (alwaysNotify) | Currently selected tab |
| `isOverhangVisible` | bool (default: true) | Hide the top bar (e.g., during video playback) |
| `isOptionsAvailable` | bool (default: true) | Whether the options key opens a panel for this group |

The `SceneManager` reads these fields when registering a new group (see "Overhang wiring" below).

### `JRScreen` — `components/JRScreen.xml/.bs`

Extends `JRGroup`. Adds three lifecycle virtual functions that subclasses override:

```brightscript
sub OnScreenShown()       ' Called when this screen becomes visible (push, or pop revealing it)
sub OnScreenHidden()      ' Called when this screen is hidden (push of a new screen, or pop)
sub destroy()             ' Called when this screen is permanently removed from the stack
```

The base implementations are minimal:

- `OnScreenShown()` restores focus from `lastFocus` (or sets focus on the screen itself)
- `OnScreenHidden()` is a no-op
- `destroy()` is a no-op — subclasses **must** override to clean up tasks, observers, and large data structures (this is a known cruft point; see Cruft Callouts)

`JRScreen.bs:init()` also initializes the `roku-log` log manager (debug builds: level 5; prod: level 2), so every JRScreen-derived component has logging available without each one having to call `initializeLogManager`.

### `JRScene` — `components/JRScene.xml/.bs`

Covered in `bootstrap.md`. Relevant here: it has a `Group id="content"` child that the `SceneManager` swaps the active screen in and out of, and a `JROverhang id="overhang"` that the `SceneManager` reads field updates onto.

## SceneManager — `components/data/SceneManager.bs`

Lives at `m.global.sceneManager`. The only thing that mutates `m.scene.findNode("content")`. All navigation goes through it.

### State

```brightscript
m.groups = []                                  ' the stack (array of group nodes, top of stack = last)
m.scene = m.top.getScene()                     ' reference to JRScene
m.content = m.scene.findNode("content")        ' the visible-group slot
m.overhang = m.scene.findNode("overhang")      ' the persistent top bar
```

Only the **top** of the stack is mounted in the rendered scene graph (as the single child of `m.content`). All other entries are kept in the `m.groups` array but are not part of the rendered tree. This means an entry in the stack still exists in memory, but its tasks/observers will not fire until it's restored. (Subclasses should consider this when deciding whether to suspend background work in `OnScreenHidden`.)

### Public API

The full public surface (snippet illustrative, not exhaustive — canonical source: `components/data/SceneManager.bs`):

| Function | Purpose |
|---|---|
| `pushScene(newGroup)` | Push a group onto the stack and make it visible. Hides the previous top, calls `OnScreenHidden` on it, calls `OnScreenShown` on the new one. |
| `popScene()` | Remove the top of the stack. **If the stack has only 1 entry, shows an exit confirmation dialog instead.** Calls `OnScreenHidden` + `destroy` on the removed group. Restores the next-top group's focus from `lastFocus`. |
| `getActiveScene()` | Peek the top of the stack (no removal). |
| `clearScenes()` | Pop everything. Calls `OnScreenHidden` + `destroy` on every JRScreen, `destroy` on any `Video` subtype. Hides the overhang first to avoid staggered visual cleanup. |
| `clearPreviousScene()` | Pop without restoration (used internally for queue advancement: video finishes → pop the player → push the next player). |
| `deleteSceneAtIndex(index = 1)` | Delete a specific entry from the stack (rarely used). |
| `settings()` | Convenience: create and push the `Settings` component. |
| `setBackgroundImage(uri, isAnimated, forceBackdrop)` | Proxy to `JRScene.setBackgroundImage`. |
| `userMessage(title, message)` | Show an OK-only modal dialog. |
| `standardDialog(title, message)` | Show a themed OK dialog (custom `StandardDialog` component). |
| `radioDialog(title, message)` | Show a radio-button selection dialog. The selection result fires on `returnData` field. |
| `showConfirmationDialog(title, message, buttons)` | Multi-button dialog. Result via `returnData`. |
| `dismissDialog()` | Close the active dialog. |
| `isDialogOpen()` | Bool. |
| `reloadHome()` | Sets `reloadHomeRequested = true`; `main.bs` observes this field and triggers a home-screen rebuild. Used after theme color changes, settings changes, etc. |
| `refreshThemeColors()` | Walk the overhang tree and re-apply colors from `m.global.constants` (no component recreation). |
| `updateUser()` | Pass `currentUser` through to the overhang. |
| `resetTime()` | Tell the overhang to refresh the displayed clock. |

`returnData` and `isDataReturned` are how dialog selections come back to callers: dialogs write `returnData` and set `isDataReturned = true`; observers in `main.bs` (or in feature code that registered a temporary observer) read the result.

### How `pushScene` works

```brightscript
sub pushScene(newGroup)
  currentGroup = m.groups.peek()

  if isValid(currentGroup)
    ' Walk the focus chain to find the deepest currently-focused node
    if isValid(currentGroup.focusedChild)
      focused = currentGroup.focusedChild
      while focused.hasFocus() = false
        focused = focused.focusedChild
      end while
      currentGroup.lastFocus = focused          ' save it for restoration on pop
    end if
    currentGroup.setFocus(false)

    if currentGroup.isSubType("JRGroup")
      unregisterOverhangData(currentGroup)      ' detach overhang field observers
    end if

    currentGroup.visible = false

    if currentGroup.isSubType("JRScreen")
      currentGroup.callFunc("OnScreenHidden")
    end if
  end if

  m.groups.push(newGroup)

  if isValid(currentGroup)
    m.content.replaceChild(newGroup, 0)         ' swap the visible child
  else
    m.content.appendChild(newGroup)
  end if

  if newGroup.isSubType("JRScreen")
    newGroup.callFunc("OnScreenShown")
  end if

  if newGroup.isSubType("JRGroup")
    registerOverhangData(newGroup)              ' wire overhang field observers
    if not newGroup.isInFocusChain()
      newGroup.setFocus(true)
    end if
  end if
end sub
```

Two important details:

- The "walk the focus chain" loop preserves the *deepest* focused element, not just `focusedChild`. This matters for nested panels (e.g., a list inside a tab inside a screen) so back navigation lands the cursor exactly where the user left it.
- `newGroup.isInFocusChain()` is checked before forcing focus on the new group, so screens that set focus internally during `init()` aren't overridden.

### How `popScene` works

```brightscript
sub popScene()
  if m.groups.count() <= 1
    ' Don't actually pop — show "Exit JellyRock?" confirmation
    showConfirmationDialog(...)
    m.top.isPendingExitConfirmation = true
    return
  end if

  group = m.groups.pop()
  if isValid(group)
    if group.isSubType("JRGroup")     then unregisterOverhangData(group)
    if group.isSubType("Video")       then group.control = "stop"   ' tell Jellyfin we stopped
    group.visible = false
    if group.isSubType("JRScreen")    then group.callFunc("OnScreenHidden") + group.callFunc("destroy")
    if group.isSubType("Video")       then group.callFunc("destroy")
  end if

  group = m.groups.peek()             ' the newly-revealed top
  if isValid(group)
    registerOverhangData(group)
    group.visible = true
    m.content.replaceChild(group, 0)
    if group.isSubType("JRScreen")
      group.callFunc("OnScreenShown")
    else
      ' Restore focus directly (non-JRScreen subtype)
      if isValid(group.lastFocus) then group.lastFocus.setFocus(true)
    end if
  else
    m.scene.exit = true
  end if
end sub
```

Notable:

- **The video player's stop signal to the server happens here** — `group.control = "stop"` on a `Video` subtype. This is how Jellyfin learns playback ended when the user just hits back.
- The exit confirmation is the reason there's no separate "exit" path in `main.bs` — the natural `back` from the home screen routes here.

## Focus management

Every `JRGroup` has a `lastFocus` field. The dance is:

1. **On push** — `SceneManager` walks the current group's focus chain and saves the deepest focused node into `currentGroup.lastFocus`.
2. **On pop** — `SceneManager` calls `OnScreenShown()` on the revealed `JRScreen`, whose default implementation reads `m.top.lastFocus` and calls `.setFocus(true)` on it. Subclasses can override `OnScreenShown` to do something more elaborate (e.g., re-fetch data first, then focus).
3. **For `non-JRScreen` subtypes** (rare in screen position, but happens for some dialog-like groups), the `SceneManager` itself restores focus directly without calling `OnScreenShown`.

The `lastFocus` mechanism is one of the things JellyRock gets reliably right — UIs that are otherwise complex (rows of rows, tabs of grids) maintain cursor position consistently across navigation.

## Overhang wiring

`JROverhang` is the persistent top bar (logo, current user info, search icon, settings icon, library tabs, clock). It lives in `JRScene` and is **not** part of any individual screen. Each screen *describes* what should appear in the overhang via its `JRGroup` fields:

```xml
<JRGroup interface fields:>
  isOverhangVisible: bool
  overhangTitle: string
  overhangTabs: array
  selectedTabId: string
```

When a group is pushed, `SceneManager.registerOverhangData(group)` wires field observers:

```brightscript
sub registerOverhangData(group)
  if group.isSubType("JRGroup")
    m.overhang.visible = group.isOverhangVisible
    group.observeField("isOverhangVisible", "updateOverhangVisible")

    ' Set tabs BEFORE title — onTabsChanged hides the title before it renders
    ' with text, preventing a visible title→tab transition flash
    m.overhang.selectedTabId = group.selectedTabId
    m.overhang.tabs = group.overhangTabs
    group.observeField("overhangTabs", "updateOverhangTabs")
    m.overhang.observeField("selectedTabId", "onOverhangTabSelected")

    if isValid(group.overhangTitle) then m.overhang.title = group.overhangTitle
    group.observeField("overhangTitle", "updateOverhangTitle")
  end if
end sub
```

`unregisterOverhangData(group)` is the symmetric teardown called on push (for the displaced group) and pop (for the popped group). The pattern means individual screens never touch the overhang directly — they just declare what they want, and the framework wires it.

The `selectedTabId` observation is bidirectional: when the user changes tabs in the overhang, `onOverhangTabSelected` writes back into the active group's `selectedTabId` field, which the group observes to swap content. The `home/Home` screen uses this for the home/favorites tab swap.

## Known cruft

Tracked in [`tech-debt.md`](tech-debt.md) — search by `area` for navigation / `SceneManager` entries.

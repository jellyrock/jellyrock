---
topic: deep-linking
related-files:
  - source/replayRoute.bs
  - source/main.bs
  - components/JRScene.bs
  - components/ItemDetails.bs
  - components/auth/AuthManager.bs
last-reviewed: 2026-06-28
---

# Deep Linking & Casting

How another device opens content directly in JellyRock — the launch payload, how JellyRock
resolves and plays it, and how to test it. JellyRock is a self-hosted client, so this is **not**
about Roku Search / ads (we publish no catalog); the intended consumer is the **Jellyfin
ecosystem casting to a Roku** (e.g. a phone app telling this device to play an item). We control
both ends, so the payload below is JellyRock's contract, not Roku's.

## Ingress

Both Roku ingress paths are handled (`source/main.bs`):

- **Cold start** — the device is launched into JellyRock with the params on `Main(args)`
  (`.../launch/dev?...` over ECP, or a real Roku launch). Requires `supports_input_launch=1`
  in the `manifest` (present).
- **Runtime** — JellyRock is already open and is handed content via an `roInputEvent`
  (`.../input?...`). Same `manifest` flag.

Both funnel the params to `stashDeepLink()` (`source/replayRoute.bs`).

## Payload

| `Param` | Required | Meaning |
|---|---|---|
| `contentId` | **yes** | What to do, encoded as a **bare** Jellyfin item id, or **pipe-separated key=value** — `id=<itemId>\|serverId=<serverGuid>\|action=<verb>` (parsed by `parseDeepLinkContentId`). Key names mirror Jellyfin web's `?id=&serverId=`. |
| `mediaType` | no | Roku's media-type hint. Used only as the throwaway `:type` segment of the details route (`ItemDetails` resolves the real type from the fetched item). Otherwise ignored. |
| `itemName` | no | A display title, used **only** to name the item in the server-switch prompt (we can't fetch the title ourselves before switching — it lives on a server we're not yet authenticated to). Omit → the prompt falls back to a server-named message. |

### `contentId` keys

| Key | Default | Meaning |
|---|---|---|
| `id` | — | The Jellyfin item id. A **bare segment** (no `=`) is taken as the id, so both `<id>` and `<id>\|action=play` work as well as `id=<id>\|action=play`. |
| `serverId` (alias `server`) | active server | The target server's Jellyfin **id (GUID)**, not a URL. See "Server resolution". |
| `action` | `open` | What to do with the resolved item — **the sender's explicit intent** (the route decides; behavior is *never* inferred from the resolved item). One of `open` / `play` / `shuffle` / `trailer` / `instantmix`. Any **unknown** value degrades to `open`, so the contract is **forward-compatible** — a new verb is additive and safe on older builds. |

**Parsing rules** (`parseDeepLinkContentId`):

- **Split on the first `=` only** — a value may itself contain `=` (it's preserved, not dropped).
- **Duplicate keys are last-wins** — `id=a|id=b` resolves to `b`. Empty segments (stray `|`) are ignored.
- **Keys are case-insensitive**; the `action` value and the `serverId` GUID are normalized to lower
  case (a Jellyfin server GUID is canonical lower-case hex, and the saved-server match folds both
  sides), so a wrongly-cased sender still resolves.
- **The `id` is validated as URL-safe before use** (`isPlausibleDeepLinkItemId`: hex/alphanumeric +
  dashes/underscores, no `/ ? # & = | %` or whitespace). An id carrying URL-structural characters
  is dropped at stash time — it's concatenated raw into the details route and the `/Items/<id>`
  fetch URL, so this stops a crafted `contentId` from reshaping either. (A real Jellyfin id is a
  GUID, so this never rejects a legitimate link; it is an injection guard, not a strict GUID check.)

> **Why everything rides inside `contentId` (and uses pipes).** `contentId` is the only deep-link
> field that survives **both** Roku ingress paths: cold-start `/launch` standardizes only
> `contentId` + `mediaType` (extra top-level params are dropped), while runtime `/input` forwards
> arbitrary params. Roku also **forbids `&` inside `contentId`** and treats `action` as a reserved
> top-level launch key — so the contract is nested *inside* `contentId`, pipe-delimited (Roku's own
> documented convention, e.g. `series=x|Season=1`). Nesting also sidesteps the reserved-`action`
> collision (ours is a sub-key Roku never reads).

> The `serverId` value is a Jellyfin **server id (GUID)**, not a URL. JellyRock can only connect to
> servers it already has saved (it maps the GUID → a saved server's URL). A GUID for a server that
> isn't set up on the device can't be fulfilled (see "Server resolution").

## Behavior

- **Validate FIRST, then navigate** (`JRScene.resolveDeepLink`) — a deep link is resolved (a
  metadata fetch, with a spinner) **before** any navigation, so an **invalid id never disturbs the
  active session**: it just toasts *"This content isn't available."* — no navigation, nothing torn
  down (a malicious LAN `curl` of junk ids is harmless). A spinner shows during the fetch; a fetch
  failure toasts the same way. Only a **valid** id navigates on. *(Exception: a **cross-server**
  link can't be validated until after its user-confirmed switch, so an invalid id there toasts
  post-switch — see "Server resolution".)*
- **Then route** to `/details/<type>/<id>?deeplink=<action>` (post-login, Home is shown first so
  it's the back-stack root; a playback cast arriving over an active player tears that player down
  first). The `?deeplink=<action>` query carries the **action**; `ItemDetails` loads + dispatches it.
  *(Exception: a grid-container target on `open` diverts to the library grid before `ItemDetails` —
  see the `open` action below.)*
- **Dispatch the action** (`ItemDetails.dispatchDeepLinkAction`) — **do what the route asked**, on the resolved
  item. The action is the sender's explicit intent; it is **never** inferred from the item:
  - **`open`** (and any unknown action) → land on the **details springboard**, no playback. A
    **grid-container** type (`CollectionFolder` / `UserView` / `Folder` / `Channel` / `Genre` /
    `MusicGenre` / `Studio`) has no springboard, so `JRScene.resolveDeepLink` diverts it **before**
    `ItemDetails` straight to the scoped library **grid** (`routeForItem` → the same `/library/:id`
    route an in-app tap uses, handed the already-fetched node as route context; Back lands on Home).
    Only the non-playback `open` path diverts — a playback action never targets a container.
  - **`play`** → `QueueManager.launchItem`, the **same** per-type quickplay engine a normal in-app
    tap uses (no deep-link-specific play logic): a single **video** resumes its Jellyfin bookmark
    (no resume/start-over dialog); a **Series** smart-resumes the next-up episode
    (`QuickPlayTask.doSeries`); a **container** (Season / `BoxSet` / `MusicArtist` / `MusicAlbum` /
    Playlist) plays; a **Person** shuffles their movies + watched episodes; a **live channel /
    program** watches; **Audio** → audio player; **Photo** → viewer; `PhotoAlbum` → slideshow.
  - **`shuffle`** → the same path the **Shuffle** button uses (`onShuffleButtonPressed`).
  - **`trailer`** → plays this item's trailer(s).
  - **`instantmix`** → builds an **instant mix** from the item (mirrors the `instantMixButton`; the
    quickplay engine lower-cases the verb and no-ops gracefully on a target that yields no mix).
- **Once per navigation** — `checkDeepLinkLaunch()` keys off the router's per-navigation `route.id`,
  so a **repeat cast of the same item** still fires — the router reuses the **active** view on a
  same-path navigation (independent of any route flag) and delivers it through `onRouteUpdate`
  with a new `route.id` — while an ordinary **back-from-player** resume (same `route.id`) does
  **not** re-fire. A runtime recast that lands while already on the item's details dispatches the
  **new** action in place (`playFromDeepLink(action)`), not the stale one.

## Server resolution

A deep link may target a different server than the one you're signed into (`source/replayRoute.bs`):

| `server` GUID | Behavior |
|---|---|
| absent, or = the active server | open it on the current session |
| = a **saved** server (different) | **runtime:** prompt *"Play '\<title\>' on '\<server\>'? You'll switch servers…"* → on confirm, a non-destructive reachability **check** (so an offline target can't strand you), then switch (sign out → re-login → replay). **cold start:** login is steered straight to that server (no prompt — no session to disrupt). |
| unknown GUID | toast *"…a Jellyfin server you haven't added to this device."* |

## Auth (deferred deep links)

If a deep link arrives while signed out, it's **stashed** (`m.global.AuthManager.stashedDeepLink`),
a toast explains *"Sign in to open your content."*, and `replayAfterLogin()` opens it once login
completes. (The `AuthManager` `canActivate` guard uses the sibling `stashedRoute` for in-app
signed-out redirects — see [navigation.md](../architecture/navigation.md).)

## Feedback (toasts + spinner)

- A **spinner** shows while the id is being validated (`JRScene.resolveDeepLink`'s fetch); it does
  **not** block the remote, so a runtime cast doesn't freeze what you're doing.
- **"This content isn't available."** when the id is invalid or the validation fetch fails — and
  **nothing else happens** (no navigation; the active session is untouched).
- **"Playing \<title\>"** when a `play`/`shuffle`/`trailer`/`instantmix` action's playback actually starts — fired
  by the player on mount (the end state), using the resolved item's name. An `open` action shows no
  toast (it just navigates); Photo/`PhotoAlbum` open the viewer with no toast.
- **"Switching to '\<server\>'…"** when a confirmed server switch begins.
- **"Sign in to open your content."** when deferred for auth.
- **"Cast canceled."** when a server-switch prompt is dismissed.

## Testing (ECP via cURL)

`<IP>` = the Roku's address. Watch the TV; `curl "http://<IP>:8060/query/media-player"` reports
playback state/position for scripted checks.

**Encoding (verified on-device):** the ONLY character that must be encoded is the `=` inside a
`key=value` pair — write it `%3D`. A **literal `=` in the query value makes Roku's ECP return
`404`** (e.g. `?contentId=id=x` → 404; `?contentId=id%3Dx` → 200). The `|` separators do **not**
need encoding — a literal `|` is accepted (200) — and a bare-id `contentId` (no `=`) needs none at
all. So drop the `id=` prefix (a leading bare segment is the id) and keep the pipes literal: the
readable `<itemId>|action%3D<verb>` is the minimal correct form. `/input` and `/launch` are **POST**
(`-d ''`); a `GET` returns 404.

```bash
# Open an item's details (bare id, action defaults to open) — runtime
curl -d '' "http://<IP>:8060/input?contentId=<itemId>"

# Play it — runtime
curl -d '' "http://<IP>:8060/input?contentId=<itemId>|action%3Dplay"

# Shuffle / trailer / instant mix (instantmix targets music: MusicArtist / MusicAlbum / Audio)
curl -d '' "http://<IP>:8060/input?contentId=<itemId>|action%3Dshuffle"
curl -d '' "http://<IP>:8060/input?contentId=<itemId>|action%3Dtrailer"
curl -d '' "http://<IP>:8060/input?contentId=<itemId>|action%3Dinstantmix"

# Play on a specific (saved) server, with a cast title for the switch prompt
curl -d '' "http://<IP>:8060/input?contentId=<itemId>|serverId%3D<serverGuid>|action%3Dplay&itemName=<Title>"

# Cold start straight into playback
curl -d '' "http://<IP>:8060/launch/dev?contentId=<itemId>|action%3Dplay"

# Invalid id → toast + Home (no stuck details), for any action
curl -d '' "http://<IP>:8060/input?contentId=deadbeefdoesnotexist"
```

A deep link whose `serverId` is a *different saved server* triggers the switch prompt; an *unknown*
server GUID toasts. A repeat of the same `play`/`shuffle`/`trailer` command should re-fire (regression
net for the same-path-resume bug fixed alongside this doc); a repeat `open` is a no-op (already
showing it).

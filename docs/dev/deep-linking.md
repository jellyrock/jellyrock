---
topic: deep-linking
related-files:
  - source/replayRoute.bs
  - source/main.bs
  - components/ItemDetails.bs
  - components/auth/AuthManager.bs
last-reviewed: 2026-06-15
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
| `contentId` | **yes** | The item to open. Two accepted forms (parsed by `parseDeepLinkContentId`): a **bare** Jellyfin item id, or **pipe-separated key=value** — `id=<itemId>\|server=<serverGuid>` (mirrors Jellyfin web's `?id=&serverId=`). |
| `mediaType` | no | Roku's media-type hint. **Ignored for the launch decision** — JellyRock infers play-vs-springboard from the *resolved* item (see below). Accepted for Roku compatibility. |
| `itemName` | no | A display title for the item. Used **only** to name the item in the server-switch prompt (we can't fetch the title ourselves before switching — it lives on a server we're not yet authenticated to). Omit and the prompt falls back to a server-named message. |

> The `server` value is a Jellyfin **server id (GUID)**, not a URL. JellyRock can only connect to
> servers it already has saved (it maps the GUID → a saved server's URL). A GUID for a server that
> isn't set up on the device can't be fulfilled (see "Server resolution").

## Behavior

After login, `replayAfterLogin()` navigates `Home → /details/<type>/<id>?deeplink=1` (Home first so
it's the back-stack root). `ItemDetails` is the validator/launcher:

- **Validate** — it fetches the item by id. An invalid/missing id → toast
  *"This content isn't available."* + back to **Home** (never a broken details screen).
- **Auto-launch decision** — inferred from the **resolved item's type** (`isDeepLinkAutoPlayable`),
  not the sender's `mediaType`:
  - a single, directly-playable **video** item (Movie, Episode, Video, …) → **plays**, resuming at
    its Jellyfin **bookmark** (`UserData.PlaybackPositionTicks`); no resume/start-over dialog.
  - a **container** (Series / Season / `BoxSet` / `MusicArtist` / `MusicAlbum` / Playlist) or a type with
    its own non-video action (Photo / `PhotoAlbum` / `TvChannel` / Program / Person / Audio) → lands on
    the **details springboard**, where Play / Resume / View are ready.
- **Once per navigation** — `checkDeepLinkLaunch()` keys off the router's per-navigation `route.id`,
  so a **repeat cast of the same item** (whose `ItemDetails` is cached by `keepAlive`) still
  launches, while an ordinary **back-from-player** resume (same `route.id`) does **not** re-launch.

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

## Feedback (toasts)

- **"Opening \<title\>"** when a launch starts (uses the resolved item's name).
- **"Switching to '\<server\>'…"** when a confirmed server switch begins.
- **"Sign in to open your content."** when deferred for auth.
- **"Cast canceled."** when a server-switch prompt is dismissed.

## Testing (ECP via cURL)

`<IP>` = the Roku's address. Watch the TV; `curl "http://<IP>:8060/query/media-player"` reports
playback state/position for scripted checks.

```bash
# Play a movie on the active server (bare id) — runtime
curl -d '' "http://<IP>:8060/input?contentId=<itemId>"

# Encoded id + server, with a cast title (note the URL-encoding: = is %3D, | is %7C)
curl -d '' "http://<IP>:8060/input?contentId=id%3D<itemId>%7Cserver%3D<serverGuid>&itemName=<Title>"

# Cold start straight into content
curl -d '' "http://<IP>:8060/launch/dev?contentId=<itemId>"

# Invalid id → toast + Home (no stuck details)
curl -d '' "http://<IP>:8060/input?contentId=deadbeefdoesnotexist"
```

A deep link whose `server` is a *different saved server* triggers the switch prompt; an *unknown*
server GUID toasts. A repeat of the same command should re-launch (regression net for the
`keepAlive-resume` bug fixed alongside this doc).

---
topic: deep-linking
related-files:
  - source/replayRoute.bs
  - source/main.bs
  - components/JRScene.bs
  - components/ItemDetails.bs
  - components/auth/AuthManager.bs
last-reviewed: 2026-10-09
---

# Deep linking and casting

How another device opens content in JellyRock: the payload it sends, how JellyRock resolves and acts on it, and how to test it. For how a user sends one, see the [user guide](../user/deep-linking.md).

This isn't about Roku Search or ads: JellyRock publishes no catalog. The sender is the Jellyfin ecosystem casting to a Roku, such as a phone app telling the Roku to play an item. We control both ends, so the payload below is JellyRock's contract, not Roku's.

## How links arrive

`source/main.bs` handles both of Roku's ways in. Both need `supports_input_launch=1` in the `manifest`, which is set.

- **Cold start:** the Roku launches JellyRock with the parameters on `Main(args)`, from `.../launch/dev?...` over ECP or a real Roku launch.
- **Runtime:** JellyRock is already open and gets the content in an `roInputEvent`, from `.../input?...`.

Both pass the parameters to `stashDeepLink()` in `source/replayRoute.bs`. The remote-control path (voice commands, and Jellyfin remote-control commands over a socket; see [ADR 0021](../adr/0021-remote-control-ws-receiver.md)) builds the same `contentId` and calls the same function, in `remoteDispatch`.

## Payload

| Parameter | Required | Meaning |
| --- | --- | --- |
| `contentId` | Yes | What to do. Either a bare Jellyfin item ID, or pipe-separated `key=value` pairs: `id=<itemId>\|serverId=<serverGuid>\|action=<verb>`. `parseDeepLinkContentId()` reads it. The key names follow Jellyfin web's `?id=&serverId=`. |
| `mediaType` | No | Roku's media-type hint. It only fills the throwaway `:type` segment of the details route; `ItemDetails` takes the real type from the fetched item. |
| `itemName` | No | A title, used only to name the item in the server-switch prompt. JellyRock can't fetch the title before switching, because the item is on a server it isn't signed in to. Without it, the prompt names only the server. |

### `contentId` keys

| Key | Default | Meaning |
| --- | --- | --- |
| `id` | None | The Jellyfin item ID. A segment with no `=` is taken as the ID, so `<id>`, `<id>\|action=play` and `id=<id>\|action=play` all work. |
| `serverId` (or `server`) | The active server | The target server's Jellyfin ID (a GUID), not a URL. See [Server resolution](#server-resolution). |
| `action` | `open` | What to do with the item: `open`, `play`, `shuffle`, `trailer` or `instantmix`. This is the sender's choice; JellyRock never infers it from the item. An unknown value acts as `open`, so a new verb is safe on older builds. |

`parseDeepLinkContentId()` follows these rules:

- **It splits each segment on the first `=` only,** so a value can contain `=`.
- **A repeated key keeps its last value:** `id=a|id=b` gives `b`. Empty segments (a stray `|`) are ignored.
- **Keys are case-insensitive.** The `action` value and the `serverId` GUID are lowercased, so a sender with the wrong case still works. A Jellyfin server GUID is lowercase hex, and the saved-server match ignores case on both sides.
- **The ID must be URL-safe** (`isPlausibleDeepLinkItemId()`): letters, digits, dashes and underscores, with no `/ ? # & = | %` and no whitespace. Any other ID is dropped when it is stashed. The ID is pasted into the details route and the `/Items/<id>` URL, so this stops a crafted `contentId` from changing either. A real Jellyfin ID is a GUID, so no real link is rejected: this guards against injection, and isn't a strict GUID check.

**Why everything goes inside `contentId`, separated by pipes:** `contentId` is the only field that survives both ways in. A cold-start `/launch` keeps only `contentId` and `mediaType` and drops other parameters, while a runtime `/input` forwards them all. Roku also forbids `&` inside `contentId` and reserves `action` as a top-level launch key. So the contract lives inside `contentId`, separated by pipes, as Roku's own docs do (`series=x|Season=1`). Our `action` is a sub-key, which Roku never reads.

## Behavior

### Check the item, then navigate

`JRScene.resolveDeepLink()` fetches the item's metadata, with a spinner, before any navigation. If the ID is invalid or the fetch fails, the user sees "This content isn't available." and nothing else changes: no navigation, and the current session is untouched. A junk `curl` from another device on the network does no harm. Only a valid item leads anywhere.

The exception is a link to another server: it can't be checked until after the user agrees to switch, so an invalid ID there shows the message after the switch (see [Server resolution](#server-resolution)).

### Route

A valid item goes to `/details/<type>/<id>?deeplink=<action>`. After sign-in, Home is shown first so it is the root of the back stack. A playback cast that arrives while the player is open closes that player first. `ItemDetails` loads the item and carries out the action from the `?deeplink=` query.

The exception is `open` on a grid container (see below), which goes to the library grid instead.

### Carry out the action

`ItemDetails.dispatchDeepLinkAction()` does what the link asked, on the fetched item:

- **`open`** (and any unknown action) shows the item's details, with no playback. A grid-container type (`CollectionFolder`, `UserView`, `Folder`, `Channel`, `Genre`, `MusicGenre`, `Studio`) has no details screen, so `JRScene.resolveDeepLink()` sends it to the library grid before `ItemDetails` runs. It uses `routeForItem()`, the same `/library/:id` route a tap in the app uses, and passes the fetched node along. **Back** returns to Home. Only `open` does this, since no playback action targets a container.
- **`play`** calls `QueueManager.launchItem`, the same per-type quick-play code a tap in the app uses, with no deep-link logic of its own. A single video resumes from its Jellyfin bookmark, with no resume or start-over dialog. A series resumes its next-up episode (`QuickPlayTask.doSeries()`). A season, `BoxSet`, `MusicArtist`, `MusicAlbum` or playlist plays. A person shuffles their movies and watched episodes. A live channel or program plays live. Audio opens the audio player, a photo the viewer, and a `PhotoAlbum` a slideshow.
- **`shuffle`** takes the **Shuffle** button's path (`onShuffleButtonPressed()`).
- **`trailer`** plays the item's trailers.
- **`instantmix`** builds an instant mix from the item, as the **Instant Mix** button does. It does nothing on an item that yields no mix.

### Once per navigation

`checkDeepLinkLaunch()` keys off the router's `route.id`, which is new for each navigation. A repeat cast of the same item still runs: the router reuses the open view for a navigation to the same path, and delivers it through `onRouteUpdate` with a new `route.id`. Returning from the player keeps the same `route.id`, so it doesn't run the action again. A runtime cast that arrives while the item's details are already open runs the new action in place (`playFromDeepLink(action)`).

## Server resolution

A link can name a different server from the one the user is signed in to (`source/replayRoute.bs`). JellyRock can only reach servers it has saved: it maps the GUID to a saved server's URL.

| `serverId` | What happens |
| --- | --- |
| Missing, or the active server | Opens on the current session. |
| Another saved server | **Runtime:** asks "Play '\<title\>' on '\<server\>'? You'll switch servers and be signed out of the current one." If the user agrees, JellyRock checks the server answers (so an offline server can't strand them), then signs out, signs in to the other server and opens the link. **Cold start:** sign-in goes straight to that server, with no prompt, since there's no session to interrupt. |
| A GUID it doesn't know | Shows "This content is on a Jellyfin server you haven't added to this device." |

## Links that arrive while signed out

A link that arrives while signed out is stashed (`m.global.AuthManager.stashedDeepLink`), the user sees "Sign in to open your content.", and `replayAfterLogin()` opens it once sign-in completes. The `AuthManager` `canActivate` guard uses the separate `stashedRoute` for redirects inside the app; see [navigation.md](../architecture/navigation.md).

## What the user sees

- **A spinner** while the item is checked. It doesn't block the remote, so a runtime cast doesn't freeze what the user is doing.
- **"This content isn't available."** when the ID is invalid or the check fails. Nothing else happens.
- **"Playing \<title\>"** when playback from `play`, `shuffle`, `trailer` or `instantmix` starts. The player shows it when it opens, with the item's name. `open` shows nothing, and neither do a photo or a `PhotoAlbum`.
- **"Switching to '\<server\>'…"** when a server switch starts.
- **"Sign in to open your content."** when the link waits for sign-in.
- **"Cast canceled."** when the user turns down a server switch.

## Testing with ECP and curl

Replace `<IP>` with the Roku's address. Watch the TV; for a scripted check, `curl "http://<IP>:8060/query/media-player"` reports the playback state and position.

**Encoding:** only the `=` inside a `key=value` pair must be encoded, as `%3D`. A literal `=` in the value makes ECP return 404 (`?contentId=id=x` gives 404, `?contentId=id%3Dx` gives 200). The `|` separators can stay literal, and a bare ID needs no encoding. So leave out `id=` (the first bare segment is the ID) and keep the pipes: `<itemId>|action%3D<verb>` is the shortest correct form. `/input` and `/launch` take POST (`-d ''`); a GET returns 404.

```bash
# Open an item's details (bare id, action defaults to open), runtime
curl -d '' "http://<IP>:8060/input?contentId=<itemId>"

# Play it, runtime
curl -d '' "http://<IP>:8060/input?contentId=<itemId>|action%3Dplay"

# Shuffle, trailer, instant mix (instantmix targets music: MusicArtist, MusicAlbum, Audio)
curl -d '' "http://<IP>:8060/input?contentId=<itemId>|action%3Dshuffle"
curl -d '' "http://<IP>:8060/input?contentId=<itemId>|action%3Dtrailer"
curl -d '' "http://<IP>:8060/input?contentId=<itemId>|action%3Dinstantmix"

# Play on a specific saved server, with a title for the switch prompt
curl -d '' "http://<IP>:8060/input?contentId=<itemId>|serverId%3D<serverGuid>|action%3Dplay&itemName=<Title>"

# Cold start straight into playback
curl -d '' "http://<IP>:8060/launch/dev?contentId=<itemId>|action%3Dplay"

# Invalid id: the message only, for any action
curl -d '' "http://<IP>:8060/input?contentId=deadbeefdoesnotexist"
```

A `serverId` for a different saved server shows the switch prompt; an unknown GUID shows the message. Sending the same `play`, `shuffle` or `trailer` command twice should run it twice. A repeated `open` does nothing, because the details are already showing.

---
topic: remote-control
related-files:
  - components/remotecontrol/RemoteControlTask.bs
  - components/remotecontrol/RemoteControlTask.xml
  - components/vendor/BrightWebSocket/WebSocketClient.xml
  - components/vendor/BrightWebSocket/web_socket_client/WebSocketClient.brs
  - components/vendor/BrightWebSocket/web_socket_client/WebSocketClientTask.brs
  - components/vendor/BrightWebSocket/README.md
  - source/remotecontrol/remoteCommand.bs
  - source/remotecontrol/remoteProtocol.bs
  - source/utils/backoff.bs
  - source/remotecontrol/remoteDispatch.bs
  - source/replayRoute.bs
  - source/utils/deviceCapabilities.bs
  - source/main.bs
  - source/utils/globals.bs
  - source/api/userAuth.bs
  - components/home/Home.bs
  - scripts/lint/socket-thread-release-check.js
  - scripts/lint/socket-auth-binding-check.js
  - docs/architecture/remote-control-longpoll-contract.md
last-reviewed: 2026-10-10
---

# Remote control: cast to JellyRock

Another Jellyfin client (web or mobile) can drive playback on JellyRock from Jellyfin's **Play On** menu: cast an item, then pause, seek, skip or stop it from that client. JellyRock is the receiving half of Jellyfin's session remote-control protocol.

## Two transports, one command stream

Jellyfin pushes remote-control commands (`Play`, `Playstate`, `GeneralCommand`) to a session over a `WebSocket`. There is no ECP, SSDP or DLNA path: with no open socket, the server drops the command. A session shows up as a cast target only when its capabilities report `SupportsMediaControl = true` and it has an active controller. On the session, Jellyfin exposes that combination as `SupportsRemoteControl`, the field its cast-target filter reads.

So JellyRock has two transports that feed one normalized command stream:

1. **`ws://` (#666).** Against a plain HTTP server, JellyRock opens Jellyfin's own session socket. No server changes are needed.
2. **HTTPS long-poll (#667).** Roku has no TLS on sockets (`ifSocketOption` offers none, so there is no `wss://`), so a secure server cannot use the first transport. Instead the **JellyRock Companion** server plugin (repo `jellyfin-plugin-jellyrock`) queues the same commands, and JellyRock pulls them with an authenticated HTTP long-poll over TLS (`roUrlTransfer`). The versioned wire contract is in [`remote-control-longpoll-contract.md`](remote-control-longpoll-contract.md).

`RemoteControlTask.runReceiver` picks the transport from the server scheme (`remoteProtocol.isHttpServer`):

- **`http://`:** the `ws://` socket, with no probe.
- **`https://`:** probe the plugin with `GET /JellyRock/RemoteControl/info`. A `200` whose body carries the expected `CONTRACT_VERSION` starts the long-poll loop. Anything else leaves JellyRock dark: no cast target is advertised. `buildSocketUrl` returns nothing for a non-HTTP server, so an `https://` session's token never goes out over cleartext `ws://`.

On HTTPS the plugin owns the capability. JellyRock advertises `SupportsMediaControl` as `false` there (`deviceCapabilities.bs` checks the scheme), and the plugin forces it `true` while a poll is live and revokes it when polling stops. That revocation follows the plugin's poll freshness, not `LastActivityDate`, and it is what drops a closed JellyRock from the cast list. The `ws://` path gets the same from the socket disconnect. Verified on a device: with the app closed, `SupportsRemoteControl` turned false within the grace window, though other traffic kept `LastActivityDate` recent.

## Threading: a Task owns the transport, the main thread dispatches

The socket is I/O, so it lives on a Task thread. But the seams a command drives (`stashDeepLink`, `onRuntimeDeepLink`, `getActiveView`, `roAppManager`, `m.scene.callFunc`) are main-thread code. So the flow splits:

```text
                RemoteControlTask (Task thread)                     main thread (Main() loop)
 Jellyfin  ─ws─▶ WebSocketClient ─▶ remoteCommand.parseMessage ─▶ dispatchCommand field ─▶ remoteDispatch
   server        (vendored)          (pure normalize)              (observed by main.bs)     ├─ play     → stashDeepLink + onRuntimeDeepLink
                                                                                             ├─ navigate → stashDeepLink + onRuntimeDeepLink
                                                                                             ├─ route / goback → m.scene.callFunc("routerNavigate" / "routerGoBack")
                                                                                             └─ transport→ getActiveView().handleTransport(evt)
```

- **[`RemoteControlTask`](../../components/remotecontrol/RemoteControlTask.bs)** owns the vendored `WebSocketClient` node, itself a nested Task ([vendor README](../../components/vendor/BrightWebSocket/README.md)). It parses each frame, answers keepalive requests, reconnects with backoff and hands normalized commands to the main thread. It never dispatches, and it never logs the socket URL, which carries the token.
- **`remoteCommand.bs` and `remoteProtocol.bs`** are pure: no node, no socket, no `m.global`. They hold the wire-protocol parser and the transport helpers (the HTTP check, URL builders, the keepalive frame), and have unit tests in `tests/source/unit/remotecontrol/`. The reconnect delay comes from the shared `backoff.nextDelayMs` ([`backoff.bs`](../../source/utils/backoff.bs)), which the TV guide's retries use too.
- **`remoteDispatch.bs`** is the main-thread adapter, the one place a remote command calls the deep-link and player seams. Voice uses the same `dispatchTransport`: the `roInputEvent` branch in `main.bs` calls it, so voice and cast control the player identically.

The command rides a field on the Task node, `dispatchCommand`, which the main loop observes. A Task-node field observed on a port delivers; an `m.global` field observed on a port does not (the delivery defect noted in `main.bs`). That is why the field lives on the Task.

## Lifecycle

`setGlobalNodes` (phase 2) creates the Task node on `m.global` but does not start it, because it needs the session token.

- **Start:** `Home`'s first-run block launches it with `launchTask()` after sign-in, next to the capabilities POST and the pairing report ([below](#cold-launch-pairing-report-668)). First run is per Home instance, so the receiver restarts on each fresh sign-in, including after a server switch. The node is app-wide and never replaced: `main.bs` observes its `dispatchCommand` once at start-up, so a new node would go unheard. A new Home with no sign-out since the last one relaunches the node while it runs, which Roku ignores, and the one receiver keeps listening. The `no-same-node-relaunch` suppression on that launch records this.
- **Stop:** `SignOut` in `source/api/userAuth.bs`, the one teardown point for sign-out and server switch (a switch reaches `SignOut(false)` once the new server answers its probe). So the socket never outlives a session. `StopRemoteControlReceiver()` stops the receiver, then the live `WebSocketClient` child the receiver publishes on `socketNode`. The child needs its own stop, because stopping the receiver kills its thread before its own `closeSocket()` cleanup can run. A STOP does not wait for the thread to end, so the child is copied into a local first: the receiver may still be clearing that field, and a dot on `invalid` would crash sign-out.

### Releasing socket threads

Each connect attempt creates a fresh `WebSocketClient` node, and its Task thread must be released when the connection ends, since a Task thread survives dropped references (the #728 leak class). Two mechanisms cover it:

- **`closeSocket()` stops the child once the connection has ended.** It runs on every reconnect, and it also covers an error raised while the socket is still open, which the loop's own exit never sees. It sends no close frame: on every path that reaches it the client has already left `OPEN`, and the STOP would kill the sending thread anyway. The teardown is abrupt by design ([`remotecontrol-socket-abrupt-teardown`](tech-debt.md#remotecontrol-socket-abrupt-teardown)).
- **The vendored socket loop exits by itself** once its connection reaches `CLOSED` and its event port is drained (a single-connection contract; see the modification list in the vendor README). This reclaims a child left behind by a receiver that died without running `closeSocket()`.

The receiver wakes on `on_close` or `on_error`, but the vendored loop releases its thread on `ready_state = CLOSED`. Those are different signals. They line up only because every `_close()` path in the client posts one of the two, and nothing enforces that. So the receiver also observes `ready_state` and treats `CLOSED` as the end, but only for a socket that opened: `ready_state` reads `CLOSED` before `open()` is called, and the Task seeds `m.top.ready_state` from it at start-up, so an ungated check would tear down every connection before it opened. `on_close` and `on_error` stay the fast path: an error raised while the socket is `OPEN` or `CLOSING` arrives up to `_CLOSING_DELAY` (30 seconds) before the client forces `CLOSED`. Whichever signal comes first wins, with the same result.

Jellyfin ends a session with a `WebSocket` close frame (code `1000`, reason `System Shutdown`), not by dropping the connection; measured against 10.11.11 with a raw upgrade that mirrors the vendored client's. That is why `on_close`, not `on_error`, is the terminal event. A close frame raises no error, so the socket goes from `OPEN` to `CLOSING` and reaches `CLOSED` (emitting `on_close`) only after `_CLOSING_DELAY`, by which time the event port is long idle. The vendored loop's exit test has to be ordered for that, or the receiver never learns the socket died.

Both mechanisms rely on a connection that ends. A connect that never completes is weaker. On a non-blocking socket, Roku's `connect()` reports only that the attempt started, and the vendored client never re-checks `isConnected()` or `eConnRefused()`, so it sits in `CONNECTING` until the handshake write fails. The receiver blocks on the same socket, so this costs one thread, not a growing number. No test can reach the ordering inside the vendored loop, so `npm run lint:socket-thread-release` checks it.

Reconnects back off exponentially from 1 second to a 30-second cap. A connection that stayed up 30 seconds or more resets the backoff. The receiver re-reads the token before each reconnect and stops if it changed. When the server sends `ForceKeepAlive`, the receiver sends a `KeepAlive` at once and then every half of the requested interval, so the server does not reap the session.

### Anything sent on the socket uses quoted JSON keys

BrightScript turns a bare identifier key into lower case. Jellyfin's REST endpoints bind keys case-insensitively, but the socket path decodes case-sensitively. So a lowercased `MessageType` binds to nothing, is dropped with no server log line, and the session is reaped about 60 seconds after it connects. A casing slip that is harmless everywhere else in the app is fatal here: it left every 10.11 and later server with a socket that dropped and reconnected forever, until #934.

## Cold-launch pairing report (#668)

The companion plugin can wake a closed app through ECP `/launch` (the cast producer, [ADR 0023](../adr/0023-cold-launch-cast-producer.md)). For that, JellyRock reports its wake identity once per app open: `POST /JellyRock/RemoteControl/pair {rokuIps, appId, isDev}`.

This is not part of the receiver. `remoteProtocol.buildPairRequest` builds it, and `Home`'s first-run block sends it as a fire-and-forget `SubmitSideEffect`, next to the capabilities POST. Sending it from there keeps it off the receiver's Task thread, so a slow or stalled `/pair` can never delay the live receiver. It goes out on HTTP and HTTPS alike, because the ECP wake does not depend on the command transport. `SubmitSideEffect` queues each request as its own child node, so the two back-to-back calls from Home do not overwrite each other (#744).

The body carries no `DeviceId` or `UserId`. The plugin binds identity from the auth header `SideEffectTask` attaches, so a hostile body cannot claim another device's pairing. This depends on the `DeviceId` the header carries; the next section explains how it is bound.

### How the `DeviceId` is bound (#743)

**Jellyfin takes the `DeviceId` from the `Authorization` header.** When the header leaves it out, the server substitutes the `DeviceId` the auth token was minted under (`AuthorizationContext.GetAuthorizationInfoFromDictionary`, the same from 10.7 to 12.0). A token's device row is fixed when the token is minted; only `DeviceName` and `AppVersion` change afterwards.

The socket upgrade differs by server version:

| Server | How the socket binds its session |
|---|---|
| 10.7.x | From the query string alone: `api_key` and `deviceId`. The header is not read. |
| 10.8 to 10.10 | The header authenticates, and a `deviceId` query parameter, when present, overrides the header's `DeviceId`. |
| 10.11 and later | From the header only. A `deviceId` query parameter is ignored. |

The original `ws://` receiver sent no header and relied on `&deviceId=`. From 10.11 that parameter is ignored, so a header-less upgrade lands on the token's `DeviceId`, not the app's. On an install upgraded from a build older than #721, that was the old suffixed id. The socket then sat on a different session from the REST API, the capabilities POST and `/pair`: the cast target resolved, but commands went where the app was not listening.

So `RemoteControlTask` sends `buildAuthHeader(false)` as an `Authorization` header on the upgrade, which pins the socket to the `DeviceId` everything else advertises. `&deviceId=` stays on the URL with the same value, so every server version agrees. `npm run lint:socket-auth-binding` guards this. The device name is left out (`false`) because the handshake is written as a raw string with no header encoding, and the server already has the name on the token's device row.

The token also stays on the URL, so a proxy that strips `Authorization` falls back to the old behavior instead of failing to connect. Its parameter name depends on the version (`remoteProtocol.buildSocketUrl`):

- **`ApiKey` on 10.8.0 and later.** `api_key` is legacy authorization, behind `EnableLegacyAuthorization` since 10.11 and off by default from 12.0, so an `api_key` fallback would stop authenticating there.
- **`api_key` on 10.7.x and on an unknown version**, because it is the only name 10.7's socket listener reads.

Jellyfin keys a session on `Client` plus `DeviceId` (`GetSessionKey`), and from 12.0 on the user id too. Any future channel that opens a Jellyfin session must send this header.

### Why `/pair` has no version

The long-poll probe (`/info`) carries `CONTRACT_VERSION` and refuses a mismatch; `/pair` has no version field. It is a registration, not a command, so a misread costs at most a wrong or failed wake. Its safety across versions comes from the plugin's HTTP status codes:

- An old plugin without the route answers **404**, which reads as no producer. Safe.
- A future breaking change to `/pair` must answer old clients with **400**, or move the route so they get 404. It must never reinterpret a field silently. Version the route, not the body.
- The body only grows: the plugin ignores unknown fields, and identity comes from the auth header.
- The client never reads the response, so it cannot misread a new version. A `contractVersion` field would only repeat what 400 and 404 already say.

## Capabilities: the trap

`deviceCapabilities.bs` advertises the session as controllable:

- **`SupportsMediaControl`** is `true` only when the server URL is `http://` (see the transport choice above). It makes JellyRock appear in **Play On**, and it carries transport control: pause, seek, skip.
- **`SupportedCommands`** comes from `getSupportedRemoteCommands()` and may contain only `GeneralCommandType` values. **A `Playstate` verb (Pause, Stop, Seek) in this list makes the whole `POST /Sessions/Capabilities/Full` return 400**, so none of the capabilities stick. Transport rides on `SupportsMediaControl` instead.

The advertised commands are the navigation and messaging ones JellyRock acts on: `DisplayContent`, `GoHome`, `GoToSearch`, `GoToSettings`, `Back` and `DisplayMessage`. The web client sends display mirroring and shows its remote buttons only for commands it sees advertised, so a command JellyRock does not handle is not sent. Volume, the directional pad, `SendKey`, `SendString` and screenshots are left out (see [deferred work](#scope-and-deferred-work)).

## Command mapping

| Jellyfin frame | Normalized | What JellyRock does |
|---|---|---|
| `Play` (`PlayNow`, `PlayShuffle`, `PlayInstantMix`, `PlayNext`, `PlayLast`) | `play` | Builds the `contentId` `<itemIds[startIndex]>\|action=<verb>`, then `stashDeepLink` and `onRuntimeDeepLink`, the deep-link play path |
| `GeneralCommand{DisplayContent}` | `navigate` | Opens the item's detail screen (action `open`) through the same deep-link seam. **Dropped during playback** ([below](#displaycontent-during-playback)). |
| `GeneralCommand{GoHome, GoToSearch, GoToSettings}` | `route` | `routerNavigate(<path>)` with `/`, `/search` or `/settings`. The `/` route's `clearStackOnResolve` makes Home the root of the back stack. |
| `GeneralCommand{Back}` | `goback` | `routerGoBack`, which does nothing at the root, so it never exits the app |
| `GeneralCommand{DisplayMessage}` | `message` | With `TimeoutMs`, a **toast** (`Header` and `Text`). Without it, a **dialog** that stays until the user presses OK. |
| `Playstate{Pause, Unpause, Stop, NextTrack, PreviousTrack, Seek, Rewind, FastForward, PlayPause}` | `transport` | `getActiveView().handleTransport(evt)` on the active player |
| `ForceKeepAlive` | `keepalive` | The receiver sends `KeepAlive` on the interval. Never reaches the main thread. |
| `GeneralCommand{volume, directional, SendKey, …}`, `KeepAlive`, `Sessions`, `RefreshProgress`, `UserDataChanged`, anything unknown | `ignore` | Dropped, never an error, so a hostile, future or unknown frame cannot break the receiver |

`Seek` carries an absolute `SeekPositionTicks` and becomes `seekto`, unlike voice's relative `seek`. Both players (`VideoPlayerView`, `AudioPlayerView`, reached through `PlayerHostView`) handle `previous`, `seekto` and `playpause` for the cast verbs.

### `DisplayContent` during playback

The web client's display mirroring (`enableDisplayMirroring`, `displayMirrorManager.ts`) sends a `DisplayContent` on every item-detail page the controller browses while JellyRock is the cast target. It does not check whether the target is playing. Acting on each one would stack an `ItemDetails` screen on top of playback, one per item browsed.

So `navigate` (action `open`) is dropped when the active routed view is a media player. The controller's browsing never pulls the cast target off the video, which matches the usual cast model: the receiver changes only on an explicit play. The guard sits at the shared runtime deep-link seam (`replayRoute.wouldStackOverActivePlayer`, which gates `replayDeepLinkRuntime`), so it also covers a Roku OS `open` deep link that arrives during playback. A playback action (`play`, `shuffle`, `trailer`, `instantmix`) is exempt, because it replaces the player on purpose. With no player up, mirroring still opens the item.

### Seek from the web client

The web client sends an absolute `Seek` from its jump buttons, handled here as `seekto` (verified on a device: the video jumps). It sends nothing when you drag the progress bar for a remote session. So scrub-to-seek from the web does nothing, which is web-client behavior, not a JellyRock gap.

### `DisplayMessage`: toast or dialog

The payload has no priority field, so `TimeoutMs` signals what the sender wants. Present means show it briefly, so JellyRock shows a one-line toast reading `Header`, a dash, then `Text`. Absent means leave it up until acknowledged, so JellyRock shows a dialog the user dismisses with OK.

The dialog's title is supplied by JellyRock (`LabelCastMessage`, "Message from another device"), so a message reads as coming from another device, not as an app prompt. Jellyfin's own contract is `Header` as title and `Text` as body. The dialog keeps that role without giving away the title: `Header` shows as a bold subheading above `Text`. Putting sender text in the title would make any message from the network look like an app prompt. A `Header` with no `Text` becomes the body (`remoteDispatch.castMessageParts`).

`DisplayMessage` is not limited to admins. The command endpoints require only the default authorization, so any signed-in user with remote-control permission can send one: you, someone in your household or an admin. The fixed title makes no claim about who sent it. Showing the sender's name is followup `cast-display-message-sender-name`. The sender is authenticated and on your network, so a dialog that interrupts the screen ("dinner's ready") is acceptable. A setting to turn messages off waits for evidence that someone wants it.

## Scope and deferred work

- **One item per cast.** A `Play` casts `itemIds[startIndex]` through the deep-link seam. The full `ItemIds` list, `StartIndex` and `StartPositionTicks` are parsed but not used. Casting an episode still gives a queue to move through, because the player builds its own next-episode queue. Casting a music album plays only the first track. Multi-item casting is followup `queue-aware-multi-item-casting`.
- **Casting to an idle screen works.** A cast `navigate` or `play` ends in `m.scene.callFunc("resolveDeepLink")` or `callFunc("routerNavigate")`, which runs on the render thread, the same path Roku's runtime deep links use. Checked on a device on 2026-07-12: with JellyRock idle on Home, a cast from the web client opened the movie at once, with no delay and no lost first action. An earlier guess about a lag waking the render thread on idle screens did not reproduce.
- **HTTPS and remote servers** use the plugin long-poll transport (#667), described above and in [`remote-control-longpoll-contract.md`](remote-control-longpoll-contract.md).
- **More `GeneralCommand` types.** These are deferred, each with a known way to build it, not platform dead ends:
  - *Track selection* (`SetAudioStreamIndex`, `SetSubtitleStreamIndex`): possible through the player's existing track-switch functions; needs player work.
  - *Live TV* (`ChannelUp`, `ChannelDown`; `Guide` has no route yet).
  - *Queue modes* (`PlayNext`, `PlayLast`, `SetShuffleQueue`, `SetRepeatMode`): part of multi-item casting.
  - *Volume* (`SetVolume`, `VolumeUp`, `VolumeDown`, `Mute`): a streaming player cannot set system volume, but a Roku TV exposes more of the OS. Worth a platform check before ruling it out.
  - *Directional pad, `SendKey`, `SendString`, `TakeScreenshot`*: an app cannot inject these into SceneGraph focus, but ECP can (the transport the RTA tests use), which the companion plugin could send. Followup `cast-commands-platform-ecp`.

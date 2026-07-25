---
topic: remote-control
related-files:
  - components/remotecontrol/RemoteControlTask.bs
  - components/remotecontrol/RemoteControlTask.xml
  - components/vendor/BrightWebSocket/WebSocketClient.xml
  - source/remotecontrol/remoteCommand.bs
  - source/remotecontrol/remoteProtocol.bs
  - source/remotecontrol/remoteDispatch.bs
  - source/utils/deviceCapabilities.bs
  - source/main.bs
  - source/utils/globals.bs
  - source/api/userAuth.bs
  - components/home/Home.bs
  - docs/architecture/remote-control-longpoll-contract.md
last-reviewed: 2026-07-25
---

# Remote control — "Cast to JellyRock"

Lets another Jellyfin client (web / mobile) drive playback on JellyRock via Jellyfin's
**"Play On"** menu — cast an item, then pause / seek / next / previous / stop from the
controlling client. This is the receiving half of Jellyfin's session remote-control protocol.

## The two-transport vision

Jellyfin pushes remote-control commands (`Play` / `Playstate` / `GeneralCommand`) to a session
over a **`WebSocket`** — there is no ECP/SSDP/DLNA path, and with no open socket the command is
silently dropped server-side. A session shows up as a cast target only when its `Capabilities`
report `SupportsMediaControl == true` **and** it has an active controller.

That gives two transports, one normalized command stream:

1. **`ws://` (#666)** — against a plain-**HTTP** server, JellyRock opens Jellyfin's
   native session socket directly. **No server changes.** This is the shipped half.
2. **HTTPS long-poll (#667)** — Roku has **no socket TLS** (`ifSocketOption` exposes no
   TLS; there is no `wss://` on Roku), so a secure server can't use transport #1. Instead the
   companion **JellyRock Companion** server plugin (repo `jellyfin-plugin-jellyrock`) queues the
   same commands and JellyRock pulls them with an authenticated HTTP **long-poll** over TLS
   (`roUrlTransfer`), sidestepping `wss://` entirely. The wire contract is frozen + versioned in
   [`remote-control-longpoll-contract.md`](remote-control-longpoll-contract.md).

**Transport selection** happens in `RemoteControlTask.runReceiver`, gating on the server scheme
(`remoteProtocol.isHttpServer`):

- `http://` → the `ws://` socket, unconditionally (no probe; the #666 path is untouched). The
  receiver never downgrades an `https://` session's token onto cleartext `ws://`.
- `https://` → probe the plugin (`GET /JellyRock/RemoteControl/info`): `200` → run the long-poll
  loop; anything else → stay dark (no cast target advertised — unchanged from before #667).

On `https` the **plugin owns the `SupportsMediaControl` capability**: JellyRock keeps advertising it
`false` (`deviceCapabilities.bs` is scheme-gated and unchanged), and the plugin forces it `true`
while a poll is live, revoking it when polling stops. That revocation — driven by the plugin
controller's **poll-freshness**, not `LastActivityDate` — is what drops a closed JellyRock from the
cast list (the `ws://` path gets this free from a socket disconnect). Verified on device: with the app
closed, `SupportsRemoteControl` flips false within the grace window even though other traffic keeps
`LastActivityDate` warm.

## Threading — Option B (Task owns the socket, main thread dispatches)

The socket is I/O, so it lives on a **Task thread**; but the seams a command must drive
(`stashDeepLink`, `onRuntimeDeepLink`, `getActiveView`, `roAppManager`, `m.scene.callFunc`) are
**main-thread** only. So the flow splits cleanly:

```text
                RemoteControlTask (Task thread)                     main thread (Main() loop)
 Jellyfin  ─ws─▶ WebSocketClient ─▶ remoteCommand.parseMessage ─▶ dispatchCommand field ─▶ remoteDispatch
   server        (vendored)          (pure normalize)              (observed by main.bs)     ├─ play     → stashDeepLink + onRuntimeDeepLink
                                                                                             ├─ navigate → stashDeepLink + onRuntimeDeepLink
                                                                                             └─ transport→ getActiveView().handleTransport(evt)
```

- **`RemoteControlTask`** ([.bs](../../components/remotecontrol/RemoteControlTask.bs)) owns the
  vendored `WebSocketClient` node (a nested Task — see
  [`components/vendor/BrightWebSocket/README.md`](../../components/vendor/BrightWebSocket/README.md)),
  parses each frame, answers keepalive, reconnects with backoff, and marshals normalized commands
  to the main thread. It **never** dispatches and **never** logs the socket URL (it carries the token).
- **`remoteCommand.bs`** / **`remoteProtocol.bs`** are pure (no node, no socket, no `m.global`) and
  unit-tested — the wire-protocol parser and the transport helpers (the HTTP gate, URL builder, backoff,
  keepalive frame).
- **`remoteDispatch.bs`** is the main-thread adapter — the single place the deep-link and player
  seams are called for a remote command. `dispatchTransport` is **shared** with the voice path
  (`main.bs`'s `roInputEvent` branch calls the same adapter), so voice and cast dispatch transport
  identically.

**Marshalling detail:** the command rides a field on the **task node** (`dispatchCommand`), observed
by the main loop — a task-node field + port delivers, but an `m.global` field + port does **not**
(the delivery defect noted in `main.bs`). That's why the field lives on the task, not on `m.global`.

## Lifecycle

The task node is created on `m.global` in `setGlobalNodes` (Phase 2), but **not** started there —
it needs the session token. It is:

- **Started** (`control="RUN"`) post-login from `Home.isFirstRun` (alongside the capabilities POST and
  the cold-launch pairing report — see below). `isFirstRun` is per-Home-instance, so it restarts on each
  fresh login (including after a server switch).
- **Stopped** (`control="STOP"`) in `SignOut` (`source/api/userAuth.bs`) — the single logout +
  server-switch chokepoint (a server switch runs `SignOut(false)` via `performServerSwitch`), so the
  socket never survives a session teardown.

Reconnect is exponential backoff (`1s`→`30s` cap); it stops on a token rotation (re-read before each
reconnect). `ForceKeepAlive` from the server sets a send interval (half the requested seconds), on
which the receiver sends a `KeepAlive` so the session isn't reaped.

## Cold-launch pairing report (#668)

So the companion plugin can wake a **closed** app via ECP `/launch` (the cast *producer*, ADR 0023),
JellyRock reports its wake identity — `POST /JellyRock/RemoteControl/pair {rokuIps, appId, isDev}` —
once per app open. This is **not** part of the receiver: it fires as a fire-and-forget `SubmitSideEffect`
from `Home.isFirstRun` (next to the capabilities POST), composed by `remoteProtocol.buildPairRequest`.
Firing it there — not from `RemoteControlTask` — keeps it **off the command channel's critical path**
(a slow/stalled `/pair` can never delay the live receiver) and off the receiver Task thread (so it can't
race the capabilities POST on the shared side-effect node). It's **transport-agnostic** (fires on
`http` *and* `https` — the ECP wake is independent of the command transport). The body carries **no**
`DeviceId`/`UserId`; identity is bound from the auth header the `SideEffectTask` attaches, so a hostile
body can't spoof another device's pairing. (This depends on a **stable** `DeviceId` — see the
`deviceid-suffix-gate-10.11` decision; on the `ws://` path an unstable `serverDeviceName` would split
the phantom and the live socket into two sessions.)

### How the `DeviceId` is actually bound (#743)

**Jellyfin resolves `DeviceId` from the `Authorization` header and nowhere else.** It never reads it
from a query string, and when the header omits it the server silently substitutes the `DeviceId` the
auth **token was minted under** (`AuthorizationContext.GetAuthorizationInfoFromDictionary`; identical
in 10.7 → 10.11). A token's device row is fixed at mint time and is never rewritten afterwards — only
`DeviceName` / `AppVersion` are.

Two consequences the original `ws://` receiver got wrong:

- The `&deviceId=` query parameter on the socket URL is **inert**. It looks like it binds the
  socket, but the server ignores it.
- A header-less upgrade therefore lands on the **token's** `DeviceId`, not the app's. On an install
  upgraded from a build older than #721 that is the old suffixed id, so the socket sat on a
  different session than the REST API, the capabilities POST and `/pair` — the cast target resolved
  but commands were delivered where the app wasn't listening.

`RemoteControlTask` therefore sends `buildAuthHeader(false)` as an `Authorization` header on the
upgrade handshake, which pins the socket to the same `DeviceId` everything else advertises. The
device name is omitted (`false`) because the handshake is written as a raw string with no
header-encoding layer and the server already has the name on the token's device row. `api_key` stays
on the URL so a proxy that strips `Authorization` degrades to the old behavior instead of failing to
connect.

Session identity is keyed `GetSessionKey(client, deviceId)`, so "same `Client` + same `DeviceId`" is
the whole invariant. Any future channel that opens a Jellyfin session must send this header.

**`/pair` is intentionally version-free** — unlike `/info`+`/poll`, which carry `CONTRACT_VERSION` and
refuse a mismatch. It's a *registration*, not a *command*, so a misread is bounded (wrong/failed wake),
and its skew-safety is the plugin's **HTTP status contract**, not a version field:

- Old plugin without the route → **404** → treated as producer-absent. Fail-safe.
- A future **breaking** `/pair` change **must** `400` old clients (or move the route so they `404`) —
  **never silently reinterpret a field**. The RESTful move is to version the *route*, not add a body field.
- The body is **additive-only** (the plugin ignores unknown fields); identity is bound from the auth claim.
- The client is fire-and-forget and **never reads the response**, so it cannot be version-confused by
  construction. A `contractVersion` field would only duplicate what `400`/`404` already express.

## Capabilities — the gotcha

`deviceCapabilities.bs` advertises the session as controllable:

- **`SupportsMediaControl`** — `true` **only** when the server URL is `http://` (see the HTTP gate
  above). This is what makes JellyRock appear in "Play On" and is what carries **transport** control
  (pause / seek / next / …).
- **`SupportedCommands`** — `getSupportedRemoteCommands()` and **must** contain only
  `GeneralCommandType` values. **Putting `Playstate` verbs (Pause/Stop/Seek/…) here makes the whole
  `POST /Sessions/Capabilities/Full` return 400**, so nothing sticks. Transport rides on
  `SupportsMediaControl`, not `SupportedCommands`. The advertised set is the actionable navigation +
  messaging commands: `DisplayContent`, `GoHome`, `GoToSearch`, `GoToSettings`, `Back`,
  `DisplayMessage`. **The web only *sends* a `GeneralCommand` it sees advertised here** — so a
  command we don't handle is simply never sent. Volume, directional D-pad, `SendKey`/`SendString`,
  and screenshot are deliberately omitted (not actionable from an app on Roku today — see deferred work).

## Command mapping (Jellyfin → JellyRock)

| Jellyfin frame | Normalized | JellyRock seam |
|---|---|---|
| `Play` (`PlayNow`/Shuffle/`InstantMix`) | `play` | mint `contentId` `<itemIds[startIndex]>\|action=<verb>` → `stashDeepLink` + `onRuntimeDeepLink` (the deep-link play path) |
| `GeneralCommand{DisplayContent}` | `navigate` | springboard the item (action `open`) via the same deep-link seam — **suppressed over active playback** (see the display-mirroring note below) |
| `GeneralCommand{GoHome/GoToSearch/GoToSettings}` | `route` | `routerNavigate(<path>)` (`/`, `/search`, `/settings`); `/`'s `clearStackOnResolve` makes Home the back-stack root |
| `GeneralCommand{Back}` | `goback` | `routerGoBack` (`sgRouter.goBack`; no-op at root, so it never exits the app) |
| `GeneralCommand{DisplayMessage}` | `message` | `TimeoutMs` present → **toast** (`Header` + `Text`); absent → **dialog** (persistent, dismiss with OK) |
| `Playstate{Pause/Unpause/Stop/NextTrack/PreviousTrack/Seek/Rewind/FastForward/PlayPause}` | `transport` | `getActiveView().handleTransport(evt)` on the active player |
| `ForceKeepAlive` | `keepalive` | receiver answers with `KeepAlive` on the interval (never reaches the main thread) |
| `GeneralCommand{volume/directional/SendKey/…}` / `KeepAlive` / `Sessions` / `RefreshProgress` / `UserDataChanged` / unknown | `ignore` | dropped — never an error, so a hostile/future/unrecognized frame can't break the receiver |

`Seek` carries an **absolute** `SeekPositionTicks` → `seekto` (distinct from voice's relative
`seek`). Both players gained `previous` / `seekto` / `playpause` cases for the cast verbs.

Note on `DisplayContent` vs active playback: jellyfin web's **Display Mirroring** feature
(`enableDisplayMirroring`, `displayMirrorManager.ts`) fires a `DisplayContent` on **every** item-detail
browse while JellyRock is the selected cast target — it does **not** check whether the target is
already playing. Enacting each one would stack an `ItemDetails` screen on top of live playback (and
browsing several items would stack several). So `navigate`/`open` is **dropped when the active routed
view is a media player** — the controller's incidental browsing never yanks the cast target off the
video (matches the standard cast model: the receiver only changes on an explicit *play*). This guard
lives at the shared runtime deep-link seam (`replayRoute.wouldStackOverActivePlayer`, gating
`replayDeepLinkRuntime`), so it equally covers a **Roku OS** `open` deep link arriving mid-playback,
not just the cast path. A **playback** action (`play`/`shuffle`/`trailer`/`instantmix`) is exempt — it
legitimately *replaces* the player. Idle mirroring (no player up) still opens the item as before.

Note on seek: jellyfin web sends an absolute `Seek` from its **±N s jump buttons** (handled here as
`seekto`, verified on device — the video jumps), but it sends **nothing** when the progress bar is
dragged/scrubbed on a remote session. So "scrub-to-seek from the web" is a no-op — a jellyfin web
behavior, not a JellyRock gap.

Note on `DisplayMessage`: the payload has no priority field, so `TimeoutMs` is the sender's intent
signal — **present** means "show briefly then dismiss" (a **toast**: `Header` — `Text`), **absent**
means "leave this up until acknowledged" (a **dialog** the user dismisses with OK). The dialog uses a
JR-supplied provenance title (`LabelCastMessage` = "Message from another device") with the sender's
`Header` + `Text` as the body, so a bare message reads as an incoming cast message rather than a JR
system prompt. `DisplayMessage` is **not** admin-only — the command endpoints require only
`DefaultAuthorization` (any authenticated user with remote-control permission), so the sender could be
you, a household member, or an admin; the static title avoids asserting otherwise. Resolving the
actual sender name (`ControllingUserId` → username) is a followup. This is a trusted-LAN, authenticated
sender, so a dialog interrupting the screen (e.g. "dinner's ready" from another household member) is
acceptable; a user opt-out setting is deferred until there's evidence it's wanted.

## Scope (#666) and deferred work

- **Single item.** A `Play` casts `itemIds[startIndex]` — the one item — through the deep-link seam.
  The full `ItemIds` list / `StartIndex` / `StartPositionTicks` are parsed but not consumed.
  Casting an **episode** still gives a navigable queue because the *player* builds its own
  next-episode queue; casting a music **album** currently plays only the first track. Multi-item
  queue casting (`PlayNext` / `PlayLast`, start-position) is the **queue-aware casting** followup.
- **Navigation to an idle screen — verified working.** A cast `navigate`/`play` bottoms out in
  `m.scene.callFunc("resolveDeepLink"/"routerNavigate", …)`, which runs on the render thread — the same
  path Roku's own runtime deep links use. Device-checked (2026-07-12): with JellyRock sitting idle on
  Home, a web-client cast to a movie opens it immediately, with no delay and no dropped first action. An
  earlier hypothesis about a render-thread-wake lag on idle screens did **not** reproduce.
- **HTTPS / remote servers.** Handled by the #667 plugin long-poll transport (see the two-transport
  section above and [`remote-control-longpoll-contract.md`](remote-control-longpoll-contract.md)).
- **More `GeneralCommand` types (deferred, not impossible).** The advertised set is navigation + messaging.
  The rest are followups with a concrete mechanism, NOT platform dead-ends:
  - *Track selection* (`SetAudioStreamIndex` / `SetSubtitleStreamIndex`) — feasible via the player's
    existing track-switch APIs; needs player integration.
  - *Live TV* (`ChannelUp` / `ChannelDown`; `Guide` has no route yet) — Live-TV-specific.
  - *Queue modes* (`PlayNext` / `PlayLast` / `SetShuffleQueue` / `SetRepeatMode`) — folds into the
    queue-aware casting followup.
  - *Volume* (`SetVolume` / `VolumeUp/Down` / `Mute`) — a streaming player can't set system volume,
    but a **Roku TV** exposes more OS API; worth a platform check before writing it off.
  - *Directional D-pad + `SendKey` / `SendString` / `TakeScreenshot`* — not injectable into the
    SceneGraph focus from inside the app, but doable via **ECP** (the transport the RTA tests use),
    which would ride the planned #667 server plugin. Deferred to that effort.

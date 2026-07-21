---
topic: remote-control-longpoll-contract
related-files:
  - source/remotecontrol/remoteProtocol.bs
  - components/remotecontrol/RemoteControlTask.bs
  - source/remotecontrol/remoteCommand.bs
  - source/api/baseRequest.bs
last-reviewed: 2026-07-21
---

# Long-poll wire contract — HTTPS "Cast to JellyRock" (#667)

The **frozen** HTTP contract between JellyRock and the companion Jellyfin server plugin
(`jellyfin-plugin-jellyrock`). It is the HTTPS counterpart to the `ws://` receiver
([remote-control.md](remote-control.md), ADR 0021): Roku has no socket TLS, so a secure server can't push
commands over `wss://`. Instead the plugin **queues** the same remote-control commands Jellyfin would push
over the session socket, and JellyRock **pulls** them with a long-poll `GET` loop over TLS (`roUrlTransfer`).

This contract is **published and versioned** (not an internal plugin detail) so any future client — including
the official Roku app, which shares Roku's no socket TLS limitation — can consume it against a stable spec
with no plugin rework.

## Direction & scope

- **Server → client only.** The long-poll carries *inbound* remote-control commands to JellyRock.
  JellyRock's *outbound* reporting (playback progress, capabilities POST, mark-played) stays on the normal
  Jellyfin REST API — **unchanged**. This channel never carries client→server data beyond the poll request
  itself.
- One in-flight poll per JellyRock session. A session is identified by the authenticated device (below).

## Endpoints

Both endpoints live under the plugin's MVC route prefix and require Jellyfin authentication (`[Authorize]`,
`DefaultAuthorization` — any authenticated user with remote-control permission, matching the `ws` path).
Authentication uses JellyRock's standard `Authorization: MediaBrowser …` header
([`buildAuthHeader()`](../../source/api/baseRequest.bs)), which already carries `Client="JellyRock"`,
`DeviceId="<serverDeviceName>"`, and `Token`. **The token is never placed in the URL** — an improvement over
the `ws` path's `?api_key=` (`roUrlTransfer` can set headers; `BrightWebSocket` could not).

The server resolves the target `SessionInfo` from the authenticated request's `DeviceId` claim — the same
device that binds JellyRock's REST session. Any `deviceId` query argument is diagnostic only and MUST NOT be
trusted over the authenticated identity.

### `GET /JellyRock/RemoteControl/info` — presence probe + version negotiation

| | |
|---|---|
| **200** | `{ "contractVersion": 1, "pluginVersion": "<x.y.z>" }` — plugin present. |
| **404** | Plugin absent (route not registered). **This is JellyRock's presence signal** on an `https` server. |
| **401** | Unauthenticated / expired token. |

JellyRock treats any non-200 as "no usable plugin" and stays dark on `https` (no cast target advertised).
`contractVersion` lets JellyRock refuse a plugin that speaks a newer/older contract it can't handle.

### `GET /JellyRock/RemoteControl/poll?waitMs=<n>[&ack=1][&ackId=<guid>]` — the long-poll command channel

Long-holds the request until a command is queued **or** `waitMs` elapses.

| | |
|---|---|
| **200** | JSON **array** of command envelopes (see below). One or more commands were queued. |
| **204** | Hold window elapsed with no queued command. JellyRock re-polls immediately. |
| **401** | Unauthenticated / expired token → JellyRock stops polling (session ended). |
| **404** | Plugin uninstalled mid-session → JellyRock stops polling. |

`waitMs` is JellyRock's requested hold ceiling (e.g. `25000`). The server MAY cap it. JellyRock's own
client-side timeout is set **longer** than `waitMs` (plus margin) so a `204` always arrives before the
transfer times out.

`ack=1` and `ackId` are the **at-least-once acknowledgment** (see [At-least-once delivery](#at-least-once-delivery)),
an additive, opt-in extension that does **not** bump `contractVersion`:

- `ack=1` — the client's capability flag, present on **every** poll from an ack-aware client (including the
  first). It tells the plugin "retain delivered commands until I confirm them." A plugin that predates this
  ignores the flag and stays at-most-once; a client that omits it (an older build) likewise gets at-most-once.
  So a new/old mix on either side degrades cleanly — neither regresses.
- `ackId=<guid>` — the client's **cumulative** ack: the last `MessageId` it durably received. Omitted until
  the client has received a command. The plugin drops every retained command up to and including this id and
  **redelivers the rest** on this poll. An absent or unrecognized `ackId` acks nothing.

## Command envelope

Each element of the `200` array is the **exact `{ MessageType, Data }` shape Jellyfin pushes over the session
socket**, so [`remoteCommand.parseMessage`](../../source/remotecontrol/remoteCommand.bs) consumes it
**unchanged** — no new parser branch, no long-poll-specific normalization:

```json
[
  { "MessageType": "Play",           "Data": { "ItemIds": ["…"], "PlayCommand": "PlayNow", "StartIndex": 0 }, "MessageId": "<guid>" },
  { "MessageType": "Playstate",      "Data": { "Command": "Pause" },                                          "MessageId": "<guid>" },
  { "MessageType": "GeneralCommand", "Data": { "Name": "DisplayMessage", "Arguments": { "Header": "…" } },     "MessageId": "<guid>" }
]
```

- `MessageType` / `Data` — verbatim from the server's `ISessionController.SendMessage(name, messageId, data)`
  fan-out. The full `Play` / `Playstate` / `GeneralCommand` mapping is documented once in
  [remote-control.md](remote-control.md#command-mapping-jellyfin--jellyrock) and applies identically here.
- **Enum values MUST serialize as their string names**, exactly as the `WebSocket` frames do —
  `Playstate.Command` as `"Pause"` / `"NextTrack"` / `"Seek"`, `GeneralCommand.Name` as
  `"DisplayContent"` / `"GoHome"`, `Play.PlayCommand` as `"PlayNow"` — **never as integers.** The client
  matches these by string; numeric enums (the .NET `System.Text.Json` *default*) silently no-op every
  command whose meaning rides on the `enum` value. `Play` is the misleading exception — it still plays
  because its action defaults and the payload is `ItemIds` — so test a `Playstate` verb, not `Play`, when
  validating serialization. (A plugin serializing `Data` with `System.Text.Json` needs a `JsonStringEnumConverter`.)
  Field-name casing is free (the client reads case-insensitively); only the enum *values* are load-bearing.
- `MessageId` — the server-assigned message GUID; the **ack key** for [at-least-once delivery](#at-least-once-delivery).
  The client echoes the last id it received back as the next poll's cumulative `ackId`, and dedupes by it. A
  client that doesn't ack simply ignores it (at-most-once). Always present on this channel.
- **Batch semantics:** the queue drains **FIFO** into the array; commands that pile up between polls are
  delivered in order in a single `200`. JellyRock dispatches them in array order.
- **`KeepAlive` / `ForceKeepAlive` are not sent** on this channel — the poll request itself is the
  keepalive (see liveness). A plugin MUST NOT enqueue them.

## At-least-once delivery

The plugin removes a batch from its queue to write it into the `200` response. HTTP gives the server no
signal that the client actually received those bytes, so a client that disconnects between *drain* and
*delivery* would lose that batch. `ack=1` + `ackId` close that gap; it is **opt-in and additive** (contract
still `1`), realizing the hook the `MessageId` field was reserved for.

**Mechanism (cumulative ack + redelivery):**

1. An ack-aware client sends `ack=1` on every poll. The plugin then **retains** each delivered command
   (delivered-but-unacked) instead of dropping it.
2. When the client's poll response arrives, it records the last `MessageId` and sends it as `ackId` on the
   **next** poll. The plugin drops everything up to and including that id.
3. Anything still unacked is **redelivered** ahead of new commands. So a lost response self-heals on the next
   poll: the commands the client never saw come back, keyed off an `ackId` that didn't advance past them.

**The client MUST dedupe by `MessageId`.** At-least-once means a redelivered batch can contain a command the
client already enacted (e.g. its ack was lost, or two polls briefly overlapped). Most commands are idempotent,
but the **relative** transport verbs — `NextTrack`, `PreviousTrack`, `Rewind`, `FastForward` — are not:
replaying one double-applies. JellyRock keeps a small ring of recently-dispatched ids and skips a repeat.

**Ordering & bounds:** redelivery preserves FIFO order. The retained buffer is bounded like the queue
(oldest-dropped past a cap): a client that receives but never acks is buggy or gone — it is about to lapse
out of the cast list anyway — so the plugin favors the newest commands rather than growing without limit.

**Cumulative, not per-message:** the client acks the newest id it received, which implicitly acks everything
before it. This is sufficient because the transport is whole-response-or-nothing (`roUrlTransfer` yields the
full body or a timeout, never a partial array) and the client dispatches the array in strict order.

> A plugin or client that implements neither side of this stays at **at-most-once**, exactly as contract v1
> shipped — the tiny drain→deliver window remains, and the user re-issues the rare lost command. Mixed
> versions are safe in every direction.

## Liveness — the closed-app requirement

Unlike the `ws` path, there is **no socket whose disconnect drops JellyRock from the cast list**. So liveness is
tied to an **active poll**:

- Each poll request refreshes the session's server-side activity (`LogSessionActivity`) and records a
  last-poll timestamp.
- The plugin's attached controller reports `IsSessionActive` = "a poll arrived within the grace window"
  (grace ≈ `waitMs` + margin). When JellyRock stops polling (app closed, or the poll loop dies without
  reconnecting), the controller goes inactive and the plugin **revokes the media-control capability /
  detaches**, so the server drops JellyRock from other clients' cast lists.
- **JellyRock advertises `SupportsMediaControl: false` on `https`** ([deviceCapabilities.bs](../../source/utils/deviceCapabilities.bs));
  the plugin owns the capability entirely on the secure path — forcing it `true` while a poll is live and
  `false` when stale. This keeps the closed-app fix server-side (a closed client can't retract anything itself).

> The exact server mechanism that removes a stale session from the web cast list — whether flipping
> `IsSessionActive` false suffices, or the raw `Capabilities.SupportsMediaControl` flag must also be cleared
> and/or `OnSessionControllerDisconnected` called — is pinned by on-device verification against the target
> server line (10.11.11), not assumed. See the plugin repo for the resolved mechanism.

## JellyRock transport selection

Consulted in [`RemoteControlTask.runReceiver`](../../components/remotecontrol/RemoteControlTask.bs), gating on
`remoteProtocol.isHttpServer`:

| Server URL | Transport |
|---|---|
| `http://…`  | `ws://` session socket (unchanged, #666). **No probe** — the shipped path is untouched. |
| `https://…` + probe `200` | **Long-poll** (this contract). |
| `https://…` + probe non-200 | Dark — no cast target advertised (unchanged behavior from before #667). |

## Versioning

`contractVersion` starts at **1**. A backward-compatible addition (new optional field, new `MessageType`
JellyRock already ignores) does not bump it. A breaking change (renamed field, changed status semantics)
bumps it; JellyRock refuses a `contractVersion` it doesn't implement and stays dark rather than risk acting on a command it might misread.

The [at-least-once ack](#at-least-once-delivery) (`ack=1` / `ackId`) is a deliberate example of a
version-**free** addition: the request params are optional, an unrecognized side just ignores them, and the
guarantee degrades to the v1 at-most-once behavior on any mismatch. Both sides could therefore ship
independently. Bumping to `2` would instead force a hard cutover — a client hard-gates on an exact version
match and goes dark on a mismatch — which is unwarranted for a change this additive.

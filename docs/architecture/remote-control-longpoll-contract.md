---
topic: remote-control-longpoll-contract
related-files:
  - source/remotecontrol/remoteProtocol.bs
  - components/remotecontrol/RemoteControlTask.bs
  - source/remotecontrol/remoteCommand.bs
  - source/api/baseRequest.bs
last-reviewed: 2026-10-10
---

# Long-poll wire contract: HTTPS "Cast to JellyRock" (#667)

The fixed HTTP contract between JellyRock and the companion Jellyfin server plugin (`jellyfin-plugin-jellyrock`). It is the HTTPS counterpart to the `ws://` receiver ([remote-control.md](remote-control.md), ADR 0021). A Roku cannot open a TLS socket, so a secure server cannot push commands over `wss://`. Instead the plugin queues the remote-control commands Jellyfin would have pushed over the session socket, and JellyRock pulls them with a long-poll `GET` loop over TLS (`roUrlTransfer`).

The contract is published and versioned, not an internal plugin detail, so any other client can use it against a stable spec without plugin changes. That includes the official Roku app, which has the same TLS socket limit.

## Direction and scope

- **Server to client only.** The long poll carries remote-control commands to JellyRock. JellyRock's own reporting (playback progress, the capabilities POST, marking items played) stays on the normal Jellyfin REST API, unchanged. The channel carries nothing from the client beyond the poll request itself.
- **One poll in flight per JellyRock session.** The session is the authenticated device (below).

## Endpoints

Both endpoints live under the plugin's route prefix, `/JellyRock/RemoteControl`, and require Jellyfin authentication (`[Authorize]`, `DefaultAuthorization`): any authenticated user with remote-control permission, as on the `ws` path. JellyRock authenticates with its standard `Authorization: MediaBrowser …` header ([`buildAuthHeader()`](../../source/api/baseRequest.bs)), which carries `Client="JellyRock"`, `DeviceId="<serverDeviceName>"` and `Token`. **The token never goes in the URL**, unlike the `ws` path, which sends it as a query parameter (`remoteProtocol.buildSocketUrl()`).

The server finds the target `SessionInfo` from the authenticated request's `DeviceId`, the same device that holds JellyRock's REST session. A `deviceId` query argument is for diagnosis only and MUST NOT be trusted over the authenticated identity.

The plugin has a third route, `/pair`, for the cold-launch pairing report. It is not part of this versioned contract; [remote-control.md](remote-control.md#cold-launch-pairing-report-668) describes it.

### `GET /JellyRock/RemoteControl/info`: presence probe and version check

| Status | Meaning |
|---|---|
| **200** | `{ "contractVersion": 1, "pluginVersion": "<x.y.z>" }`: the plugin is installed. |
| **404** | The plugin is absent (no such route). **This is how JellyRock learns** whether an `https` server has the plugin. |
| **401** | Not authenticated, or the token expired. |

JellyRock treats any status but 200 as "no usable plugin" and stays dark on `https`: it advertises no cast target. It also stays dark when `contractVersion` is not exactly the version it implements (`CONTRACT_VERSION` in `remoteProtocol.bs`).

### `GET /JellyRock/RemoteControl/poll?waitMs=<n>[&ack=1][&ackId=<guid>]`: the command channel

The server holds the request until a command is queued or `waitMs` passes.

| Status | Meaning |
|---|---|
| **200** | A JSON array of command envelopes (below): one or more commands were queued. |
| **204** | The hold ran out with nothing queued. JellyRock polls again at once. |
| **401** | Not authenticated, or the token expired. JellyRock stops polling: the session ended. |
| **404** | The plugin was uninstalled during the session. JellyRock stops polling. |

`waitMs` is the longest hold JellyRock asks for, and the server MAY shorten it. JellyRock sends `waitMs=25000` and gives the transfer a 35-second timeout, longer than the hold, so a `204` always arrives before its own request times out.

`ack=1` and `ackId` are the at-least-once acknowledgment ([below](#at-least-once-delivery)), an optional addition that does not change `contractVersion`:

- **`ack=1`** is the client's capability flag, sent on every poll from a client that acknowledges, the first included. It tells the plugin to keep delivered commands until the client confirms them. A plugin older than the flag ignores it and stays at-most-once, and a client that leaves it out gets at-most-once too. So an old and new pair, either way round, still works as before.
- **`ackId=<guid>`** is the client's cumulative ack: the last `MessageId` it received. It is left out until the client has received a command. The plugin drops every kept command up to and including that id, and delivers the rest again on this poll. A missing or unknown `ackId` acknowledges nothing.

### What JellyRock does on everything else

`RemoteControlTask.runLongPollReceiver()` also:

- **backs off** after any other status or a timeout, from 1 to 30 seconds, so an unreachable server cannot make it loop hot;
- **waits out a fast empty answer**: a `204`, or a `200` that dispatched nothing, that came back in under a second is held to one second before the next poll. A plugin that honors the hold never triggers this;
- **stops when the token changes** between polls (a server-side token rotation or a sign-out), as the `ws` path does.

## Command envelope

Each element of a `200` array is the exact `{ MessageType, Data }` shape Jellyfin pushes over the session socket, so [`remoteCommand.parseMessage`](../../source/remotecontrol/remoteCommand.bs) reads it unchanged, with nothing specific to the long poll:

```json
[
  { "MessageType": "Play",           "Data": { "ItemIds": ["…"], "PlayCommand": "PlayNow", "StartIndex": 0 }, "MessageId": "<guid>" },
  { "MessageType": "Playstate",      "Data": { "Command": "Pause" },                                          "MessageId": "<guid>" },
  { "MessageType": "GeneralCommand", "Data": { "Name": "DisplayMessage", "Arguments": { "Header": "…" } },     "MessageId": "<guid>" }
]
```

- **`MessageType` and `Data`** are copied from the server's `ISessionController.SendMessage(name, messageId, data)`. The mapping of every `Play`, `Playstate` and `GeneralCommand` is documented once in [remote-control.md](remote-control.md#command-mapping) and applies here unchanged.
- **Enum values MUST be sent as their string names**, as the socket frames send them: `Playstate.Command` as `"Pause"`, `"NextTrack"` or `"Seek"`, `GeneralCommand.Name` as `"DisplayContent"` or `"GoHome"`, and `Play.PlayCommand` as `"PlayNow"`. **Never as integers.** The client matches them as strings, so numeric enums, which are the default in .NET's `System.Text.Json`, quietly do nothing for every command whose meaning is in the enum. `Play` misleads here: it still plays, because its action has a default and the payload is `ItemIds`. So test a `Playstate` command, not `Play`, to check the serialization. A plugin that writes `Data` with `System.Text.Json` needs a `JsonStringEnumConverter`. Field-name case does not matter, since the client ignores it; only the enum values do.
- **`MessageId`** is the server's message GUID and the key for [at-least-once delivery](#at-least-once-delivery). The client sends the last id it received back as the next poll's `ackId`, and skips an id it has already run. A client that does not acknowledge ignores it and gets at-most-once. It is always present on this channel.
- **Batches are in order.** The queue drains first in, first out into the array, so commands that build up between polls arrive in order in one `200`, and JellyRock runs them in array order.
- **`KeepAlive` and `ForceKeepAlive` are never sent** on this channel: the poll request is the keepalive (see [Liveness](#liveness-the-closed-app-requirement)). A plugin MUST NOT queue them.

## At-least-once delivery

The plugin takes a batch off its queue to write the `200` response, and HTTP tells the server nothing about whether the client received it. So a client that disconnects between the two loses the batch. `ack=1` and `ackId` close that gap. They are optional and additive (the contract is still version 1), and use the `MessageId` field that was kept for this.

**How it works (cumulative ack, then redelivery):**

1. A client that acknowledges sends `ack=1` on every poll. The plugin then keeps each delivered command until it is acknowledged, instead of dropping it.
2. When a poll's response arrives, the client notes the last `MessageId` and sends it as `ackId` on the next poll. The plugin drops everything up to and including that id.
3. Anything still unacknowledged is delivered again, ahead of new commands. So a lost response repairs itself on the next poll: the commands the client never saw come back, because its `ackId` did not move past them.

**The client MUST skip a `MessageId` it already ran.** At-least-once means a repeated batch can hold a command the client already acted on, when its ack was lost or two polls briefly overlapped. Most commands are safe to repeat, but the relative transport commands (`NextTrack`, `PreviousTrack`, `Rewind`, `FastForward`) are not: running one twice moves twice. JellyRock remembers the last 64 ids it dispatched and skips a repeat.

**Order and limits.** Commands delivered again keep their first-in, first-out order. The kept commands are capped like the queue, dropping the oldest past the cap: a client that receives but never acknowledges is broken or gone, and about to leave the cast list anyway, so the plugin keeps the newest commands instead of growing without limit.

**Cumulative, not per message.** Acknowledging the newest id acknowledges everything before it. That is enough because a response arrives whole or not at all (`roUrlTransfer` gives the full body or a timeout, never part of an array), and the client runs the array strictly in order.

> A plugin or client that implements neither side stays at-most-once, as contract version 1 first shipped: the short window between taking and delivering a batch remains, and the user repeats the rare lost command. Any mix of versions is safe.

## Liveness: the closed-app requirement

Unlike the `ws` path, there is no socket whose disconnect drops JellyRock from the cast list. So whether JellyRock is live depends on an active poll:

- Each poll refreshes the session's activity on the server (`LogSessionActivity`) and records when it arrived.
- The plugin's session controller reports `IsSessionActive` as "a poll arrived within the grace window", about `waitMs` plus a margin. When JellyRock stops polling (the app closed, or the poll loop died without reconnecting), the controller goes inactive and the plugin removes the media-control capability, so the server drops JellyRock from other clients' cast lists.
- **JellyRock advertises `SupportsMediaControl: false` on `https`** ([`deviceCapabilities.bs`](../../source/utils/deviceCapabilities.bs)), and the plugin owns the capability on the secure path: `true` while a poll is live, `false` once it goes stale. That keeps the fix for a closed app on the server, since a closed client cannot take anything back itself.

> The exact server mechanism that removes a stale session from the web client's cast list is settled by testing on a device against the target server line (10.11.11), not assumed: whether `IsSessionActive` going false is enough, or `Capabilities.SupportsMediaControl` must also be cleared, or `OnSessionControllerDisconnected` called. The plugin repo has the result.

## Which transport JellyRock uses

`RemoteControlTask.runReceiver()` picks by `remoteProtocol.isHttpServer()`:

| Server URL | Transport |
|---|---|
| `http://…` | The `ws://` session socket (#666), with no probe. |
| `https://…`, probe `200` with this `contractVersion` | The long poll (this contract). |
| `https://…`, anything else | Dark: no cast target, as before #667. |

## Versioning

`contractVersion` starts at 1. A change that old clients can ignore (a new optional field, a new `MessageType` JellyRock already ignores) does not change it. A breaking change (a renamed field, a status with a new meaning) raises it, and JellyRock stays dark on a version it does not implement instead of acting on a command it might misread.

The [at-least-once ack](#at-least-once-delivery) is a deliberate example of an addition that needs no new version: its parameters are optional, a side that does not know them ignores them, and any mismatch falls back to version 1's at-most-once behavior. So each side could ship on its own. Raising the version to 2 would have forced both to switch at once, since the client requires an exact match and goes dark otherwise, which a change this small does not justify.

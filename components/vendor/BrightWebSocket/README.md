# Vendored: BrightWebSocket

RFC 6455 WebSocket client for Roku/BrightScript. Roku has no native WebSocket
component and there is no ropm/npm package for this library, so it is **manually
vendored** here (not managed by `npm run ropm`).

- **Upstream:** https://github.com/SuitestAutomation/BrightWebSocket
- **Pinned commit:** `3d64524354e41b0b0a06841dc53e696e685e334a` (2021-03-08)
- **License:** MIT (see `./LICENSE`) — © 2018 Rolando Islas
- **Lineage:** maintained fork of the dormant `opencma/BrightWebSocket`, whose
  README redirects here.

## Why vendored (and why here)

Consumed by the remote-control receiver (#666) as the `ws://` transport, behind
the `wsTransport` seam so the socket implementation is swappable. Upstream has
been dormant since 2021, so JellyRock is the de-facto maintainer.

## Local modifications

The sources are **not** byte-for-byte upstream — trimmed + hardened when vendored (commit
`dcac8b52`) and lightly touched since. Deltas vs the pinned SHA:

- `WebSocketClient.xml` — `<script>` uris repointed to this vendored path; dropped the `secure`
  field + the `TlsUtil.brs` script.
- **TLS removed** — Roku can't do socket TLS, so the unimplemented `wss://` skeleton (`TlsUtil.brs`,
  `rsa_encrypt`, `m._secure`/`_tls`) was deleted (`ws://` only; ~710 dead lines).
- **OOM guard** — the frame decoder now caps the server-declared inbound `payload_size`
  (`WebSocketClient.brs` `_read_socket_data`) — the must-fix from the review below.
- **100ms poll** — the task loop polls every 100ms instead of the upstream 1ms busy-loop.
- **Logger silenced** — the missing-config Logger noise was quieted.
- **`run` → `runSocketLoop`** (`WebSocketClientTask.brs`) — the top-level task worker was renamed off
  the reserved `run` (collides with the global `Run()`). It only ever worked because the Task
  dispatches it by the `functionName` string, never a scope call; renamed so we don't rely on that.
- **Caller-set `headers` survive task startup** (`WebSocketClientTask.brs`) — upstream's init did
  `m.top.headers = m.ws.get_headers()`, overwriting the node field with the client's empty default.
  Since `init()` sets `control="RUN"`, a caller setting `headers` right after `CreateObject` races
  that write and lost it silently. Now the client is seeded FROM the node, after the observers are
  registered, so an earlier write is picked up and a later one still arrives as a field event.
  Load-bearing for the remote-control receiver's Authorization header (see issue #743).
- **`m.task_port` → `m.port`** (`WebSocketClientTask.brs`) — `m.task_port` is never assigned (3
  reads, 0 writes), so the re-observe after a `set_buffer_size`/`set_protocols`/`set_headers`
  round-trip rebound the field to an invalid port. Dead upstream because nothing called those
  setters; live for us now that the receiver sets `headers`.
- **Linted + formatted as owned code** — since upstream is dead, the sources were brought up to the
  project's BrighterScript lint: `function`→`sub` for void functions, an explicit all-paths return in
  `Logger._level_to_string`, and removal of the dead `mask`/`scheme` locals — plus Prettier formatting.
  The `components/vendor/**` diagnostic filter was dropped from every bsconfig (see "Build/lint").

Diff against upstream with the pinned SHA above for the exact line-level deltas.

## Security review (2026-07, pre-vendor)

Audited the untrusted-input paths (handshake parse, frame decoder, byte/mask
handling). **No malicious code** — legitimate RFC 6455 implementation. Findings
deferred to the post-validation gate (this is vanilla-for-validation; not yet
hardened for shipping to untrusted servers):

- **Must-fix before ship — unbounded inbound allocation (OOM/DoS).** The frame
  decoder does not bound the server-declared `payload_size`, continuation
  reassembly, inbound control-frame size, or pre-handshake accumulation
  (`web_socket_client/WebSocketClient.brs` `_read_socket_data`). On the cleartext
  `ws://` LAN path a malicious/MITM server can grow the buffer without limit.
  Fix = a bounded-buffer cap (`_error` + `_close` on oversize).
- **Keep `log_level` at default** — `VERBOSE` logs the token-bearing handshake
  request (`WebSocketClient.brs:332`). Never log the socket URL from JellyRock.
- Quality: ~1 kHz busy-poll in `WebSocketClientTask.run` (`wait(1)`); `bytes_to_long`
  64-bit length bug (unreachable for small frames); `m.task_port` typo (fixed — see local
  modifications; it stopped being a dead path once the receiver began setting `headers`);
  `TlsUtil.brs` (661 lines) is dead code on `ws://`; ASCII-only strings (fine for
  our hex/numeric command frames).

## Build/lint

Because upstream is unmaintained (there is no one to merge divergence back to — the fork's last
commit is our pinned SHA, and the original `rolandoislas/BrightWebSocket` is archived), JellyRock
**owns and lints** this code like the rest of the project — it is **not** excluded from
BrighterScript diagnostics or Prettier.

When first vendored it was lint-exempt via a `components/vendor/**` diagnostic filter (mirroring
`roku_modules`). That filter was **removed from every `bsconfig*.json`** once the sources were brought
up to the project's lint (`function`→`sub` where void, all-paths-return, dead-code removal) and
formatting. New edits are linted + formatted normally, so real issues surface instead of being hidden.
(The attribution `README.md` + `LICENSE` stay out of prose/spell lint as third-party docs.)

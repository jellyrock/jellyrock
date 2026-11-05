# `BrightWebSocket` (adopted)

An RFC 6455 `WebSocket` client for Roku. Roku has no native `WebSocket` component and no ropm or npm package carries this library, so JellyRock keeps a copy here and owns it. `npm run ropm` does not manage it.

- **Upstream:** [`SuitestAutomation/BrightWebSocket`](https://github.com/SuitestAutomation/BrightWebSocket)
- **Pinned commit:** `3d64524354e41b0b0a06841dc53e696e685e334a` (2021-03-08)
- **License:** MIT (the copyright holder is named in [`LICENSE`](LICENSE))
- **Lineage:** a maintained fork of the dormant `opencma/BrightWebSocket`, whose README points here.

## Why it is here

The remote-control receiver (#666) uses it as its `ws://` transport, behind the `wsTransport` seam, so the socket implementation can be swapped. Upstream has been dormant since 2021, so JellyRock is in practice its maintainer.

## Local modifications

The sources differ from upstream. They were trimmed and hardened when adopted (commit `dcac8b52`) and changed since. To see every line, diff against the pinned commit above.

- **Script paths:** the `<script>` URIs in `WebSocketClient.xml` point to this folder. The `secure` field and the `TlsUtil.brs` script are gone.
- **TLS removed:** Roku cannot do socket TLS, so the unimplemented `wss://` skeleton (`TlsUtil.brs`, `rsa_encrypt`, `m._secure` and `m._tls`) was deleted. The client is `ws://` only.
- **Inbound size cap:** the frame decoder caps the payload size the server declares (`_read_socket_data` in `WebSocketClient.brs`). This was the must-fix from the review below.
- **100 ms poll:** the Task loop polls every 100 ms instead of upstream's 1 ms busy loop.
- **Drain per pass:** `_read_socket_data` reads everything the socket holds per pass (up to `_buffer_size`) and decodes every complete frame through `_decode_frame`. Upstream read 1 KB and decoded one frame per pass, so a 26 KB SyncPlay `PlayQueue` frame took about 3.1 s at the 100 ms poll (measured 2026-10-24 on a Stick 4K).
- **The Task thread exits after close** (`WebSocketClientTask.brs`). Upstream's loop ran forever and held one Task thread per socket for the app's lifetime, which is one leaked thread per reconnect against Roku OS's cap of 100 concurrent threads (the #728 `&h29` crash class). The loop now exits once a requested connection reaches `CLOSED` and the event port is drained. The node is now single-connection: reopening after a close needs a new node. The only consumer, `RemoteControlTask`, already creates one per connect attempt.
  - **The exit test stays at the head of the loop body, before `m.ws.run()`.** `run()` performs the `CLOSED` transition and posts the final `ready_state`, `on_close` and `on_error` messages to the port. A drained port seen before `run()` says nothing about what `run()` then queued. Testing after `run()` releases the thread with the terminal events still queued, so `m.top.on_close` is never written and `RemoteControlTask.connectAndPump` blocks forever instead of reconnecting. `npm run lint:socket-thread-release` gates this order, because no test on hardware or in CI can reach this loop.
  - **The consumer does not depend on `on_close` alone.** This exit keys on `ready_state`, while `RemoteControlTask` wakes on `on_close` or `on_error`. The two coincide today only because every `_close()` path in `WebSocketClient.brs` posts one of them. Nothing in the client enforces that, and `lint:socket-thread-release` can't check it (it reads the Task and the receiver, not the client). So the receiver also observes `ready_state` and treats `CLOSED` as terminal. If a re-sync changes when the client posts terminal events, that observer keeps the receiver from blocking on a socket whose thread is already gone.
  - **Two limits.** The exit only covers a connection that reaches `CLOSED`. Upstream has no check that a connect completed: `connect()` only reports that the attempt started on a non-blocking socket (Roku `ifSocketConnection`), and the client never calls `isConnected()`, `eConnRefused()` or `isException()`. So a stalled connect keeps the node in `CONNECTING` until the handshake write fails. And `_CLOSING_DELAY` is 30 s, so a close started by the server takes up to that long to reach `CLOSED` unless a socket read fails first.
- **Logger quieted:** the noise about a missing config file was removed.
- **`run` renamed to `runSocketLoop`** (`WebSocketClientTask.brs`). The Task's worker function was named after the reserved `run`, which collides with the global `Run()`. It only worked because the Task starts it by the `functionName` string, never by a call in scope.
- **Caller-set `headers` survive Task startup** (`WebSocketClientTask.brs`). Upstream's `init()` ran `m.top.headers = m.ws.get_headers()`, which overwrote the field with the client's empty default. Because `init()` sets `control = "RUN"`, a caller setting `headers` right after `CreateObject` raced that write and lost it without a sign. The client is now seeded from the node after the observers are registered, so an earlier write is picked up and a later one still arrives as a field event. The remote-control receiver's `Authorization` header depends on this (#743).
- **`m.task_port` renamed to `m.port`** (`WebSocketClientTask.brs`). Nothing ever assigned `m.task_port` (3 reads, 0 writes), so after a `set_buffer_size`, `set_protocols` or `set_headers` round trip the field was observed again on an invalid port. That path was dead upstream because nothing called those setters. It became live once the receiver set `headers`.
- **Unused byte helpers deleted** (`ByteUtil.brs`): `byte_array_to_long`, `bytes_to_int`, `bytes_to_int24`, `int24_to_bytes`, `byte_array`, `byte_array_sub` and `byte_array_equals`, which the `dead-code` check reported.
- **Self-start recorded:** the Task's `init()` sets `control = "RUN"` itself, which bypasses `launchTask()`'s thread count. That line carries a `bsc-disable-line no-raw-run` with the reason, and the RTA `task-thread-peak` spec bounds the total the count misses.
- **Linted and formatted like the rest of the code:** void functions became `sub`, `Logger._level_to_string` returns on every path, and the dead `mask` and `scheme` locals are gone.

## Security review (2026-07, before adoption)

The review read the paths that handle input from the network: the handshake parse, the frame decoder and the byte and mask handling. It found no malicious code; it is a legitimate RFC 6455 implementation. The findings:

- **Must fix before shipping (done): unbounded inbound allocation.** The frame decoder did not bound the payload size the server declares, continuation reassembly, inbound control frames or what accumulates before the handshake (`_read_socket_data` in `WebSocketClient.brs`). On the cleartext `ws://` path, a malicious server or a machine in the middle could grow the buffer without limit. The fix is the size cap above (`_error` and `_close` when a frame is too large).
- **Keep `log_level` at its default.** At `VERBOSE` the client logs the handshake request, which carries the token (`_send_handshake` in `WebSocketClient.brs`). Never log the socket URL from JellyRock.
- **Quality notes:** the 1 kHz busy poll (fixed, see above); a 64-bit length bug in `bytes_to_long` that small frames never reach; the `m.task_port` typo (fixed, see above); the dead `TlsUtil.brs` (deleted); strings are ASCII only, which suits our hex and numeric command frames.

## Lint and build

JellyRock owns this code, so every check applies to it, as it does to the rest of the repo. Only package-managed code under `roku_modules` is exempt. [ADR 0054](../../docs/adr/0054-owned-code-gets-every-check.md) records the rule. A finding here is fixed in the code or suppressed on its line with a reason, never by excluding the folder.

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

- **No Task wrapper:** upstream's SceneGraph Task (`WebSocketClient.xml`, `WebSocketClientTask.brs`) is not kept. `RemoteControlTask` runs the client object on its own thread (`connectAndPump()`), so no message crosses a thread between the socket and its consumer. The wrapper handed each message over through a node field, and a frame was held there for seconds (see [`remote-control.md`](../../docs/architecture/remote-control.md)). The `secure` field and the `TlsUtil.brs` script are gone too.
- **TLS removed:** Roku cannot do socket TLS, so the unimplemented `wss://` skeleton (`TlsUtil.brs`, `rsa_encrypt`, `m._secure` and `m._tls`) was deleted. The client is `ws://` only.
- **Inbound size cap:** the frame decoder caps the payload size the server declares (`_read_socket_data` in `WebSocketClient.brs`). This was the must-fix from the review below.
- **Drain per pass:** `_read_socket_data` reads everything the socket holds per pass (up to `_buffer_size`) and decodes every complete frame through `_decode_frame`. Upstream read 1 KB and decoded one frame per pass, so a 26 KB SyncPlay `PlayQueue` frame took about 3.1 s under the wrapper's 100 ms poll (measured 2026-10-24 on a Stick 4K).
- **Read per pass:** `run` calls `_read_socket_data` on every pass, not only when a socket event arrives. The read no longer depends on an event arriving for bytes already in the socket, and it does nothing when the socket holds none. The handshake is still sent on a socket event only.
- **Writable events off after the handshake** (`_send_handshake`): the handshake is their only use. Left on, the socket raised one on every wait, so `run` never waited: about 8,000 passes a second when run in a plain loop, against about 5 with them off (measured 2026-11-15 on a Stick 4K). Upstream's wrapper hid this behind its own poll.
- **`release()` added:** closes the TCP socket at once, with no close frame and no event, for an owner dropping a client whose connection is over.
- **Logger quieted:** the noise about a missing config file was removed.
- **Unused byte helpers deleted** (`ByteUtil.brs`): `byte_array_to_long`, `bytes_to_int`, `bytes_to_int24`, `int24_to_bytes`, `byte_array`, `byte_array_sub` and `byte_array_equals`, which the `dead-code` check reported.
- **Linted and formatted like the rest of the code:** void functions became `sub`, `Logger._level_to_string` returns on every path, and the dead `mask` and `scheme` locals are gone.

## Security review (2026-07, before adoption)

The review read the paths that handle input from the network: the handshake parse, the frame decoder and the byte and mask handling. It found no malicious code; it is a legitimate RFC 6455 implementation. The findings:

- **Must fix before shipping (done): unbounded inbound allocation.** The frame decoder did not bound the payload size the server declares, continuation reassembly, inbound control frames or what accumulates before the handshake (`_read_socket_data` in `WebSocketClient.brs`). On the cleartext `ws://` path, a malicious server or a machine in the middle could grow the buffer without limit. The fix is the size cap above (`_error` and `_close` when a frame is too large).
- **Keep `log_level` at its default.** At `VERBOSE` the client logs the handshake request, which carries the token (`_send_handshake` in `WebSocketClient.brs`). Never log the socket URL from JellyRock.
- **Quality notes:** the 1 kHz busy poll (fixed, see above); a 64-bit length bug in `bytes_to_long` that small frames never reach; the `m.task_port` typo (fixed, see above); the dead `TlsUtil.brs` (deleted); strings are ASCII only, which suits our hex and numeric command frames.

## Lint and build

JellyRock owns this code, so every check applies to it, as it does to the rest of the repo. Only package-managed code under `roku_modules` is exempt. [ADR 0054](../../docs/adr/0054-owned-code-gets-every-check.md) records the rule. A finding here is fixed in the code or suppressed on its line with a reason, never by excluding the folder.

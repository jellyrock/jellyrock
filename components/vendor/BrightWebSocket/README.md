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

**None to the sources** — the `web_socket_client/*.brs` files are byte-for-byte
upstream. The only change is in `WebSocketClient.xml`: the `<script>` uris are
repointed from `pkg:/components/web_socket_client/…` to this vendored path.

Diff against upstream with the pinned SHA above.

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
  64-bit length bug (unreachable for small frames); `m.task_port` typo (dead path);
  `TlsUtil.brs` (661 lines) is dead code on `ws://`; ASCII-only strings (fine for
  our hex/numeric command frames).

## Build/lint

Excluded from BrighterScript diagnostics via a `components/vendor/**` filter in
`bsconfig.json` (mirrors how `roku_modules` is excluded), so third-party style
does not trip the project's linters/plugins.

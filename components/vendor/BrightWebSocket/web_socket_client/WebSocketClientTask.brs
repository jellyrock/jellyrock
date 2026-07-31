' WebSocketClientTask.brs
' Copyright (C) 2018 Rolando Islas
' Released under the MIT license
'
' BrightScript, SceneGraph Task wrapper for the web socket client
'
' JellyRock modification (see ../../README.md): removed the `secure`/TLS field
' handling (ws:// only — upstream TLS was unimplemented and Roku can't do socket TLS).

' Entry point
sub init()
  ' Task init
  m.top.functionName = "runSocketLoop"
  m.top.control = "RUN"
end sub

' Main task loop.
' JellyRock modification: renamed from `run` — a top-level `run()` collides with the built-in
' global `Run()` (BSC: cannot-use-reserved-word / native-function-collision). It worked upstream
' only because the Task dispatches it by the `functionName` STRING, never a scope call; renamed so
' we don't rely on that and the diagnostic is genuinely resolved, not just suppressed.
sub runSocketLoop()
  m.ws = WebSocketClient()
  m.port = createObject("roMessagePort")
  m.ws.set_message_port(m.port)
  ' Fields
  m.top.STATE_CONNECTING = m.ws.STATE.CONNECTING
  m.top.STATE_OPEN = m.ws.STATE.OPEN
  m.top.STATE_CLOSING = m.ws.STATE.CLOSING
  m.top.STATE_CLOSED = m.ws.STATE.CLOSED
  m.top.ready_state = m.ws.get_ready_state()
  m.top.protocols = m.ws.get_protocols()
  m.top.buffer_size = m.ws.get_buffer_size()
  ' Event listeners
  m.top.observeField("open", m.port)
  m.top.observeField("send", m.port)
  m.top.observeField("close", m.port)
  m.top.observeField("buffer_size", m.port)
  m.top.observeField("protocols", m.port)
  m.top.observeField("headers", m.port)
  m.top.observeField("log_level", m.port)

  ' JellyRock modification: seed the client FROM the node instead of overwriting the node with the
  ' client's empty defaults (upstream did `m.top.headers = m.ws.get_headers()` above). init() sets
  ' control="RUN", so a caller that sets `headers` right after CreateObject races this thread's
  ' startup and upstream silently discarded the value. Seeding AFTER the observers are registered
  ' closes the window in both directions: a write that landed earlier is picked up here, a later one
  ' arrives as a field event. Load-bearing — the remote-control receiver sets the Authorization
  ' header that binds the socket's Jellyfin DeviceId, and losing it re-splits the session (#743).
  if m.top.headers <> invalid and m.top.headers.count() > 0
    m.ws.set_headers(m.top.headers)
  end if

  ' JellyRock modification: ready_state is CLOSED before open() is ever called, so the loop-exit
  ' check below must only fire once a connection was actually requested.
  m.connect_requested = false

  if len(m.top.open) > 0
    m.ws.open(m.top.open)
    m.connect_requested = true
  end if

  while true
    ' Check task messages. JellyRock hardening: poll every 100ms instead of the upstream
    ' 1ms busy-loop — this is a latency-tolerant remote-control channel (commands seconds
    ' apart), so ~100ms adds no perceptible latency but cuts idle CPU ~100x.
    msg = wait(100, m.port)
    ' Field event
    if type(msg) = "roSGNodeEvent"
      if msg.getField() = "open"
        m.ws.open(msg.getData())
        m.connect_requested = true
      else if msg.getField() = "send"
        m.ws.send(msg.getData())
      else if msg.getField() = "close"
        m.ws.close(msg.getData())
      else if msg.getField() = "buffer_size"
        m.ws.set_buffer_size(msg.getData())
      else if msg.getField() = "protocols"
        m.ws.set_protocols(msg.getData())
      else if msg.getField() = "headers"
        m.ws.set_headers(msg.getData())
      else if msg.getField() = "log_level"
        m.ws.set_log_level(msg.getData())
      end if
      ' WebSocket event
    else if type(msg) = "roAssociativeArray"
      if msg.id = "on_open"
        m.top.on_open = msg.data
      else if msg.id = "on_close"
        m.top.on_close = msg.data
      else if msg.id = "on_message"
        m.top.on_message = msg.data
      else if msg.id = "on_error"
        m.top.on_error = msg.data
      else if msg.id = "ready_state"
        m.top.ready_state = msg.data
        ' JellyRock modification: `m.task_port` -> `m.port`. m.task_port is never assigned anywhere in
        ' this component (3 reads, 0 writes), so these re-observes silently rebound the field to an
        ' invalid port. Upstream never tripped it because nothing called set_buffer_size/protocols/
        ' headers; the remote-control receiver now sets `headers`, which makes this path live.
      else if msg.id = "buffer_size"
        m.top.unobserveField("buffer_size")
        m.top.buffer_size = msg.data
        m.top.observeField("buffer_size", m.port)
      else if msg.id = "protocols"
        m.top.unobserveField("protocols")
        m.top.protocols = msg.data
        m.top.observeField("protocols", m.port)
      else if msg.id = "headers"
        m.top.unobserveField("headers")
        m.top.headers = msg.data
        m.top.observeField("headers", m.port)
      end if
    end if
    m.ws.run()

    ' JellyRock modification: exit once a requested connection has closed AND the port is drained
    ' (msg = invalid), so the final on_close/ready_state events reach m.top before the thread is
    ' released. Upstream looped forever, leaking the thread. Single-connection contract now:
    ' reopening after close needs a fresh node.
    if m.connect_requested and msg = invalid and m.ws.get_ready_state() = m.ws.STATE.CLOSED
      exit while
    end if
  end while
end sub

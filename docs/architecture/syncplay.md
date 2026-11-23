---
topic: syncplay
related-files:
  - components/syncplay/SyncPlayManager.bs
  - components/syncplay/SyncPlayManager.xml
  - components/syncplay/TimeSyncTask.bs
  - components/syncplay/TimeSyncTask.xml
  - source/syncplay/syncPlayConverge.bs
  - source/syncplay/syncPlayPlayer.bs
  - source/syncplay/syncPlayGroup.bs
  - source/syncplay/syncPlayPlayback.bs
  - source/syncplay/syncPlayOffset.bs
  - source/syncplay/syncPlayTime.bs
  - source/syncplay/syncPlayState.bs
  - source/syncplay/syncPlayQueue.bs
  - source/syncplay/syncPlayMessage.bs
  - source/syncplay/syncPlayRequests.bs
  - source/syncplay/syncPlayInbox.bs
  - source/syncplay/syncPlayHooks.bs
  - source/syncplay/syncPlayMenu.bs
  - tests/source/shared/syncPlaySim.bs
last-reviewed: 2026-11-21
---

# SyncPlay: staying in step with a group

SyncPlay lets this Roku join a Jellyfin watch-together group and play, pause and seek with it. This doc covers the engine that keeps the player in step: its layers, its one decision function, and the rules that are easy to break.

Three other docs hold the rest, and this one links to them instead of repeating them:

- [playback.md](./playback.md#syncplay-the-player-follows-the-group): what the player and the queue do differently in a group, and how a play is handed to the group.
- [remote-control.md](./remote-control.md): the socket, the plugin long poll, and the receiver Task that carries the group's frames.
- [The user page](../user/features/syncplay.md): what the viewer sees.

## What SyncPlay is on the wire

The server owns the group. A member never tells another member anything.

- The server sends a command: `Unpause`, `Pause`, `Seek` or `Stop`. Each carries a position in ticks, a server time (`When`) and the time it was sent (`EmittedAt`).
- An `Unpause` is a line: at `When` the group is at that position, and it plays forward from there. A `Pause` or a `Seek` is a point the group stands at.
- A member reports `Buffering` when it cannot play (a load, a seek, a stall) and `Ready` when it can. The server pauses the group while any member it waits on is buffering.
- For a group `Seek` and for a new item, the server marks every member buffering and waits for each `Ready`.
- The server takes a `Ready` only near the point it names. It answers one further off than its tolerance with a corrective `Seek` (`syncPlayPlayback.READY_TOLERANCE_MS` mirrors that tolerance).
- A viewer's control is a request (`Pause`, `Unpause`, `Seek`, `NextItem` and more). The server answers with a frame to every member, never in the HTTP reply.
- Queue changes arrive as `PlayQueue` group updates, and the group's state (`Idle`, `Waiting`, `Paused`, `Playing`) as `StateUpdate`.

Two consequences shape the code. A request that fails draws no frame at all, so each request's HTTP result has to be tracked. And every position has to be placed on the server's clock, so the member measures the offset between its clock and the server's.

### How frames reach the manager

Frames come over the session socket on an `http://` server, and over the companion plugin's long poll on an `https://` server. Both end in the same receiver Task ([remote-control.md](./remote-control.md#two-transports-one-command-stream)).

1. `remoteCommand.parseMessage()` hands a `SyncPlayCommand` or `SyncPlayGroupUpdate` to `syncPlayMessage.parseCommand()` or `parseGroupUpdate()`. A frame it cannot use becomes `ignore`, and the receiver logs it.
2. `RemoteControlTask.sendSyncPlayFrame()` numbers and stamps the frame and writes the last few together to the manager's `frames` field (`syncPlayInbox.push()`).
3. `SyncPlayManager.drainInbox()` applies each number once, in order (`syncPlayInbox.take()`). Its `inboxTimer` reads the field again while a group may be sending.

The numbered hand-off exists because one notification per frame was not reliable. [remote-control.md](./remote-control.md#threading-a-task-owns-the-transport-the-main-thread-dispatches) has the evidence, and decision `syncplay-frames-numbered-handoff` records the choice.

Requests go out through `ApiClient.BuildSyncPlayRequest(action, body)`, one method for every `/SyncPlay/<action>` route. The bodies come from `syncPlayRequests.bs`.

## The layers

| Layer | Where | Thread | Owns |
|---|---|---|---|
| The pure layer | `source/syncplay/` | Its caller's | Parsing, time, the clock estimate, the membership state, the queue mapping, the two models and the decision. No node, no HTTP, no Timer. |
| The manager | `components/syncplay/SyncPlayManager.bs`, at `m.global.syncPlayManager` | Render | The loop around the decision, every write to the player, every request, the Timers, the published fields. |
| The player hooks | `source/syncplay/syncPlayHooks.bs`, called by `PlayerHostView`, `VideoPlayerView` and the OSD | Render | The one file in the pure folder that reads `m.global`. Events go up through `notify()`, and the viewer's controls through `control()`. |
| The time sync | `components/syncplay/TimeSyncTask.bs` | Task | One burst of `GET /GetUtcTime` rounds, each stamped at send and receive. |
| The menu and icon | `syncPlayMenu.bs`, driven by `JRScene.openSyncPlayMenu()` and `applySyncPlayIcon()` | Render | What the overhang icon shows and what the group menu offers. |

Most of the pure layer runs on the render thread, because the manager calls it. The parser and `syncPlayInbox.push()` run on the receiver's Task thread.

Three things about the manager are easy to get wrong:

- Its working state is built in `ensureReady()`, not in `init()`. `setGlobalNodes()` creates the node from the main thread, and an AA built there loses its `LongInteger` entries on the way to the render thread ([threading.md](./threading.md#measured-findings)). Every entry point calls `ensureReady()` first.
- It never observes the player. The host and the player push events to `playerEvent()`, and the manager acts through the host's `handleTransport` verbs. An observer on the player's `state` could be removed by another component's `unobserveField` (#898).
- Every time is a `LongInteger`: epoch milliseconds or Jellyfin ticks. A `Double` loses precision inside an AA (decision `syncplay-time-longinteger`, and the header of `syncPlayTime.bs`).

### The clock estimate

`syncPlayOffset.bs` keeps the last few rounds and uses the one with the shortest delay, as jellyfin-web does. A join starts a burst of `FIRST_SYNC_ROUNDS`, and later bursts of `SYNC_ROUNDS` follow at `syncPlayOffset.nextBurstSeconds()`. After a burst that has an estimate, the manager posts a `Ping` with half the measured round trip.

Until the first estimate, the group model answers "unknown" and the member applies no command. The viewer's SyncPlay Time Offset setting is added to every conversion (`syncPlayOffset.setExtraOffsetMs()`).

## The comparison engine

The manager keeps two models and asks one pure function what to do.

- The player model (`syncPlayPlayer.bs`) holds what the `Video` node was told, what it has confirmed, and where it is. The node's own fields cannot answer that: `state` lags a write, and `position` moves only on a notification and reads stale while paused.
- The group model (`syncPlayGroup.bs`) holds what the group wants (`wants()`), what the server waits for from this member, and the life of each request.
- `syncPlayConverge.decide()` compares them and returns at most one action, plus a time to look again (`wakeAtMs`).

`SyncPlayManager.converge()` is the loop:

1. A fact arrives: a player event, a frame, a request's result or the timer. It updates a model and nothing else.
2. `converge()` advances both models to now (`syncPlayPlayer.advance()`, `syncPlayGroup.advance()`) and calls `decide()`.
3. `carryOut()` performs the action, and `syncPlayConverge.applied()` tells the models it was done.
4. The loop asks again until `decide()` returns no action, then sets `convergeTimer` to `wakeAtMs`.

No handler decides anything. Two events in either order end in the same place, which is what makes the engine testable without a device. To add behavior, add a fact to a model and a rule to `decide()`. A handler that writes to the player on its own breaks that property.

The loop holds a few guards:

- An event that arrives while the loop runs only sets `m.convergeAgain`. The player answers a write from inside the write, so the loop would otherwise be entered twice.
- `CONVERGE_ROUNDS` caps the actions one event may cause. Past it the manager logs `the comparison did not settle` and looks again later.
- Every node write goes through `tellPlayer()`, which marks the verb `fromGroup` and brackets it with `ownWrite`. Without the mark, the player would send a group's `Seek` back to the group as a new request.
- Every `Buffering`, `Ready` and ask goes through `sendRequest()`. The group model has two slots, `report` and `ask`, so at most one of each is in flight.

The actions are `pause`, `resume`, `seek`, `reload`, `stop`, `leave`, `report`, `ask`, `halt` and `notice`, plus three that change only the models (`settled`, `inStep`, `holdsSpent`). `decide()` can also return `load`, but the manager never asks for one: the queue layer performs each load itself (`SyncPlayManager.applyQueue()`), and `comparisonCtx()` passes `loadOwed: false`.

### Why it replaced the first engine

The first engine reacted to each event in its own handler. Members drifted after pauses, froze on corrections, lost seeks, and could be left behind after a reload. PR #1355 deleted it for the comparison.

Its PR records both engines on a Streaming Stick 4K against Jellyfin 12.4.0. After a group pause, the old engine left the member 51 to 195 ms ahead over 14 rounds (2026-11-10). The new one stayed within 30 ms over 20 resumes (2026-11-18). A 2,000-step mixed soak on 2026-11-18 ended every step at rest.

[ADR 0063](../adr/0063-syncplay-compares-two-models.md) records the choice.

## The rules that are easy to break

The header of `syncPlayConverge.bs` lists the rules in the order `decide()` applies them. This section says why each one is there.

### A node in flight is not written to

While the node loads, seeks, lands, pauses or resumes (`syncPlayPlayer.isInFlight()`), the comparison waits. A write to a node with a write in flight can leave it buffering for good. The device facts are in [playback.md](./playback.md#syncplay-the-player-follows-the-group).

There are two exceptions. A load from the item's start is paused at its first frame for its `Ready` (`holdsFirstFrame()`). A seek stuck at a full buffer is recovered (below).

### Holds and waits are pauses nobody pressed

The player model records who owns each pause (`pauseOwner`):

- `group`: the group's `Pause`. The OSD shows.
- `viewer`: the viewer's own press, asked of the group.
- `wait`: the group is getting ready (a load or a seek). No OSD.
- `hold`: a correction of this member's own, waiting for the group to arrive. No OSD.
- `scrub`: the node paused itself for the trick-play bar.

`SyncPlayManager.pausedForViewer()` answers false for a hold or a wait, so the Play key and the OSD never treat one as a pause. A member that stops following while held is resumed once (the first branch of `decide()`), since nothing else would resume it.

### How a member catches up

A playing member is judged against the group's line on each position reading. Only a clock that a notification measured counts (`clock.measured`).

- Ahead past `aheadBarMs`: it holds. The node pauses, and resumes as the line reaches where it stopped.
- Behind past `behindBarMs`: it catches up (`syncPlayConverge.catchUp()`). It seeks ahead of the group by a lead, lands, and then holds until the group arrives.
- Inside the bars it is left alone. A correction would show more than the difference.

A seek on a paused node resumes it, so the catch-up always seeks a playing node ahead and then holds. It never seeks to where the group is now, because the seek takes time and the group would be past that point when it landed.

The lead is learned. The player model keeps how long the stream's last few seeks took (`seekSamples`). The lead is the slowest of them plus `leadMarginMs`, kept between `leadMs` and `leadMaxMs`. The seek's landing budget is its lead, so the group hears of a stall only when the seek runs past it.

Each correction has a budget, so nothing is written for good to a node it does not help:

- `holdLimit` holds in a row. After that the member plays on ahead, and the log says so once (`holdsSpent`).
- `catchUpLimit` catch-ups in a row. After that the member asks the group to wait (below).
- A reading in step makes both budgets whole again (`inStep`), and so does any group command.

A catch-up seek the node did not take is not repeated. When it lands nearer its start than its target (`catchUpFellBack()`), the stream is reloaded once at the group's point. Decision `syncplay-catch-up-fell-back-reloads` has the case.

After a time offset pick, both bars narrow to `pickBarMs` until the next settled reading (`group.pickPending`).

### The resume lag

A resume takes effect a little after it is written. The player model learns how late from the first two readings after each resume (`learnResumeLag()`), and the comparison writes the next resume that much early (`lineAction()`).

- The lag is kept per kind of stop, `landing` or `steady`, because a node stopped straight after a landing resumes differently.
- The lag in use is a median of the last few samples (`lagInUse()`), so one late reading does not move it.
- A sample can be below zero: the node ran on past the stop the model took. A lag below zero is used only when at least two samples are kept and all are below zero. A low-end Stick's node ran on at every resume measured, and on other devices one such sample is noise.
- A new stream forgets what was learned (`syncPlayPlayer.mounted()`).

That last point costs a low-end device a few short holds at the start of each video. Carrying the lag across streams was tried and declined on 2026-11-20. The carry changed what other devices did, and decision `syncplay-resume-lag-not-carried` records the samples.

`lateLagMs()` guards one trap: a lag below zero applied to "now" would put the resume off at every look, for good.

### A group standing still, and the short landing

When the server waits for this member's `Ready` at a point, the node has to be at that point, paused.

1. A node off the point seeks to it once (`group.pointSoughtTicks`). A second seek to the same place has preceded every frozen player seen, so there is no second.
2. A direct play gets one more seek (`group.pointRetried`), because it can start from the keyframe before its target and the second seek lands on it. A transcode lands as short the second time, so it gets none.
3. Nothing is sought while this wait's `Ready` is in flight (`readyInFlightForWait()`). A seek then would send a `Buffering` behind the `Ready` and flip the group out of its pause.

A short landing is what is left: the node is paused further short of the point than the server's tolerance, and its seeks are spent. Some devices cannot seek exactly. They start from the sync frame before the target, and every seek there lands the same way.

A `Ready` naming the point would start this member behind by the shortfall. So the member asks the group to come to where it stands (`syncPlayConverge.landingAsk()`). The ask is a `Seek` request to its own position. The server sends every member a `Seek` there, and this node is already at it.

- One ask per group `Seek`. `syncPlayGroup.command()` clears `landingAsked` on each `Seek`, since a node can land short of every point a paused group is sent to.
- The asks of one pause are capped by `landingAskLimit`. Two members whose sync frames differ could otherwise pull the group back in turns for good. The count is whole again when the group plays or stops.
- The `Ready` is held while the ask's answer is awaited, up to `requestLimitMs` (`awaitsLandingAnswer()`).
- With no ask left, the `Ready` names the point (`readyTicks()`), and the offset is taken back as a catch-up when the group plays.

`landingAskLimit` is a chosen number, not a measured one. The per-Seek ask was measured on a low-end Streaming Stick on 2026-11-20 (direct play, Jellyfin 12.4.0, ten rounds of two seeks inside one pause). Before it, 3 of 10 resumes froze and the member resumed up to 7.4 s behind. After it, 10 of 10 ended at rest.

A load of this member's own gets the same care with different rules. Its first frame seeks to the group's point once when it reads short (`landedShortOfLoadPoint()`, once per load through `group.seekForLoad`).

### When the group is asked to wait

The member that is behind pays first. It asks the group to wait only when it cannot catch up alone:

- its catch-up budget is spent;
- its last seek never landed (`player.lastSeekGaveUp`); or
- its seeks as a rule need a longer lead than `leadMaxMs` (`seeksTooSlow()`, judged on the median so one slow seek does not say so).

The ask is again a `Seek` request to its own position, marked `waitOnMe`. It goes once (`group.askedWait`) until the member is next in step, the group pauses, or the member stalls. A failed one goes again. Decision `syncplay-slow-seek-waits-on-member` has the case that started it.

### Slow seeks and stuck seeks

A seek has a landing budget (`syncPlayPlayback.SEEK_SETTLE_MS`, or the lead for a catch-up). Past it, two things can be true:

- The node still buffers. The seek is slow (`seekSlow`): it stays in flight, and the group is told `Buffering` as a stall. When it lands, its time is one more sample.
- The node is not buffering. The seek is given up (`lastSeekGaveUp`), and the model takes the node where its state says.

A stuck seek is one that never lands. Roku's player sits at a full buffer, still `buffering`. The manager tells the model when the buffer first reads full (`syncPlayPlayer.bufferFull()`). After `stuckFullBufferMs` there, `stuckSeekAction()` recovers in two steps:

1. The same seek is written again, once per group command (`group.recoverSeeks`).
2. If that sticks too, the stream is reloaded once (`group.stuckReloads`).

After both, nothing more is written, and the player's own buffer check ends playback. The headroom of `stuckFullBufferMs` over a healthy seek is thin on one device (followup `syncplay-stuck-seek-wait-thin-headroom`).

Two more recoveries share the `recoverSeeks` count. A node that reads playing but sends no reading for `silentPlayingMs` is sought once. A node that takes no pause after `pauseWriteLimit` writes is sought once when its clock is unknown, and otherwise the member halts.

### Reports and requests

- `Buffering` goes out once per load (`group.bufferingForLoad` against the player's `loadCount`), once per group `Seek`, and for a stall that outlasts `syncPlayPlayback.STALL_MS`.
- `Ready` goes out from a paused node. A playing node reports `Ready` only when it plays on purpose: after a stall, in a playing group, or with nothing known.
- No `Ready` goes out while the queue layer still owes the new item's load (`ctx.loadPending`). The node is on the item before, and the server would correct its position with a `Seek`.
- A `Ready` settles only the wait it was sent in (`waitCount`), and a result is matched to its try by number (`requestCount`). A late result from an earlier try changes nothing.
- A failed request goes again while it is wanted. After `requestTries` the viewer is told once, and it keeps going every `retryEveryMs`. It never stops, because a `Ready` the server waits for holds the whole group.
- A client-error status (400 to 499) to an ask counts as answered: the server heard it and said no (`SyncPlayManager.onRequestResult()`).
- When nothing says where the group is, the member sends a `Ready` every `whereEveryMs`. The server answers it alone with the current command.

### The viewer's controls

- A pause, play or seek is asked of the group (`SyncPlayManager.viewerAsk()`). The group model holds the ask until a command answers it. For a pause, `wants()` answers "paused" at once, and the comparison pauses the node as the viewer's own.
- The player writes the pause itself only when the ask cannot be sent (`viewerPause()` answers true).
- A scrub sets `player.scrubbing`. The node pauses itself under the trick-play bar, and the comparison leaves it alone: no resume, hold or catch-up. The one write allowed is a seek to where the group stands.
- OK on the bar posts the target to the group and writes nothing to the node. The group's `Seek` closes the bar. `VideoPlayerView`'s `groupSeekFallbackTimer` closes it when no `Seek` comes.
- Back during group playback halts the member (`haltFollowing()`). It stays in the group, posts `SetIgnoreWait` so the server stops waiting on it, and records commands without applying them.
- A halted member follows again from the menu, on its own play, or on another member's new playlist. `syncPlayGroup.followedAgain()` drops what the server held from it before the halt.

A halt is also the engine's way out when it cannot follow: the group plays something the video player cannot, the queue cannot be loaded, or the node will not stay paused.

### A lost membership

A reopened socket makes the manager sync the clock and ping at once (`onSocketReopened()`). A server that no longer holds the membership answers `NotInGroup`, and the manager joins the group again (`syncPlayState.rejoinsAfterLoss()`), up to `REJOIN_LIMIT` times inside `REJOIN_WINDOW_MS`. A membership left behind by an app exit is ended at the next launch (decision `syncplay-stale-membership-at-launch`).

## Limits and where they live

`syncPlayConverge.defaultPolicy()` is the one place the comparison reads its thresholds, so a soak can compare candidates. Its own comment says which are measured and which are provisional. Read the values there.

| What it bounds | Name | Lives in |
|---|---|---|
| The drift bars: behind, ahead, after a pick | `behindBarMs`, `aheadBarMs`, `pickBarMs` | `defaultPolicy()`, from `SKIP_TO_SYNC_MIN_MS`, `SETTLE_CORRECTION_MS` and `PICK_CORRECTION_MS` in `syncPlayPlayback.bs` |
| How near the point a `Ready` must be | `pointToleranceMs` | `defaultPolicy()`, from `READY_TOLERANCE_MS` |
| A catch-up's lead: floor, ceiling, margin | `leadMs`, `leadMaxMs`, `leadMarginMs` | `defaultPolicy()`, from `CATCH_UP_LEAD_MS`, `CATCH_UP_LEAD_MAX_MS` and `CORRECTION_LEAD_MARGIN_MS` |
| Corrections in a row | `catchUpLimit`, `holdLimit` | `defaultPolicy()` |
| Asks to come to a short landing in one pause | `landingAskLimit` | `defaultPolicy()` |
| A paused member's longest wait for the group | `aheadWaitMaxMs` | `defaultPolicy()` |
| A stuck seek, and how often a seek is looked at | `stuckFullBufferMs`, `stuckPollMs` | `defaultPolicy()` |
| A playing node with no reading | `silentPlayingMs` | `defaultPolicy()` |
| Pause writes before a recovery | `pauseWriteLimit` | `defaultPolicy()`, from `PAUSE_ATTEMPTS` |
| Requests: time limit, tries, retry pace, the "where" ask | `requestLimitMs`, `requestTries`, `retryEveryMs`, `whereEveryMs` | `defaultPolicy()` |
| A seek's landing budget, a stall, a pause's confirmation | `SEEK_SETTLE_MS`, `STALL_MS`, `PAUSE_CONFIRM_MS`, `PAUSE_LANDED_MS` | `syncPlayPlayback.bs` |
| How long a clock may run forward unread | `PAUSE_ESTIMATE_MAX_AGE_MS`, `LANDING_READING_MAX_MS` | `syncPlayPlayback.bs` |
| A landing's first reading | `ARRIVAL_READING_MS` | `syncPlayPlayer.bs` |
| The resume lag's band and sample count | `RESUME_LAG_MIN_MS`, `RESUME_LAG_MAX_MS`, `RESUME_LAG_SAMPLES` | `syncPlayPlayer.bs` |
| Seek samples kept | `SEEK_SAMPLES` | `syncPlayPlayer.bs` |
| Clock rounds kept, and the burst pace | `RING_SIZE`, `BURST_INTERVAL_SECONDS` | `syncPlayOffset.bs` |
| Rounds per burst, actions per event | `FIRST_SYNC_ROUNDS`, `SYNC_ROUNDS`, `CONVERGE_ROUNDS` | `SyncPlayManager.bs` |
| Frames written together, and the late-frame log | `WINDOW`, `LATE_MS` | `syncPlayInbox.bs` |
| Rejoins after a lost membership | `REJOIN_LIMIT`, `REJOIN_WINDOW_MS` | `syncPlayState.bs` |

`CATCH_UP_LEAD_MAX_MS` is a viewing choice, not a measurement: it is the longest a catch-up freezes this member's picture alone. Its comment keeps it under `stuckFullBufferMs`.

## How it is tested

- Pure unit specs, one per file of the pure layer, in `tests/source/unit/syncplay/`. `syncPlayConverge.spec.bs` holds a case for each rule. A rule change starts there.
- A replay of recorded device traces (`syncPlayPlayerReplay.spec.bs`). It feeds the player model what a real node reported and compares the model's position with each reading.
- The simulator (`syncPlayConvergeSim.spec.bs` over `tests/source/shared/syncPlaySim.bs`). A fake node and a fake server run the manager's loop on a virtual clock, over seeded random orders of pauses, seeks, scrubs, stalls and lost requests. Each run has to end in step, and a write the real node would wedge on is a violation. A failing seed replays.
- A manager spec (`tests/source/unit/components/SyncPlayManager.spec.bs`) for the wiring around the loop.
- Four RTA specs on a device: `syncplay-menu`, `syncplay-controls`, `syncplay-correction` and `syncplay-reload` in `tests/rta/specs/`. A second member of the same account drives the group over REST.
- The mixed soak (`syncplay-stress.spec.js`, the `mix` case). It draws a seeded order of steps and checks after each that the member is at rest where the group is.

The commands, the soak's records and how to read them are in [rta-tests.md](../dev/rta-tests.md#stress-a-syncplay-race-syncplay-stress).

The specs read the manager through its published `sync` field. It carries counters made for them (`groupSeeks`, `readiesSent`, `correctionsDone`, `stuckSeeks`, `slowSeeks` and more). An RTA build publishes after every event, which a release build does not pay for. `rtaSyncPlaySeekBudgetMs` shortens one seek's budget so a spec can force a slow seek.

### What the tests cannot show

- The second member is not a real client. It is REST calls that create the group and ignore the wait. It never plays, never reports `Ready`, and has no screen. Nothing here tests two players against each other.
- The drift in the app is the Roku's own reading: `SyncPlayManager.publishedDriftMs()` sets the player model's clock against the group's line, under the Roku's own clock estimate. No test measures two screens from outside. An error in the estimate or in the output delay of a TV does not show. `npm run syncplay:probe` ([`scripts/syncplay-probe.js`](../../scripts/syncplay-probe.js)) measures one Roku against the group's line from outside the app, on a server that runs on the machine measuring. Run it by hand to judge a change to tightness. It sees an error in the estimate, and still not a TV's delay.
- The simulator's fake node behaves as one device's records did, and it has known gaps: it never delivers a late result from an earlier try (`syncplay-sim-no-late-request-result`), and never lets a seek fall back (`syncplay-sim-seek-never-falls-back`).
- No manager-level unit case reads what the manager passes the comparison (`syncplay-pause-estimate-wiring-untested`).

## Known gaps

The user page's [Known limits](../user/features/syncplay.md#known-limits) lists what a viewer can meet, each with its device and date. The open followups in `docs/progress.md` hold the rest. By what they are about:

- A member can play a few tens of milliseconds behind after a group `Seek`, inside the bars, so nothing corrects it (`syncplay-member-behind-after-seek-uncorrected`).
- The learned lead misses on a file with sparse keyframes (`syncplay-catch-up-lead-from-keyframes`).
- A load in a group that never reaches a first frame, cause unknown (`syncplay-load-never-reaches-first-frame`).
- A previous step right after a transcoding item's `Ready` (`syncplay-previous-reload-never-swaps`).
- A join whose frame never arrived, seen once (`syncplay-join-frame-never-seen`).
- A group's stream restart after a real playback error has not been captured (`syncplay-error-restart-uncaptured`).
- No queue edits from the Roku, and voice fast-forward and rewind are unchecked (`syncplay-queue-edits-shuffle-voice-scrub`).

The drift bars and the write limits came from the first engine, and the request limits are provisional. `defaultPolicy()` says so in its own comment. Treat a change to any of them as a change to measure with the soak, before and after.

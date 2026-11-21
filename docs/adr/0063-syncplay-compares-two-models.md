# ADR 0063: SyncPlay keeps a Roku in step by comparing two models and taking one action at a time

**Status:** Accepted
**Date:** 2026-11-21

**related-files**: `source/syncplay/syncPlayConverge.bs`, `source/syncplay/syncPlayPlayer.bs`, `source/syncplay/syncPlayGroup.bs`, `components/syncplay/SyncPlayManager.bs`

SyncPlay holds a model of what the player is doing (`syncPlayPlayer`) and a model of what the group wants (`syncPlayGroup`). One pure function, `syncPlayConverge.decide()`, compares them and returns one action. `SyncPlayManager.carryOut()` is the only place that writes to the Video node, and `sendRequest()` the only place that posts to the server. Timings a device needs (how late its resumes land, how long its seeks take) are learned as it plays, between a floor and a ceiling, never set per model. [syncplay.md](../architecture/syncplay.md) describes the shape.

The first engine reacted to each event in its own handler. A member drifted after pauses, froze on corrections, lost seeks and could be left behind after a reload, and each fix added a handler that raced another. It was deleted in #1355. Measured from outside the app on 2026-11-21 (Jellyfin 12.4.0, eight cycles per run, readings good to about 30 ms): after a resume the first engine left an Ultra a median 50 ms ahead and up to 223 ms, and this one 0 ms and up to 37 ms; after a group Seek, 94 ms behind against 20 ms behind.

**Ruled out:** patching the first engine's handlers one fault at a time (each fix moved the race); fixed timings per Roku model (a table to maintain, wrong on the next device).

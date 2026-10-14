# ADR 0038: An item the queue arrives at starts fresh, and the queue owns that rule

**Status:** Accepted
**Date:** 2026-09-19

**related-files**: `components/manager/QueueManager.bs`, `components/manager/QueueManager.xml`, `source/utils/nodeHelpers.bs`, `source/utils/versionPick.bs`, `source/utils/episodeQueue.bs`, `components/video/PlayerHostView.bs`, `components/video/VideoPlayerView.bs`, `components/ItemGrid/LoadVideoContentTask.bs`, `components/tasks/QuickPlayTask.bs`, `components/GetShuffleItemsTask.bs`, `components/ItemDetails.bs`, `tests/source/integration/queueArrival.spec.bs`

A video the queue moves to on its own — the next item when one ends, or the player's next /
previous — is one the viewer did not choose to resume, so it plays from the beginning. Before
this, only an item with SEVERAL versions resumed, because only that item reaches the version
chooser, which reads each version's position; a single-version item next to it started at 0. So
the behavior depended on how many files an item happened to have rather than on anything the
viewer did. Measured 2026-09-19 on a Roku Ultra with the synthetic `Version Episodes (2026)`
fixture: on 12.0, auto-advance and Play All resumed a multi-version episode at its saved 200 s
while a single-version one started at 0. A saved position on an item the viewer is about to
arrive at belongs to an earlier session — a second viewing, an abandoned attempt — and the Resume
button is one press away; `jellyfin-web`'s `nextTrack` also plays with no start position.

## Decision

**`QueueManager.advanceTo(index)` is how a video queue moves on**, from
`PlayerHostView.onPlayerStateChange` at an item's end and from `VideoPlayerView.switchToQueueItem`
for next / previous. It marks the item it reaches through `nodeHelpers.startFresh()`: an exact
start at 0, so the loader never substitutes a version's saved position; `startsFresh`, so the
loader picks the version by the viewer's explicit pick (`versionPick`) instead; and no version in
progress, since none resumes. The rule lives in the queue rather than in the code that builds
one, so a builder cannot forget it and it survives a shuffle, which reorders items before any
arrival. The first item is each builder's call, because it follows from the button the viewer
pressed: Play All and shuffle start it fresh (`startCurrentFresh`), while quick play of a series
or season and the Resume button keep the loader's resume path.

**Two item classes are not arrivals.** The item behind a Cinema Mode intro is the one the viewer
launched, so the loader tags the copy it queues `followsIntro` and `advanceTo` consumes the tag;
that copy is queued with `insertAfterCurrent` rather than appended, because appending played the
rest of the queue first. Live TV has no position to start from. Audio moves with the plain
position methods and is untouched.

**Before 12.0 a server lists every file of an episode as its own episode** — same series, season
and episode number, one `MediaSource` each, queried 2026-09-19 on 10.7.7 through 10.11.11 — so
every queue the app builds from a list of episodes keeps one copy per episode (`episodeQueue`),
chosen by the same pick → match → device rule as a version. Playlists and collections are left
alone: the viewer put those entries there.

## Ruled out

- **Resuming an item the queue arrives at** — its position belongs to an earlier session and
  drops the viewer mid-scene, and the old behavior was inconsistent by version count.
- **Tagging items in each queue builder** — this shipped first on the branch and is exactly how
  quick play of a season was missed; the queue-level rule closes that class outright.
- **jellyfin-web 12.0's exact-`Name` match** for carrying a version pick — a name belongs to the
  file, so it only lines up when every item's versions share one naming scheme, and it would
  hold a viewer on 1080p when the next item has 4K. Matched on the video instead.
- **Carrying an automatic version choice** — only an explicit pick carries, so upgrades still
  happen.
- **A server-version gate for collapsing copies** — servers before 12.0 really do report copies
  as separate episodes, a data shape no API tier changes, so one code path serves all.

**Constraints:** a wrongly tagged library where two genuinely different episodes share a series,
season and episode number loses one of them from a generated queue; both stay playable directly.
The intro handoff depends on the `followsIntro` tag, which `advanceTo` consumes on the first move.

Promotes the `episode-queue-starts-fresh` note, which was written earlier on the same branch and
never reached `main`, when the rule covered episodes only.

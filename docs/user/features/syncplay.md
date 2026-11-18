---
pitch: Watch together. Join a SyncPlay group and play, pause and seek in step with people on other Jellyfin apps.
since: 3.3.0
server: 10.7.0
httpsserver: 10.11.0
httpsplugins: JellyRock Companion
highlight: 1
---

# SyncPlay (watch together)

SyncPlay keeps a group of people watching the same video at the same moment. When anyone in the group pauses, seeks or moves to the next item, everyone does. The others can be on JellyRock, the Jellyfin web app or any other Jellyfin app with SyncPlay. JellyRock is the first Roku client for Jellyfin to support SyncPlay.

## What you need

- **SyncPlay access on your Jellyfin account.** An admin sets it for each user in the Jellyfin dashboard. If your account has no SyncPlay access, JellyRock doesn't show the **SyncPlay** icon. To start a group, your account needs permission to create groups as well as join them.
- **On an HTTPS server, the JellyRock Companion plugin, on Jellyfin 10.11 or later.** On an HTTP server you need nothing else. See [Jellyfin server plugins](../jellyfin-server-plugins.md) to install it.

SyncPlay plays videos: movies, episodes and other videos. If you play music or Live TV while you're in a group, it plays on your Roku alone, and you stop following the group.

## Join or start a group

1. Select the **SyncPlay** icon at the top of the screen.
2. Pick a group to join it, or pick **New group** to start one. Keep the suggested name or type your own, then select **OK**.
3. JellyRock tells you it joined. If the group is playing, your Roku plays the same video from the same point.

While you're in a group, the **SyncPlay** icon is highlighted.

## Watch together

- **Play something as you usually would.** While you're in a group, it plays for the whole group.
- **A group mark in the player.** Press **Up** during playback: the **SyncPlay** icon shows next to the clock, lit as it is at the top of the screen while you watch with the group, and dim while you have stepped out of the group's video.
- **Use the remote as usual.** Play, pause, seeking, skipping and next or previous all go to the group, so everyone moves together. Saying "fast-forward" or "rewind" to your Roku jumps the group ahead or back by your [Instant Replay Duration](../app-settings.md#playbackInstantReplaySeconds) instead of scanning, so nobody drifts out of step.
- **People coming and going.** A message tells you when someone joins or leaves the group.
- **Getting back in after a lost connection.** If your Roku loses its connection to the server while you're in a group, JellyRock puts you back in the group once the connection returns, and says "Reconnected to" with the group's name. The others may pause for a moment while your video loads again. If the group ended while you were disconnected, a message says so, and your video keeps playing on your Roku alone.
- **Staying in step.** JellyRock keeps your Roku on the group's clock by itself. If a resume leaves it noticeably ahead or behind, it corrects itself: the picture holds for a moment and starts again in step with the group. If the sound from your TV still lags the other people's devices, raise **SyncPlay Time Offset** until they line up, up to 500 milliseconds.
- **Repeat and shuffle for the whole group.** Press **Up** during playback and open the gear. **Repeat** and **Shuffle** set the group's own modes, so they change what plays next for everyone, and a change someone else makes shows up in the same rows. Under **Repeat one** the video starts again for the whole group when it ends, or when anyone presses next or previous.

So that one person's settings don't move everyone, a few things wait while you're in a group: JellyRock shows the skip button instead of skipping intros by itself, doesn't ask whether you're still watching, doesn't play Cinema Mode intros, and doesn't show its next-episode button. When a video ends, the group's playlist decides what plays next.

## Step out and back in

Press **Back** to leave the video. You stay in the group, but you stop following it, and the group plays on without you. If the group was repeating, your Roku stops repeating with it.

To catch up, select the **SyncPlay** icon and pick **Resume with Group**. Your Roku plays the group's video from where the group is now. Playing the video the group is watching does the same, however you start it, and nobody else's video restarts. If you play a season, a playlist or a collection from the video the group is watching, the videos after it are added up next for the whole group, and a toast says how many. If your Roku is already playing that video with the group, it keeps playing and a toast says you are already watching it with the group, so nothing pauses for anyone. You also follow again when someone in the group starts something new, or when you play a different video yourself: JellyRock asks first, naming the video, and **Play for Everyone** plays it for the whole group in place of what the group is watching, while **Cancel** leaves the group's video alone. A video someone casts to your Roku while you watch with the group plays for the whole group, as if you had picked it.

## Leave a group

Select the **SyncPlay** icon and pick **Leave Group**, or pick **Leave Group** in the player's gear while you watch. Signing out or switching servers leaves the group too.

If you press **Home** on the remote while you're in a group, JellyRock leaves that group the next time it starts, and tells you so.

## The gear while you watch together

While you follow a group, the gear in the player's controls has three more rows under **Repeat**:

- **Shuffle**: **Off** or **On**, for the group's playlist. The server reorders it around the video that is on.
- **SyncPlay Time Offset**: the same setting as in **Settings → Playback**, in steps of 100 milliseconds. Pick a value while you listen, until the sound lines up. A change applies at once: for a higher value the picture jumps ahead, shows **Syncing with the group** and holds for a couple of seconds; for a lower value it holds for a moment. For a value between the steps, type it in **Settings → Playback**. Once you have, a pick within 50 milliseconds of that value waits until the group next resumes.
- **Leave Group**: leaves the group. The video keeps playing on your Roku alone, and if the group was repeating, the repeat turns off.

## Settings

- [SyncPlay Time Offset](../app-settings.md#playbackSyncPlayTimeOffsetMs), in **Settings → Playback**: how many milliseconds ahead of the group your Roku plays, and 0 means no offset. A change made here applies the next time the group resumes. You can also set it from the gear while you watch, as above.

## Troubleshooting

- **There is no SyncPlay icon.** Your account has no SyncPlay access. Ask your server's admin to turn it on.
- **"SyncPlay on an HTTPS server needs the JellyRock plugin installed on that server."** Install the JellyRock Companion plugin on your server, as [Jellyfin server plugins](../jellyfin-server-plugins.md) describes.
- **The SyncPlay icon is dim, and selecting it says "SyncPlay is waiting for the server to reconnect."** Your Roku lost its connection to the server and is getting it back. Wait a moment and select the icon again. If you're already in a group, the icon still opens its menu, so you can leave.
- **"Permission required to create a group."** Your account can join groups but not start them. Join one, or ask your admin for permission to create groups.
- **"That group no longer exists."** The group ended before you joined. Open the **SyncPlay** icon again to see the groups there are now.
- **Your Roku sounds a little behind everyone else, every time.** Your TV or sound system may be adding a delay. Raise **SyncPlay Time Offset** in **Settings → Playback** in small steps (try 100) until the sound lines up.
- **A seek ends a few seconds before where you aimed.** Some Roku devices can only start playing from certain points in a video. When one is in the group, JellyRock moves the whole group back to the nearest point that device can start from, so everyone stays in step.

## Known limits

These are the rough edges we know of, each with the device and date it was measured on.

- **Small differences are left alone.** JellyRock corrects your Roku only when it plays more than 150 milliseconds ahead of the group or 400 milliseconds behind it. Inside that range a correction would be more noticeable than the difference.
- **A seek can leave the picture frozen for several seconds.** Now and then Roku's own media player stops on the old frame after a seek while the sound and the group wait. JellyRock sends the seek again after 10 seconds, and the video then plays. It happened 3 times in about 8,500 group seeks on a Streaming Stick 4K (2026-11-16).
- **A video with a very high bitrate can make the group wait when one Roku catches up.** When your Roku falls behind it jumps ahead to rejoin the group. On a 100 Mbps test video that jump took up to 8 seconds on a Streaming Stick 4K and up to 10 on an Ultra, and the whole group paused until it landed, in about one catch-up in four (2026-11-18). Ordinary videos land in a second or two.
- **A low-end Roku holds the picture a few times at the start of each video.** On a low-end Streaming Stick the picture holds three or four times for under half a second each as a new video starts, while JellyRock learns how that device resumes (2026-11-18). After that it stays in step.
- **Two seeks during one pause can leave a low-end Roku without a picture for about 20 seconds.** When someone seeks twice while the group is paused, a low-end Streaming Stick can end up a few seconds short of the group. When the group resumes, that Roku loads its video again, and the others wait while it does. It happened on 3 of 77 resumes in a test that seeks often (2026-11-18). Other Roku models tested did not do it.
- **A video that fails mid-stream takes a while to recover.** When a stream broke while a group was playing, Roku took 54 seconds to report it on a Streaming Stick 4K (2026-11-16). On Jellyfin 12.1 or later the group plays on without you after 30 seconds, and your Roku rejoins once its video loads again. On an older server the group waits for you.
- **A video can fail to start in a group.** Three times in testing a video stopped loading before its first frame, and JellyRock showed **Error During Playback** about a minute later (2026-11-12 and 2026-11-17, Streaming Stick 4K). We have not found the cause.

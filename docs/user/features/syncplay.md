---
pitch: Watch together. Join a SyncPlay group and play, pause and seek in step with people on other Jellyfin apps.
since: 3.3.0
server: 10.7.0
highlight: 1
---

# SyncPlay (watch together)

SyncPlay keeps a group of people watching the same video at the same moment. When anyone in the group pauses, seeks or moves to the next item, everyone does. The others can be on JellyRock, the Jellyfin web app or any other Jellyfin app with SyncPlay.

## What you need

- **SyncPlay access on your Jellyfin account.** An admin sets it for each user in the Jellyfin dashboard. If your account has no SyncPlay access, JellyRock doesn't show the **SyncPlay** icon. To start a group, your account needs permission to create groups as well as join them.
- **On an HTTPS server, the JellyRock Companion plugin.** On an HTTP server you need nothing else. See [Jellyfin server plugins](../jellyfin-server-plugins.md) to install it.

SyncPlay plays videos: movies, episodes and other videos. If you play music or Live TV while you're in a group, it plays on your Roku alone, and you stop following the group.

## Join or start a group

1. Select the **SyncPlay** icon at the top of the screen.
2. Pick a group to join it, or pick **New group** to start one. A new group is named after you.
3. JellyRock tells you it joined. If the group is playing, your Roku plays the same video from the same point.

While you're in a group, the **SyncPlay** icon is highlighted.

## Watch together

- **Play something as you usually would.** While you're in a group, it plays for the whole group.
- **Use the remote as usual.** Play, pause, seeking, skipping and next or previous all go to the group, so everyone moves together.
- **People coming and going.** A message tells you when someone joins or leaves the group.

So that one person's settings don't move everyone, a few things wait while you're in a group: JellyRock shows the skip button instead of skipping intros by itself, doesn't ask whether you're still watching, doesn't play Cinema Mode intros, and doesn't show its next-episode button. When a video ends, the group's playlist decides what plays next.

## Step out and back in

Press **Back** to leave the video. You stay in the group, but you stop following it, and the group plays on without you.

To catch up, select the **SyncPlay** icon and pick **Resume with Group**. Your Roku plays the group's video from where the group is now. You also follow again when you play a video, which then plays for the whole group, or when someone in the group starts something new.

## Leave a group

Select the **SyncPlay** icon and pick **Leave Group**. Signing out or switching servers leaves the group too.

If you press **Home** on the remote while you're in a group, JellyRock leaves that group the next time it starts, and tells you so.

## Troubleshooting

- **There is no SyncPlay icon.** Your account has no SyncPlay access. Ask your server's admin to turn it on.
- **"SyncPlay on an HTTPS server needs the JellyRock plugin installed on that server."** Install the JellyRock Companion plugin on your server, as [Jellyfin server plugins](../jellyfin-server-plugins.md) describes.
- **"Permission required to create a group."** Your account can join groups but not start them. Join one, or ask your admin for permission to create groups.
- **"That group no longer exists."** The group ended before you joined. Open the **SyncPlay** icon again to see the groups there are now.

---
pitch: Watch live channels from your Jellyfin server, browse the TV guide, and schedule recordings from your couch.
since: 1.0.0
server: 10.7.0
---

# Live TV and recordings

Watch the live channels your Jellyfin server offers, see what's on now and later in the TV guide, and record a program or a whole series. The recordings are saved on your server.

## What you need

- **Live TV set up on your Jellyfin server**, with at least one tuner or channel list. The TV guide shows programs only when the server has guide data for the channels.
- **Live TV access on your Jellyfin account.** An admin sets it for each user in the Jellyfin dashboard.
- **To record, permission to manage Live TV recordings.** Without it, the record buttons are grayed out or missing.

## Browse channels and the TV guide

1. Open your **Live TV** library from Home.
2. Press the options button (**\***) on the remote to switch between **Channels**, a grid of channel logos, and **TV Guide**, a schedule of every channel. JellyRock remembers the view you picked.
3. In either view, the options button also filters the list to your favorite channels.

In the TV guide, move through channels and time with the arrows, and press **OK** on a program to see its details below the guide. From there:

- **View Channel** opens the channel's page.
- **Record** records that program.
- **Record Series** records every airing of the series. It shows only for a program that is part of a series.

Press **Back** to return from the details to the guide.

## Watch a channel

- Press **Play** on the remote to start the channel in focus, in **Channels** or in the **TV Guide**.
- Or select a channel to open its page, and press **Watch**. A program's page has **Watch** while the program is airing, and **Go to Channel** to open its channel's page.

While a channel plays:

- Press **Up** or **Down** to show the player controls. The program airing now and the channel number appear at the top.
- The controls' previous and next buttons change the channel, in channel-number order. Past the last channel you come back around to the first.
- If you pause or go back, **LIVE** in the controls takes you back to the live broadcast. It is grayed out while you're watching live.

The program information updates by itself when one program ends and the next begins.

## Record a program or a series

Press **Record** or **Record Series** on a program's details in the TV guide. A channel's page, and the page of a program that is airing or still to come, has **Record** too: on a channel's page it records the program airing now. JellyRock tells you **Recording scheduled**, and the program shows that it's set to record.

To cancel, open the same program and press **Cancel Recording** or **Cancel Series Recording**. JellyRock tells you **Recording canceled**.

Your server saves each recording. Which library it shows up in depends on how your server's admin set up recordings, and **Search** finds it either way.

## On the Home screen

Home has two Live TV rows when they have something to show:

- **On Now**: programs airing now. Select one to open its page.
- **Active Recordings**: what your server is recording right now.

Both are part of the standard Home arrangement. If you use your web client's arrangement, add or remove them in your Jellyfin home screen settings.

## Settings

- [Home Row Size](../app-settings.md#uiHomeRowLimit): how many items the **On Now** and **Active Recordings** rows load.
- [Use Web Client's Home Section Arrangement](../app-settings.md#uiHomeUseWebArrangement): whether Home follows your web client's row order, which decides whether the Live TV rows show.

## Troubleshooting

- **"No schedule information"** in the guide. Your server has no guide data for that channel at that time. Ask your server's admin to check its guide data.
- **"Schedule unavailable"** in the guide. JellyRock couldn't load the schedule from your server. It tries again by itself.
- **"Failed to schedule recording"** or **"Failed to cancel recording"**. Your server refused the change or couldn't be reached. Check that your account may manage recordings, then try again.
- **"This channel took too long to start."** The channel's source didn't answer in time. Try again, or try the channel in the Jellyfin web app to see whether the source is down.
- **"This channel isn't sending any video."** The channel opened but sent no picture. JellyRock retries a few times before showing this.
- **"This channel's stream stopped."** The channel played for a while, then stopped and didn't come back after a few tries.

For other playback problems, see [Playback troubleshooting](../playback-troubleshooting.md).

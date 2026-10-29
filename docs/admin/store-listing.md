# Roku store listing

The two descriptions the Roku Channel Store shows for JellyRock. Paste each block into the Developer Dashboard when you submit a release: the dashboard changes the listing only with a release, so a change here waits for the next one.

The listing is English only. The dashboard takes a version for each store language, if that changes.

## Change the text

1. Edit the block here in a pull request, and paste it into the dashboard with the release that ships it.
2. Write for someone browsing the store on a TV. Say what JellyRock does for them, in plain words, and make every claim true of the release the text ships with.
3. Run `npm run lint:docs`. It fails when a block is over its limit, and when a count it cites no longer matches the app: the number of languages, the number of themes or the oldest Jellyfin server supported.

The check counts each line break as two characters, in case the dashboard counts it that way.

## On-device description

Shown on the app's page in the store on a Roku, at most 300 characters. The page shows only the first four lines or so in a box, and the viewer presses a button to read the rest, so the first two sentences carry what JellyRock is and why it is fast.

```text store-on-device
A fast, smooth Jellyfin client for Roku, from a former maintainer of the original app. Loading runs in the background, so menus keep moving. Direct Play in original quality, surround and Dolby Vision kept, SyncPlay, Live TV. 98 languages. Free, open source, no ads. Needs a Jellyfin server.
```

## Online description

Shown on the app's page at channelstore.roku.com, at most 1,500 characters.

```text store-online
JellyRock is a Jellyfin client for Roku, from a former maintainer of the original Jellyfin Roku app. Stream your movies, shows, music, photos and live TV from your personal Jellyfin server.

Fast because it's built right
A Roku app lags when it loads data on the thread that draws the screen. JellyRock follows Roku's threading rules: every request to your server runs on background workers sized to your Roku model, so menus keep moving while data loads, and Back cancels a slow load. Tuned for low-memory models and tested on real Rokus.

Playback
• Direct Play in original quality when your Roku supports the file.
• Surround stays surround: converted audio goes to Dolby Digital, not stereo.
• Dolby Vision MKVs, which Roku can't play as is, repackaged with no re-encoding.
• Scrub thumbnails, and intro and outro skipping.
• Chapters and track switching on one playback screen.

Watch together
Join a SyncPlay group and play, pause and seek in step with friends on other Jellyfin apps.

Also included
Live TV with a guide and DVR, Quick Connect sign-in, Roku voice search, casting from Jellyfin's apps, subtitle downloads, Favorites, nine themes or your own colors, and 98 languages. On HTTPS servers, casting and SyncPlay need our free server plugin.

Free and open source. No ads, no tracking, no subscriptions. Needs Jellyfin 10.7 or later, which JellyRock finds on your network.

https://jellyrock.app
https://github.com/jellyrock/jellyrock
```

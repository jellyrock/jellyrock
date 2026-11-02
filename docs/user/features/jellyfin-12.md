---
pitch: Works with Jellyfin 12 and uses what's new in it, from collections and language filters to episode versions.
since: 2.30.0
server: 12.0.0
---

# Jellyfin 12

JellyRock works with Jellyfin 12, and everything it does on older servers works on 12 too. JellyRock follows the API changes Jellyfin 12 made, and it also uses the features below, which only Jellyfin 12 offers.

## What you need

Jellyfin 12.0 or later. On an older server, JellyRock doesn't offer these features, so you won't see them there. [Jellyfin server feature matrix](../jellyfin-server-feature-matrix.md) says what each version supports.

## A version of an episode

When an episode has more than one file, Jellyfin 12 shows it as one episode with several versions, as it does for a movie. Pick the one to play from the **Video** menu on the episode's page. Each version is labeled by what differs, such as its resolution.

On older servers, each file is listed as its own episode.

## Resume the version you were watching

Each version of a movie or episode keeps its own resume point. When you open the item, its page selects the version you were partway through, marked **In progress** in the **Video** menu, and **Resume** continues it. A poster's progress bar shows the version you played last.

## Play the original audio

In the Jellyfin web app, set **Preferred audio language** to **Original language**. JellyRock then plays each item's audio track in the language it was made in, instead of a dub. An episode with no language of its own uses its series' language.

This follows your Jellyfin setting while [Audio Language Preference](../app-settings.md#playbackAudioLanguagePreference) in JellyRock is **Use Web Client Setting**, the default.

## The collections an item is in

On a movie, show or episode's page, the **Collections** row lists the collections it is in, so you can open one from there. Only collections the item was added to directly are listed: an episode shows its own collections, not its series'.

## A library's collections

In a movie or TV library, open **Options** and pick **Collections** in the **View** menu to list the collections in that library.

## Filter by audio or subtitle language

In a movie library, open **Options**. The **Filter** menu has **Audio Language** and **Subtitle Language**, which list the languages that library has. Pick one to show only the movies that have it.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| None of these features show | Your server is older than 12.0. |
| No **Collections** row on an item | The item isn't in a collection, or only its series is. |
| The original language doesn't play | JellyRock's **Audio Language Preference** is set to **Use Roku Language** or a custom language, your server doesn't know the item's original language, or the item has no track in it. |

# Manage subtitles

The **Manage Subtitles** button on a movie or episode searches your Jellyfin server's subtitle providers and downloads a subtitle onto the item. You stay on the details screen.

It needs a subtitle provider plugin on your server. [Jellyfin server plugins](jellyfin-server-plugins.md) lists the ones JellyRock is tested with and how to install them.

## What you need

You need a subtitle provider plugin on the server, signed in to its provider account.

JellyRock is tested with **Open Subtitles**. Any Jellyfin subtitle provider should work. JellyRock never talks to a provider itself: it asks your server, which searches every installed provider and merges the results.

If no subtitle provider plugin is installed, JellyRock hides the **Manage Subtitles** button. Your server reports which plugins it has, so JellyRock doesn't offer a search that can never find anything. JellyRock checks this each time you sign in. If you install a provider while JellyRock is open, sign out and back in, or restart the app, to see the button.

A provider plugin that is installed but never signed in still shows the button. The server can't tell JellyRock whether a plugin has an account, and that plugin returns no results for anyone. See [Why "no subtitles found" can mean several things](#why-no-subtitles-found-can-mean-several-things) for why this is hard to tell apart from a search with no matches.

## Who can use it

Jellyfin's subtitle permissions are not obvious, so JellyRock does not follow the permission checkbox alone.

On Jellyfin 10.7 and 10.8, any signed-in user can search and download. The `Enable subtitle management` permission does not exist on those versions.

On Jellyfin 10.9 and later (checked on Jellyfin 10.11.11):

| Account | `Enable subtitle management` | Search and download | Delete |
| --- | --- | --- | --- |
| Administrator | Off (the default) | ✅ | ✅ |
| Administrator | On | ✅ | ✅ |
| Regular user | Off (the default) | ❌ | ❌ |
| Regular user | On | ✅ | ❌ |

Two things to know:

- `Enable subtitle management` is off by default for every account, administrators included. Jellyfin lets administrators through anyway. If you are an administrator and have never changed the checkbox, subtitle search still works for you. An app that relied on the checkbox alone would hide the feature on most home servers.
- Deleting a subtitle always needs an administrator account, on every supported server version. It is a separate, stricter check than searching. Turning on `Enable subtitle management` for a regular user lets them search and download, but not delete.

If you can't delete a subtitle, its row has no delete option.

## What it works on

Subtitle search is offered for movies and episodes only. Jellyfin's search has no useful answer for a collection, a series or an album, so the button doesn't show for them.

Jellyfin also searches single video files only. For a disc rip stored as an ISO image or a DVD or Blu-ray folder, the server finds nothing on every version, whatever providers are installed.

## Why "no subtitles found" can mean several things

Jellyfin's subtitle search returns an empty result, reported as a success, in all of these cases:

- A provider is installed but not signed in.
- The provider account details are wrong.
- The provider has no subtitles for this release.
- The item is a disc rip (an ISO image or a DVD or Blu-ray folder), not a single video file.

A server with no provider plugin never gets this far, because the button is hidden.

The server does not tell these cases apart, so JellyRock can't either. The message says no subtitles were found and suggests checking your provider setup. That is all the server's answer reveals.

If a search finds nothing for a well-known film, check the provider setup first.

## Downloads report success even when they fail

Jellyfin's download returns the same "accepted" answer when the download worked, when it failed, and when the provider's daily download limit stopped it. So JellyRock doesn't trust that answer. After a download, it checks the item again and waits for the subtitle to appear. Only then does it tell you the subtitle was added.

A download ends in one of three ways:

- **Added:** the subtitle is on the item.
- **Still processing:** the server accepted the download, but the file did not appear within about 15 seconds. It may still arrive. Wait a moment, then press **Refresh** on the details screen to reload the item's subtitles.
- **Couldn't add:** the server rejected the request.

Most free provider accounts have a daily download limit. Reaching it looks like a download that never arrives.

## Choosing a language

The language list comes from your server. JellyRock sends the regional language code, not a generic three-letter one. So Traditional and Simplified Chinese, or Brazilian and European Portuguese, are searched as separate languages.

The panel starts on your Jellyfin subtitle language preference.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| No **Manage Subtitles** button on a movie or episode | No subtitle provider plugin is installed on the server. Or, on 10.9 and later, you are a regular user without `Enable subtitle management`. |
| No **Manage Subtitles** button on a series, collection or album | This is expected. Search covers movies and episodes only. |
| Subtitle search always finds nothing | The provider plugin is not signed in, or its account details are wrong. |
| Subtitle search finds nothing for one item only | The item is a disc rip (an ISO image or a DVD or Blu-ray folder), or the provider has nothing for it. |
| Subtitle downloads never appear | The provider's daily download limit was reached. |
| No delete option on a downloaded subtitle | Deleting needs an administrator account. |

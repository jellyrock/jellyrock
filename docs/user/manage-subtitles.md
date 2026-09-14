# Manage Subtitles

The **Manage Subtitles** button on a movie or episode searches your Jellyfin
server's subtitle providers and downloads a subtitle onto the item, without
leaving the detail screen.

It needs a subtitle provider plugin on your server — see
[Jellyfin Server Plugins](jellyfin-server-plugins.md) for the ones JellyRock is
tested with and how to install them.

## What you need

A subtitle provider plugin installed on the server **and given credentials**.

JellyRock is tested with **Open Subtitles**. Any Jellyfin subtitle provider
should work: JellyRock never talks to a provider directly — it asks your server,
and the server searches every installed provider together and merges the
results.

**If no subtitle provider plugin is installed, JellyRock hides the Manage
Subtitles button** — the server reports which plugins it has, so the app does
not offer a search that can never find anything. JellyRock checks this once each
time you sign in. If you install a provider while JellyRock is open, sign out and
back in (or restart the app) to see the button.

A provider plugin that is installed but never signed in *does* show the button,
because the server cannot tell JellyRock whether a plugin has credentials — and
it returns results for nobody. See the warning below about why that is hard to
tell apart from "there genuinely are no subtitles".

## Who can use it

Subtitle permissions in Jellyfin are not obvious, and JellyRock deliberately does
not simply mirror the permission checkbox.

**On Jellyfin 10.7 and 10.8**, any signed-in user can search and download — the
`Enable subtitle management` permission does not exist on those versions.

**On Jellyfin 10.9 and newer** (measured against a live 10.11.11 server):

| Account | `Enable subtitle management` | Search & download | Delete |
| --- | --- | --- | --- |
| Administrator | not ticked (**the default**) | ✅ | ✅ |
| Administrator | ticked | ✅ | ✅ |
| Regular user | not ticked (**the default**) | ❌ | ❌ |
| Regular user | ticked | ✅ | ❌ |

Two things worth knowing:

- **`Enable subtitle management` is off by default for every account, including
  administrators** — but administrators are allowed through regardless, because
  Jellyfin's permission check short-circuits for admins. So if you are an admin
  and have never touched that checkbox, subtitle search still works for you. (An
  app that gated purely on the checkbox would hide the feature from most
  self-hosted installs.)
- **Deleting a subtitle always requires an administrator account**, on every
  supported server version. It is a separate, stricter check than searching —
  granting a regular user `Enable subtitle management` lets them search and
  download, but not delete.

If you cannot delete, the delete affordance simply does not appear on the row.

## What it works on

Subtitle search is offered for **movies and episodes only**. Jellyfin's search
endpoint has no meaningful answer for a collection, a series or an album, so the
button is not shown for them.

Jellyfin also only searches **single video files**. For a disc rip stored as an
ISO image or a DVD / Blu-ray folder, the server returns no results on every
version, whatever providers are installed.

## ⚠️ Why "no subtitles found" can mean several different things

Jellyfin's subtitle search returns an **empty list**, with a success status, for
all of these (a server with no provider plugin at all does not get this far — the
button is hidden):

- a provider is installed but has no credentials
- the credentials are wrong
- the provider genuinely has no subtitles for this release
- the item is a disc rip (ISO image or DVD / Blu-ray folder) rather than a single
  video file

The server does not distinguish them, so **JellyRock cannot either** — the
message you see says no subtitles were found and suggests checking your provider
setup, because that is the honest limit of what is knowable from the response.

If searching returns nothing for a well-known film, suspect the provider
configuration before you suspect the film.

## ⚠️ Downloads report success even when they fail

Jellyfin's download endpoint returns the same "accepted" response whether the
download succeeded, failed, or was rejected because the provider's **daily
download limit** was reached. JellyRock therefore does not trust that response:
after asking for a download it re-checks the item and looks for the subtitle to
actually appear, and only then tells you it was added.

That is why a download reports one of three outcomes:

- **Added** — the subtitle is confirmed present on the item.
- **Still processing** — the server accepted it but the file had not appeared
  within about 15 seconds. It may still arrive: wait a moment, then press
  **Refresh** on the detail screen to reload the item's subtitles.
- **Couldn't add** — the request itself was rejected.

Most free provider accounts have a daily download cap. Hitting it looks like a
download that never arrives.

## Choosing a language

The language list comes from your server, and JellyRock sends the regional code
rather than a generic three-letter one — so Traditional and Simplified Chinese,
or Brazilian and European Portuguese, search as the distinct languages they are
rather than collapsing together.

The language the panel starts on comes from your Jellyfin subtitle language
preference.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| No **Manage Subtitles** button on a movie or episode | No subtitle provider plugin installed on the server; or, on 10.9+, a regular user without `Enable subtitle management` |
| No **Manage Subtitles** button on a series, collection or album | Expected — search supports movies and episodes only |
| Subtitle search always returns nothing | Provider plugin has no, or invalid, credentials |
| Subtitle search returns nothing for one item only | The item is a disc rip (ISO image or DVD / Blu-ray folder), or the provider has nothing for it |
| Subtitle downloads never appear | Provider daily download limit reached |
| No delete affordance on a downloaded subtitle | Deleting requires an administrator account |

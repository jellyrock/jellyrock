# Jellyfin Server Plugins & Server-Side Setup

Some JellyRock features do nothing until something is set up **on your Jellyfin
server**, not on your Roku. If a button is missing, or a search comes back empty
no matter what you type, this page is where to look first.

This is a companion to the
[Jellyfin Server Feature Matrix](jellyfin-server-feature-matrix.md), which covers
what each **server version** supports. This page covers what each feature needs
**configured** once you are on a new enough version.

> **Installing plugins** is a Jellyfin operation, not a JellyRock one, and the
> steps change between server releases. Follow the
> [official Jellyfin plugin documentation](https://jellyfin.org/docs/general/server/plugins/)
> for your version. What is documented below is what JellyRock *needs* from the
> server, and how to tell from inside the app whether it is working.

## Quick reference

| JellyRock feature | Needs on the server | Minimum server |
| --- | --- | --- |
| Manage Subtitles (search & download) | A **subtitle provider plugin**, with credentials | Any supported version |
| Delete a downloaded subtitle | An **administrator** account | Any supported version |
| Skip intro / outro | A **media segment provider plugin** | 10.10.0 |
| Cast to JellyRock over **HTTPS** | The **`jellyfin-plugin-jellyrock`** companion plugin | Any supported version |
| Song lyrics | Nothing — lyrics your library already has | 10.9.0 |
| Trickplay scrubbing thumbnails | Nothing — server-side trickplay generation | 10.9.0 |
| Quick Connect | Nothing | Any supported version |

---

## Subtitle providers

Powers the **Manage Subtitles** button on a movie or episode: searching your
server's subtitle providers and downloading a subtitle onto the item without
leaving the detail screen.

### What you need

A subtitle provider plugin installed on the server **and given credentials**.
Open Subtitles is the common choice. A provider plugin that is installed but
never signed in returns results for nobody — see the warning below about why
that is hard to tell apart from "there genuinely are no subtitles".

### Who can use it

Subtitle permissions in Jellyfin are not obvious, and JellyRock deliberately does
not simply mirror the permission checkbox. Measured against a live 10.11.11
server:

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

### Only movies and episodes

Subtitle search is offered for **movies and episodes only**. Jellyfin's search
endpoint has no meaningful answer for a collection, a series or an album, so the
button is not shown for them.

### ⚠️ Why "no subtitles found" can mean several different things

Jellyfin's subtitle search returns an **empty list**, with a success status, for
all of these:

- no subtitle provider plugin is installed
- a provider is installed but has no credentials
- the credentials are wrong
- the provider genuinely has no subtitles for this release

The server does not distinguish them, so **JellyRock cannot either** — the
message you see says no subtitles were found and suggests checking your provider
setup, because that is the honest limit of what is knowable from the response.

If searching returns nothing for a well-known film, suspect the provider
configuration before you suspect the film.

### ⚠️ Downloads report success even when they fail

Jellyfin's download endpoint returns the same "accepted" response whether the
download succeeded, failed, or was rejected because the provider's **daily
download limit** was reached. JellyRock therefore does not trust that response:
after asking for a download it re-checks the item and looks for the subtitle to
actually appear, and only then tells you it was added.

That is why a download reports one of three outcomes:

- **Added** — the subtitle is confirmed present on the item.
- **Still processing** — the server accepted it but the file had not appeared
  within about 15 seconds. It may still arrive; reopen the panel to check.
- **Couldn't add** — the request itself was rejected.

Most free provider accounts have a daily download cap. Hitting it looks like a
download that never arrives.

### Choosing a language

The language list comes from your server, and JellyRock sends the regional code
rather than a generic three-letter one — so Traditional and Simplified Chinese,
or Brazilian and European Portuguese, search as the distinct languages they are
rather than collapsing together.

The language the panel starts on comes from your Jellyfin subtitle language
preference.

---

## Media segment providers — skip intro / outro

The skip button during playback needs the server to have **detected** segments
first. Jellyfin 10.10.0+ provides the API, but the detection itself comes from a
segment provider plugin (intro/outro detection).

Per-segment-type behavior (auto-skip, show a skip button, do nothing) is
configured in the Jellyfin web client, and can be overridden per device in
JellyRock under **Settings → Playback → Media Segments**.

See [App Settings](app-settings.md) for the options JellyRock itself provides.

---

## Cast to JellyRock over HTTPS

Casting from the Jellyfin web client to your Roku works over a plain `http`
server with no plugin. **Over `https` it needs the `jellyfin-plugin-jellyrock`
companion plugin**, and this is a Roku platform limitation rather than a
JellyRock choice: Roku provides no TLS socket support, so JellyRock cannot hold
the secure `wss://` connection Jellyfin normally pushes cast commands over. The
plugin queues those commands instead, and JellyRock fetches them over HTTPS.

Without the plugin on an `https` server, JellyRock does not advertise itself as
a cast target at all, rather than appearing and then failing to respond.

---

## Features that need no plugin

These depend only on your **server version** — see the
[Feature Matrix](jellyfin-server-feature-matrix.md) for the details:

- **Trickplay thumbnails** while scrubbing (10.9.0+) — generated by the server
  for your libraries.
- **Song lyrics** (10.9.0+) — shown for tracks whose lyrics your library already
  holds.
- **Quick Connect** — works on every supported version; JellyRock hides the
  button only when the server explicitly reports the feature disabled.

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| No **Manage Subtitles** button on a movie or episode | Regular user without `Enable subtitle management` |
| No **Manage Subtitles** button on a series, collection or album | Expected — search supports movies and episodes only |
| Subtitle search always returns nothing | No provider plugin, or no/invalid provider credentials |
| Subtitle downloads never appear | Provider daily download limit reached |
| No delete affordance on a downloaded subtitle | Deleting requires an administrator account |
| No skip-intro button | Server has no segment provider, or segments not yet detected |
| Roku not offered as a cast target on an `https` server | `jellyfin-plugin-jellyrock` not installed |

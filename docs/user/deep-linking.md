# Deep linking & casting to JellyRock

Open or play anything on your JellyRock from somewhere else — a browser bookmark, a
shell script, a Home Assistant automation, a phone shortcut, a voice routine. You send
your Roku one short command and JellyRock jumps straight to the item, or starts playing
it, without you touching the remote.

Unlike some Roku clients, **you only need the item's ID.** You don't have to tell
JellyRock whether it's a movie, an album, a show, or a folder — it looks that up from your
server and does the right thing. Just the ID (and, optionally, _what_ to do with it).

> This works over your **local network** using Roku's built-in External Control Protocol
> (ECP). Your Roku and the device sending the command need to be on the same network.

---

## The 10-second version

Open an item on a JellyRock that's already running:

```bash
curl -d '' "http://<roku-ip>:8060/input?contentId=<itemId>"
```

Want it to start _playing_ instead of just opening? Add an action:

```bash
curl -d '' "http://<roku-ip>:8060/input?contentId=<itemId>|action%3Dplay"
```

That's the whole idea. The rest of this guide is: finding those two pieces, the other
things you can do besides "play," casting to a specific server, and ready-made automation
recipes.

---

## What you can do (actions)

The `action` says what to do with the item. Leave it off and it defaults to `open`.

| Action | What it does | Works well on |
|---|---|---|
| `open` _(default)_ | Jump to the item's page. A library, folder, genre, or collection opens **into its grid** instead. | Anything |
| `play` | Start playing. A movie/episode **resumes where you left off**; a show **smart-resumes its next-up episode**; an album, playlist, or season plays in order. | Movie, Episode, Series, Season, Album, Playlist, Audio, live channel, Photo |
| `shuffle` | Shuffle-play — the same as pressing **Shuffle** in the app. | Album, Playlist, Artist, library |
| `trailer` | Play the item's trailer. | Movie, Series |
| `instantmix` | Start an **Instant Mix** seeded from the item. | Song, Album, Artist |

Picked an action JellyRock doesn't recognize? It safely falls back to `open` — so a command
written for a newer version never breaks an older one.

---

## What you need

### 1. Your Roku's IP address

On the Roku: **Settings → Network → About** (or find it in your router's device list). It
looks like `192.168.1.50`. Everywhere below, `<roku-ip>` means this.

### 2. The item's ID

Open the item in the **Jellyfin web app** in a browser. The address bar will read
something like:

```text
https://your-server/web/#/details?id=4f9c...&serverId=de50...
```

Copy the value after `id=` — that's your `<itemId>`. (The `serverId` next to it is only
needed if you're casting to a _different_ server — see
[Casting to a specific server](#casting-to-a-specific-server).)

### 3. (Cold start only) JellyRock's channel ID

JellyRock's Roku channel ID is **`819325`**. You only need it for the `/launch` form below —
the one that starts JellyRock when it isn't already open. (You can list the channels
installed on a Roku any time with `curl "http://<roku-ip>:8060/query/apps"`.)

---

## Two ways to send a deep link

| Form | Use it when |
|---|---|
| `.../input?contentId=...` | JellyRock is **already open** on the Roku |
| `.../launch/819325?contentId=...` | JellyRock might be **closed** — this starts it, then opens the item |

Both take the exact same `contentId`. If you're scripting something that should "just work"
no matter what's on screen, prefer `/launch`.

### A note on URL formatting

A bare item ID is a clean URL — nothing to encode:

```bash
curl -d '' "http://<roku-ip>:8060/input?contentId=<itemId>"
```

The **one** character you must encode is the `=` inside `action=...` (or `serverId=...`): write
it `%3D`. Roku's ECP returns **404** and does nothing for a literal `=` in the query, so
`action=play` is sent as `action%3Dplay`. Everything else stays readable — the `|` separators
are fine as-is, and you can drop the `id=` prefix (a leading bare value is taken as the ID):

```bash
curl -d '' "http://<roku-ip>:8060/input?contentId=<itemId>|action%3Dplay"
```

_(The `-d ''` makes `curl` send a `POST`, which ECP requires — a `GET` returns 404.)_

---

## Casting to a specific server

JellyRock supports more than one server, and a deep link can target one of them by adding
`serverId` — the Jellyfin **server ID** (a GUID, the `serverId=` value from the web URL),
**not** a server URL.

```bash
curl -d '' "http://<roku-ip>:8060/input?contentId=<itemId>|serverId%3D<serverGuid>|action%3Dplay&itemName=The%20Matrix"
```

- The server must be one you've **already added to this device** — JellyRock won't connect
  to a server it doesn't know.
- If JellyRock is **already running** and signed into a _different_ server, it shows a
  confirmation on the TV — _"Play 'The Matrix' on '\<server\>'? You'll switch servers…"_ —
  does a quick reachability check (so an offline server can't strand you), then switches and
  plays. The optional `itemName` is only there to put the title in that prompt.
- On a **cold start**, there's no session to interrupt, so it just signs you into the
  target server and opens the item — no prompt.
- A `serverId` for a server you _haven't_ added shows a toast and does nothing else.

Omit `serverId` entirely (the common case) and JellyRock uses whatever server you're
currently signed into.

---

## If you're signed out

A deep link that arrives while you're signed out isn't lost. JellyRock **remembers it**,
shows _"Sign in to open your content."_, and opens it automatically the moment you finish
signing in.

---

## What you'll see on the TV

| You sent... | The TV shows... |
|---|---|
| Any deep link | A brief spinner while JellyRock looks the item up |
| `play` / `shuffle` / `trailer` / `instantmix` | _"Playing \<title\>"_ when playback actually starts |
| An ID that doesn't exist (or can't be reached) | _"This content isn't available."_ — and **nothing else changes** |
| A confirmed server switch | _"Switching to '\<server\>'…"_ |
| A link while signed out | _"Sign in to open your content."_ |
| A dismissed server-switch prompt | _"Cast canceled."_ |

Crucially, an unknown or junk ID **never disturbs what you're already watching** — JellyRock
checks the ID _before_ it navigates anywhere, so a bad command is just a toast.

---

## Recipes

All of these are the same command in different clothes — point any tool that can send an
HTTP POST at the ECP URL.

**A shell script** — play an item, with the item ID as an argument:

```bash
#!/usr/bin/env bash
# play.sh <itemId>
ROKU_IP="192.168.1.50"
curl -d '' "http://${ROKU_IP}:8060/input?contentId=${1}|action%3Dplay"
```

**A browser bookmark** — bookmark this URL (filled in) to open an item with one click from
your computer:

```text
http://192.168.1.50:8060/input?contentId=<itemId>|action%3Dplay
```

**Home Assistant** — a starting-point `rest_command` you can call from an automation or a
dashboard button (adjust to your setup):

```yaml
rest_command:
  jellyrock_play:
    url: "http://192.168.1.50:8060/input?contentId={{ item_id }}|action%3Dplay"
    method: POST
```

**Phone shortcuts** (iOS Shortcuts, Tasker, etc.) — any "send an HTTP POST request" action
pointed at the same URL works the same way.

---

## When it doesn't work

| Symptom | Likely cause / fix |
|---|---|
| Nothing happens at all | JellyRock wasn't running — use the `/launch/819325` form instead of `/input`. Also double-check the Roku IP and that both devices are on the same network. |
| _"This content isn't available."_ | The ID is wrong, belongs to a _different_ server (add `serverId`), or the item was deleted. |
| It asks to switch servers when you didn't expect it | Your `serverId` points at a different server than the one you're signed into — drop `serverId` to use the current one. |
| A toast about a server you haven't added | Add that server in JellyRock first, then retry. |
| It opens but doesn't play | You sent `open` (the default). Add `\|action%3Dplay` to the `contentId`. |
| `/launch` opens the app but not the item | Check that the `=` in `action=...` is encoded as `%3D` — ECP returns 404 (and does nothing) for a literal `=` in the query. The item ID and `\|` separators stay as-is. |

To verify playback from a script, ask the Roku what it's doing:

```bash
curl "http://<roku-ip>:8060/query/media-player"
```

---

## Safety & privacy

- **Local network only.** ECP isn't exposed to the internet; only devices on your network
  can send these commands.
- **A bad command can't hurt anything.** JellyRock validates every ID before acting, so a
  random or malformed command shows a harmless toast and leaves your current session
  untouched.
- **Nothing is published.** JellyRock is a self-hosted client — it doesn't advertise your
  library to Roku's search or anywhere else. Deep links are something _you_ send, not a
  catalog you expose.

---

## Full reference

This guide covers the everyday cases. For the complete parameter contract, the exact
parsing rules, the security model, and how it all works under the hood, see the
[developer reference](../dev/deep-linking.md).

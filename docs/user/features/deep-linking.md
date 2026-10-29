# Deep linking and casting to JellyRock

You can open or play anything in JellyRock from another device: a browser bookmark, a shell script, a Home Assistant automation, a phone shortcut or a voice routine. You send your Roku one short command, and JellyRock goes to the item or starts playing it. You don't touch the remote.

You only need the item's ID. Some Roku clients also make you say whether the item is a movie, an album, a show or a folder. JellyRock looks that up on your server. You send the ID and, if you like, what to do with it.

> This works on your local network, through Roku's built-in External Control Protocol (ECP). Your Roku and the device sending the command must be on the same network.

## Quick start

To open an item in a JellyRock that is already running:

```bash
curl -d '' "http://<roku-ip>:8060/input?contentId=<itemId>"
```

To start playing it instead, add an action:

```bash
curl -d '' "http://<roku-ip>:8060/input?contentId=<itemId>|action%3Dplay"
```

The rest of this guide covers how to find those two values, the other actions, casting to a specific server, and ready-made recipes.

## Actions

The `action` says what to do with the item. Without one, JellyRock uses `open`.

| Action | What it does | Works well on |
| --- | --- | --- |
| `open` _(default)_ | Goes to the item's page. A library, folder, genre or collection opens into its grid instead. | Anything |
| `play` | Starts playing. A movie or episode resumes where you left off. A show resumes its next-up episode. An album, playlist or season plays in order. | Movie, Episode, Series, Season, Album, Playlist, Audio, live channel, Photo |
| `shuffle` | Shuffle-plays, the same as pressing **Shuffle** in the app. | Album, Playlist, Artist, library |
| `trailer` | Plays the item's trailer. | Movie, Series |
| `instantmix` | Starts an **Instant Mix** based on the item. | Song, Album, Artist |

If JellyRock doesn't recognize the action, it uses `open`. A command written for a newer version never breaks an older one.

## What you need

### 1. Your Roku's IP address

On the Roku, go to **Settings → Network → About**, or find it in your router's device list. It looks like `192.168.1.50`. In this guide, `<roku-ip>` means this address.

### 2. The item's ID

Open the item in the Jellyfin web app in a browser. The address bar reads something like:

```text
https://your-server/web/#/details?id=4f9c...&serverId=de50...
```

Copy the value after `id=`. That is your `<itemId>`. You need the `serverId` next to it only to cast to a different server (see [Casting to a specific server](#casting-to-a-specific-server)).

### 3. JellyRock's channel ID, to start it from closed

JellyRock's Roku channel ID is `819325`. You need it only for the `/launch` form below, which starts JellyRock when it isn't open. To list the channels installed on a Roku, run `curl "http://<roku-ip>:8060/query/apps"`.

## Two ways to send a deep link

| Form | Use it when |
| --- | --- |
| `.../input?contentId=...` | JellyRock is already open on the Roku. |
| `.../launch/819325?contentId=...` | JellyRock might be closed. This starts it, then opens the item. |

Both take the same `contentId`. For a script that should work whatever is on screen, use `/launch`.

### Formatting the URL

A bare item ID needs no encoding:

```bash
curl -d '' "http://<roku-ip>:8060/input?contentId=<itemId>"
```

Encode one character: the `=` inside `action=...` or `serverId=...`. Write it as `%3D`, so `action=play` becomes `action%3Dplay`. Roku's ECP returns 404 and does nothing when the query holds a literal `=`.

Everything else stays readable. The `|` separators work as they are. You can leave off the `id=` prefix, because a bare value at the start is taken as the ID:

```bash
curl -d '' "http://<roku-ip>:8060/input?contentId=<itemId>|action%3Dplay"
```

The `-d ''` makes `curl` send a `POST`, which ECP requires. A `GET` returns 404.

## Casting to a specific server

JellyRock supports more than one server. A deep link can target one of them with `serverId`. This is the Jellyfin server ID (a GUID, the `serverId=` value from the web URL), not a server URL.

```bash
curl -d '' "http://<roku-ip>:8060/input?contentId=<itemId>|serverId%3D<serverGuid>|action%3Dplay&itemName=The%20Matrix"
```

- The server must already be added on this Roku. JellyRock won't connect to a server it doesn't know.
- If JellyRock is running and signed in to a different server, the TV asks you to confirm: _"Play 'The Matrix' on '\<server\>'? You'll switch servers…"_. JellyRock then checks that the server is reachable, so an offline server can't strand you. Then it switches and plays. The optional `itemName` only puts the title in that prompt.
- If JellyRock starts from closed, there is no session to interrupt. It signs you in to the target server and opens the item, with no prompt.
- A `serverId` for a server you haven't added shows a message and does nothing else.

Leave out `serverId`, as most links do, and JellyRock uses the server you're signed in to.

## If you're signed out

A deep link that arrives while you're signed out isn't lost. JellyRock remembers it, shows _"Sign in to open your content."_, and opens it as soon as you sign in.

## What you see on the TV

| You sent | The TV shows |
| --- | --- |
| Any deep link | A short spinner while JellyRock looks up the item |
| `play`, `shuffle`, `trailer` or `instantmix` | _"Playing \<title\>"_ when playback starts |
| An ID that doesn't exist or can't be reached | _"This content isn't available."_, and nothing else changes |
| A confirmed server switch | _"Switching to '\<server\>'…"_ |
| A link while signed out | _"Sign in to open your content."_ |
| A dismissed server-switch prompt | _"Cast canceled."_ |

An unknown or junk ID never interrupts what you're watching. JellyRock checks the ID before it goes anywhere, so a bad command only shows a message.

## Recipes

Each recipe sends the same command. Any tool that can send an HTTP POST to the ECP URL works.

**Shell script.** Play an item, with the item ID as an argument:

```bash
#!/usr/bin/env bash
# play.sh <itemId>
ROKU_IP="192.168.1.50"
curl -d '' "http://${ROKU_IP}:8060/input?contentId=${1}|action%3Dplay"
```

**Browser bookmark.** Bookmark this URL, filled in, to play an item with one click from your computer:

```text
http://192.168.1.50:8060/input?contentId=<itemId>|action%3Dplay
```

**Home Assistant.** A starting `rest_command` to call from an automation or a dashboard button. Adjust it to your setup:

```yaml
rest_command:
  jellyrock_play:
    url: "http://192.168.1.50:8060/input?contentId={{ item_id }}|action%3Dplay"
    method: POST
```

**Phone shortcuts.** In iOS Shortcuts, Tasker or similar apps, any "send an HTTP POST request" action pointed at the same URL works.

## When it doesn't work

| Symptom | Likely cause and fix |
| --- | --- |
| Nothing happens | JellyRock wasn't running. Use the `/launch/819325` form instead of `/input`. Also check the Roku IP, and that both devices are on the same network. |
| _"This content isn't available."_ | The ID is wrong, belongs to a different server (add `serverId`), or the item was deleted. |
| It asks to switch servers when you didn't expect it | Your `serverId` points at a different server than the one you're signed in to. Remove `serverId` to use the current one. |
| A message about a server you haven't added | Add that server in JellyRock first, then try again. |
| It opens but doesn't play | You sent `open`, the default. Add `\|action%3Dplay` to the `contentId`. |
| `/launch` opens the app but not the item | Check that the `=` in `action=...` is encoded as `%3D`. ECP returns 404 and does nothing when the query holds a literal `=`. The item ID and the `\|` separators stay as they are. |

To check playback from a script, ask the Roku what it's playing:

```bash
curl "http://<roku-ip>:8060/query/media-player"
```

## Safety and privacy

- **Local network only.** ECP isn't exposed to the internet. Only devices on your network can send these commands.
- **A bad command can't hurt anything.** JellyRock checks every ID before it acts. A random or malformed command shows a harmless message and leaves your current session alone.
- **Nothing is published.** JellyRock is a client for your own server. It doesn't list your library in Roku's search or anywhere else. A deep link is something you send, not a catalog you expose.

## Full reference

This guide covers everyday use. For the full parameter list, the parsing rules, the security model and how it works inside the app, see the [developer reference](../dev/deep-linking.md).

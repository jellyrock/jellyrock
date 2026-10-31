---
pitch: Find Jellyfin servers on your network or type an address, and switch between the ones you've saved.
since: 1.0.0
server: 10.7.0
---

# Connect to your servers

JellyRock looks for Jellyfin servers on your network, so you can usually pick yours without typing. It remembers each server you connect to, so you can move between them.

## What you need

A Jellyfin server running 10.7 or later. Some features need a newer one: see the [Jellyfin server feature matrix](../jellyfin-server-feature-matrix.md).

## Connect to a server

On **Connect to Server**:

1. Pick a server from the list. It shows the servers JellyRock found on your network and the ones you've saved.
2. Or enter your server's address by hand, and select **Submit**.

Then pick a user or sign in. See [Quick Connect](quick-connect.md) to sign in with a code.

## Switch servers

Choose **Change server** from the user menu at the top of Home, or from the options button (**\***) on Home. This signs you out of the server you're on and returns to **Connect to Server**.

## Remove a saved server

On **Connect to Server**, move to the saved server in the list, press the options button (**\***) and pick **Delete Saved**.

## When something is on another server

If a [cast](cast-to-jellyrock.md) or a [deep link](deep-linking.md) asks for something on another saved server, JellyRock asks before it switches. Switching signs you out of the current server.

## Troubleshooting

- **Your server isn't in the list.** Enter its address by hand. Searching finds only servers on the same network as your Roku.
- **"Server not found, is it online?"** JellyRock couldn't reach that address. Check that the address is right and that the server is running.

---
pitch: Sign in with a short code from your phone or computer, instead of typing a password with the remote.
since: 1.0.0
server: 10.7.0
---

# Quick Connect (sign in with a code)

Typing a password with a Roku remote is slow. With Quick Connect, JellyRock shows a short code, you approve it in Jellyfin on your phone or computer, and your Roku signs in.

## What you need

- **Quick Connect turned on for your server.** An admin turns it on in Jellyfin. On Jellyfin 10.8 and later, JellyRock shows the **Quick Connect** button only when it's on.
- **Jellyfin on another device** where you're already signed in: the web app in a browser, or a Jellyfin app on your phone.

## Sign in with a code

1. On the screen where you pick a user, select **Quick Connect**.
2. JellyRock shows a code.
3. In Jellyfin on your other device, choose **Quick Connect** and enter the code.
4. JellyRock signs you in as soon as you approve the code, and asks whether to save the sign-in on this Roku. Say yes to stay signed in: JellyRock signs you in by itself the next time it starts.

The code stays on screen until you approve it or cancel. Press **Cancel** to go back.

## Troubleshooting

- **There's no Quick Connect button.** Quick Connect is turned off on your server. Ask your server's admin to turn it on, or sign in with your password.
- **"Quick Connect is disabled on this server."** You're on Jellyfin 10.7, where JellyRock can't tell beforehand. Sign in with your password.
- **"This Quick Connect code is no longer valid."** The code ran out before you approved it. Select **Quick Connect** again for a new code.
- **"Couldn't reach the server."** JellyRock lost touch with your server while it waited. Check the connection and try again.

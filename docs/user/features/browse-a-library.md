---
pitch: Move between a library's tabs at the top of the screen, choose how each one is drawn, and pick the tab it opens on.
since: unreleased
server: 10.7.0
---

# Browse a library

Open a library from Home to browse what is in it. Its tabs are at the top of the screen, and the settings icon beside them holds the settings that belong to that library, above the app's own.

## What you need

A library on your Jellyfin server.

## Move between tabs

A library's tabs show it in different ways. A movie library has **Movies**, **Favorites**, **Collections**, **Genres** and **Studios**. A TV library has **Shows**, **Favorites**, **Genres**, **Networks** and **Collections**. Music and Live TV have their own. **Collections** needs Jellyfin 12.0 or later.

1. In the library, press **Up** until the top row has focus.
2. Move to a tab and press **OK**. The tab opens with the first item focused.

Press **Up** from the top of a tab to reach the tabs again. Opening a studio, a network or a genre shows that one list under its name, with no tabs. Press **Back** to return to the library.

## Change how a tab is drawn

A movie library can show its movies two ways: **Presentation**, which shows the focused movie's details above the posters, or **Comfortable**, a full grid of posters.

1. In the library, press **Up** until the top row has focus, then move to the settings icon and press **OK**.
2. Select **Layout**. Its row shows the layout in use.
3. Select a layout. The library is redrawn at once.

JellyRock remembers the layout for that tab of the library on this Roku. Your sort, your filter and a letter picked on the letter rail stay as they were.

## Choose the tab a library opens on

A library opens on its usual first tab: **Movies**, **Shows**, **Album Artists** for music and **Channels** for Live TV. If you picked a **Default screen** for the library in the Jellyfin website's Home screen settings, it opens there instead. You can also pick a tab for it on this Roku, which wins over both.

1. In the library, press **Up** until the top row has focus, then move to the settings icon and press **OK**.
2. Select **Default tab**. Its row shows the tab the library opens on.
3. Select a tab. The library opens on it from the next time you open it.

The first choice in the list keeps no tab on this Roku. It reads **Web client setting** when the Jellyfin website picked a tab, or **Default** when nothing did, with that tab's name beside it. A change made on the Jellyfin website shows on the Roku after you next sign in or start JellyRock. Moving between tabs never changes which tab a library opens on.

## The settings icon's menu

The menu lists the library's own settings first and **All settings** last. A list with nothing to choose, such as a network opened inside a TV library, has no menu: the settings icon opens Settings directly.

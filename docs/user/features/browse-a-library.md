---
pitch: Move between a library's tabs, choose how each is drawn and how many items fit in a row, and pick where it opens.
since: unreleased
server: 10.7.0
---

# Browse a library

Open a library from Home to browse what is in it. Its tabs are at the top of the screen, and the settings icon beside them holds the settings that belong to that library, above the app's own.

## What you need

A library on your Jellyfin server.

## Move between tabs

A library's tabs show it in different ways. A movie library has **Movies**, **Favorites**, **Collections**, **Genres** and **Studios**. A TV library has **Shows**, **Favorites**, **Genres**, **Networks** and **Collections**. Music and Live TV have their own. **Collections** needs Jellyfin 12.0 or later.

The Collections library has **Collections** and **Favorites**, and the Playlists library has **Playlists** and **Favorites**. A music video library has **Folders**, which shows it as it is stored, **Music Videos**, which lists every video in one place, and **Favorites**.

1. In the library, press **Up** until the top row has focus.
2. Move to a tab and press **OK**. The tab opens with the first item focused.

Press **Up** from the top of a tab to reach the tabs again. Opening a studio, a network or a genre shows that one list under its name, with no tabs. Press **Back** to return to the library.

## Change how a tab is drawn

The settings icon's menu changes how the tab on screen is drawn. Each change redraws the tab at once and keeps you on the item you were on. Your sort, your filter and a letter picked on the letter rail stay as they were.

1. In the library, press **Up** until the top row has focus, then move to the settings icon and press **OK**. Each row of the menu shows its setting in use.
2. Select a setting, then a choice.

- **Layout:** a movie library's **Movies** tab shows a **Grid** of posters, or a **Grid with details**, which shows the focused movie's details above the posters.
- **Items per row:** how many posters or covers fit across the screen, from 3 to 11. Fewer makes them bigger; more shows more at once. A tab shows 7 posters, 6 album, artist or playlist covers, or 4 wide pictures in a music video or home video library, until you pick.
- **Item Titles:** **Enabled** shows each item's title under it, **Disabled** shows the art alone. This one applies to every library, and you can also set it in **Settings → User Interface → Libraries → General → Grid View Settings → Item Titles**.

JellyRock remembers the layout and the items per row for that tab of the library on this Roku.

## See what is focused

A row under the tabs describes the item you are on: its title, and its year, rating and length where it has them. On the right, a library with tabs shows its own name beside **Sort** and **Filter**, and the far right shows where you are in the list, such as "12 of 240". To hide that count, turn off **Settings → User Interface → Libraries → General → Grid View Settings → Item Count**.

## Sort a tab

1. From the first row of a tab, press **Up** once. The **Sort** button takes focus. It names the sort in use and its direction, such as "Sort: Title ↑".
2. Press **OK**, then select what to sort by. The tab reloads in that order.
3. To reverse the order, open the menu again and select **Order** at the bottom of it.

## Filter a tab

1. From the first row of a tab, press **Up**, then **Right** to the **Filter** button, and press **OK**.
2. Select a kind of filter. **Status** offers **Played**, **Unplayed** and **Resumable**, and you pick one. **Genres**, **Parental Ratings** and **Years** each open a list where you tick as many as you want; press **Back** when you are done.
3. The menu comes back so you can add another kind. Press **Back** to close it.

Filters work together. Two genres ticked show items in either genre, and a genre with **Unplayed** shows only the items in that genre you have not played. The **Filter** button counts what is set, such as "Filter: 2".

To remove every filter, open **Filter** and select **Clear filters**, the first row. It also clears a voice search and a letter picked on the letter rail.

Which filters a tab offers depends on the library. A music library has **Favorites** alone, a collection, playlist or music video list has **Played** and **Unplayed**, and a movie library has the most.

Deep in a long list, press **Replay** to jump to the first item, then **Up** to reach **Sort** and **Filter**.

## What a tab remembers

Each tab keeps its own sort and its own filters, so changing one tab never changes another.

- **Sort** is remembered for that tab of the library on this Roku, until you change it.
- **Filters** last while you are signed in. They are still there when you come back from an item, from Home or from search, and they clear when you sign out, switch user or close JellyRock.

Press **Replay** in a library to jump to the first item, from the letter rail too. Your sort, your filters and a letter picked on the letter rail stay as they were. It does nothing on the **TV Guide**.

## Choose the tab a library opens on

A library opens on its usual first tab: **Movies**, **Shows**, **Album Artists** for music, **Channels** for Live TV and **Folders** for music videos. If you picked a **Default screen** for the library in the Jellyfin website's Home screen settings, it opens there instead. You can also pick a tab for it on this Roku, which wins over both.

1. In the library, press **Up** until the top row has focus, then move to the settings icon and press **OK**.
2. Select **Default tab**. Its row shows the tab the library opens on.
3. Select a tab. The library opens on it from the next time you open it.

The first choice in the list keeps no tab on this Roku. It reads **Web client setting** when the Jellyfin website picked a tab, or **Default** when nothing did, with that tab's name beside it. A change made on the Jellyfin website shows on the Roku after you next sign in or start JellyRock. Moving between tabs never changes which tab a library opens on.

## The settings icon's menu

The menu lists the library's own settings first and **All settings** last. On a screen with nothing to set, the settings icon opens Settings directly.

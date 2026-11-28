# ADR 0065: A library's tab is screen state that a link or a reload can name

**Status:** Accepted. Extends [ADR 0018](0018-deep-link-cast-contract.md) (the `contentId` contract gains a `tab` key) and [ADR 0056](0056-library-tab-ids-and-layout.md) (the tab ids are now part of that contract).
**Date:** 2026-11-27

**related-files**: `source/replayRoute.bs`, `source/utils/screenReopen.bs`, `source/GridView/gridQuery.bs`, `source/GridView/libraryTab.bs`, `components/ItemGrid/BaseGridView.bs`, `components/home/Home.bs`, `components/JRScreen.bs`, `components/JRScene.bs`, `docs/dev/deep-linking.md`

A tab is the screen's own state, as on Home, and a tab press never changes the router's address. Two things can still name a tab, and both hand it to the screen as one key in its route's context. A deep link names one with `tab=<id>` in `contentId`, read only when `open` targets a library. The reload after a theme or language change asks the screen Settings was opened from what to come back with (`JRScreen.reopenContext()`), and a library and Home answer with their tab. The tab is for that opening: it wins over the default tab kept on the Roku and the web client's pick, is never saved, and is ignored when the screen does not offer it. A link to the library already on screen switches its tab in place.

The link's value is one of the app's own tab ids, so those ids are now part of the outside contract. Renaming an id in `libraryTab.bs` breaks every sender that names it: a script, a home automation and, later, the companion plugin. A sender never needs the web client's ids. No Jellyfin client sent a tab when this was written: a `DisplayContent` carries the item's name, id and type only (`jellyfin-web` master, `displayMirrorManager.ts`, read 2026-11-27).

**Ruled out:** a tab press that changes the router's address, by a hash, by `allowReuse` on the library route or by a `replace` added to the router. None is needed to name a tab from outside, since ADR 0018 already rejected a `contentId` shaped like a router path, and each would add a history entry per press or change how a folder inside a library is pushed. Also ruled out: the web client's `LibraryTab` ids as the link's vocabulary, and a sort, a filter, a letter or a focused item in a link, which no sender asks for and the contract's unknown-key rule leaves room to add.

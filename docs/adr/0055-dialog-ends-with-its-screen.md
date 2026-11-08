# ADR 0055: A dialog ends with the screen that opened it, and screen hooks run only through `JRScreen`

**Status:** Accepted
**Date:** 2026-11-08

**related-files**: `source/utils/dialogs.bs`, `source/utils/dialogClose.bs`, `components/JRScreen.bs`, `source/main.bs`, `scripts/bsc-plugins/screen-lifecycle-entry.cjs`, `docs/architecture/dialogs.md`, `docs/architecture/navigation.md`

`presentOverlayDialog` records the component that opened a dialog as its `owner`; main-thread callers have none. When another screen covers a screen, `JRScreen.hideCovered` cancels the open dialog if the covered screen is its owner or contains it, with `externallyCancelled` set, before the incoming screen's `onScreenShown`. A screen's `onScreenShown`, `onScreenHidden` and `hideCovered` are called only through `JRScreen`'s router bridge, which keeps the dialog-focus guards. The `screen-lifecycle-entry` build gate enforces that, and `main.bs` refreshes on screensaver exit through `onScreensaverExited`. Closing a screen for good is unchanged: its `onDestroy` abandons its dialogs.

Each review of PR #1336 found another screen whose dialog stayed open and focused over the screen covering it: `ItemDetails` twice, then Settings. A rule that each screen cancel its own dialogs in `onScreenHidden` was one more duty to forget. The cancel keys on ownership, not `returnFocusTo`, because `JRScene` opens the exit and SyncPlay confirms over whatever screen is up, and covering that screen must not end them.

**Ruled out:** a build gate requiring each screen to cancel its dialogs (it keeps the duty and has to trace dialogs opened by children such as the subtitle panel and the OSD); fixing screens one at a time; a screen contract in BrighterScript v1 types, which check names and shapes, not behavior over time (epic #1341).

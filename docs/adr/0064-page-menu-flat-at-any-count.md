# ADR 0064: The page menu stays one flat list at any count of entries

**Status:** Accepted. Partially supersedes [ADR 0057](0057-page-settings-declared-by-screen.md) (past about three entries, the entries moved into one Page settings dialog).
**Date:** 2026-11-21

**related-files**: `source/utils/pageSettings.bs`, `source/home/homePageSettings.bs`, `components/JRScene.bs`

The settings icon's page menu lists every entry a screen declares, then **All settings**, in one flat list whatever their count: a library offers up to four entries and Home five. Every entry is one press from the icon, and the menu reads like the player's settings menu. ADR 0057's split, a menu hanging off the icon and a dialog for each entry's options, stands; only its move to a Page settings dialog past about three entries is gone.

**Ruled out:** one Page settings dialog behind a single row past about three entries, which puts every Home setting two presses deep for a list that still fits the screen.

# ADR 0062: An app-wide setting may also be a page entry where a pick visibly changes the page

**Status:** Accepted. Partially supersedes [ADR 0057](0057-page-settings-declared-by-screen.md) (an app-wide setting lived in Settings only).
**Date:** 2026-11-16

**related-files**: `components/ItemGrid/BaseGridView.bs`, `source/utils/pageSettings.bs`, `components/JRScene.bs`, `docs/architecture/settings.md`

A value that belongs to one page is never in Settings, as ADR 0057 says. An app-wide setting lives in Settings, and a screen may also offer it as a page entry when a pick changes that screen at once; the entry writes the same setting and nothing else. A library offers Item Titles (`itemGridShowTitles`) this way: its list is headed "Item Titles (all libraries)" through the entry's optional `pickerTitle`, and its options are the Settings screen's own words in its order, so the setting reads one way in both places. A library covered while the setting changes redraws when shown again.

Titles is the choice a viewer makes while looking at the grid, and sending them to **Settings → User Interface → Libraries → General → Grid View Settings** for it hides the one switch that changes what they are looking at. ADR 0057's rule kept a per-library value out of Settings; that half stands.

**Ruled out:** Titles saved per library, which makes one preference a per-library chore; Titles on the page only, which leaves Settings without a library-wide switch it has always had.

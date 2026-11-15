# ADR 0060: In a dialog, OK is the commit and Back only leaves

**Status:** Accepted.
**Date:** 2026-11-14

**related-files**: `components/dialogs/JRListDialog.bs`, `source/utils/dialogs.bs`, `source/utils/dialogResult.bs`, `docs/architecture/dialogs.md`

No dialog holds a draft, so the dialog family has no Apply button. A checklist (`showChecklistDialog`, `JRListDialog` with `multiSelect`) counts a tick when it is made, publishes its ticks live on `checkedIndexes`, and reports the set when it closes (`result.checkedIndexes`; `cancelled` means the set did not change). A close from code reports the set as it stands, as Back does, flagged `externallyCancelled` so a handler that acts declines it. An action over ticked rows opens a confirm from the checklist's result handler, which is where a deliberate second press belongs.

Every picker and every setting already commits on OK. The library options panel the checklist replaces and the web client's filter dialog (its source read on 2026-11-14) both apply a tick as it is made.

**Ruled out:** Apply and Cancel buttons under the list, which are a second kind of focusable thing in a dialog whose list wraps both ways, so the list either stops wrapping or never reaches them; an Apply row at the end of the list, where Back, the most common exit, would discard the ticks and the row sits off screen in a long list; Roku's own `CheckList` node, which extends `LabelList` and so cannot draw `JRListDialogRow` or sit in the family's chrome. The cost accepted: abandoning a half-made change means clearing the ticks by hand.

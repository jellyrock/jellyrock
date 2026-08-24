// Tests for the no-hand-rolled-dialog plugin.
//
// Plugin under test: scripts/bsc-plugins/no-hand-rolled-dialog.cjs
// Diagnostic code: no-hand-rolled-dialog
//
// What the plugin enforces: dialogs come from the JRDialog family, and get
// mounted by source/utils/dialogs.bs. The family exists because convention
// failed once — three components each carried a private copy of the chrome, and
// when #757 restyled one the other two silently kept the old look with every
// gate green. This plugin is the gate that was missing.
//
// THE INTERESTING EDGE IS PRECISION, and it is what the first version got wrong.
// That version also flagged any Poster drawing `filled-rounded.9.png` or
// `border-3px.9.png`, reasoning that those ARE the dialog panel. Run against the
// real tree it produced 16 false positives and 1 true positive: those assets are
// the app's generic rounded surface and edge, worn by TextButton, Toast,
// JRDropdown, IconButton and TrackDropdown. An asset does not identify a dialog.
// The describe block below pins that lesson so nobody re-adds the rule.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import noHandRolledDialogPlugin from '../../../../scripts/bsc-plugins/no-hand-rolled-dialog.cjs';

const CODE = 'no-hand-rolled-dialog';

function check(files) {
  return diagnosticsByCode(runPluginOnSource(noHandRolledDialogPlugin, files), CODE);
}

describe('no-hand-rolled-dialog', () => {
  describe('a hand-rolled dimmed backdrop', () => {
    // The shape every pre-family dialog had, and the one ItemGridOptions still
    // has: a full-screen Rectangle at 0.75 opacity behind its own panel.
    it('flags a full-screen Rectangle that dims', () => {
      const found = check({
        'components/MyPanel.xml': `<?xml version="1.0" encoding="utf-8"?>
          <component name="MyPanel" extends="Group">
            <children>
              <Rectangle width="1920" height="1080" color="#000000" opacity="0.75" />
            </children>
          </component>`,
      });
      expect(found).toHaveLength(1);
      expect(found[0].message).toContain('backdrop');
    });

    // BOTH conditions are required. A full-screen Rectangle with no opacity is an
    // opaque background — a screen's base fill, not a dialog scrim.
    it('leaves a full-screen Rectangle with no opacity alone', () => {
      expect(
        check({
          'components/MyScreen.xml': `<?xml version="1.0" encoding="utf-8"?>
            <component name="MyScreen" extends="Group">
              <children>
                <Rectangle width="1920" height="1080" color="#000000" />
              </children>
            </component>`,
        }),
      ).toHaveLength(0);
    });

    // ...and the other half: a translucent Rectangle that is not full-screen is
    // ordinary decoration (a gradient scrim behind a row title, say).
    it('leaves a translucent Rectangle that is not full-screen alone', () => {
      expect(
        check({
          'components/MyRow.xml': `<?xml version="1.0" encoding="utf-8"?>
            <component name="MyRow" extends="Group">
              <children>
                <Rectangle width="600" height="200" color="#000000" opacity="0.5" />
              </children>
            </component>`,
        }),
      ).toHaveLength(0);
    });
  });

  describe('the generic 9-patch assets are NOT a dialog marker', () => {
    // THE REGRESSION GUARD for the 16 false positives. These are the real shapes
    // from TextButton.xml and Toast.xml. If someone re-adds an asset-based rule,
    // these go red.
    it('leaves a TextButton drawing the rounded-surface asset alone', () => {
      expect(
        check({
          'components/ui/button/TextButton.xml': `<?xml version="1.0" encoding="utf-8"?>
            <component name="TextButton" extends="Group">
              <children>
                <Poster id="background" uri="pkg:/images/9patch/filled-rounded.9.png" />
              </children>
            </component>`,
        }),
      ).toHaveLength(0);
    });

    it('leaves a Toast drawing the same asset alone', () => {
      expect(
        check({
          'components/ui/toast/Toast.xml': `<?xml version="1.0" encoding="utf-8"?>
            <component name="Toast" extends="Group">
              <children>
                <Poster id="toastBackground" uri="pkg:/images/9patch/filled-rounded.9.png" />
              </children>
            </component>`,
        }),
      ).toHaveLength(0);
    });

    it('leaves a component drawing the 3px edge asset alone', () => {
      expect(
        check({
          'components/ui/dropdown/JRDropdown.xml': `<?xml version="1.0" encoding="utf-8"?>
            <component name="JRDropdown" extends="Group">
              <children>
                <Poster id="edge" uri="pkg:/images/9patch/border-3px.9.png" />
              </children>
            </component>`,
        }),
      ).toHaveLength(0);
    });
  });

  describe('mounting an overlay by hand', () => {
    // The helpers are the only path that stamps the shared overlay id, so an
    // overlay appended directly to the scene is invisible to isOverlayDialogOpen
    // / isDialogOpen / cancelOpenDialog — it cannot be superseded, queried or
    // cancelled, and nothing about it looks wrong at the call site.
    it('flags appendChild onto appScene()', () => {
      const found = check({
        'components/MyScreen.bs': `
          sub showThing()
            node = createObject("roSGNode", "MyPanel")
            appScene().appendChild(node)
          end sub
        `,
      });
      expect(found).toHaveLength(1);
      expect(found[0].message).toContain('scene');
    });

    it('flags insertChild onto a getScene() result', () => {
      expect(
        check({
          'components/MyScreen.bs': `
            sub showThing()
              node = createObject("roSGNode", "MyPanel")
              m.top.getScene().insertChild(node, 0)
            end sub
          `,
        }),
      ).toHaveLength(1);
    });

    // appendChild is ubiquitous and legitimate — every LayoutGroup fills itself
    // this way. Only the SCENE target is the dialog-mounting shape.
    it('leaves appendChild onto an ordinary node alone', () => {
      expect(
        check({
          'components/MyScreen.bs': `
            sub build()
              m.buttonRow.appendChild(createObject("roSGNode", "TextButton"))
            end sub
          `,
        }),
      ).toHaveLength(0);
    });
  });

  describe('exemptions', () => {
    it('leaves the family itself alone — it IS the chrome', () => {
      expect(
        check({
          'components/dialogs/JRDialogPanel.xml': `<?xml version="1.0" encoding="utf-8"?>
            <component name="JRDialogPanel" extends="Group">
              <children>
                <Rectangle id="dimBackground" width="1920" height="1080" color="0x000000" opacity="0.75" />
              </children>
            </component>`,
        }),
      ).toHaveLength(0);
    });

    it('leaves the mounting helpers alone — they ARE the sanctioned path', () => {
      expect(
        check({
          'source/utils/dialogs.bs': `
            sub presentOverlayDialog(dialog as object)
              appScene().appendChild(dialog)
            end sub
          `,
        }),
      ).toHaveLength(0);
    });

    // The grandfathering path for a known un-migrated surface (ItemGridOptions),
    // written on the line ABOVE — which is the only form a multi-line XML comment
    // can take.
    it('honours bsc-disable-next-line from the preceding line', () => {
      expect(
        check({
          'components/ItemGrid/ItemGridOptions.xml': `<?xml version="1.0" encoding="utf-8"?>
            <component name="ItemGridOptions" extends="Group">
              <children>
                <!-- known un-migrated panel
                     bsc-disable-next-line no-hand-rolled-dialog -->
                <Rectangle width="1920" height="1080" color="#000000" opacity="0.75" />
              </children>
            </component>`,
        }),
      ).toHaveLength(0);
    });

    it('honours bsc-disable-line on the offending line itself', () => {
      expect(
        check({
          'components/MyScreen.bs': `
            sub showThing()
              appScene().appendChild(node) ' bsc-disable-line no-hand-rolled-dialog
            end sub
          `,
        }),
      ).toHaveLength(0);
    });
  });
});

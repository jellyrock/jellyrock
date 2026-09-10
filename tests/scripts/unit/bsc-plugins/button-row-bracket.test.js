// Tests for the button-row-bracket plugin.
//
// Plugin under test: scripts/bsc-plugins/button-row-bracket.cjs
// Diagnostic code: button-row-bracket-required
//
// What the plugin enforces: on a surface whose button row can overflow (#788),
// a function that mutates the row must bracket its work with unsplitButtons()
// before and applyOverflow() after. While a row is split its tail lives in an
// off-layout stash and a "More" button occupies the last slot, so index math and
// findNode() inside an unbracketed mutator resolve against the wrong list.
//
// The reason this needs a build-time gate rather than a convention: the bracket
// is a no-op until a row actually exceeds its cap, so a forgotten one is
// completely silent — no failing test, no visual difference — until a LATER PR
// adds the button that pushes the row over.
//
// The plugin is self-configuring: it reads the managed node out of each file's
// own unsplitButtons(), so these tests exercise that discovery too.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import buttonRowBracketPlugin from '../../../../scripts/bsc-plugins/button-row-bracket.cjs';

const CODE = 'button-row-bracket-required';

/** The two bracket halves, as a real surface declares them. */
const BRACKET = `
  sub unsplitButtons()
    restoreOverflowedButtons(m.buttonGrp, m.buttonOverflow)
  end sub

  sub applyOverflow()
    applyButtonOverflow(m.buttonGrp, m.buttonOverflow, 8, "More", "pkg:/more.png")
  end sub
`;

function check(source, path = 'components/Foo.bs') {
  return diagnosticsByCode(runPluginOnSource(buttonRowBracketPlugin, { [path]: source }), CODE);
}

describe('button-row-bracket', () => {
  describe('flags an unbracketed mutation', () => {
    it('flags a mutator with neither half', () => {
      const found = check(`
        ${BRACKET}
        sub addTrailerButton()
          m.buttonGrp.insertChild(trailerButton, 3)
        end sub
      `);
      expect(found).toHaveLength(1);
      expect(found[0].message).toContain('addTrailerButton');
      expect(found[0].message).toContain('m.buttonGrp');
    });

    // Half a bracket is the likelier mistake than none: a contributor copies a
    // neighbouring mutator, keeps the unsplit and drops the re-split, and the row
    // stays whole — correct-looking, and permanently unsplit.
    it('flags a mutator missing only applyOverflow()', () => {
      const found = check(`
        ${BRACKET}
        sub addTrailerButton()
          unsplitButtons()
          m.buttonGrp.insertChild(trailerButton, 3)
        end sub
      `);
      expect(found).toHaveLength(1);
      expect(found[0].message).toContain('applyOverflow()');
      expect(found[0].message).not.toContain('unsplitButtons() or');
    });

    it('flags a mutator missing only unsplitButtons()', () => {
      const found = check(`
        ${BRACKET}
        sub addTrailerButton()
          m.buttonGrp.insertChild(trailerButton, 3)
          applyOverflow()
        end sub
      `);
      expect(found).toHaveLength(1);
      expect(found[0].message).toContain('unsplitButtons()');
    });

    it.each([
      'insertChild(btn, 0)',
      'removeChild(btn)',
      'appendChild(btn)',
      'replaceChild(btn, 0)',
      'removeChildIndex(0)',
    ])('flags the child-list write %s', (call) => {
      expect(
        check(`
          ${BRACKET}
          sub mutate()
            m.buttonGrp.${call}
          end sub
        `),
      ).toHaveLength(1);
    });

    it('reports it as an error, not a warning — a silent bracket is the whole problem', () => {
      const found = check(`
        ${BRACKET}
        sub mutate()
          m.buttonGrp.appendChild(btn)
        end sub
      `);
      expect(found[0].severity).toBe(1);
    });

    it('flags a mutation nested inside a loop or conditional', () => {
      expect(
        check(`
          ${BRACKET}
          sub clearRow()
            if m.ready
              while m.buttonGrp.getChildCount() > 0
                m.buttonGrp.removeChild(m.buttonGrp.getChild(0))
              end while
            end if
          end sub
        `),
      ).toHaveLength(1);
    });
  });

  describe('stays quiet where it should', () => {
    it('accepts a properly bracketed mutator', () => {
      expect(
        check(`
          ${BRACKET}
          sub addTrailerButton()
            unsplitButtons()
            m.buttonGrp.insertChild(trailerButton, 3)
            applyOverflow()
          end sub
        `),
      ).toHaveLength(0);
    });

    // A read cannot corrupt the row on its own. getButtonIndex() answering -1 for
    // a stashed button only misplaces something in combination with a mutation,
    // which is flagged in its own right — so reads are deliberately not gated.
    it('ignores a function that only READS the row', () => {
      expect(
        check(`
          ${BRACKET}
          sub focusButtonGroupChild()
            index = m.buttonGrp.buttonFocused
            btn = m.buttonGrp.getChild(index)
            other = m.buttonGrp.findNode("refreshButton")
            count = m.buttonGrp.getChildCount()
          end sub
        `),
      ).toHaveLength(0);
    });

    // The false-positive surface that made a naive "any m.* child write" rule
    // unusable: ItemDetails has six functions mutating OTHER m.* nodes.
    it('ignores mutations of a different node on the same screen', () => {
      expect(
        check(`
          ${BRACKET}
          sub populateInfoGroup()
            m.infoGroup.removeChild(m.infoGroup.getChild(0))
            m.itemDescription.appendChild(node)
          end sub
        `),
      ).toHaveLength(0);
    });

    it('ignores the bracket halves themselves', () => {
      expect(check(BRACKET)).toHaveLength(0);
    });

    it('ignores a file that is not an overflow surface at all', () => {
      expect(
        check(`
          sub init()
            m.buttonGrp.appendChild(playButton)
            m.buttonGrp.removeChild(oldButton)
          end sub
        `),
      ).toHaveLength(0);
    });

    it('ignores a file that defines only one bracket half', () => {
      expect(
        check(`
          sub unsplitButtons()
            restoreOverflowedButtons(m.buttonGrp, m.buttonOverflow)
          end sub
          sub mutate()
            m.buttonGrp.appendChild(btn)
          end sub
        `),
      ).toHaveLength(0);
    });

    it('honours the bsc-disable-file escape hatch', () => {
      expect(
        check(`
          ' bsc-disable-file button-row-bracket
          ${BRACKET}
          sub mutate()
            m.buttonGrp.appendChild(btn)
          end sub
        `),
      ).toHaveLength(0);
    });
  });

  describe('discovers the managed node from the file itself', () => {
    // The OSD names its row m.buttonMenuLeft, not m.buttonGrp. Nothing in the
    // plugin knows either name — both come out of the file's own unsplitButtons().
    const OSD_BRACKET = `
      sub unsplitButtons()
        restoreOverflowedButtons(m.buttonMenuLeft, m.buttonOverflow)
      end sub
      sub applyOverflow()
        applyButtonOverflow(m.buttonMenuLeft, m.buttonOverflow, 10, "More", "pkg:/more.png")
      end sub
    `;

    it('flags an unbracketed mutation of a differently-named row', () => {
      const found = check(`
        ${OSD_BRACKET}
        sub setButtonStates()
          m.buttonMenuLeft.removeChild(m.buttonMenuLeft.findNode("chapterList"))
        end sub
      `);
      expect(found).toHaveLength(1);
      expect(found[0].message).toContain('m.buttonMenuLeft');
    });

    // The right-hand OSD group is a sibling LayoutGroup that the overflow never
    // touches, so writes to it are none of this rule's business.
    it('ignores the sibling row the overflow does not manage', () => {
      expect(
        check(`
          ${OSD_BRACKET}
          sub pinInfoButton()
            m.buttonMenuRight.appendChild(infoButton)
          end sub
        `),
      ).toHaveLength(0);
    });

    it('says nothing when the bracket shape is unrecognised, rather than guessing', () => {
      expect(
        check(`
          sub unsplitButtons()
            restoreOverflowedButtons(someLocal, m.buttonOverflow)
          end sub
          sub applyOverflow()
            applyButtonOverflow(someLocal, m.buttonOverflow, 8, "More", "pkg:/more.png")
          end sub
          sub mutate()
            m.buttonGrp.appendChild(btn)
          end sub
        `),
      ).toHaveLength(0);
    });
  });
});

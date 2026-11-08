// Tests for the screen-lifecycle-entry plugin.
//
// Plugin under test: scripts/bsc-plugins/screen-lifecycle-entry.cjs
// Diagnostic code: screen-lifecycle-entry
//
// What it enforces: a screen's onScreenShown, onScreenHidden and hideCovered are called only
// through JRScreen, whose router bridge carries the focus and dialog guards. main.bs called
// onScreenShown directly on screensaver exit and an open dialog went deaf; the first case is
// that shape.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import screenLifecycleEntryPlugin from '../../../../scripts/bsc-plugins/screen-lifecycle-entry.cjs';

const CODE = 'screen-lifecycle-entry';

function check(files) {
  return diagnosticsByCode(runPluginOnSource(screenLifecycleEntryPlugin, files), CODE);
}

describe('screen-lifecycle-entry', () => {
  describe('a direct call to a hook', () => {
    it('flags the old screensaver path in main.bs', () => {
      const found = check({
        'source/main.bs': `
          sub Main()
            group = getActiveView()
            group.callFunc("onScreenShown")
          end sub
        `,
      });
      expect(found).toHaveLength(1);
      expect(found[0].message).toContain('onScreenShown');
    });

    it('flags onScreenHidden and hideCovered from a component', () => {
      const found = check({
        'components/Foo.bs': `
          sub doSomething(view as object)
            view.callFunc("onScreenHidden")
            view.callFunc("hideCovered")
          end sub
        `,
      });
      expect(found).toHaveLength(2);
    });

    it('matches callFunc and the hook name in any case, as BrightScript does', () => {
      const found = check({
        'components/Foo.bs': `
          sub doSomething(view as object)
            view.CallFunc("OnScreenShown")
          end sub
        `,
      });
      expect(found).toHaveLength(1);
    });

    it('flags a call inside a namespace function', () => {
      const found = check({
        'source/foo.bs': `
          namespace foo
            sub refresh(view as object)
              view.callFunc("onScreenShown")
            end sub
          end namespace
        `,
      });
      expect(found).toHaveLength(1);
    });

    it('flags a forward from a hook of another name', () => {
      const found = check({
        'components/Grid.bs': `
          sub onScreenHidden()
            m.guide.callFunc("onScreenShown")
          end sub
        `,
      });
      expect(found).toHaveLength(1);
    });
  });

  describe('the allowed callers', () => {
    it('allows anything in JRScreen.bs', () => {
      const found = check({
        'components/JRScreen.bs': `
          sub reshow()
            m.top.callFunc("onScreenShown")
            m.top.callFunc("hideCovered")
          end sub
        `,
      });
      expect(found).toHaveLength(0);
    });

    it("allows hideCovered from JRScene's swap, and nothing else there", () => {
      const found = check({
        'components/JRScene.bs': `
          sub onActiveRoutedViewChanged()
            m.previousRoutedView.callFunc("hideCovered")
            m.previousRoutedView.callFunc("onScreenShown")
          end sub
        `,
      });
      expect(found).toHaveLength(1);
      expect(found[0].message).toContain('onScreenShown');
    });

    it('allows a screen forwarding a hook to a nested screen from the same hook', () => {
      const found = check({
        'components/Grid.bs': `
          sub onScreenShown()
            if isValid(m.tvGuide) then m.tvGuide.callFunc("onScreenShown")
          end sub
          sub onScreenHidden()
            if isValid(m.tvGuide) then m.tvGuide.callFunc("onScreenHidden")
          end sub
        `,
      });
      expect(found).toHaveLength(0);
    });

    it('leaves other callFunc names and non-literal names alone', () => {
      const found = check({
        'components/Foo.bs': `
          sub doSomething(view as object, name as string)
            view.callFunc("onScreensaverExited")
            view.callFunc(name)
          end sub
        `,
      });
      expect(found).toHaveLength(0);
    });

    it('skips tests', () => {
      const found = check({
        'tests/source/unit/Foo.spec.bs': `
          sub cover(view as object)
            view.callFunc("hideCovered")
          end sub
        `,
      });
      expect(found).toHaveLength(0);
    });

    it('honors a next-line marker', () => {
      const found = check({
        'components/Foo.bs': `
          sub doSomething(view as object)
            ' bsc-disable-next-line screen-lifecycle-entry the reason
            view.callFunc("onScreenShown")
          end sub
        `,
      });
      expect(found).toHaveLength(0);
    });
  });
});

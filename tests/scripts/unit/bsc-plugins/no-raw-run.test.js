// Tests for the no-raw-run plugin.
//
// Plugin under test: scripts/bsc-plugins/no-raw-run.cjs
// Diagnostic code: no-raw-run
//
// What the plugin enforces: starting a Task thread must go through
// launchTask() in source/utils/tasks.bs, so the live thread count stays
// derivable. A bare `control = "RUN"` anywhere else is a build error.
//
// The interesting edge is that `control` is NOT a Task-only field — Animation
// takes "start"/"pause"/"resume" and Video takes "play"/"rewind"/"none", and
// the app has ~95 such writes. Only "RUN" starts a thread, so only "RUN" (and
// an RHS that cannot be resolved statically) is flagged.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import noRawRunPlugin from '../../../../scripts/bsc-plugins/no-raw-run.cjs';

const CODE = 'no-raw-run';

/** Runs the plugin over one component file and returns just its diagnostics. */
function check(source, path = 'components/Foo.bs') {
  return diagnosticsByCode(runPluginOnSource(noRawRunPlugin, { [path]: source }), CODE);
}

describe('no-raw-run', () => {
  it('flags a raw control = "RUN"', () => {
    expect(
      check(`
        sub init()
          m.loadTask.control = "RUN"
        end sub
      `),
    ).toHaveLength(1);
  });

  it('flags lowercase "run" — the form a case-sensitive grep misses', () => {
    // QuickConnectDialog.bs used exactly this, and it was invisible to the
    // regex sweep that found the other 98 sites.
    expect(
      check(`
        sub init()
          m.checkTask.control = "run"
        end sub
      `),
    ).toHaveLength(1);
  });

  it('flags the indexed form node["control"] = "RUN"', () => {
    expect(
      check(`
        sub init()
          m.loadTask["control"] = "RUN"
        end sub
      `),
    ).toHaveLength(1);
  });

  it('flags the ifSGNodeField form node.setField("control", "RUN")', () => {
    expect(
      check(`
        sub init()
          m.loadTask.setField("control", "RUN")
        end sub
      `),
    ).toHaveLength(1);
  });

  it('flags setField with an RHS it cannot resolve statically', () => {
    expect(
      check(`
        sub init()
          m.loadTask.setField("control", verb)
        end sub
      `),
    ).toHaveLength(1);
  });

  it('does not flag setField for other fields or other verbs', () => {
    expect(
      check(`
        sub go()
          m.loadTask.setField("itemId", "RUN")
          m.fadeIn.setField("control", "start")
          m.loadTask.setField("control", "STOP")
        end sub
      `),
    ).toHaveLength(0);
  });

  it('does not flag setField with a computed field name', () => {
    // Keyed on a literal "control" first arg, so a dynamic field name is never
    // flagged — otherwise every generic setField(name, value) helper trips it.
    expect(
      check(`
        sub go(fieldName as string)
          m.loadTask.setField(fieldName, "RUN")
        end sub
      `),
    ).toHaveLength(0);
  });

  it('does not flag setFields — the documented residual gap', () => {
    // Catching the literal case soundly would mean flagging every non-literal
    // setFields, and the codebase has many legitimate ones.
    expect(
      check(`
        sub go()
          m.loadTask.setFields({ control: "RUN" })
        end sub
      `),
    ).toHaveLength(0);
  });

  it('flags an RHS it cannot resolve statically', () => {
    // A variable could hold "RUN" at runtime, so the plugin assumes the worst
    // rather than letting a dynamic write slip the chokepoint.
    expect(
      check(`
        sub init()
          verb = "RUN"
          m.loadTask.control = verb
        end sub
      `),
    ).toHaveLength(1);
  });

  it('flags every site in a file with several', () => {
    expect(
      check(`
        sub init()
          m.a.control = "RUN"
          m.b.control = "RUN"
          m.c.control = "RUN"
        end sub
      `),
    ).toHaveLength(3);
  });

  it('does not flag control = "STOP"', () => {
    // Stopping needs no accounting: the count is derived from `state`.
    expect(
      check(`
        sub teardown()
          m.loadTask.control = "STOP"
          m.other.control = "stop"
        end sub
      `),
    ).toHaveLength(0);
  });

  it('does not flag Animation and Video control verbs', () => {
    expect(
      check(`
        sub go()
          m.fadeIn.control = "start"
          m.fadeIn.control = "pause"
          m.fadeIn.control = "resume"
          m.video.control = "play"
          m.video.control = "rewind"
          m.video.control = "fastforward"
          m.video.control = "none"
        end sub
      `),
    ).toHaveLength(0);
  });

  it('does not flag assignments to other fields', () => {
    expect(
      check(`
        sub go()
          m.loadTask.itemId = "RUN"
          m.loadTask["itemId"] = "RUN"
        end sub
      `),
    ).toHaveLength(0);
  });

  it('does not flag the wrapper itself', () => {
    expect(
      check(
        `
        function launchTask(node as object) as boolean
          node.control = "RUN"
          return true
        end function
      `,
        'source/utils/tasks.bs',
      ),
    ).toHaveLength(0);
  });

  it('does not flag vendored code', () => {
    // The vendored WebSocketClientTask self-starts; we do not author it.
    expect(
      check(
        `
        sub init()
          m.top.control = "RUN"
        end sub
      `,
        'components/vendor/BrightWebSocket/web_socket_client/WebSocketClientTask.brs',
      ),
    ).toHaveLength(0);
  });

  it('honours bsc-disable-line', () => {
    expect(
      check(`
        sub init()
          m.loadTask.control = "RUN" ' bsc-disable-line no-raw-run
        end sub
      `),
    ).toHaveLength(0);
  });

  it('honours bsc-disable-next-line', () => {
    expect(
      check(`
        sub init()
          ' bsc-disable-next-line no-raw-run
          m.loadTask.control = "RUN"
        end sub
      `),
    ).toHaveLength(0);
  });
});

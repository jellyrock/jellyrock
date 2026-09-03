// Tests for the unobserve-before-release plugin.
//
// Plugin under test: scripts/bsc-plugins/unobserve-before-release.cjs
// Diagnostic code: unobserve-before-release
//
// The rule: inside one onDestroy, is a reference released while an observer
// whose handler DEREFERENCES it is still attached? Three things keep it precise
// enough to be worth a warning, and each has a test below that fails loudly if
// it regresses:
//   1. handlers bind by (target, field), not by field name alone
//   2. only receiver-position uses count (`m.X.foo`), not reads or writes
//   3. a handler that isValid-checks the ref has handled it itself
//
// Ground truth, re-measured against the real tree when this landed: 3 hits on
// the three known-real sites at 5d50a592, 0 hits after they were reordered.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import unobserveBeforeReleasePlugin from '../../../../scripts/bsc-plugins/unobserve-before-release.cjs';

const CODE = 'unobserve-before-release';

const xml = (name) =>
  `<?xml version="1.0" encoding="utf-8" ?>
<component name="${name}" extends="Group">
  <script type="text/brightscript" uri="${name}.bs" />
</component>`;

const run = (name, bs) =>
  diagnosticsByCode(
    runPluginOnSource(unobserveBeforeReleasePlugin, {
      [`components/${name}.xml`]: xml(name),
      [`components/${name}.bs`]: bs,
    }),
    CODE,
  );

describe('unobserve-before-release — the hazard', () => {
  it('flags a handler that dereferences a reference onDestroy already released', () => {
    // The schedule.bs shape: onRecordOperationDone reads m.LoadScheduleTask, and
    // the recordOperationDone observer is still attached when it is nulled.
    const found = run(
      'Hazard',
      `
      sub init()
        m.taskA = createObject("roSGNode", "TaskA")
        m.taskB = createObject("roSGNode", "TaskB")
        m.taskB.observeField("done", "onDone")
      end sub
      sub onDone()
        m.taskA.control = "RUN"
      end sub
      sub onDestroy()
        m.taskA = invalid
        m.taskB.unobserveField("done")
        m.taskB = invalid
      end sub
    `,
    );
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe(2); // Warning — the binding is inferred.
    expect(found[0].message).toContain('onDone()');
    expect(found[0].message).toContain('m.taskA');
  });

  it('is clean once the unobserve moves above the release', () => {
    expect(
      run(
        'Fixed',
        `
      sub init()
        m.taskA = createObject("roSGNode", "TaskA")
        m.taskB = createObject("roSGNode", "TaskB")
        m.taskB.observeField("done", "onDone")
      end sub
      sub onDone()
        m.taskA.control = "RUN"
      end sub
      sub onDestroy()
        m.taskB.unobserveField("done")
        m.taskA = invalid
        m.taskB = invalid
      end sub
    `,
      ),
    ).toHaveLength(0);
  });

  it('follows releases and unobserves nested inside if blocks', () => {
    // Nearly every real onDestroy guards its teardown with `if isValid(...)`, so
    // a rule that only walked top-level statements would see almost nothing.
    const found = run(
      'Nested',
      `
      sub init()
        m.taskB.observeField("done", "onDone")
      end sub
      sub onDone()
        m.taskA.control = "RUN"
      end sub
      sub onDestroy()
        if isValid(m.taskA)
          m.taskA = invalid
        end if
        if isValid(m.taskB)
          m.taskB.unobserveField("done")
          m.taskB = invalid
        end if
      end sub
    `,
    );
    expect(found).toHaveLength(1);
  });
});

describe('unobserve-before-release — precision', () => {
  it('binds handlers by target AND field, not by field name alone', () => {
    // Six tasks in this codebase all observe "content". Binding on the field
    // alone cross-matches every one of them to every other one's handler and
    // turns 0 real hits into dozens of false ones.
    expect(
      run(
        'SameField',
        `
      sub init()
        m.taskA.observeField("content", "onA")
        m.taskB.observeField("content", "onB")
      end sub
      sub onA()
        m.other.doThing()
      end sub
      sub onB()
        m.taskB.content = []
      end sub
      sub onDestroy()
        m.other = invalid
        m.taskA.unobserveField("content")
        m.taskB.unobserveField("content")
      end sub
    `,
      ),
    ).toHaveLength(1); // only taskA's handler reaches m.other
  });

  it('ignores a released reference that is only READ or WRITTEN, never dotted into', () => {
    // `x = m.gone` yields invalid and `m.gone = 1` replaces it. Neither throws —
    // only dotting INTO an invalid reference does.
    expect(
      run(
        'ReadWrite',
        `
      sub init()
        m.taskB.observeField("done", "onDone")
      end sub
      sub onDone()
        saved = m.gone
        m.gone = saved
      end sub
      sub onDestroy()
        m.gone = invalid
        m.taskB.unobserveField("done")
      end sub
    `,
      ),
    ).toHaveLength(0);
  });

  it('does not flag a handler that validity-checks the reference itself', () => {
    expect(
      run(
        'SelfGuarded',
        `
      sub init()
        m.taskB.observeField("done", "onDone")
      end sub
      sub onDone()
        if not isValid(m.panel) then return
        m.panel.visible = false
      end sub
      sub onDestroy()
        m.panel = invalid
        m.taskB.unobserveField("done")
      end sub
    `,
      ),
    ).toHaveLength(0);
  });

  it("does not flag a handler that early-returns on the project's own teardown flag", () => {
    // VideoPlayerView.onPositionChanged's shape. `m.isDestroyed = true` runs
    // before anything is released, so the handler bails before it can
    // dereference — flagging it would fire on already-correct code, and a
    // warning that cries wolf is one somebody turns off.
    expect(
      run(
        'DestroyedGuarded',
        `
      sub init()
        m.isDestroyed = false
        m.taskB.observeField("done", "onDone")
      end sub
      sub onDone()
        if m.isDestroyed = true then return
        m.taskA.control = "RUN"
      end sub
      sub onDestroy()
        m.isDestroyed = true
        m.taskA = invalid
        m.taskB.unobserveField("done")
      end sub
    `,
      ),
    ).toHaveLength(0);
  });

  it('still flags when the teardown flag is armed only AFTER a release', () => {
    // The exemption is an ORDERING claim, not the mere presence of a flag: a
    // callback delivered between the release and the assignment still finds the
    // flag false and dereferences the reference that is already gone.
    expect(
      run(
        'DestroyedLate',
        `
      sub init()
        m.isDestroyed = false
        m.taskB.observeField("done", "onDone")
      end sub
      sub onDone()
        if m.isDestroyed = true then return
        m.taskA.control = "RUN"
      end sub
      sub onDestroy()
        m.taskA = invalid
        m.isDestroyed = true
        m.taskB.unobserveField("done")
      end sub
    `,
      ),
    ).toHaveLength(1);
  });

  it('does not flag the paired unobserve-then-release idiom', () => {
    // `m.foo.unobserveField(...)` immediately followed by `m.foo = invalid` is
    // the canonical safe shape, and is what a naive "any unobserve after any
    // release" metric wrongly flags 62 times across this codebase.
    expect(
      run(
        'Paired',
        `
      sub init()
        m.taskA.observeField("content", "onA")
        m.taskB.observeField("content", "onB")
      end sub
      sub onA()
        m.taskA.content = []
      end sub
      sub onB()
        m.taskB.content = []
      end sub
      sub onDestroy()
        m.taskA.unobserveField("content")
        m.taskA = invalid
        m.taskB.unobserveField("content")
        m.taskB = invalid
      end sub
    `,
      ),
    ).toHaveLength(0);
  });

  it('keeps scoped and unscoped observers on separate lists', () => {
    // Roku tracks them separately, so an unobserveField does not release an
    // observeFieldScoped — pairing them here would report the wrong site.
    expect(
      run(
        'Scoped',
        `
      sub init()
        m.taskB.observeFieldScoped("done", "onDone")
      end sub
      sub onDone()
        m.taskA.control = "RUN"
      end sub
      sub onDestroy()
        m.taskA = invalid
        m.taskB.unobserveField("done")
      end sub
    `,
      ),
    ).toHaveLength(0);
  });

  it('resolves an observer registered through a local alias', () => {
    // The canonical pattern: resolve into a local, cache on m, observe via the
    // local, unobserve via m.
    const found = run(
      'Alias',
      `
      sub init()
        task = createObject("roSGNode", "TaskB")
        m.taskB = task
        task.observeField("done", "onDone")
      end sub
      sub onDone()
        m.taskA.control = "RUN"
      end sub
      sub onDestroy()
        m.taskA = invalid
        m.taskB.unobserveField("done")
      end sub
    `,
    );
    expect(found).toHaveLength(1);
  });
});

describe('unobserve-before-release — scope and escape hatches', () => {
  it('does not run on a source helper with no sibling component XML', () => {
    expect(
      diagnosticsByCode(
        runPluginOnSource(unobserveBeforeReleasePlugin, {
          'source/helper.bs': `
            sub onDone()
              m.taskA.control = "RUN"
            end sub
            sub onDestroy()
              m.taskA = invalid
              m.taskB.unobserveField("done")
            end sub
          `,
        }),
        CODE,
      ),
    ).toHaveLength(0);
  });

  it('does not run on a component with no onDestroy', () => {
    expect(
      run(
        'NoTeardown',
        `
      sub init()
        m.taskB.observeField("done", "onDone")
      end sub
      sub onDone()
        m.taskA.control = "RUN"
      end sub
    `,
      ),
    ).toHaveLength(0);
  });

  it('respects the bsc-disable-line escape hatch', () => {
    // build-and-tooling.md's suppression table claims all three markers for this
    // rule, and that table exists because reaching for one a plugin does NOT
    // implement fails silently. So each claimed marker gets a test.
    expect(
      run(
        'EscLine',
        `
      sub init()
        m.taskB.observeField("done", "onDone")
      end sub
      sub onDone()
        m.taskA.control = "RUN"
      end sub
      sub onDestroy()
        m.taskA = invalid
        m.taskB.unobserveField("done") ' bsc-disable-line unobserve-before-release
      end sub
    `,
      ),
    ).toHaveLength(0);
  });

  it('respects the bsc-disable-next-line escape hatch', () => {
    expect(
      run(
        'EscNext',
        `
      sub init()
        m.taskB.observeField("done", "onDone")
      end sub
      sub onDone()
        m.taskA.control = "RUN"
      end sub
      sub onDestroy()
        m.taskA = invalid
        ' bsc-disable-next-line unobserve-before-release
        m.taskB.unobserveField("done")
      end sub
    `,
      ),
    ).toHaveLength(0);
  });

  it('respects the bsc-disable-file escape hatch', () => {
    expect(
      run(
        'EscFile',
        `
      ' bsc-disable-file unobserve-before-release
      sub init()
        m.taskB.observeField("done", "onDone")
      end sub
      sub onDone()
        m.taskA.control = "RUN"
      end sub
      sub onDestroy()
        m.taskA = invalid
        m.taskB.unobserveField("done")
      end sub
    `,
      ),
    ).toHaveLength(0);
  });
});

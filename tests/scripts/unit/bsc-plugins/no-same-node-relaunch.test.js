// Tests for the no-same-node-relaunch plugin.
//
// Plugin under test: scripts/bsc-plugins/no-same-node-relaunch.cjs
// Diagnostic code: no-same-node-relaunch
//
// What the plugin enforces: a Task node stopped and relaunched in one function
// races (the launch is sometimes ignored while the old function still runs), so a
// restartable run must launch a NEW node. See docs/architecture/threading.md.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import plugin from '../../../../scripts/bsc-plugins/no-same-node-relaunch.cjs';

const CODE = 'no-same-node-relaunch';

function check(source, path = 'components/Foo.bs') {
  return diagnosticsByCode(runPluginOnSource(plugin, { [path]: source }), CODE);
}

describe('no-same-node-relaunch — flagged', () => {
  it('flags STOP then launchTask on the same m. slot', () => {
    const found = check(`
      sub search()
        m.searchTask.control = "STOP"
        m.searchTask.query = "x"
        launchTask(m.searchTask)
      end sub
    `);
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/`m\.searchtask` is stopped and relaunched/);
    expect(found[0].location.range.start.line).toBe(4);
  });

  it('flags lowercase "stop" and a STOP guarded by a state check', () => {
    expect(
      check(`
        sub reload()
          if m.loadTask.state = "run" then m.loadTask.control = "stop"
          launchTask(m.loadTask)
        end sub
      `),
    ).toHaveLength(1);
  });

  it('flags the indexed, setField and literal setFields spellings of STOP', () => {
    expect(
      check(`
        sub a()
          m.t["control"] = "STOP"
          launchTask(m.t)
        end sub
        sub b()
          m.t.setField("control", "STOP")
          launchTask(m.t)
        end sub
        sub c()
          m.t.setFields({ control: "STOP" })
          launchTask(m.t)
        end sub
      `),
    ).toHaveLength(3);
  });

  it('matches paths case-insensitively and a dotted launchTask callee', () => {
    expect(
      check(`
        sub a()
          m.LoadTask.control = "STOP"
          tasks.launchTask(m.loadtask)
        end sub
      `),
    ).toHaveLength(1);
  });

  it('flags a local node stopped and relaunched', () => {
    expect(
      check(`
        sub a(task as object)
          task.control = "STOP"
          launchTask(task)
        end sub
      `),
    ).toHaveLength(1);
  });

  it('follows one same-file helper that stops an m. slot, and names it', () => {
    const found = check(`
      sub prepareDataLoad()
        m.loadItemsTask.control = "stop"
      end sub
      sub loadInitialItems()
        prepareDataLoad()
        launchTask(m.loadItemsTask)
      end sub
    `);
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/stopped inside `preparedataload\(\)`/);
  });

  it('flags a configuring write between STOP and launch (not a new node)', () => {
    expect(
      check(`
        sub a()
          m.task.control = "STOP"
          m.task.itemId = "1"
          m.task.setFields({ itemId: "2" })
          launchTask(m.task)
        end sub
      `),
    ).toHaveLength(1);
  });
  it('checks class methods too', () => {
    expect(
      check(
        `
        class Loader
          sub reload()
            m.task.control = "STOP"
            launchTask(m.task)
          end sub
        end class
      `,
        'source/Loader.bs',
      ),
    ).toHaveLength(1);
  });
});

describe('no-same-node-relaunch — not flagged', () => {
  it('passes a new node assigned between STOP and launch', () => {
    expect(
      check(`
        sub startRun()
          m.task.control = "STOP"
          m.task = createObject("roSGNode", "LoadTask")
          launchTask(m.task)
        end sub
      `),
    ).toHaveLength(0);
  });

  it('passes a rebind of a PARENT of the launched path', () => {
    expect(
      check(`
        sub a()
          m.view.task.control = "STOP"
          m.view = createObject("roSGNode", "Holder")
          launchTask(m.view.task)
        end sub
      `),
    ).toHaveLength(0);
  });

  it('passes a local reassigned between STOP and launch', () => {
    expect(
      check(`
        sub a()
          task = m.task
          task.control = "STOP"
          task = createObject("roSGNode", "LoadTask")
          launchTask(task)
        end sub
      `),
    ).toHaveLength(0);
  });

  it('passes a STOP after the launch (a timeout)', () => {
    expect(
      check(`
        sub a()
          task = createObject("roSGNode", "FontTask")
          launchTask(task)
          task.control = "STOP"
        end sub
      `),
    ).toHaveLength(0);
  });

  it('passes a STOP and a launch of different nodes', () => {
    expect(
      check(`
        sub a()
          m.a.control = "STOP"
          launchTask(m.b)
        end sub
      `),
    ).toHaveLength(0);
  });

  it('passes a STOP in one function and a launch in another (no call between)', () => {
    expect(
      check(`
        sub onDone()
          m.task.control = "STOP"
        end sub
        sub reload()
          launchTask(m.task)
        end sub
      `),
    ).toHaveLength(0);
  });

  it('does not carry a helper local into the caller, even with the same name', () => {
    expect(
      check(`
        sub resetOther()
          task = m.other
          task.control = "STOP"
        end sub
        sub a()
          task = m.task
          resetOther()
          launchTask(task)
        end sub
      `),
    ).toHaveLength(0);
  });

  it('ignores a control value other than STOP on the launched node', () => {
    expect(
      check(`
        sub a()
          m.task.control = "none"
          launchTask(m.task)
        end sub
      `),
    ).toHaveLength(0);
  });

  it('honors the next-line and line suppression markers', () => {
    expect(
      check(`
        sub a()
          m.t.control = "STOP"
          ' bsc-disable-next-line no-same-node-relaunch probe exercises the race on purpose
          launchTask(m.t)
        end sub
        sub b()
          m.t.control = "STOP"
          launchTask(m.t) ' bsc-disable-line no-same-node-relaunch
        end sub
      `),
    ).toHaveLength(0);
  });

  it('does not honor a whole-file opt-out', () => {
    expect(
      check(`
        ' bsc-disable-file no-same-node-relaunch
        sub a()
          m.t.control = "STOP"
          launchTask(m.t)
        end sub
      `),
    ).toHaveLength(1);
  });

  it('skips tasks.bs and vendored code', () => {
    const source = `
      sub a()
        m.t.control = "STOP"
        launchTask(m.t)
      end sub
    `;
    expect(check(source, 'source/utils/tasks.bs')).toHaveLength(0);
    expect(check(source, 'components/vendor/x/Foo.bs')).toHaveLength(0);
  });
});

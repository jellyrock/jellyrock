// Tests for the no-same-node-relaunch plugin.
//
// Plugin under test: scripts/bsc-plugins/no-same-node-relaunch.cjs
// Diagnostic code: no-same-node-relaunch
//
// What the plugin enforces: a Task node stopped and relaunched in one function
// races (the launch is sometimes ignored while the old function still runs), so a
// restartable run must launch a NEW node. See docs/architecture/threading.md.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, runPluginOnEdits, diagnosticsByCode } from '../_helpers/run-plugin.js';
import plugin from '../../../../scripts/bsc-plugins/no-same-node-relaunch.cjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PLUGIN_PATH = fileURLToPath(
  new URL('../../../../scripts/bsc-plugins/no-same-node-relaunch.cjs', import.meta.url),
);

const CODE = 'no-same-node-relaunch';

// An empty list, so these tests neither depend on which real sites are still
// pending nor see the real list's files reported as missing from a tiny program.
const unlisted = plugin.withPendingMigrations({});

function check(source, path = 'components/Foo.bs') {
  return diagnosticsByCode(runPluginOnSource(unlisted, { [path]: source }), CODE);
}

// Only the STOP-then-relaunch findings (check 1). The cases below that launch a node
// they did not assign are about check 1's scope; check 2 flags those launches too,
// and is tested on its own further down.
function stopFindings(source) {
  return check(source).filter((d) => /is stopped/.test(d.message));
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

  it('checks an inline callback as a function of its own', () => {
    expect(
      check(`
        sub a()
          promises.chain(req, {}).then(sub(res as object, ctx as object)
            m.t.control = "STOP"
            launchTask(m.t)
          end sub)
        end sub
      `),
    ).toHaveLength(1);
  });

  it('does not count a new node assigned only inside a callback', () => {
    expect(
      check(`
        sub a()
          m.t.control = "STOP"
          promises.chain(req, {}).then(sub(res as object, ctx as object)
            m.t = createObject("roSGNode", "LoadTask")
          end sub)
          launchTask(m.t)
        end sub
      `),
    ).toHaveLength(1);
  });

  it('follows a helper whose new node is assigned before its STOP, not after', () => {
    expect(
      check(`
        sub resetRun()
          m.task = createObject("roSGNode", "LoadTask")
          m.task.control = "STOP"
        end sub
        sub start()
          resetRun()
          launchTask(m.task)
        end sub
      `),
    ).toHaveLength(1);
  });
});

describe('no-same-node-relaunch — the tasks.bs release helpers', () => {
  it('flags a replaceTask whose result is dropped, then a launch of the stopped node', () => {
    const found = check(`
      sub search()
        replaceTask(m.searchTask, "SearchTask", "results", {})
        launchTask(m.searchTask)
      end sub
    `);
    expect(found).toHaveLength(1);
    expect(found[0].location.range.start.line).toBe(3);
  });

  it('flags releaseTask then a launch of the released node', () => {
    expect(
      check(`
        sub reload()
          releaseTask(m.loadTask, "content")
          launchTask(m.loadTask)
        end sub
      `),
    ).toHaveLength(1);
  });

  it('matches the helper names case-insensitively', () => {
    expect(
      check(`
        sub reload()
          ReleaseTask(m.loadTask, "content")
          launchTask(m.loadTask)
        end sub
      `),
    ).toHaveLength(1);
  });

  it('passes the assigned form — the rebind lands after the stop it wraps', () => {
    expect(
      check(`
        sub search()
          m.searchTask = replaceTask(m.searchTask, "SearchTask", "results", { query: "x" })
          m.searchTask.observeField("results", "loadResults")
          launchTask(m.searchTask)
        end sub
      `),
    ).toHaveLength(0);
  });

  it('passes the assigned form through m["x"] and a local', () => {
    expect(
      check(`
        sub a()
          m["t"] = replaceTask(m.t, "LoadItemsTask", "content", {})
          launchTask(m.t)
        end sub
        sub b()
          t = replaceTask(t, "LoadItemsTask", "content", {})
          launchTask(t)
        end sub
      `),
    ).toHaveLength(0);
  });

  it('passes a release for good, assigned invalid', () => {
    expect(
      check(`
        sub teardown()
          m.t = releaseTask(m.t, "content")
          launchTask(m.t)
        end sub
      `),
    ).toHaveLength(0);
  });

  it('passes a replace of a DIFFERENT node than the one launched', () => {
    expect(
      check(`
        sub a()
          m.b = replaceTask(m.a, "LoadItemsTask", "content", {})
          launchTask(m.b)
        end sub
      `),
    ).toHaveLength(0);
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

  it('passes a new node assigned through m["x"], setFields or addFields', () => {
    expect(
      check(`
        sub a()
          m.t.control = "STOP"
          m["t"] = createObject("roSGNode", "LoadTask")
          launchTask(m.t)
        end sub
        sub b()
          m.t.control = "STOP"
          m.setFields({ t: createObject("roSGNode", "LoadTask") })
          launchTask(m.t)
        end sub
        sub c()
          m.t.control = "STOP"
          m.addFields({ t: createObject("roSGNode", "LoadTask") })
          launchTask(m.t)
        end sub
      `),
    ).toHaveLength(0);
  });

  it('passes a helper that stops the node and then assigns a new one', () => {
    expect(
      check(`
        sub resetRun()
          m.task.control = "STOP"
          m.task = createObject("roSGNode", "LoadTask")
        end sub
        sub start()
          resetRun()
          launchTask(m.task)
        end sub
      `),
    ).toHaveLength(0);
  });

  it('passes a helper that stops the node and releases it (ExtrasRowList.cancelRun)', () => {
    expect(
      check(`
        sub cancelRun()
          m.task.control = "STOP"
          m.task = invalid
        end sub
        sub start()
          cancelRun()
          m.task = createObject("roSGNode", "LoadTask")
          launchTask(m.task)
        end sub
      `),
    ).toHaveLength(0);
  });

  it('passes a launch inside a callback after the outer function stopped the node', () => {
    expect(
      stopFindings(`
        sub a()
          m.t.control = "STOP"
          promises.chain(req, {}).then(sub(res as object, ctx as object)
            launchTask(m.t)
          end sub)
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
      stopFindings(`
        sub a()
          m.a.control = "STOP"
          launchTask(m.b)
        end sub
      `),
    ).toHaveLength(0);
  });

  it('passes a STOP in one function and a launch in another (no call between)', () => {
    expect(
      stopFindings(`
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
      stopFindings(`
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

describe('no-same-node-relaunch — a long-lived node launched again', () => {
  it('flags a launch after only an input write (MoviePresenter.loadLogo before the fix)', () => {
    const found = check(`
      class Presenter
        sub loadLogo(itemId as string)
          m.view.loadLogoTask.unobserveField("content")
          m.view.loadLogoTask.itemId = itemId
          m.view.loadLogoTask.observeField("content", "onLogoLoaded")
          launchTask(m.view.loadLogoTask)
        end sub
      end class
    `);
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/`m\.view\.loadlogotask` is launched without a new node/);
    expect(found[0].location.range.start.line).toBe(6);
  });

  it('flags a relaunch from the node’s own delivery handler (the TV guide’s paging, #991)', () => {
    // schedule.onChannelsLoaded before #991: no STOP anywhere, and inside its own
    // observer the node still reads `run`, so page 2 was dropped every time.
    const found = check(`
      sub loadChannels()
        m.LoadChannelsTask = createObject("roSGNode", "LoadChannelsTask")
        m.LoadChannelsTask.observeField("channels", "onChannelsLoaded")
        launchTask(m.LoadChannelsTask)
      end sub
      sub onChannelsLoaded()
        m.LoadChannelsTask.startIndex = m.LoadChannelsTask.startIndex + 25
        launchTask(m.LoadChannelsTask)
      end sub
    `);
    expect(found).toHaveLength(1);
    expect(found[0].location.range.start.line).toBe(8);
  });

  it('flags a launch from a later callback of a node created elsewhere', () => {
    expect(
      check(`
        sub init()
          m.task = createObject("roSGNode", "LoadItemsTask")
        end sub
        sub refresh()
          launchTask(m.task)
        end sub
      `),
    ).toHaveLength(1);
  });

  it('passes a node assigned in the same function, directly or by replaceTask', () => {
    expect(
      check(`
        sub init()
          m.task = createObject("roSGNode", "LoadItemsTask")
          launchTask(m.task)
        end sub
        sub refresh()
          m.task = replaceTask(m.task, "LoadItemsTask", "content", {})
          launchTask(m.task)
        end sub
      `),
    ).toHaveLength(0);
  });

  it('passes a node assigned by a same-file helper, one hop', () => {
    expect(
      check(`
        sub freshTask()
          m.task = createObject("roSGNode", "LoadItemsTask")
        end sub
        sub refresh()
          freshTask()
          launchTask(m.task)
        end sub
      `),
    ).toHaveLength(0);
  });

  it('does not check a local, which is assigned where the reader can see it', () => {
    expect(
      check(`
        sub launch()
          task = m.top.task
          launchTask(task)
        end sub
      `),
    ).toHaveLength(0);
  });

  it('reports a STOP-then-relaunch once, not once per finding', () => {
    const found = check(`
      sub reload()
        m.task.control = "STOP"
        launchTask(m.task)
      end sub
    `);
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/is stopped and relaunched/);
  });

  it('honors the next-line suppression, where an audited-safe site states why', () => {
    expect(
      check(`
        sub startLoader()
          ' bsc-disable-next-line no-same-node-relaunch callers wait for state = "stop"
          launchTask(m.loader)
        end sub
      `),
    ).toHaveLength(0);
  });

  it('lets a pending entry cover this shape as well as the STOP one', () => {
    const pending = plugin.withPendingMigrations({
      'components/Foo.bs': [['refresh', 'm.task']],
    });
    const found = diagnosticsByCode(
      runPluginOnSource(pending, {
        'components/Foo.bs': `
          sub refresh()
            m.task.itemId = "1"
            launchTask(m.task)
          end sub
        `,
      }),
      CODE,
    );
    expect(found).toHaveLength(0);
  });
});

describe('no-same-node-relaunch — a replaced node’s handler must check the event first', () => {
  const replacer = `
    sub load()
      m.task = replaceTask(m.task, "LoadItemsTask", "content", {})
      m.task.observeField("content", "onLoaded")
      launchTask(m.task)
    end sub
  `;
  const withHandler = (body) =>
    check(`${replacer}\nsub onLoaded(event as object)\n${body}\nend sub`);

  it('flags a handler that reads the node before the guard', () => {
    const found = withHandler(`
      data = m.task.content
      if not isCurrentTaskEvent(event, m.task) then return
    `);
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(
      /`onloaded\(\)` handles `m\.task`.*does not open with the isCurrentTaskEvent\(\) guard/,
    );
  });

  it('flags a side effect before the guard (a spinner stop)', () => {
    expect(
      withHandler(`
        stopLoadingSpinner()
        if not isCurrentTaskEvent(event, m.task) then return
      `),
    ).toHaveLength(1);
  });

  it('flags a guard inside an if body rather than its condition', () => {
    expect(
      withHandler(`
        if isValid(m.task)
          if not isCurrentTaskEvent(event, m.task) then return
        end if
      `),
    ).toHaveLength(1);
  });

  it('passes the guard first, alone or inside a wider condition', () => {
    expect(withHandler('  if not isCurrentTaskEvent(event, m.task) then return')).toHaveLength(0);
    expect(
      withHandler('  if not isValid(m.view) or not isCurrentTaskEvent(event, m.task) then return'),
    ).toHaveLength(0);
  });

  it('allows logging ahead of the guard (BaseGridView.onItemDataLoaded)', () => {
    expect(
      withHandler(`
        m.log.debug("start onLoaded()")
        print "loaded"
        if not isCurrentTaskEvent(event, m.task) then return
      `),
    ).toHaveLength(0);
  });

  it('does not follow a handler that lives in another file', () => {
    expect(check(replacer)).toHaveLength(0);
  });

  it('ignores observers of a node the file never replaces', () => {
    expect(
      check(`
        sub init()
          m.timer.observeField("fire", "onFire")
        end sub
        sub onFire()
          m.count = m.count + 1
        end sub
      `),
    ).toHaveLength(0);
  });

  it('honors the next-line suppression above the opening statement', () => {
    expect(
      withHandler(`
        ' bsc-disable-next-line no-same-node-relaunch reads only the event
        data = event.getData()
      `),
    ).toHaveLength(0);
  });
});

describe('no-same-node-relaunch — pending migrations', () => {
  const PATH = 'components/Foo.bs';
  const pendingPlugin = plugin.withPendingMigrations({ [PATH]: [['search', 'm.searchTask']] });
  const unmigrated = `
    sub search()
      m.searchTask.control = "STOP"
      launchTask(m.searchTask)
    end sub
  `;
  const migrated = `
    sub search()
      m.searchTask.control = "STOP"
      m.searchTask = createObject("roSGNode", "SearchTask")
      launchTask(m.searchTask)
    end sub
  `;
  const run = (source, path = PATH) =>
    diagnosticsByCode(runPluginOnSource(pendingPlugin, { [path]: source }), CODE);

  it('does not flag a listed site', () => {
    expect(run(unmigrated)).toHaveLength(0);
  });

  it('flags a listed site once it is migrated, naming the entry to delete', () => {
    const found = run(migrated);
    expect(found).toHaveLength(1);
    // The entry is echoed back AS WRITTEN, so it can be found by eye in the list.
    expect(found[0].message).toMatch(
      /`search\(\)` does not relaunch `m\.searchTask` in any way this rule flags/,
    );
    expect(found[0].message).toMatch(/delete its PENDING_MIGRATIONS entry/);
    expect(found[0].location.range.start.line).toBe(1);
  });

  it('does not claim the migration is done — it cannot tell that from a wrong entry', () => {
    // Same diagnostic, reached by an entry that never matched rather than by a
    // finished migration. A message asserting either would be wrong half the time.
    const wrong = plugin.withPendingMigrations({ [PATH]: [['search', 'm.typoTask']] });
    const found = diagnosticsByCode(runPluginOnSource(wrong, { [PATH]: unmigrated }), CODE);
    const stale = found.filter((d) => d.message.includes('m.typoTask'));
    expect(stale).toHaveLength(1);
    expect(stale[0].message).toMatch(/if the entry is wrong, correct it/);
    expect(stale[0].message).not.toMatch(/migration is done|no longer relaunches/);
  });

  it('flags a listed site whose function was deleted', () => {
    expect(run(`sub other()\nend sub`)).toHaveLength(1);
  });

  it('covers only the listed launch: a second one in the same function is flagged', () => {
    const found = run(`
      sub search()
        m.searchTask.control = "STOP"
        launchTask(m.searchTask)
        m.searchTask.control = "STOP"
        launchTask(m.searchTask)
      end sub
    `);
    expect(found).toHaveLength(1);
    expect(found[0].location.range.start.line).toBe(5);
  });

  it('does not cover the same function and path in another file', () => {
    const found = diagnosticsByCode(
      runPluginOnSource(pendingPlugin, { [PATH]: unmigrated, 'components/Bar.bs': unmigrated }),
      CODE,
    );
    expect(found).toHaveLength(1);
    expect(found[0].location.uri).toMatch(/Bar\.bs$/);
  });

  it('flags a listed file that is not in the build, on the plugin file', () => {
    const found = run(unmigrated, 'components/Bar.bs').filter((d) =>
      d.message.includes('not in the build'),
    );
    expect(found).toHaveLength(1);
    expect(found[0].message).toMatch(/PENDING_MIGRATIONS lists `components\/Foo\.bs`/);
    expect(found[0].location.uri).toMatch(/no-same-node-relaunch\.cjs$/);
  });

  it('clears the missing-file error once the listed file is in the build', () => {
    const steps = runPluginOnEdits(pendingPlugin, [
      { 'components/Bar.bs': 'sub other()\nend sub' },
      { [PATH]: unmigrated },
    ]).map((diagnostics) => diagnosticsByCode(diagnostics, CODE).length);
    expect(steps).toEqual([1, 0]);
  });

  it('points each missing-file error at that entry in the plugin', () => {
    // Deliberately NOT keyed to a particular entry: the list shrinks as sites are migrated,
    // and an assertion naming one of them fails the day it is deleted (it did). Every
    // diagnostic must name the line its own path is written on; an empty list has none to
    // check, which is the state this whole mechanism is working toward.
    const found = diagnosticsByCode(
      runPluginOnSource(plugin, { 'components/Unrelated.bs': 'sub a()\nend sub' }),
      CODE,
    ).filter((d) => d.message.includes('not in the build'));
    const lines = readFileSync(PLUGIN_PATH, 'utf8').split(/\r?\n/);
    // One per listed file (none is in this tiny build), so a change to the message
    // wording cannot empty the filter and leave the loop below checking nothing.
    expect(found).toHaveLength(Object.keys(plugin.PENDING_MIGRATIONS).length);
    for (const diagnostic of found) {
      const path = diagnostic.message.match(/PENDING_MIGRATIONS lists `([^`]+)`/)[1];
      expect(lines[diagnostic.location.range.start.line]).toContain(`'${path}'`);
    }
  });

  it('clears and re-raises the migrated finding as the file is edited', () => {
    const steps = runPluginOnEdits(pendingPlugin, [
      { [PATH]: unmigrated },
      { [PATH]: migrated },
      { [PATH]: unmigrated },
    ]).map((diagnostics) => diagnosticsByCode(diagnostics, CODE).length);
    expect(steps).toEqual([0, 1, 0]);
  });
});

// Every way a PENDING_MIGRATIONS entry can fail to line up with the code.
//
// This table is the gate behind the claim that the list "can only shrink". Each
// row is a state an entry can land in; the contract is that EVERY state produces
// at least one actionable diagnostic naming what to do. Seven of the eight were
// found silent or self-contradictory during review — silence is the failure this
// table exists to prevent, because a silent entry stops covering its site AND
// stops the rule from guarding it, with nothing on screen either way.
//
// Adding a ninth state means adding a row, which forces the question of what the
// plugin should say for it.
describe('no-same-node-relaunch — every state a pending entry can be in', () => {
  const PATH = 'components/Foo.bs';
  const relaunches = `
    sub search()
      m.searchTask.control = "STOP"
      launchTask(m.searchTask)
    end sub
  `;
  const migrated = `
    sub search()
      m.searchTask.control = "STOP"
      m.searchTask = createObject("roSGNode", "SearchTask")
      launchTask(m.searchTask)
    end sub
  `;

  const STATES = [
    {
      state: 'entry matches the code — the only quiet case',
      pending: { [PATH]: [['search', 'm.searchTask']] },
      files: { [PATH]: relaunches },
      expect: null,
    },
    {
      state: 'site was migrated',
      pending: { [PATH]: [['search', 'm.searchTask']] },
      files: { [PATH]: migrated },
      expect: /does not relaunch `m\.searchTask` in any way this rule flags/,
      recovers: true,
    },
    {
      state: 'function was renamed',
      pending: { [PATH]: [['search', 'm.searchTask']] },
      files: { [PATH]: relaunches.replace('search()', 'searchV2()') },
      expect: /no function or method by that name is there/,
      recovers: true,
    },
    {
      state: 'function became a class method',
      pending: { [PATH]: [['reload', 'm.searchTask']] },
      files: {
        [PATH]: `
          class Loader
            sub reload()
              m.searchTask.control = "STOP"
              launchTask(m.searchTask)
            end sub
          end class
        `,
      },
      expect: null, // a method is nameable, so the entry simply matches
    },
    {
      state: 'entry names a path the function never relaunches',
      pending: { [PATH]: [['search', 'm.typoTask']] },
      files: { [PATH]: relaunches },
      expect: /`search\(\)` does not relaunch `m\.typoTask`/,
    },
    {
      state: 'file is not in the build',
      pending: { 'components/Gone.bs': [['search', 'm.searchTask']] },
      files: { [PATH]: 'sub noop()\nend sub' },
      expect: /is not in the build/,
    },
    {
      state: 'file is one the rule never inspects',
      pending: { 'components/vendor/Dep.bs': [['search', 'm.searchTask']] },
      files: { 'components/vendor/Dep.bs': relaunches },
      expect: /this rule never inspects/,
    },
    {
      state: 'file key is cased differently from the real file',
      pending: { 'components/foo.bs': [['search', 'm.searchTask']] },
      files: { [PATH]: relaunches },
      expect: /but the file in the build is/,
    },
    {
      state: 'entry is listed twice',
      pending: {
        [PATH]: [
          ['search', 'm.searchTask'],
          ['search', 'm.searchTask'],
        ],
      },
      files: { [PATH]: relaunches },
      expect: /more than once/,
    },
    {
      state: 'listed file was emptied out',
      pending: { [PATH]: [['search', 'm.searchTask']] },
      files: { [PATH]: "' nothing here" },
      expect: /no function or method by that name is there/,
      recovers: true,
    },
    {
      state: 'file key names a file that is not BrightScript',
      pending: { 'components/Foo.xml': [['search', 'm.searchTask']] },
      files: {
        'components/Foo.xml':
          '<?xml version="1.0" encoding="utf-8"?>\n<component name="Foo" extends="Group" />',
        [PATH]: relaunches,
      },
      expect: /is not a BrightScript file/,
    },
  ];

  for (const { state, pending, files, expect: wanted } of STATES) {
    it(state, () => {
      const found = diagnosticsByCode(
        runPluginOnSource(plugin.withPendingMigrations(pending), files),
        CODE,
      );
      if (wanted === null) {
        expect(found.map((d) => d.message)).toEqual([]);
        return;
      }
      expect(found.some((d) => wanted.test(d.message))).toBe(true);
    });
  }

  // A state an edit to the CODE can resolve must clear once it is resolved, in the
  // same program — which is what the language server keeps between keystrokes. A
  // single validation cannot see this: a diagnostic anchored outside the file that
  // produced it is never cleared when that file re-validates, so it outlives the
  // fix. Every recoverable row's entry names `search` / `m.searchTask`, so
  // `relaunches` is the code that matches it again.
  for (const { state, pending, files } of STATES.filter((row) => row.recovers)) {
    it(`${state} — clears once the code matches the entry again`, () => {
      const steps = runPluginOnEdits(plugin.withPendingMigrations(pending), [
        files,
        { [PATH]: relaunches },
      ]).map((diagnostics) => diagnosticsByCode(diagnostics, CODE).map((d) => d.message));
      expect(steps[0]).not.toEqual([]);
      expect(steps[1]).toEqual([]);
    });
  }

  // An entry in a file the rule cannot check has one remedy — delete it — so the
  // file gets one error, not a second per entry that cannot be acted on. The key
  // listed AFTER it must still be audited: reading functions out of a file that
  // has none throws, and the never-crash guard would swallow the rest of the list.
  it('reports an uncheckable file once, and still audits the keys after it', () => {
    for (const key of ['components/vendor/Dep.bs', 'components/Foo.xml']) {
      const found = diagnosticsByCode(
        runPluginOnSource(
          plugin.withPendingMigrations({
            [key]: [
              ['gone', 'm.aTask'],
              ['alsoGone', 'm.bTask'],
            ],
            'components/Gone.bs': [['search', 'm.searchTask']],
          }),
          {
            'components/vendor/Dep.bs': 'sub noop()\nend sub',
            'components/Foo.xml':
              '<?xml version="1.0" encoding="utf-8"?>\n<component name="Foo" extends="Group" />',
          },
        ),
        CODE,
      );
      const messages = found.map((d) => d.message);
      expect(messages).toHaveLength(2);
      expect(messages.filter((m) => m.includes(`\`${key}\``))).toHaveLength(1);
      expect(messages.filter((m) => m.includes('`components/Gone.bs`'))).toHaveLength(1);
    }
  });

  // The review found states where the plugin said, of ONE node, both "this is
  // relaunched" and "this is no longer relaunched" — following either message
  // left the other standing. Two claims about DIFFERENT nodes are not a
  // contradiction: an entry naming `m.typoTask` while the code relaunches
  // `m.searchTask` yields both, and together they pinpoint the typo.
  it('never makes both claims about the same node', () => {
    const pathsIn = (messages, pattern) =>
      new Set(messages.map((m) => m.match(pattern)?.[1]?.toLowerCase()).filter(Boolean));

    for (const { state, pending, files } of STATES) {
      const messages = diagnosticsByCode(
        runPluginOnSource(plugin.withPendingMigrations(pending), files),
        CODE,
      ).map((d) => d.message);
      const live = pathsIn(messages, /^`([^`]+)` is stopped/);
      const retired = pathsIn(messages, /does not stop and relaunch `([^`]+)`/);
      const both = [...live].filter((path) => retired.has(path));
      expect(`${state}: ${both.join(',')}`).toBe(`${state}: `);
    }
  });
});

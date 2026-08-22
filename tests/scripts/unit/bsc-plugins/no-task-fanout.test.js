// Tests for the no-task-fanout plugin.
//
// Plugin under test: scripts/bsc-plugins/no-task-fanout.cjs
// Diagnostic code: no-task-fanout
//
// What the plugin enforces: a Task launch inside a loop spawns one thread per
// iteration, so the concurrent count scales with server data. That is the shape
// epic #728 (`&h29` "too many task threads") actually took, in HomeRows'
// per-library latest-media fan-out removed by PR #762.
//
// The interesting edge is that NOT every in-loop launch is a fan-out. The live
// `HomeRows.startParallelLoads()` loops over `m.sectionPlan` and launches four
// fixed `m.<field>` slots — the same node however many times the loop turns —
// so the discriminator is the ARGUMENT's stability, not the loop itself. Get
// that wrong in either direction and the rule is useless: too loose and it
// misses #728, too tight and it fails the codebase on day one.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import noTaskFanoutPlugin from '../../../../scripts/bsc-plugins/no-task-fanout.cjs';

const CODE = 'no-task-fanout';

/** Runs the plugin over one component file and returns just its diagnostics. */
function check(source, path = 'components/Foo.bs') {
  return diagnosticsByCode(runPluginOnSource(noTaskFanoutPlugin, { [path]: source }), CODE);
}

describe('no-task-fanout', () => {
  describe('the #728 shape', () => {
    it('flags a node constructed and launched inside a for-each — the HomeRows fan-out', () => {
      // Reduced from HomeRows.bs as it stood before c59e96a1: one
      // LoadItemsTask per library, all launched in the same pass.
      expect(
        check(`
          sub startLatestMediaLoads()
            for each library in m.filteredLatest
              loadLatest = createObject("roSGNode", "LoadItemsTask")
              m.latestMediaTasks.push(loadLatest)
              launchTask(loadLatest)
            end for
          end sub
        `),
      ).toHaveLength(1);
    });

    it('flags launching the loop variable itself', () => {
      expect(
        check(`
          sub go()
            for each task in m.pendingTasks
              launchTask(task)
            end for
          end sub
        `),
      ).toHaveLength(1);
    });

    it('flags a helper call result — the node is built fresh per iteration', () => {
      expect(
        check(`
          sub go()
            for each library in libraries
              launchTask(makeLoaderFor(library))
            end for
          end sub
        `),
      ).toHaveLength(1);
    });

    it('flags a bare `m` — the scope object is not a task slot', () => {
      // Guards `isStableSlot`'s `current !== expression` check. Without it a
      // bare `m` satisfies "variable named m" and the whole loop body goes
      // unchecked. Found by mutation: the line had no test at all.
      expect(
        check(`
          sub go()
            for each item in items
              launchTask(m)
            end for
          end sub
        `),
      ).toHaveLength(1);
    });

    it('flags an indexed step, which is a per-iteration node wearing an m. prefix', () => {
      // The gap a naive "starts with m." check would leave open.
      expect(
        check(`
          sub go()
            for i = 0 to m.tasks.count() - 1
              launchTask(m.tasks[i])
            end for
          end sub
        `),
      ).toHaveLength(1);
    });
  });

  describe('loop forms', () => {
    it('flags inside a counted for loop', () => {
      expect(
        check(`
          sub go()
            for i = 0 to 9
              launchTask(buildTask(i))
            end for
          end sub
        `),
      ).toHaveLength(1);
    });

    it('flags inside a while loop', () => {
      expect(
        check(`
          sub go()
            while m.queue.count() > 0
              launchTask(m.queue.pop())
            end while
          end sub
        `),
      ).toHaveLength(1);
    });

    it('yields one diagnostic for a site inside nested loops', () => {
      // The walk enters the body of every loop, so an inner call is reached
      // twice at an identical position (measured). This asserts the observable
      // contract — one diagnostic per site — which is what a reader needs.
      //
      // It deliberately does NOT claim to cover the plugin's own dedup guard:
      // `diagnostics.register` collapses identical diagnostics too, so this
      // test passes with that guard removed. Verified by mutation rather than
      // assumed. The guard earns its place by not depending on undocumented
      // compiler behaviour, not by being separately observable here.
      expect(
        check(`
          sub go()
            for each row in m.rows
              for each item in row.items
                launchTask(makeTask(item))
              end for
            end for
          end sub
        `),
      ).toHaveLength(1);
    });
  });

  describe('what must NOT be flagged', () => {
    it('allows a fixed m.<field> slot in a loop — the live HomeRows shape', () => {
      // startParallelLoads() loops over m.sectionPlan and launches four
      // singleton slots. Flagging this would fail the codebase on day one.
      expect(
        check(`
          sub startParallelLoads()
            for each section in m.sectionPlan
              if section.type = "resume"
                launchTask(m.LoadContinueWatchingTask)
              else if section.type = "nextup"
                launchTask(m.LoadNextUpTask)
              end if
            end for
          end sub
        `),
      ).toHaveLength(0);
    });

    it('allows a deeper stable path such as m.view.loadLogoTask', () => {
      // MoviePresenter.bs launches through exactly this shape.
      expect(
        check(`
          sub go()
            for each item in items
              launchTask(m.view.loadLogoTask)
            end for
          end sub
        `),
      ).toHaveLength(0);
    });

    it('allows a launch outside any loop, whatever the argument', () => {
      expect(
        check(`
          sub go()
            task = CreateObject("roSGNode", "ServerReachableTask")
            launchTask(task)
          end sub
        `),
      ).toHaveLength(0);
    });

    it('leaves non-launch calls in a loop alone', () => {
      expect(
        check(`
          sub go()
            for each item in items
              processItem(item)
              m.rows.appendChild(item)
            end for
          end sub
        `),
      ).toHaveLength(0);
    });
  });

  describe('scope and escape hatches', () => {
    it('does not flag the launchTask wrapper itself', () => {
      expect(
        check(
          `
            sub retryAll()
              for each node in m.pending
                launchTask(node)
              end for
            end sub
          `,
          'source/utils/tasks.bs',
        ),
      ).toHaveLength(0);
    });

    it('does not flag vendored code we do not author', () => {
      expect(
        check(
          `
            sub go()
              for each t in tasks
                launchTask(t)
              end for
            end sub
          `,
          'components/vendor/Thing.bs',
        ),
      ).toHaveLength(0);
    });

    it('honours bsc-disable-line on the offending line', () => {
      expect(
        check(`
          sub go()
            for each t in tasks
              launchTask(t) ' bsc-disable-line no-task-fanout
            end for
          end sub
        `),
      ).toHaveLength(0);
    });

    it('honours bsc-disable-next-line on the line above', () => {
      expect(
        check(`
          sub go()
            for each t in tasks
              ' bsc-disable-next-line no-task-fanout
              launchTask(t)
            end for
          end sub
        `),
      ).toHaveLength(0);
    });
  });

  it('reports at Error severity, matching no-raw-run', () => {
    const [diagnostic] = check(`
      sub go()
        for each t in tasks
          launchTask(t)
        end for
      end sub
    `);
    expect(diagnostic.severity).toBe(1);
  });
});

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
// so the discriminator is the ARGUMENT, not the loop itself. Get that wrong in
// either direction and the rule is useless: too loose and it misses #728, too
// tight and it fails the codebase on day one.
//
// An `m.` path is only that same node while the loop leaves it alone, so the
// exemption has a second half: a slot the body REBINDS is a fresh node per turn
// wearing a stable name. Those two halves are what the first two describe blocks
// pull on from opposite sides.

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
      // Guards the `path === SELF_REFERENCE` rejection in `stableSlotPath`.
      // Without it a bare `m` satisfies "dotted path rooted at m" and the whole
      // loop body goes unchecked. Found by mutation: the line had no test at all.
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

    it('flags a fresh node parked in a stable m. slot each turn', () => {
      // The one-token escape from every other assertion in this block: hoist the
      // flagged local into an `m.` field and the stable-slot exemption applies,
      // while the fan-out is untouched — nothing STOPs the previous node and the
      // loop never waits. The shape is idiomatic here (QueueManager and JRScene
      // both build Task nodes straight into an `m.` slot at a call site), which
      // is why the exemption has to ask whether the loop rebinds the slot.
      expect(
        check(`
          sub go()
            for each lib in m.libs
              m.loader = createObject("roSGNode", "LoadItemsTask")
              launchTask(m.loader)
            end for
          end sub
        `),
      ).toHaveLength(1);
    });

    it('flags a rebind of a PARENT of the launched path', () => {
      // `m.view = <fresh>` makes `m.view.task` a different node every turn just
      // as surely as rebinding the leaf does, so the check walks prefixes.
      expect(
        check(`
          sub go()
            for each item in items
              m.view = createObject("roSGNode", "RowView")
              launchTask(m.view.task)
            end for
          end sub
        `),
      ).toHaveLength(1);
    });

    it('flags a rebind that happens AFTER the launch in the body', () => {
      // Source order does not matter — the second turn launches a node the first
      // turn's tail rebound.
      expect(
        check(`
          sub go()
            for each item in items
              launchTask(m.loader)
              m.loader = createObject("roSGNode", "LoadItemsTask")
            end for
          end sub
        `),
      ).toHaveLength(1);
    });

    it('flags a rebind nested inside an if', () => {
      // The rebind is collected from the whole loop subtree, not just the body's
      // top-level statements.
      expect(
        check(`
          sub go()
            for each lib in m.libs
              if lib.enabled
                m.loader = createObject("roSGNode", "LoadItemsTask")
              end if
              launchTask(m.loader)
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

    it('allows a sibling field write that is not the launched slot', () => {
      // startParallelLoads() writes m.isLoadingResume in the same body it
      // launches m.LoadContinueWatchingTask from. Matching too loosely here —
      // "any m. write in the loop" — would fail the live codebase.
      expect(
        check(`
          sub startParallelLoads()
            for each section in m.sectionPlan
              m.isLoadingResume = true
              launchTask(m.LoadContinueWatchingTask)
            end for
          end sub
        `),
      ).toHaveLength(0);
    });

    it('allows a write to a CHILD of the launched slot', () => {
      // Configuring the node (m.LoadNextUpTask.itemId = ...) is not rebinding
      // it: the slot still holds the same node. Only the path itself or one of
      // its parents counts.
      expect(
        check(`
          sub go()
            for each section in m.sectionPlan
              m.LoadNextUpTask.itemId = section.id
              launchTask(m.LoadNextUpTask)
            end for
          end sub
        `),
      ).toHaveLength(0);
    });

    it('flags a rebind spelled as a literal-key index, read back dotted', () => {
      // The two spellings name the same field, so a write in one and a launch
      // in the other is the same fan-out. Collected by `slotsAssignedIn`.
      expect(
        check(`
          sub go()
            for each lib in m.libs
              m["loader"] = createObject("roSGNode", "LoadItemsTask")
              launchTask(m.loader)
            end for
          end sub
        `),
      ).toHaveLength(1);
    });

    it('flags a literal-key rebind of a PARENT of the launched path', () => {
      expect(
        check(`
          sub go()
            for each lib in m.libs
              m["view"] = buildView(lib)
              launchTask(m.view.task)
            end for
          end sub
        `),
      ).toHaveLength(1);
    });

    it('allows a literal-key write to a DIFFERENT field than the launched slot', () => {
      // The literal-key collection must stay keyed on the field name, not
      // degrade into "any bracket write rebinds everything".
      expect(
        check(`
          sub go()
            for each lib in m.libs
              m["pending"] = true
              launchTask(m.loader)
            end for
          end sub
        `),
      ).toHaveLength(0);
    });

    it('allows a COMPUTED-index write, which names no knowable field', () => {
      // Deliberate: treating an unknowable target as rebinding every slot
      // would flag correct code to guard a shape nobody writes.
      expect(
        check(`
          sub go()
            for each lib in m.libs
              m[lib.key] = lib.name
              launchTask(m.loader)
            end for
          end sub
        `),
      ).toHaveLength(0);
    });

    it('matches a literal-key rebind case-insensitively, as BrightScript does', () => {
      // AA keys are case-insensitive, so `m["Loader"]` and `m.loader` are one
      // field. Without the lowercasing, this rebind slips the check.
      expect(
        check(`
          sub go()
            for each lib in m.libs
              m["Loader"] = createObject("roSGNode", "LoadItemsTask")
              launchTask(m.loader)
            end for
          end sub
        `),
      ).toHaveLength(1);
    });

    it('flags a launch whose arity is not one, rather than assuming it safe', () => {
      // Holds the "report rather than assume safe" posture for any launch
      // shape the stability check cannot read.
      expect(
        check(`
          sub go()
            for each lib in m.libs
              launchTask()
            end for
          end sub
        `),
      ).toHaveLength(1);
    });

    it('allows a rebind that sits OUTSIDE the loop', () => {
      // Built once, launched many times against the same node — the shape the
      // exemption exists for.
      expect(
        check(`
          sub go()
            m.loader = createObject("roSGNode", "LoadItemsTask")
            for each item in items
              launchTask(m.loader)
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

  describe('accepted over-reporting', () => {
    it('flags a lazily-initialized singleton, which builds only one node', () => {
      // Deliberate. The rule does not reason about which branch ran, so a guarded
      // build inside the loop reads as a rebind. Absent from the codebase and one
      // suppression comment away; over-reporting a launch beats under-reporting
      // one on an Error-severity thread-budget guard.
      expect(
        check(`
          sub go()
            for each item in items
              if not isValid(m.loader)
                m.loader = createObject("roSGNode", "LoadItemsTask")
              end if
              launchTask(m.loader)
            end for
          end sub
        `),
      ).toHaveLength(1);
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

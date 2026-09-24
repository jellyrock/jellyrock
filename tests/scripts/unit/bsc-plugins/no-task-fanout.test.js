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
// The interesting edge is that NOT every in-loop launch is a fan-out. A loop
// that launches a fixed `m.<field>` slot launches the same node however many
// times it turns, so the discriminator is the ARGUMENT, not the loop itself. Get
// that wrong in either direction and the rule is useless: too loose and it
// misses #728, too tight and it flags bounded code nobody can fix.
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
  describe('the launch ARGUMENT is unstable — the #728 shape', () => {
    // Half one of the rule: the thing being launched is a different node on
    // every turn, whatever it is called.
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
  });

  describe('the loop REBINDS the slot — spelling 1, a dotted assignment', () => {
    // Half two, and the half a first version of this rule got wrong. An `m.` path
    // names one node only while the loop leaves it alone; hoisting a flagged local
    // into an `m.` field is the first thing someone reaches for to clear the
    // diagnostic, so exempting it would have taught the bypass. Each spelling of a
    // write gets its own block below; this one is the plain dotted assignment.
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

    it('flags a rebind in the OUTER loop when the launch sits in an inner one', () => {
      // The inner loop's own body rebinds nothing, so only the outer pass can
      // see this. Pinned because it depends on the walk reaching loops
      // outermost-first, which is not obvious from reading the visitor.
      expect(
        check(`
          sub go()
            for each a in m.sections
              m.loader = createObject("roSGNode", "LoadItemsTask")
              for each b in a.items
                launchTask(m.loader)
              end for
            end for
          end sub
        `),
      ).toHaveLength(1);
    });

    it('flags a rebind in an INNER loop when the launch follows it', () => {
      // The mirror case: the rebind is nested deeper than the launch. The
      // assigned-path set is collected from the whole subtree, so it is seen.
      expect(
        check(`
          sub go()
            for each a in m.sections
              for each b in a.items
                m.loader = createObject("roSGNode", "LoadItemsTask")
              end for
              launchTask(m.loader)
            end for
          end sub
        `),
      ).toHaveLength(1);
    });

    it('allows a sibling field write that is not the launched slot', () => {
      // A loading flag written beside the launch it guards, as HomeRows'
      // section loads once did in this loop. Matching too loosely here — "any
      // m. write in the loop" — would flag every guarded launch.
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
  });

  describe('rebind spelling 2 — a literal-key index', () => {
    // `m["loader"]` and `m.loader` are one field in BrightScript, so the check has
    // to read both spellings or mixing them across the write and the launch slips
    // it. A COMPUTED key names nothing knowable and is deliberately not collected.
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
  });

  describe('rebind spelling 3 — a literal-AA setFields / addFields', () => {
    // The spelling with real precedent: `globals.bs` parks Task nodes with
    // `m.global.addFields({ ... })`. The negative cases here are the load-bearing
    // ones — each guards the FALSE-POSITIVE direction, which is the costlier one
    // for an Error-severity rule.
    it('flags a rebind through a literal-AA setFields', () => {
      // The third write spelling, and the one with real precedent —
      // `globals.bs` parks Task nodes via addFields exactly this way.
      expect(
        check(`
          sub go()
            for each lib in m.libs
              m.view.setFields({ task: makeTask(lib) })
              launchTask(m.view.task)
            end for
          end sub
        `),
      ).toHaveLength(1);
    });

    it('flags a rebind through addFields', () => {
      expect(
        check(`
          sub go()
            for each lib in m.libs
              m.global.addFields({ loader: makeTask(lib) })
              launchTask(m.global.loader)
            end for
          end sub
        `),
      ).toHaveLength(1);
    });

    it('matches an AA key case-insensitively, as BrightScript fields are', () => {
      // `{ Task: … }` and `m.view.task` are one field. Without lowercasing the
      // AA key, the rebind is not matched and the launch slips through.
      expect(
        check(`
          sub go()
            for each lib in m.libs
              m.view.setFields({ Task: makeTask(lib) })
              launchTask(m.view.task)
            end for
          end sub
        `),
      ).toHaveLength(1);
    });

    it('allows a setFields that writes a DIFFERENT field than the launched slot', () => {
      expect(
        check(`
          sub go()
            for each lib in m.libs
              m.view.setFields({ title: lib.name, visible: true })
              launchTask(m.view.task)
            end for
          end sub
        `),
      ).toHaveLength(0);
    });

    it('allows a NON-literal setFields, whose keys are not knowable', () => {
      // Same documented limitation as no-raw-run: flagging every non-literal
      // setFields to chase soundness would false-positive across the codebase.
      expect(
        check(`
          sub go()
            for each lib in m.libs
              m.view.setFields(buildFields(lib))
              launchTask(m.view.task)
            end for
          end sub
        `),
      ).toHaveLength(0);
    });

    it('does not treat an ordinary method taking an AA as a field write', () => {
      // Guards the setFields/addFields name filter. Without it ANY dotted call
      // with a literal AA would mark its keys rebound, turning correct code
      // into a false positive — the costlier direction for a build error.
      expect(
        check(`
          sub go()
            for each lib in m.libs
              m.view.configure({ task: lib.id })
              launchTask(m.view.task)
            end for
          end sub
        `),
      ).toHaveLength(0);
    });

    it('does not treat a setFields on a NON-m target as rebinding an m. slot', () => {
      // The write has to be rooted at `m` to touch an `m.` slot. Without that
      // check, configuring any unrelated node in the loop would falsely flag
      // the launch.
      expect(
        check(`
          sub go()
            for each lib in m.libs
              row.setFields({ loader: lib.id })
              launchTask(m.loader)
            end for
          end sub
        `),
      ).toHaveLength(0);
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

  describe('what counts as a launch call', () => {
    it('flags a DOTTED launch call, so namespacing tasks.bs cannot silently disable the rule', () => {
      // `launchTask` is a free function today, so every call site is bare. If
      // `source/utils/tasks.bs` is ever namespaced — an active convention here,
      // 10 of 44 utils files — all 101 call sites become dotted in one commit.
      // A bare-only match would then flag NOTHING, with the plugin still loading
      // and CI still green. `no-raw-run` keys on the `control` write, so it would
      // keep passing and only this bound would vanish.
      expect(
        check(`
          sub go()
            for each lib in m.libs
              tasks.launchTask(makeLoaderFor(lib))
            end for
          end sub
        `),
      ).toHaveLength(1);
    });
  });

  describe('through a same-file helper the loop calls — one hop', () => {
    // A loop that calls a helper which launches is the same fan-out one call
    // away. The helper's body is judged exactly as a loop body would be, and the
    // diagnostic lands on the CALL in the loop, where the repetition is.

    /** The 0-based line of the first line of `source` containing `needle`. */
    const lineOf = (source, needle) => source.split('\n').findIndex((l) => l.includes(needle));

    it('flags a loop call to a helper that parks a new node and launches it — the HomeRows shape', () => {
      const source = `
        sub startParallelLoads()
          for each section in m.sectionPlan
            if section.type = "resume" then startResumeLoad()
          end for
        end sub

        sub startResumeLoad()
          if m.isLoadingResume then return
          m.resumeTask = replaceTask(m.resumeTask, "LoadItemsTask", "content", { itemsToLoad: "continue" })
          m.isLoadingResume = launchTask(m.resumeTask)
        end sub
      `;
      const diagnostics = check(source);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].location.range.start.line).toBe(
        lineOf(source, 'then startResumeLoad()'),
      );
      expect(diagnostics[0].message).toContain('startResumeLoad()');
    });

    it('flags a helper that launches a local it builds', () => {
      expect(
        check(`
          sub go()
            for each lib in m.libs
              loadOne()
            end for
          end sub

          sub loadOne()
            task = createObject("roSGNode", "LoadItemsTask")
            launchTask(task)
          end sub
        `),
      ).toHaveLength(1);
    });

    it('flags a helper launching a slot the LOOP rebinds', () => {
      expect(
        check(`
          sub go()
            for each lib in m.libs
              m.loader = createObject("roSGNode", "LoadItemsTask")
              launchLoader()
            end for
          end sub

          sub launchLoader()
            launchTask(m.loader)
          end sub
        `),
      ).toHaveLength(1);
    });

    it('allows a helper launching a stable slot nothing rebinds', () => {
      expect(
        check(`
          sub go()
            for each section in m.sectionPlan
              launchNextUp()
            end for
          end sub

          sub launchNextUp()
            launchTask(m.LoadNextUpTask)
          end sub
        `),
      ).toHaveLength(0);
    });

    it('flags a helper whose launch sits in a callback it registers — still one per call', () => {
      // Deferred is not bounded: N calls register N callbacks, and each one
      // launches. The direct rule walks into inline functions in a loop for the
      // same reason.
      expect(
        check(`
          sub go()
            for each lib in m.libs
              loadLater(lib)
            end for
          end sub

          sub loadLater(lib)
            promises.onThen(fetchSomething(lib), sub(result)
              launchTask(createObject("roSGNode", "LoadItemsTask"))
            end sub)
          end sub
        `),
      ).toHaveLength(1);
    });

    it('matches the helper name case-insensitively, as BrightScript does', () => {
      expect(
        check(`
          sub go()
            for each lib in m.libs
              LoadOne()
            end for
          end sub

          sub loadOne()
            launchTask(createObject("roSGNode", "LoadItemsTask"))
          end sub
        `),
      ).toHaveLength(1);
    });

    it('errs toward reporting when two functions share the bare name', () => {
      // A namespaced function and a global one both answer to `loadOne` here;
      // the rule does not resolve which a call reaches, so either fanning out
      // flags the call — whichever is declared last.
      expect(
        check(`
          sub go()
            for each lib in m.libs
              loadOne()
            end for
          end sub

          namespace loaders
            sub loadOne()
              launchTask(createObject("roSGNode", "LoadItemsTask"))
            end sub
          end namespace

          sub loadOne()
            launchTask(m.LoadNextUpTask)
          end sub
        `),
      ).toHaveLength(1);
    });

    it('reports each call site once — two calls, two diagnostics; nested loops, still one each', () => {
      expect(
        check(`
          sub go()
            for each a in m.outer
              for each b in a.inner
                loadOne()
              end for
              loadOne()
            end for
          end sub

          sub loadOne()
            launchTask(createObject("roSGNode", "LoadItemsTask"))
          end sub
        `),
      ).toHaveLength(2);
    });

    it('leaves a helper whose own launch sits in a loop to the direct report', () => {
      // The helper's in-loop launch is already flagged where it is; flagging
      // every caller too would report one fan-out twice.
      const source = `
        sub go()
          for each lib in m.libs
            loadAll()
          end for
        end sub

        sub loadAll()
          for each t in m.tasks
            launchTask(t)
          end for
        end sub
      `;
      const diagnostics = check(source);
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].location.range.start.line).toBe(lineOf(source, 'launchTask(t)'));
    });

    it('leaves a helper that is not called from a loop alone', () => {
      expect(
        check(`
          sub go()
            loadOne()
          end sub

          sub loadOne()
            launchTask(createObject("roSGNode", "LoadItemsTask"))
          end sub
        `),
      ).toHaveLength(0);
    });

    describe('stating the bound', () => {
      it("honours the suppression on the HELPER's launch — the helper bounds itself", () => {
        // The preferred place: the claim sits beside the guard it depends on,
        // so deleting that guard means walking past it.
        expect(
          check(`
            sub go()
              for each section in m.sectionPlan
                startResumeLoad()
              end for
            end sub

            sub startResumeLoad()
              if m.isLoadingResume then return
              m.resumeTask = replaceTask(m.resumeTask, "LoadItemsTask", "content", {})
              ' bsc-disable-next-line no-task-fanout one run at a time: the isLoadingResume guard above
              m.isLoadingResume = launchTask(m.resumeTask)
            end sub
          `),
        ).toHaveLength(0);
      });

      it("honours bsc-disable-line on the helper's launch too", () => {
        expect(
          check(`
            sub go()
              for each section in m.sectionPlan
                startResumeLoad()
              end for
            end sub

            sub startResumeLoad()
              m.resumeTask = replaceTask(m.resumeTask, "LoadItemsTask", "content", {})
              launchTask(m.resumeTask) ' bsc-disable-line no-task-fanout cancel-then-replace
            end sub
          `),
        ).toHaveLength(0);
      });

      it('honours a suppression on the call site, the line it reports', () => {
        expect(
          check(`
            sub go()
              for each section in m.sectionPlan
                ' bsc-disable-next-line no-task-fanout returns after the first match
                startResumeLoad()
              end for
            end sub

            sub startResumeLoad()
              m.resumeTask = replaceTask(m.resumeTask, "LoadItemsTask", "content", {})
              launchTask(m.resumeTask)
            end sub
          `),
        ).toHaveLength(0);
      });

      it('still flags a helper when only ONE of its launches is suppressed', () => {
        expect(
          check(`
            sub go()
              for each section in m.sectionPlan
                startBoth()
              end for
            end sub

            sub startBoth()
              m.a = replaceTask(m.a, "LoadItemsTask", "content", {})
              ' bsc-disable-next-line no-task-fanout guarded
              launchTask(m.a)
              m.b = replaceTask(m.b, "LoadItemsTask", "content", {})
              launchTask(m.b)
            end sub
          `),
        ).toHaveLength(1);
      });
    });

    describe('reach — gaps stated in the plugin, pinned so a change to them is deliberate', () => {
      it('does not follow a second hop', () => {
        expect(
          check(`
            sub go()
              for each lib in m.libs
                outer()
              end for
            end sub

            sub outer()
              inner()
            end sub

            sub inner()
              launchTask(createObject("roSGNode", "LoadItemsTask"))
            end sub
          `),
        ).toHaveLength(0);
      });

      it('does not follow a class method reached as m.helper()', () => {
        expect(
          check(`
            class Loader
              sub go()
                for each lib in m.libs
                  m.loadOne()
                end for
              end sub

              sub loadOne()
                launchTask(createObject("roSGNode", "LoadItemsTask"))
              end sub
            end class
          `),
        ).toHaveLength(0);
      });

      it('does not follow a helper declared in another file', () => {
        const diagnostics = diagnosticsByCode(
          runPluginOnSource(noTaskFanoutPlugin, {
            'components/Foo.bs': `
              sub go()
                for each lib in m.libs
                  loadOne()
                end for
              end sub
            `,
            'components/FooHelpers.bs': `
              sub loadOne()
                launchTask(createObject("roSGNode", "LoadItemsTask"))
              end sub
            `,
          }),
          CODE,
        );
        expect(diagnostics).toHaveLength(0);
      });
    });
  });

  describe('what must NOT be flagged', () => {
    it('allows a fixed m.<field> slot in a loop', () => {
      // One node per slot however many times the loop turns, so the count is
      // bounded by the source, not the data. HomeRows' section loads had this
      // shape until each moved into a helper that builds a new node per run.
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

// Unit tests for scripts/lib/catchup-typed.cjs: the banner rules of
// .claude/skills/catchup/jellyrock.md as the typed lines the shared reader
// (.claude/skills/catchup/catchup-state.sh) ranks. Pure: each case hands it a
// state object shaped like catchup-state.js's JSON.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { typedLines, BANNER_IDS } = require('../../../scripts/lib/catchup-typed.cjs');

const T = '\t';
const run = (o) => ({
  status: 'completed',
  event: 'push',
  createdAt: '2026-10-06T10:00:00Z',
  ...o,
});

describe('typedLines', () => {
  it('a healthy state prints nothing', () => {
    expect(typedLines({ _errors: {} })).toEqual([]);
  });

  it('each _errors entry is an ERROR line naming the section', () => {
    const lines = typedLines({
      _errors: { ci: 'gh: not logged in', watches: 'HTTP 502' },
    });
    expect(lines).toEqual([
      `ERROR${T}ci${T}catchup-state: ci failed: gh: not logged in`,
      `ERROR${T}watches${T}catchup-state: watches failed: HTTP 502`,
    ]);
  });

  it('a field never carries a tab or a newline', () => {
    const [line] = typedLines({ _errors: { prs: 'a\tb\nc' } });
    expect(line).toBe(`ERROR${T}prs${T}catchup-state: prs failed: a b c`);
  });

  it('a ci note (no runs for the branch) is an INFO ci-none line', () => {
    expect(
      typedLines({
        ci: { current_branch_runs: [], note: 'no CI runs for feat/x among the 100 newest runs' },
      }),
    ).toEqual([`INFO${T}ci-none${T}no CI runs for feat/x among the 100 newest runs`]);
  });

  describe('ci-failing', () => {
    it('a finished run that did not pass fires, routed to /ci-triage with its id', () => {
      const lines = typedLines({
        ci: {
          current_branch_runs: [
            run({ name: 'Build', conclusion: 'failure', databaseId: 37560200942 }),
          ],
        },
      });
      expect(lines).toEqual([
        `BANNER${T}ci-failing${T}CI run "Build" failure (2026-10-06T10:00:00Z)${T}/ci-triage 37560200942`,
      ]);
    });

    it.each(['cancelled', 'timed_out', 'startup_failure', 'action_required'])(
      '%s fires',
      (conclusion) => {
        const [line] = typedLines({
          ci: { current_branch_runs: [run({ name: 'Build', conclusion, databaseId: 1 })] },
        });
        expect(line.split(T).slice(0, 2)).toEqual(['BANNER', 'ci-failing']);
      },
    );

    it.each(['success', 'skipped', 'neutral'])('%s does not fire', (conclusion) => {
      expect(
        typedLines({
          ci: { current_branch_runs: [run({ name: 'Build', conclusion, databaseId: 1 })] },
        }),
      ).toEqual([]);
    });

    it('a run still in progress does not fire', () => {
      const runs = [run({ name: 'Build', status: 'in_progress', conclusion: '', databaseId: 1 })];
      expect(typedLines({ ci: { current_branch_runs: runs } })).toEqual([]);
    });

    it('a later green run of the same workflow makes it an INFO ci-recovered line', () => {
      // gh run list is newest first
      const runs = [
        run({
          name: 'Device Unit Tests',
          conclusion: 'success',
          databaseId: 3,
          createdAt: '2026-10-06T12:00:00Z',
        }),
        run({ name: 'Device Unit Tests', conclusion: 'cancelled', databaseId: 2 }),
      ];
      expect(typedLines({ ci: { current_branch_runs: runs } })).toEqual([
        `INFO${T}ci-recovered${T}CI run "Device Unit Tests" cancelled (2026-10-06T10:00:00Z), recovered by a later green run`,
      ]);
    });

    it('a green run of another workflow, or an older green run, does not recover it', () => {
      const runs = [
        run({ name: 'JellyRock Bot', conclusion: 'success', databaseId: 3 }),
        run({ name: 'Build', conclusion: 'failure', databaseId: 2 }),
        run({ name: 'Build', conclusion: 'success', databaseId: 1 }),
      ];
      const lines = typedLines({ ci: { current_branch_runs: runs } });
      expect(lines).toEqual([
        `BANNER${T}ci-failing${T}CI run "Build" failure (2026-10-06T10:00:00Z)${T}/ci-triage 2`,
      ]);
    });

    it('a later run of the same workflow that did not pass recovers nothing', () => {
      const runs = [
        run({ name: 'Build', conclusion: 'cancelled', databaseId: 3 }),
        run({ name: 'Build', status: 'in_progress', conclusion: '', databaseId: 4 }),
        run({ name: 'Build', conclusion: 'failure', databaseId: 2 }),
      ];
      expect(typedLines({ ci: { current_branch_runs: runs } }).map((l) => l.split(T)[3])).toEqual([
        '/ci-triage 3',
        '/ci-triage 2',
      ]);
    });

    it('one banner per failing run', () => {
      const runs = [
        run({ name: 'A', conclusion: 'failure', databaseId: 2 }),
        run({ name: 'B', conclusion: 'failure', databaseId: 1 }),
      ];
      expect(typedLines({ ci: { current_branch_runs: runs } }).map((l) => l.split(T)[3])).toEqual([
        '/ci-triage 2',
        '/ci-triage 1',
      ]);
    });
  });

  describe('watches', () => {
    it('one upstream-watch banner per open issue, routed by its label', () => {
      const open = [
        { label: 'roku-os', number: 90, title: '[roku-os] Roku OS 16.0 released', triaging: false },
        {
          label: 'server-upgrade:tracker',
          number: 80,
          title: '[server-upgrade] Jellyfin 12.2 — release triage',
          triaging: true,
        },
        {
          label: 'server-upgrade:rc',
          number: 70,
          title: '[server-upgrade] Jellyfin 12.3-rc1 — release candidate',
          triaging: false,
        },
      ];
      expect(typedLines({ watches: { open } })).toEqual([
        `BANNER${T}upstream-watch${T}#90 [roku-os] Roku OS 16.0 released${T}review the release notes, then close #90`,
        `BANNER${T}upstream-watch${T}#80 [server-upgrade] Jellyfin 12.2 — release triage (triage started)${T}/server-upgrade (digest #80)`,
        `BANNER${T}upstream-watch${T}#70 [server-upgrade] Jellyfin 12.3-rc1 — release candidate${T}/server-upgrade with the versions issue #70 names`,
      ]);
    });

    it('no open issue fires nothing', () => {
      expect(typedLines({ watches: { open: [] } })).toEqual([]);
    });
  });

  it('one review-requested banner per PR, routed to /code-review <N>', () => {
    const prs = {
      review_requested: [
        { number: 41, title: 'Fix focus' },
        { number: 7, title: 'Docs' },
      ],
      yours_open: [],
    };
    expect(typedLines({ prs })).toEqual([
      `BANNER${T}review-requested${T}PR #41 awaiting your review: Fix focus${T}/code-review 41`,
      `BANNER${T}review-requested${T}PR #7 awaiting your review: Docs${T}/code-review 7`,
    ]);
  });

  it('stale architecture docs are one INFO line', () => {
    const docs_stale = {
      architecture: [
        { file: 'docs/a.md', days: 130, status: 'stale' },
        { file: 'docs/b.md', days: null, status: 'no-date' },
      ],
    };
    expect(typedLines({ docs_stale })).toEqual([
      `INFO${T}arch-docs-stale${T}2 architecture doc(s) stale: docs/a.md (130d), docs/b.md (no date) (info only; the blocking gate is CI's)`,
    ]);
  });

  it('one handoff-pending banner per pending handoff, routed to the skill that wrote it', () => {
    const handoffs = {
      pending: [
        { name: 'issue-573.md', age_days: 3 },
        { name: 'crash.md', age_days: 0 },
      ],
      pruned_count: 0,
    };
    expect(typedLines({ handoffs })).toEqual([
      `BANNER${T}handoff-pending${T}pending handoff .claude/handoffs/issue-573.md (3d old)${T}read it and follow the skill that wrote it`,
      `BANNER${T}handoff-pending${T}pending handoff .claude/handoffs/crash.md (0d old)${T}read it and follow the skill that wrote it`,
    ]);
  });

  it('a null section fires nothing (its _errors entry says why)', () => {
    const state = {
      _errors: { ci: 'x' },
      ci: null,
      prs: null,
      watches: null,
      docs_stale: null,
      handoffs: null,
    };
    expect(typedLines(state)).toEqual([`ERROR${T}ci${T}catchup-state: ci failed: x`]);
  });

  it('BANNER_IDS is every id a BANNER line can carry, and catchup.conf gives each one a class', () => {
    const conf = readFileSync('.claude/skills/catchup/catchup.conf', 'utf8');
    const classed = [...conf.matchAll(/^class\.([a-z0-9-]+)=(fire|resume|overdue|debt)$/gm)].map(
      (m) => m[1],
    );
    expect(classed.sort()).toEqual([...BANNER_IDS].sort());
    expect(conf).toMatch(/^reader=node scripts\/catchup-state\.js --typed --pretty$/m);
  });
});

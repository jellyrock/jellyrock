// Unit tests for scripts/lib/catchup-typed.cjs — the banner rules of
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
const signal = (o) => ({
  status: 'watching',
  latest_upstream: '2',
  latest_acknowledged: '1',
  stale: false,
  ...o,
});

describe('typedLines', () => {
  it('a healthy state prints nothing', () => {
    expect(typedLines({ _errors: {} })).toEqual([]);
  });

  it('each _errors entry is an ERROR line naming the section; signals adds the fix as a detail', () => {
    const lines = typedLines({
      _errors: { ci: 'gh: not logged in', signals: 'bad row at line 9' },
    });
    expect(lines).toEqual([
      `ERROR${T}ci${T}catchup-state: ci failed: gh: not logged in`,
      `ERROR${T}signals${T}catchup-state: signals failed: bad row at line 9`,
      '  fix docs/signals-backlog.md, then npm run lint:docs',
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

  describe('signals', () => {
    it('one signals-stale banner per stale row, routed to /done <slug>', () => {
      const rows = [
        signal({
          slug: 'roku-os',
          stale: true,
          latest_upstream: '15.2',
          latest_acknowledged: '15.1',
        }),
        signal({ slug: 'quiet' }),
      ];
      expect(typedLines({ signals: { rows, stale_count: 1, action_pending_count: 0 } })).toEqual([
        `BANNER${T}signals-stale${T}signals-backlog: roku-os needs attention (upstream 15.2, acknowledged 15.1)${T}review the upstream change, then /done roku-os`,
      ]);
    });

    it('a stale row with an open digest routes to /server-upgrade and names the digest', () => {
      const rows = [
        signal({
          slug: 'jellyfin-server-stable',
          stale: true,
          latest_upstream: '10.11.11',
          latest_acknowledged: '10.11.8',
          digest: { number: 632, triaging: false },
        }),
      ];
      expect(typedLines({ signals: { rows, stale_count: 1, action_pending_count: 0 } })).toEqual([
        `BANNER${T}signals-stale${T}signals-backlog: jellyfin-server-stable needs attention (upstream 10.11.11, acknowledged 10.11.8; open digest #632)${T}/server-upgrade`,
      ]);
    });

    it('rows in action_pending are one signals-action-pending banner, routed to /focus', () => {
      const rows = [
        signal({ slug: 'a', status: 'action_pending' }),
        signal({ slug: 'b', status: 'action_pending' }),
        signal({ slug: 'c' }),
      ];
      expect(typedLines({ signals: { rows, stale_count: 0, action_pending_count: 2 } })).toEqual([
        `BANNER${T}signals-action-pending${T}2 signal(s) in action_pending (a, b): these need a JellyRock change${T}`,
      ]);
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
      signals: null,
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

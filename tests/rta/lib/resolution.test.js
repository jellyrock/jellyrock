/**
 * Hardware-free gate on the resolution audit's classification.
 *
 * The audit's whole value is that it separates two defects a green suite cannot tell
 * apart — a DUPLICATE id, and a single id sitting in a view that is parked off-screen —
 * so what needs pinning is that it reports them separately and stays quiet on the ordinary
 * case. A classifier that collapsed the two, or that flagged every hidden font and timer,
 * would be worse than no audit: it would train its readers to skip the line.
 *
 * The census is a fixture rather than a device read, deliberately. The shape it returns
 * was measured on `.177` — `flatTree` entries carrying `id`, `subtype`, `ref`, `parentRef`,
 * `keyPath`, `visible`, `opacity` — and what needs a real Roku is whether a given keyPath
 * resolves at all, which stays hardware-verified through `npm run test:rta`. The same
 * split `steps.test.js` already draws.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The census is the only thing that needs a device, so it is the only thing mocked. The
// recorder is mocked too because the budget test's whole assertion is WHAT gets recorded.
const storeNodeReferences = vi.fn();
const recordResolution = vi.fn();
vi.mock('roku-test-automation', () => ({
  odc: { storeNodeReferences: () => storeNodeReferences() },
}));
vi.mock('../../../scripts/run-record.js', () => ({
  recordResolution: (...a) => recordResolution(...a),
}));

const {
  leadingSceneId,
  hiddenAncestor,
  classifyResolution,
  auditSceneResolutions,
  resetAuditBudget,
} = await import('./resolution.js');

/** Build a flat tree from `[id, subtype, parentRef, extra]` rows; ref is the index. */
const tree = (rows) =>
  rows.map(([id, subtype, parentRef, extra = {}], ref) => ({
    id,
    subtype,
    ref,
    parentRef,
    keyPath: id ? `#${id}` : '',
    ...extra,
  }));

const byRef = (t) => new Map(t.map((n) => [n.ref, n]));

describe('leadingSceneId — only the leading segment is a findNode call', () => {
  it('takes the id a scene-rooted read resolves through', () => {
    expect(leadingSceneId('#homeRows.content.getChildCount()')).toBe('homeRows');
    expect(leadingSceneId('#jrDialog')).toBe('jrDialog');
  });

  it('ignores the LATER #segments, which are scoped to the found subtree', () => {
    // `#jrDialog.#okButton...` finds jrDialog in the scene and then walks INTO it, so
    // okButton cannot pick up a stranger and is not what this audits.
    expect(leadingSceneId('#jrDialog.#okButton.#buttonBorder.blendColor')).toBe('jrDialog');
  });

  it('returns null for a keyPath that is not a find at all', () => {
    expect(leadingSceneId('focusedChild.id')).toBeNull();
    expect(leadingSceneId('')).toBeNull();
    expect(leadingSceneId('#')).toBeNull();
    expect(leadingSceneId(undefined)).toBeNull();
  });
});

describe('hiddenAncestor — a suspended view hides everything under it', () => {
  it('reports null when the whole chain is presented', () => {
    const t = tree([
      ['', 'JRScene', -1],
      ['view', 'Home', 0, { visible: true }],
      ['homeRows', 'HomeRows', 1, { visible: true }],
    ]);
    expect(hiddenAncestor(t[2], byRef(t))).toBeNull();
  });

  it('finds a hidden ANCESTOR, not just a hidden node — the suspend case', () => {
    // sgRouter's default suspendMode "hide" parks a covered view with visible=false and
    // leaves it in the tree, so its children still report visible:true. This is the
    // `waitHome()`-passed-from-a-grid shape.
    const t = tree([
      ['', 'JRScene', -1],
      ['view', 'Home', 0, { visible: false }],
      ['homeRows', 'HomeRows', 1, { visible: true }],
    ]);
    expect(hiddenAncestor(t[2], byRef(t))).toBe('#view');
  });

  it('treats opacity 0 as hidden — the app reveals dialogs that way', () => {
    const t = tree([
      ['', 'JRScene', -1],
      ['panel', 'JRDialog', 0, { opacity: 0 }],
      ['buttonRow', 'LayoutGroup', 1, { visible: true }],
    ]);
    expect(hiddenAncestor(t[2], byRef(t))).toBe('#panel');
  });

  it('does NOT flag a node for being hidden ITSELF — that is usually the subject', () => {
    // Measured: the first full audited suite produced 19 anomaly records and 14 were
    // `#osd` flagged with `hiddenAt` pointing at `#osd`. Those are
    // `waitFor('#osd.visible', (v) => v === false)` — a gate whose job is to wait until
    // the OSD is hidden. Reporting it flags a node for the exact state the caller
    // asserted. The defect is being hidden BECAUSE THE VIEW AROUND IT was suspended.
    const t = tree([
      ['', 'JRScene', -1],
      ['view', 'PlayerHostView', 0, { visible: true }],
      ['osd', 'OSD', 1, { visible: false }],
    ]);
    expect(hiddenAncestor(t[2], byRef(t))).toBeNull();
  });

  it('treats a node carrying NEITHER field as presented', () => {
    // 19 of 108 nodes on Home report no `visible` at all (fonts, timers, animations).
    // Flagging those would bury the real signal under noise.
    const t = tree([
      ['', 'JRScene', -1],
      ['defaultFont', 'Font', 0],
    ]);
    expect(hiddenAncestor(t[1], byRef(t))).toBeNull();
  });

  it('terminates on a malformed parentRef cycle rather than spinning', () => {
    const t = tree([
      ['a', 'Group', 1, { visible: true }],
      ['b', 'Group', 0, { visible: true }],
    ]);
    expect(hiddenAncestor(t[0], byRef(t))).toBeNull();
  });
});

describe('classifyResolution — the two defects stay separate', () => {
  const presentedHome = tree([
    ['', 'JRScene', -1],
    ['view', 'Home', 0, { visible: true }],
    ['homeRows', 'HomeRows', 1, { visible: true }],
  ]);

  it('reports an ordinary unique, presented read as clean', () => {
    expect(classifyResolution('homeRows', presentedHome)).toMatchObject({
      count: 1,
      presented: true,
      hiddenAt: null,
    });
  });

  it('reports a DUPLICATE with the subtypes that collide', () => {
    // Seven components declare a node with id `buttons`; which one answers is a property
    // of tree order rather than of the test.
    const t = tree([
      ['', 'JRScene', -1],
      ['buttons', 'JRButtonGroup', 0, { visible: true }],
      ['buttons', 'JRButtons', 0, { visible: true }],
    ]);
    const v = classifyResolution('buttons', t);
    expect(v.count).toBe(2);
    expect(v.subtypes).toEqual(['JRButtonGroup', 'JRButtons']);
  });

  it('reports NOT PRESENTED for a unique id in a suspended view', () => {
    // The defect a uniqueness check misses: there is only ever one `#homeRows`, and
    // `waitHome()` still passed from a library grid by reading it inside a suspended Home.
    const t = tree([
      ['', 'JRScene', -1],
      ['view', 'Home', 0, { visible: false }],
      ['homeRows', 'HomeRows', 1, { visible: true }],
    ]);
    expect(classifyResolution('homeRows', t)).toMatchObject({
      count: 1,
      presented: false,
      hiddenAt: '#view',
    });
  });

  it('reports the two defects independently when both hold', () => {
    const t = tree([
      ['', 'JRScene', -1],
      ['view', 'Home', 0, { visible: false }],
      ['buttons', 'JRButtonGroup', 1, { visible: true }],
      ['buttons', 'JRButtons', 0, { visible: true }],
    ]);
    const v = classifyResolution('buttons', t);
    expect(v.count).toBe(2);
    expect(v.presented).toBe(false);
  });

  it('stays silent on an id that is simply absent', () => {
    // A batched read reports a per-key miss as `undefined` without failing, so zero is a
    // reachable and uninteresting state. Reporting it would drown the real findings.
    expect(classifyResolution('nothingHere', presentedHome)).toMatchObject({
      count: 0,
      presented: null,
    });
  });

  it('survives a census that came back without a tree', () => {
    expect(classifyResolution('homeRows', undefined)).toMatchObject({ count: 0 });
  });

  // A button the OVERFLOW menu has stashed. `components/ItemDetails.xml` declares
  // `<Group id="buttonOverflow" visible="false" />` beside the row, and
  // `source/utils/buttonOverflow.bs` moves the tail into it once the row is over its cap,
  // leaving a `moreButton` in the last slot.
  //
  // This is the `#homeRows` defect again, on a surface this suite reads 31 times: the
  // stashed button is still in the SCENE, so a scene-rooted `#watchedButton.id` resolves
  // and the gate goes green while describing a button nobody can see. Pinned here because
  // the overflow is not reachable on the fixture today — main's own note puts ItemDetails
  // at exactly 8 of 8 — so nothing else can exercise it until a ninth button lands, and by
  // then the question is whether the instrument WOULD have caught it. It does, with no new
  // machinery: `hiddenAncestor` walks up and the stash is `visible: false`.
  it('reports a button the overflow menu has stashed as OFF-SCREEN', () => {
    const t = tree([
      ['', 'JRScene', -1],
      ['view', 'ItemDetails', 0, { visible: true }],
      ['buttons', 'JRButtonGroup', 1, { visible: true }],
      ['buttonOverflow', 'Group', 1, { visible: false }],
      ['watchedButton', 'IconButton', 3, { visible: true }],
    ]);
    expect(classifyResolution('watchedButton', t)).toMatchObject({
      count: 1,
      presented: false,
      hiddenAt: '#buttonOverflow',
    });
  });

  it('leaves a button still ON the row alone, so the gate is not noise', () => {
    // The other half of the same check: flagging every button on a surface that HAS an
    // overflow stash would report the 7 that are visible along with the 1 that is not.
    const t = tree([
      ['', 'JRScene', -1],
      ['view', 'ItemDetails', 0, { visible: true }],
      ['buttons', 'JRButtonGroup', 1, { visible: true }],
      ['buttonOverflow', 'Group', 1, { visible: false }],
      ['playButton', 'IconButton', 2, { visible: true }],
    ]);
    expect(classifyResolution('playButton', t)).toMatchObject({
      count: 1,
      presented: true,
      hiddenAt: null,
    });
  });
});

describe('the census budget reports that it stopped, rather than stopping silently', () => {
  const OLD = process.env.RTA_AUDIT_RESOLUTION;

  beforeEach(() => {
    process.env.RTA_AUDIT_RESOLUTION = '1';
    resetAuditBudget();
    recordResolution.mockClear();
    storeNodeReferences.mockClear();
    storeNodeReferences.mockResolvedValue({
      flatTree: [{ id: 'osd', subtype: 'OSD', ref: 0, parentRef: -1, keyPath: '#osd' }],
    });
  });
  afterEach(() => {
    if (OLD === undefined) delete process.env.RTA_AUDIT_RESOLUTION;
    else process.env.RTA_AUDIT_RESOLUTION = OLD;
    resetAuditBudget();
  });

  /** Drive `n` audited reads through the real budget path. */
  const audit = async (n) => {
    for (let i = 0; i < n; i++) await auditSceneResolutions(['#osd.visible']);
  };

  it('emits a truncation record once the budget is spent, and only once', async () => {
    // The budget silently capped the audit before this: the ledger reported `audited: N`
    // with no way to say whether N was the population or the point we stopped looking.
    //
    // Driven against the DEFAULT budget rather than a small override, because the module
    // reads `RTA_AUDIT_BUDGET` once at import time — setting it here would change nothing
    // and would read as though it had.
    await audit(205);
    const markers = recordResolution.mock.calls.map(([r]) => r).filter((r) => r.truncated);
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ truncated: true, budget: 200 });
  });

  it('takes no further censuses once truncated — the cap is real, not advisory', async () => {
    await audit(205);
    expect(storeNodeReferences).toHaveBeenCalledTimes(200);
  });

  it('records nothing at all while under budget', async () => {
    await audit(5);
    expect(recordResolution.mock.calls.filter(([r]) => r.truncated)).toHaveLength(0);
    expect(storeNodeReferences).toHaveBeenCalledTimes(5);
  });
});

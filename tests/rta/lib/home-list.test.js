// Tests for tests/rta/lib/home-list.js — the module that owns Home's row list ids.
//
// Hardware-free: everything here is pure. The device-touching half (`homeListId`,
// `waitFocusInHomeContent`) is tested against the mocked ODC in `steps.test.js`.

import { describe, it, expect } from 'vitest';
import {
  HOME_ROW_LIST_IDS,
  HOME_ROW_LIST_SUBTYPES,
  homeListKeyPaths,
  focusIsInHomeContent,
} from './home-list.js';

describe('the id and subtype constants', () => {
  it('lists BOTH candidate lists, because only one is ever in the scene', () => {
    // A resolver that probes one list silently reverts to the original bug: the read it
    // would drop is the one that resolves to `undefined` rather than throwing.
    expect(HOME_ROW_LIST_IDS).toEqual(['#homeRows', '#favoritesRows']);
    expect(HOME_ROW_LIST_SUBTYPES).toEqual(['HomeRows', 'FavoritesRows']);
  });

  it('keeps the two POSITIONALLY aligned — `homeListId` indexes one by the other', () => {
    // Load-bearing and invisible at the call site: `homeListId` reads `subtype()` off both
    // ids and maps the answer back through `HOME_ROW_LIST_SUBTYPES.indexOf(...)`. Reorder
    // one array and the resolver returns the WRONG id — which resolves to nothing, so every
    // read under it comes back `undefined` and the failure names the wrong list.
    expect(HOME_ROW_LIST_IDS).toHaveLength(HOME_ROW_LIST_SUBTYPES.length);
    for (const [i, id] of HOME_ROW_LIST_IDS.entries()) {
      expect(id.toLowerCase()).toBe(`#${HOME_ROW_LIST_SUBTYPES[i].toLowerCase()}`);
    }
  });

  it('freezes both, because they are a shared registry', () => {
    expect(Object.isFrozen(HOME_ROW_LIST_IDS)).toBe(true);
    expect(Object.isFrozen(HOME_ROW_LIST_SUBTYPES)).toBe(true);
  });
});

describe('homeListKeyPaths', () => {
  it('builds a keyPath per candidate id, in id order', () => {
    expect(homeListKeyPaths('content.getChildCount()')).toEqual([
      '#homeRows.content.getChildCount()',
      '#favoritesRows.content.getChildCount()',
    ]);
  });

  it('returns the bare ids for an empty suffix, rather than a trailing dot', () => {
    // A trailing `.` is not a keyPath ODC can resolve, so this would fail as "not found"
    // rather than as a bug — the quiet kind of wrong this module exists to stop.
    expect(homeListKeyPaths('')).toEqual(['#homeRows', '#favoritesRows']);
    expect(homeListKeyPaths()).toEqual(['#homeRows', '#favoritesRows']);
  });
});

describe('focusIsInHomeContent', () => {
  it('accepts EITHER row list, because which one is live depends on the selected tab', () => {
    expect(focusIsInHomeContent({ node: { subtype: 'HomeRows' } })).toBe(true);
    expect(focusIsInHomeContent({ node: { subtype: 'FavoritesRows' } })).toBe(true);
  });

  it('rejects focus that is somewhere else entirely', () => {
    expect(focusIsInHomeContent({ node: { subtype: 'BaseGridView' } })).toBe(false);
    expect(focusIsInHomeContent({ node: { subtype: 'JRTabBar' } })).toBe(false);
  });

  it('rejects a FAILED focus read rather than treating it as arrival', () => {
    // `getFocusedNode` is `.catch(() => null)`ed at every call site, so this is the shape a
    // dropped ODC read actually takes. Answering `true` here would let a gate pass on the
    // device having stopped answering — a false positive, which is the one failure mode
    // these predicates must not have.
    expect(focusIsInHomeContent(null)).toBe(false);
    expect(focusIsInHomeContent(undefined)).toBe(false);
    expect(focusIsInHomeContent({})).toBe(false);
    expect(focusIsInHomeContent({ node: {} })).toBe(false);
  });

  it('does not match on a node id or keyPath — subtype is the only signal', () => {
    // The rule this predicate exists to follow: RTA builds a keyPath segment from `node.id`
    // only while that id is non-empty, so an id-keyed test stops matching the moment a node
    // is created without one. A node carrying the id but the wrong subtype is not Home's
    // content, and must not read as it.
    expect(
      focusIsInHomeContent({ keyPath: 'x.#homeRows', node: { id: 'homeRows', subtype: 'Group' } }),
    ).toBe(false);
  });
});

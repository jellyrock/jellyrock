// Tests for the pure parts of scripts/jellyfin-matrix.js. The network half is
// exercised by running the script against real servers.

import { describe, it, expect } from 'vitest';
import {
  parseServerList,
  buildRequestUrl,
  countItems,
  formatTable,
} from '../../../scripts/jellyfin-matrix.js';

describe('parseServerList', () => {
  it('splits, trims and drops trailing slashes and empty entries', () => {
    expect(parseServerList(' http://a:8097/ ,http://b:8098,, http://c//')).toEqual([
      'http://a:8097',
      'http://b:8098',
      'http://c',
    ]);
  });

  it('returns [] when unset or blank', () => {
    expect(parseServerList(undefined)).toEqual([]);
    expect(parseServerList('  ')).toEqual([]);
  });
});

describe('buildRequestUrl', () => {
  it('replaces every {userId} and encodes it', () => {
    expect(buildRequestUrl('http://a', '/Users/{userId}/Items?x={userId}', 'a b')).toBe(
      'http://a/Users/a%20b/Items?x=a%20b',
    );
  });

  it('adds a missing leading slash', () => {
    expect(buildRequestUrl('http://a', 'Shows/NextUp', 'u')).toBe('http://a/Shows/NextUp');
  });
});

describe('countItems', () => {
  it('counts a query result, a bare array, and nothing else', () => {
    expect(countItems('{"Items":[{},{}],"TotalRecordCount":0}')).toBe(2);
    expect(countItems('[{},{},{}]')).toBe(3);
    expect(countItems('{"Id":"x"}')).toBeNull();
    expect(countItems('Bad Request')).toBeNull();
  });
});

describe('formatTable', () => {
  it('aligns columns and shows a non-list body as -', () => {
    const out = formatTable([
      { server: 'http://a', version: '10.7.7', status: 200, items: 38, bytes: 59477, ms: 44 },
      { server: 'http://bb', version: '12.0.0', status: 400, items: null, bytes: 272, ms: 8 },
    ]).split('\n');
    expect(out).toEqual([
      'server     version  status  items  bytes  ms',
      '---------  -------  ------  -----  -----  --',
      'http://a   10.7.7   200     38     59477  44',
      'http://bb  12.0.0   400     -      272    8',
    ]);
  });

  it('prints an error in place of the result, with ? for an unknown version', () => {
    const out = formatTable([{ server: 'http://c', error: 'ECONNREFUSED' }]).split('\n');
    expect(out[2]).toBe('http://c  ?        ERROR: ECONNREFUSED');
  });
});

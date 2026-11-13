// Tests for the no-direct-favorite-request plugin.
//
// Plugin under test: scripts/bsc-plugins/no-direct-favorite-request.cjs
// Diagnostic code: no-direct-favorite-request
//
// What the plugin enforces: BuildMarkFavoriteRequest and BuildUnmarkFavoriteRequest are
// called only from source/utils/favorites.bs (which bumps the scene's favoritesVersion) and
// source/api/ApiClient.bs (where they are defined). Two escape hatches:
// `' bsc-disable-line/next-line no-direct-favorite-request`.

import { describe, it, expect } from 'vitest';
import { runPluginOnSource, diagnosticsByCode } from '../_helpers/run-plugin.js';
import noDirectFavoriteRequestPlugin from '../../../../scripts/bsc-plugins/no-direct-favorite-request.cjs';

const CODE = 'no-direct-favorite-request';
const run = (files) => runPluginOnSource(noDirectFavoriteRequestPlugin, files);

describe('no-direct-favorite-request', () => {
  it('flags BuildMarkFavoriteRequest in a component as an error', () => {
    const found = diagnosticsByCode(
      run({
        'components/Foo.bs': `
          sub init()
            req = GetApi().BuildMarkFavoriteRequest("id")
          end sub
        `,
      }),
      CODE,
    );
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe(1);
    expect(found[0].message).toContain('favorites.request(');
  });

  it('flags BuildUnmarkFavoriteRequest in a component', () => {
    const found = diagnosticsByCode(
      run({
        'components/Foo.bs': `
          sub init()
            req = GetApi().BuildUnmarkFavoriteRequest("id")
          end sub
        `,
      }),
      CODE,
    );
    expect(found).toHaveLength(1);
  });

  it('does not flag the call inside source/utils/favorites.bs', () => {
    const found = diagnosticsByCode(
      run({
        'source/utils/favorites.bs': `
          function request(id as string) as dynamic
            return GetApi().BuildMarkFavoriteRequest(id)
          end function
        `,
      }),
      CODE,
    );
    expect(found).toHaveLength(0);
  });

  it('does not flag the call inside source/api/ApiClient.bs', () => {
    const found = diagnosticsByCode(
      run({
        'source/api/ApiClient.bs': `
          sub go()
            m.BuildUnmarkFavoriteRequest("id")
          end sub
        `,
      }),
      CODE,
    );
    expect(found).toHaveLength(0);
  });

  it('respects bsc-disable-line on the same line', () => {
    const found = diagnosticsByCode(
      run({
        'components/Foo.bs': `
          sub init()
            req = GetApi().BuildMarkFavoriteRequest("id") ' bsc-disable-line no-direct-favorite-request
          end sub
        `,
      }),
      CODE,
    );
    expect(found).toHaveLength(0);
  });

  it('respects bsc-disable-next-line on the line above', () => {
    const found = diagnosticsByCode(
      run({
        'components/Foo.bs': `
          sub init()
            ' bsc-disable-next-line no-direct-favorite-request
            req = GetApi().BuildUnmarkFavoriteRequest("id")
          end sub
        `,
      }),
      CODE,
    );
    expect(found).toHaveLength(0);
  });

  it('does not flag an unrelated BuildXRequest call', () => {
    const found = diagnosticsByCode(
      run({
        'components/Foo.bs': `
          sub init()
            req = GetApi().BuildMarkPlayedRequest("id")
            req2 = GetApi().BuildGetItemRequest("id")
          end sub
        `,
      }),
      CODE,
    );
    expect(found).toHaveLength(0);
  });
});

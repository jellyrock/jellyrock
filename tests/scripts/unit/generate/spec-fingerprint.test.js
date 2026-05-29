// Tests for scripts/generate/spec-fingerprint.js.
//
// The pure reducer (buildFingerprint) is driven with tiny hand-written fixture
// specs — never the ~2 MB real ones — exercising every reduction the diff
// depends on (type signatures, format-bearing retypes, nullable, refs, params,
// request/response shapes, enums, description stripping). A final block runs the
// CLI --from-file write/--check drift gate against a temp tree via spawnScript.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';
import {
  buildFingerprint,
  serializeFingerprint,
} from '../../../../scripts/generate/spec-fingerprint.js';

const SCRIPT = 'scripts/generate/spec-fingerprint.js';

// A compact OpenAPI-shaped fixture covering the surfaces the reducer touches.
function fixtureSpec() {
  return {
    openapi: '3.0.1',
    info: { version: '9.9.9' },
    paths: {
      '/Items': {
        // A non-operation sibling that must be ignored.
        parameters: [],
        get: {
          summary: 'cosmetic — must be stripped',
          parameters: [
            { name: 'userId', in: 'query', schema: { type: 'string', format: 'uuid' } },
            {
              name: 'limit',
              in: 'query',
              required: true,
              schema: { type: 'integer', format: 'int32' },
            },
          ],
          responses: {
            200: {
              description: 'ok',
              content: {
                'application/json; profile="CamelCase"': {
                  schema: { $ref: '#/components/schemas/ItemsResult' },
                },
              },
            },
          },
        },
      },
      '/Items/{itemId}': {
        post: {
          requestBody: {
            description: 'cosmetic',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateDto' } } },
          },
          responses: { 204: { description: 'no content' } },
        },
      },
    },
    components: {
      schemas: {
        ItemsResult: {
          type: 'object',
          properties: {
            Items: { type: 'array', items: { $ref: '#/components/schemas/BaseItem' } },
            TotalRecordCount: { type: 'integer', format: 'int32' },
          },
        },
        BaseItem: {
          type: 'object',
          properties: {
            Id: { type: 'string' },
            RunTimeTicks: { type: 'integer', format: 'int64', nullable: true },
            Kind: { allOf: [{ $ref: '#/components/schemas/ItemKind' }], description: 'cosmetic' },
          },
        },
        ItemKind: { enum: ['Movie', 'Series', 'Episode'], type: 'string' },
        UpdateDto: { type: 'object', properties: { Name: { type: 'string' } } },
      },
    },
  };
}

describe('buildFingerprint — operations', () => {
  const fp = buildFingerprint(fixtureSpec(), { specVersion: '9.9.9' });

  it('keys operations by "METHOD path" and skips non-operation path siblings', () => {
    expect(Object.keys(fp.operations).sort()).toEqual(['GET /Items', 'POST /Items/{itemId}']);
  });

  it('reduces parameters to name/in/type/required, sorted deterministically', () => {
    expect(fp.operations['GET /Items'].parameters).toEqual([
      { name: 'limit', in: 'query', type: 'integer:int32', required: true },
      { name: 'userId', in: 'query', type: 'string:uuid', required: false },
    ]);
  });

  it('captures the success-response schema ref (tolerating profile media types)', () => {
    expect(fp.operations['GET /Items'].response).toBe('ref:ItemsResult');
  });

  it('captures the requestBody schema ref and omits response when there is no 2xx body', () => {
    const op = fp.operations['POST /Items/{itemId}'];
    expect(op.requestBody).toBe('ref:UpdateDto');
    expect(op.response).toBeUndefined();
  });
});

describe('buildFingerprint — schemas + type signatures', () => {
  const fp = buildFingerprint(fixtureSpec(), { specVersion: '9.9.9' });

  it('records format so int64→int32-style retypes are visible', () => {
    expect(fp.schemas.BaseItem.properties.RunTimeTicks).toBe('integer:int64?'); // nullable → ?
    expect(fp.schemas.ItemsResult.properties.TotalRecordCount).toBe('integer:int32');
  });

  it('reduces arrays and refs structurally', () => {
    expect(fp.schemas.ItemsResult.properties.Items).toBe('array<ref:BaseItem>');
  });

  it('unwraps a single-ref allOf (the description-sibling shape) to the ref', () => {
    expect(fp.schemas.BaseItem.properties.Kind).toBe('ref:ItemKind');
  });

  it('captures enum values in order', () => {
    expect(fp.schemas.ItemKind.enum).toEqual(['Movie', 'Series', 'Episode']);
  });

  it('strips all descriptions/summaries/examples', () => {
    expect(serializeFingerprint(fp)).not.toMatch(/cosmetic/);
  });
});

describe('buildFingerprint — determinism', () => {
  it('is order-independent (shuffled input → identical output)', () => {
    const a = serializeFingerprint(buildFingerprint(fixtureSpec(), { specVersion: '9.9.9' }));
    // Rebuild from a spec whose object-key insertion order differs.
    const shuffled = JSON.parse(JSON.stringify(fixtureSpec()));
    const reordered = {
      components: shuffled.components,
      paths: shuffled.paths,
      info: shuffled.info,
    };
    const b = serializeFingerprint(buildFingerprint(reordered, { specVersion: '9.9.9' }));
    expect(a).toBe(b);
  });
});

describe('CLI --from-file write + --check drift gate', () => {
  let dir;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('exits non-zero when missing/stale, writes, then exits zero', () => {
    dir = mkdtempSync(join(tmpdir(), 'jellyrock-spec-fp-'));
    const specPath = join(dir, 'spec.json');
    // The CLI keys the output filename off the <version> arg, not info.version.
    writeFileSync(specPath, JSON.stringify(fixtureSpec()));

    const args = ['10.7.0', '--from-file', specPath, dir];

    const check1 = spawnScript(SCRIPT, [...args, '--check']);
    expect(check1.exitCode).toBe(1);

    const write = spawnScript(SCRIPT, args);
    expect(write.exitCode).toBe(0);

    const written = JSON.parse(
      readFileSync(join(dir, 'docs/architecture/spec-fingerprints/jellyfin-10.7.0.json'), 'utf8'),
    );
    expect(written.specVersion).toBe('10.7.0');

    const check2 = spawnScript(SCRIPT, [...args, '--check']);
    expect(check2.exitCode).toBe(0);
  });
});

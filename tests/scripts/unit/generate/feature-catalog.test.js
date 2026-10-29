// Tests for scripts/generate/feature-catalog.cjs.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnScript } from '../_helpers/spawn-script.js';

const SCRIPT = 'scripts/generate/feature-catalog.cjs';

const README_BEGIN = '<!-- BEGIN generated features (npm run docs:features) -->';
const README_END = '<!-- END generated features -->';

const segments = [
  '---',
  'pitch: Skip the intros your server has marked.',
  'since: 2.9.0',
  'server: 10.10.0',
  'plugins: Intro Skipper',
  '---',
  '',
  '# Media segments',
  '',
  'Body.',
  '',
].join('\n');

const subtitles = [
  '---',
  'pitch: Download a subtitle from its page.',
  'since: unreleased',
  'server: 10.7.0',
  '---',
  '',
  '# Manage subtitles',
  '',
].join('\n');

function setupTree(pages = { 'media-segments.md': segments, 'manage-subtitles.md': subtitles }) {
  const dir = mkdtempSync(join(tmpdir(), 'jellyrock-feature-catalog-'));
  const files = {
    'package.json': JSON.stringify({ version: '3.2.0' }),
    'docs/dev/jellyfin-version-boundaries.yml': "floor: '10.7.0'\n",
    'locale/languages.json': JSON.stringify([{ code: '' }, { code: 'en_US' }, { code: 'fr' }]),
    'settings/settings.json': JSON.stringify([
      { settingName: 'uiTheme', options: [{ id: 'jellyrock' }, { id: 'custom' }] },
    ]),
    'README.md': `# JellyRock\n\n## Features\n\n${README_BEGIN}\nold\n${README_END}\n\n## Install\n`,
  };
  for (const [name, content] of Object.entries(pages))
    files[`docs/user/features/${name}`] = content;
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

const read = (dir, rel) => readFileSync(join(dir, rel), 'utf8');

describe('feature-catalog', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('writes the catalog from each page, sorted by title, with the app facts', () => {
    dir = setupTree();
    const { exitCode } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(0);
    const catalog = JSON.parse(read(dir, 'docs/feature-catalog.json'));
    expect(catalog.schema).toBe(1);
    expect(catalog.app).toEqual({ languages: 2, themes: 1, serverFloor: '10.7.0' });
    expect(catalog.features.map((f) => f.slug)).toEqual(['manage-subtitles', 'media-segments']);
    expect(catalog.features[1]).toEqual({
      slug: 'media-segments',
      title: 'Media segments',
      pitch: 'Skip the intros your server has marked.',
      since: '2.9.0',
      server: '10.10.0',
      plugins: ['Intro Skipper'],
      screenshots: [],
      page: 'docs/user/features/media-segments.md',
      url: 'https://docs.jellyrock.app/features/media-segments/',
    });
    expect(catalog.features[0].since).toBe('unreleased');
  });

  it('writes the features index page, which lists every page', () => {
    dir = setupTree();
    spawnScript(SCRIPT, [dir]);
    const index = read(dir, 'docs/user/features/index.md');
    expect(index).toMatch(/^# Features\n/);
    expect(index).toContain(
      '| [Media segments](media-segments.md) | Skip the intros your server has marked. | 10.10.0 or later | Intro Skipper |',
    );
    expect(index).toContain(
      '| [Manage subtitles](manage-subtitles.md) | Download a subtitle from its page. | 10.7.0 or later | None |',
    );
  });

  it('writes the README list between its markers and leaves the rest alone', () => {
    dir = setupTree();
    spawnScript(SCRIPT, [dir]);
    const readme = read(dir, 'README.md');
    expect(readme).toContain(
      `${README_BEGIN}\n\n- **[Manage subtitles](docs/user/features/manage-subtitles.md):** Download a subtitle from its page.\n` +
        `- **[Media segments](docs/user/features/media-segments.md):** Skip the intros your server has marked.\n\n${README_END}`,
    );
    expect(readme).toMatch(/^# JellyRock\n\n## Features\n\n/);
    expect(readme).toMatch(/\n\n## Install\n$/);
  });

  it('--check passes once the outputs are written, and fails after a page changes', () => {
    dir = setupTree();
    spawnScript(SCRIPT, [dir]);
    expect(spawnScript(SCRIPT, [dir, '--check']).exitCode).toBe(0);
    writeFileSync(
      join(dir, 'docs/user/features/media-segments.md'),
      segments.replace('Skip the intros', 'Skip the outros'),
    );
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir, '--check']);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(
      /out of date: docs\/feature-catalog\.json, docs\/user\/features\/index\.md, README\.md/,
    );
    expect(stderr).toMatch(/npm run docs:features/);
  });

  it('--check writes nothing', () => {
    dir = setupTree();
    const { exitCode } = spawnScript(SCRIPT, [dir, '--check']);
    expect(exitCode).toBe(1);
    expect(read(dir, 'README.md')).toContain(`${README_BEGIN}\nold\n${README_END}`);
  });

  it('refuses a page whose frontmatter is broken, rather than publish it', () => {
    dir = setupTree({ 'media-segments.md': segments.replace('since: 2.9.0\n', '') });
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/media-segments\.md: missing `since:`.*npm run lint:docs/s);
  });

  it('fails when the README has no markers', () => {
    dir = setupTree();
    writeFileSync(join(dir, 'README.md'), '# JellyRock\n');
    const { exitCode, stderr } = spawnScript(SCRIPT, [dir]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/README\.md is missing its markers/);
  });
});

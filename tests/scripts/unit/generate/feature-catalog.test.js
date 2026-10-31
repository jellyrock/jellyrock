// Tests for scripts/generate/feature-catalog.cjs.

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { spawnScript } from '../_helpers/spawn-script.js';
import { gitSafeEnv } from '../_helpers/git-env.js';

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

// The same page, picked for the README's short list, ranked second.
const segmentsHighlighted = segments.replace(
  'server: 10.10.0\n',
  'server: 10.10.0\nhighlight: 2\n',
);

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
      https: null,
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

  it('lists only the highlighted pages in the README, links them all, and leaves the rest alone', () => {
    dir = setupTree({ 'media-segments.md': segmentsHighlighted, 'manage-subtitles.md': subtitles });
    spawnScript(SCRIPT, [dir]);
    const readme = read(dir, 'README.md');
    expect(readme).toContain(
      `${README_BEGIN}\n\n- **[Media segments](docs/user/features/media-segments.md):** Skip the intros your server has marked.\n\n` +
        `See [all features](docs/user/features/index.md).\n\n${README_END}`,
    );
    expect(readme).not.toContain('[Manage subtitles](docs/user/features/manage-subtitles.md)');
    expect(readme).toMatch(/^# JellyRock\n\n## Features\n\n/);
    expect(readme).toMatch(/\n\n## Install\n$/);
  });

  it('lists the highlighted pages by rank, not by title', () => {
    dir = setupTree({
      'media-segments.md': segmentsHighlighted,
      'manage-subtitles.md': subtitles.replace(
        'server: 10.7.0\n',
        'server: 10.7.0\nhighlight: 1\n',
      ),
    });
    spawnScript(SCRIPT, [dir]);
    const readme = read(dir, 'README.md');
    expect(readme).toContain('[Manage subtitles]');
    expect(readme).toContain('[Media segments]');
    expect(readme.indexOf('[Manage subtitles]')).toBeLessThan(readme.indexOf('[Media segments]'));
  });

  it('writes only the link to every feature when no page is highlighted', () => {
    dir = setupTree();
    spawnScript(SCRIPT, [dir]);
    expect(read(dir, 'README.md')).toContain(
      `${README_BEGIN}\n\nSee [all features](docs/user/features/index.md).\n\n${README_END}`,
    );
  });

  it('--check passes once the outputs are written, and fails after a page changes', () => {
    dir = setupTree({ 'media-segments.md': segmentsHighlighted, 'manage-subtitles.md': subtitles });
    spawnScript(SCRIPT, [dir]);
    expect(spawnScript(SCRIPT, [dir, '--check']).exitCode).toBe(0);
    writeFileSync(
      join(dir, 'docs/user/features/media-segments.md'),
      segmentsHighlighted.replace('Skip the intros', 'Skip the outros'),
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

  it('shows what a feature needs on HTTPS in the index and the catalog', () => {
    const page = subtitles.replace(
      'server: 10.7.0\n',
      'server: 10.7.0\nhttpsserver: 10.11.0\nhttpsplugins: Open Subtitles\n',
    );
    dir = setupTree({ 'media-segments.md': segments, 'manage-subtitles.md': page });
    expect(spawnScript(SCRIPT, [dir]).exitCode).toBe(0);
    const features = JSON.parse(read(dir, 'docs/feature-catalog.json')).features;
    expect(features.find((f) => f.slug === 'manage-subtitles').https).toEqual({
      server: '10.11.0',
      plugins: ['Open Subtitles'],
    });
    expect(features.find((f) => f.slug === 'media-segments').https).toBeNull();
    expect(read(dir, 'docs/user/features/index.md')).toContain(
      '10.7.0 or later (HTTPS: 10.11.0 or later) | None (HTTPS: Open Subtitles) |',
    );
  });

  describe('--release: stamping `since: unreleased` when a release is published', () => {
    // Commits the tree, tags it, then applies `after` (pages added or changed on main after the tag).
    const git = (args) => execFileSync('git', args, { cwd: dir, env: gitSafeEnv(), stdio: 'pipe' });
    function tagTree(tag, after = {}) {
      git(['init', '-q', '-b', 'main']);
      git(['config', 'user.email', 'test@example.com']);
      git(['config', 'user.name', 'Test']);
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'release']);
      git(['tag', tag]);
      for (const [name, content] of Object.entries(after)) {
        writeFileSync(join(dir, 'docs/user/features', name), content);
      }
    }
    const lateFeature = subtitles.replace('# Manage subtitles', '# Late feature');

    it('stamps a page that was unreleased in the tagged commit, then regenerates the outputs', () => {
      dir = setupTree();
      tagTree('v3.4.0');
      const { exitCode, stdout } = spawnScript(SCRIPT, [
        dir,
        '--release',
        '3.4.0',
        '--ref',
        'v3.4.0',
      ]);
      expect(exitCode).toBe(0);
      expect(stdout).toMatch(
        /stamped since: 3\.4\.0 on docs\/user\/features\/manage-subtitles\.md/,
      );
      expect(read(dir, 'docs/user/features/manage-subtitles.md')).toContain('\nsince: 3.4.0\n');
      const catalog = JSON.parse(read(dir, 'docs/feature-catalog.json'));
      expect(catalog.features.find((f) => f.slug === 'manage-subtitles').since).toBe('3.4.0');
    });

    it('leaves a page with a version alone', () => {
      dir = setupTree();
      tagTree('v3.4.0');
      spawnScript(SCRIPT, [dir, '--release', '3.4.0', '--ref', 'v3.4.0']);
      expect(read(dir, 'docs/user/features/media-segments.md')).toBe(segments);
    });

    it('leaves unreleased a page merged after the tag, which the release does not hold', () => {
      dir = setupTree();
      tagTree('v3.4.0', { 'late-feature.md': lateFeature });
      const { exitCode } = spawnScript(SCRIPT, [dir, '--release', '3.4.0', '--ref', 'v3.4.0']);
      expect(exitCode).toBe(0);
      expect(read(dir, 'docs/user/features/late-feature.md')).toContain('\nsince: unreleased\n');
      expect(read(dir, 'docs/user/features/manage-subtitles.md')).toContain('\nsince: 3.4.0\n');
    });

    it('refuses a version that is not x.y.z, or a missing --ref, and writes nothing', () => {
      dir = setupTree();
      tagTree('v3.4.0');
      for (const args of [
        ['--release', 'v3.4.0', '--ref', 'v3.4.0'],
        ['--release', '3.4.0'],
      ]) {
        const { exitCode, stderr } = spawnScript(SCRIPT, [dir, ...args]);
        expect(exitCode).toBe(1);
        expect(stderr).toMatch(/--release takes a version x\.y\.z and --ref the release's tag/);
      }
      expect(read(dir, 'docs/user/features/manage-subtitles.md')).toBe(subtitles);
    });

    it('fails, writing nothing, when the ref is not in the repo', () => {
      dir = setupTree();
      tagTree('v3.4.0');
      const { exitCode, stderr } = spawnScript(SCRIPT, [
        dir,
        '--release',
        '3.5.0',
        '--ref',
        'v3.5.0',
      ]);
      expect(exitCode).toBe(1);
      expect(stderr).toMatch(/v3\.5\.0 is not a commit in this repo/);
      expect(read(dir, 'docs/user/features/manage-subtitles.md')).toBe(subtitles);
    });
  });
});

// Gate: the release package holds only what the app runs.
//
// `bsconfig-prod.json`'s `files` globs take whole folders (`source/**/*.*`,
// `components/**/*.*`, `locale/**/*.*`), so anything committed beside the code ships
// to users too. Roku's static analyzer flags each such file as "Package contains
// extraneous file", and it once found the agent notes (`CLAUDE.md`), a vendored
// README and the translation seed files in a release. The probe components under
// `components/testing/` shipped the same way.
//
// The check resolves the file list the way the build does (roku-deploy's
// `getFilePaths`, which bsc uses for `files`), without building, and compares it
// with an allowlist: a new kind of file has to be added here on purpose.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { getFilePaths } = require('roku-deploy');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

// The file types the app reads at runtime. `.bs` covers the vendored `.d.bs`
// typedefs too, which bsc copies and Roku's analyzer does not flag.
const ALLOWED_EXTENSIONS = new Set(['.bs', '.brs', '.xml', '.json', '.png', '.jpg']);
// Files with no extension that the app needs.
const ALLOWED_NAMES = new Set(['manifest']);
// Folders that only the test suites or the tooling use.
const EXCLUDED_DIRS = ['components/testing/', 'locale/seed/'];

async function releaseFiles() {
  const config = JSON.parse(readFileSync(join(ROOT, 'bsconfig-prod.json'), 'utf8'));
  const entries = await getFilePaths(config.files, ROOT);
  return entries.map((entry) => entry.dest.replaceAll('\\', '/'));
}

describe('release package contents', () => {
  it('ships only the file types the app runs', async () => {
    const files = await releaseFiles();
    expect(files.length).toBeGreaterThan(0);
    const extraneous = files.filter(
      (file) => !ALLOWED_NAMES.has(file) && !ALLOWED_EXTENSIONS.has(extname(file).toLowerCase()),
    );
    expect(extraneous).toEqual([]);
  });

  it('leaves out the test probes and the translation seed', async () => {
    const files = await releaseFiles();
    const excluded = files.filter((file) => EXCLUDED_DIRS.some((dir) => file.startsWith(dir)));
    expect(excluded).toEqual([]);
  });
});

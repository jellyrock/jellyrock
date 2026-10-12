// The markdown and spelling lints must not read files inside `.git/`.
//
// `.markdownlint-cli2.jsonc` sets `gitignore: true`, but `.git/` is never listed in
// `.gitignore`, so a `.md` file written there (the /pr skill's `.git/pr-backup-<N>-<ts>.md`)
// was linted and failed the next pre-push. `lint:spelling`'s `**/.*/**/*.md` glob reaches
// dot-directories, so it needs the same exclusion.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const scripts = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')).scripts;

describe('lint scripts skip .git/', () => {
  it('lint:markdown excludes .git/', () => {
    expect(scripts['lint:markdown']).toContain('"!.git/"');
  });

  it('lint:spelling excludes .git/**/*.md', () => {
    expect(scripts['lint:spelling']).toContain('"!.git/**/*.md"');
  });
});

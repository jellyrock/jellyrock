/**
 * Creates a deployable ZIP package from the compiled build directory using roku-deploy.
 *
 * This is the standardized way to package JellyRock for distribution.
 * The BrightScript VSCode extension uses roku-deploy for F5 deploys,
 * and this script ensures CI/CD packaging uses the same toolchain.
 *
 * Usage: node scripts/create-package.cjs [--staging-dir <path>] [--out-dir <path>]
 * Defaults: --staging-dir build/ and --out-dir out/, both under the repo root.
 * Relative paths resolve against the current directory.
 * Output: <out-dir>/jellyrock.zip
 */

const { rokuDeploy } = require('roku-deploy');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

const FLAGS = { '--staging-dir': 'stagingDir', '--out-dir': 'outDir' };

function parseArgs(argv) {
  const dirs = { stagingDir: path.join(rootDir, 'build'), outDir: path.join(rootDir, 'out') };
  for (let i = 0; i < argv.length; i++) {
    const key = FLAGS[argv[i]];
    if (!key) {
      console.error(`❌ Unknown argument: ${argv[i]}`);
      console.error(
        'Usage: node scripts/create-package.cjs [--staging-dir <path>] [--out-dir <path>]',
      );
      process.exit(1);
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) {
      console.error(`❌ ${argv[i - 1]} needs a path`);
      process.exit(1);
    }
    dirs[key] = path.resolve(process.cwd(), value);
  }
  return dirs;
}

async function createPackage() {
  const { stagingDir, outDir } = parseArgs(process.argv.slice(2));
  const options = {
    stagingDir,
    outDir,
    outFile: 'jellyrock',
    retainStagingDir: true,
  };

  console.log(
    `📦 Creating package from ${path.relative(process.cwd(), stagingDir) || '.'} using roku-deploy...`,
  );

  await rokuDeploy.zipPackage(options);

  console.log(
    `✅ Package created: ${path.join(path.relative(process.cwd(), outDir) || '.', 'jellyrock.zip')}`,
  );
}

createPackage().catch((err) => {
  console.error('❌ Failed to create package:', err.message);
  process.exit(1);
});

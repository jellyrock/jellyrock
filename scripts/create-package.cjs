/**
 * Creates a deployable ZIP package from the compiled build directory using roku-deploy.
 *
 * This is the standardized way to package JellyRock for distribution.
 * The BrightScript VSCode extension uses roku-deploy for F5 deploys,
 * and this script ensures CI/CD packaging uses the same toolchain.
 *
 * Usage: node scripts/create-package.cjs
 * Output: out/jellyrock.zip
 */

const { rokuDeploy } = require('roku-deploy');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

async function createPackage() {
  const options = {
    stagingDir: path.join(rootDir, 'build'),
    outDir: path.join(rootDir, 'out'),
    outFile: 'jellyrock',
    retainStagingDir: true
  };

  console.log('📦 Creating package from build/ using roku-deploy...');

  await rokuDeploy.zipPackage(options);

  console.log(`✅ Package created: out/jellyrock.zip`);
}

createPackage().catch((err) => {
  console.error('❌ Failed to create package:', err.message);
  process.exit(1);
});

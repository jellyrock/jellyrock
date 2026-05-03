/**
 * Creates a signed Roku .pkg from the compiled build directory using
 * roku-deploy.deployAndSignPackage().
 *
 * Local-only by design — the signing operation requires a physical Roku
 * device (the device performs the encryption using its on-device dev key),
 * and a solo-maintainer release ritual doesn't benefit enough from CI to
 * justify the secret-management overhead. Run this against your dev Roku
 * after `npm run build:prod`.
 *
 * Required env vars (load via .env or your shell's preferred secret manager):
 *   ROKU_IP                target Roku (must be in dev mode)
 *   ROKU_PASSWORD          device dev portal password
 *   ROKU_SIGNING_PASSWORD  signing password used to encrypt the .pkg
 *
 * Optional env var:
 *   ROKU_DEV_ID            expected dev ID — script queries the device's
 *                          actual keyed-developer-id and aborts before signing
 *                          if it doesn't match. Recommended for channel-store
 *                          updates (must be stable across versions).
 *
 * Storage: easiest is a gitignored .env (chmod 600) — same pattern used by
 * scripts/run-roku-tests.js for ROKU_IP/ROKU_PASSWORD. For encryption-at-rest,
 * wrap with your preferred secret manager:
 *   ROKU_SIGNING_PASSWORD=$(pass show jellyrock/signing) npm run package:signed
 *
 * Usage: npm run package:signed   (composes build:prod first — always safe)
 *        node scripts/create-signed-package.cjs   (direct; signs whatever's
 *                                                  in build/ — see prod-build
 *                                                  guard below)
 * Output: out/jellyrock-vX.Y.Z.pkg   (version pulled from manifest — if the
 *         filename's version doesn't match what you expect, the version bump
 *         didn't land)
 */

require('dotenv').config();
const { rokuDeploy } = require('roku-deploy');
const fg = require('fast-glob');
const fs = require('fs');
const path = require('path');

// Resolve from cwd, not __dirname. npm run scripts always cd to package.json
// root, so production invocations land here correctly. Tests can override by
// spawning with a different cwd.
const rootDir = process.cwd();

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

function readVersionFromManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ Expected manifest at ${manifestPath}`);
    process.exit(1);
  }
  const text = fs.readFileSync(manifestPath, 'utf8');
  const get = (key) => {
    const match = text.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return match ? match[1].trim() : null;
  };
  const major = get('major_version');
  const minor = get('minor_version');
  const build = get('build_version');
  if (!major || !minor || !build) {
    console.error(
      `❌ Could not parse version from ${manifestPath}. Need major_version, minor_version, build_version.`,
    );
    process.exit(1);
  }
  return `${major}.${minor}.${build}`;
}

async function createSignedPackage() {
  const host = requireEnv('ROKU_IP');
  const password = requireEnv('ROKU_PASSWORD');
  const signingPassword = requireEnv('ROKU_SIGNING_PASSWORD');
  const devId = process.env.ROKU_DEV_ID || undefined;

  const buildDir = path.join(rootDir, 'build');
  if (!fs.existsSync(buildDir)) {
    console.error(`❌ Expected build/ at ${buildDir}. Run 'npm run build:prod' first.`);
    process.exit(1);
  }

  // Refuse to sign anything that isn't a prod build. Detection: prod sets
  // sourceMap=false (bsconfig-prod.json), dev sets sourceMap=true. Test
  // builds also have source maps. Any *.map under build/ means the build
  // came from bsconfig.json or bsconfig-tests*.json — both unsafe to ship.
  //
  // Exclude roku_modules/ — those are ropm-vendored upstream packages that
  // ship with their own .brs.map files regardless of our bsconfig settings.
  // We have no control over their build output and they're not what this
  // guard is trying to catch.
  const sourceMaps = await fg(['**/*.map'], {
    cwd: buildDir,
    onlyFiles: true,
    ignore: ['**/roku_modules/**'],
  });
  if (sourceMaps.length > 0) {
    console.error(
      '❌ build/ contains source maps — this is a dev or test build, not a prod build.',
    );
    console.error(`   First offender: build/${sourceMaps[0]}`);
    console.error(
      "   Run 'npm run build:prod' (or just 'npm run package:signed', which composes it).",
    );
    process.exit(1);
  }

  // Version goes in the filename so a missed version-bump is obvious at a
  // glance — the manifest is the canonical on-device version source.
  const version = readVersionFromManifest(path.join(buildDir, 'manifest'));
  const outFile = `jellyrock-v${version}`;

  const outDir = path.join(rootDir, 'out');
  const stagingDir = path.join(outDir, '.staging-signed');

  const options = {
    host,
    password,
    signingPassword,
    rootDir: buildDir,
    files: ['**/*'],
    stagingDir,
    outDir,
    outFile,
  };
  // Note: roku-deploy's `options.devId` is ONLY consulted inside rekeyDevice()
  // (which we don't call). signExistingPackage/deployAndSignPackage silently
  // ignore it. So we have to run the check ourselves before signing — fail
  // fast on mismatch rather than producing a .pkg the channel store will
  // reject.
  if (devId) {
    const actualDevId = await rokuDeploy.getDevId({ host, password });
    if (actualDevId !== devId) {
      console.error(`❌ Dev ID mismatch.`);
      console.error(`   Device ${host} reports: ${actualDevId}`);
      console.error(`   .env ROKU_DEV_ID expects: ${devId}`);
      console.error(
        '   Either correct ROKU_DEV_ID in .env, or rekey this device to the expected cert.',
      );
      process.exit(1);
    }
    console.log(`  • devId verified: ${actualDevId}`);
  }

  console.log('🔐 Creating signed Roku package via deployAndSignPackage...');
  console.log(`  • host: ${host}`);
  console.log(`  • version: ${version}`);
  console.log(`  • devId check: ${devId ? 'on (passed)' : 'off (no ROKU_DEV_ID set)'}`);

  const result = await rokuDeploy.deployAndSignPackage(options);
  const pkgPath = typeof result === 'string' ? result : path.join(outDir, `${outFile}.pkg`);
  console.log(`✅ Signed package created: ${pkgPath}`);
}

createSignedPackage().catch((err) => {
  const msg = err && err.message ? err.message : String(err);
  console.error('❌ Failed to create signed package:', msg);
  process.exit(1);
});

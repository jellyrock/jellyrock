/**
 * Roku Test Runner for CI/CD
 * Deploys test build to Roku and captures console output
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import './lib/load-env.cjs';
import * as rokuDeploy from 'roku-deploy';
import { acquireDeviceLock } from './device-lock.js';
import { beginRun, RUN_OUTCOMES } from './run-record.js';
import {
  createSummaryCollector,
  unaccountedTests,
  stampManifestTitle,
  createRunGate,
} from './lib/rooibos-summary.cjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROKU_IP = process.env.ROKU_IP;
const ROKU_PASSWORD = process.env.ROKU_PASSWORD;
// Idle timeout: fails the run if the Roku console stops emitting output for this long.
// Resets on every data event, so slow-but-progressing runs are never killed. The CI
// workflow's job-level timeout remains the ultimate backstop for total run length.
const IDLE_TIMEOUT_MS = Number(process.env.ROKU_TEST_IDLE_TIMEOUT_MS) || 60 * 1000;

if (!ROKU_IP || !ROKU_PASSWORD) {
  console.error('❌ Missing required environment variables: ROKU_IP and ROKU_PASSWORD');
  process.exit(1);
}

async function deployToRoku(runId) {
  console.log(`📱 Deploying to Roku at ${ROKU_IP}...`);
  const rootDir = path.join(__dirname, '..');
  const BUILD_DIR = path.join(rootDir, 'build');
  const OUT_DIR = path.join(rootDir, 'out');
  try {
    // The device prints the app's title in its `Running dev` line, and
    // startCapture() waits for the one carrying this run's id. build/ is rebuilt by
    // every build, so the source manifest is never touched.
    const manifestPath = path.join(BUILD_DIR, 'manifest');
    const manifestText = fs.readFileSync(manifestPath, 'utf8');
    fs.writeFileSync(manifestPath, stampManifestTitle(manifestText, runId));

    // BSC v1 only compiles to build/: zip it for roku-deploy
    await rokuDeploy.zipPackage({
      stagingDir: BUILD_DIR,
      outDir: OUT_DIR,
      outFile: 'jellyrock',
      retainStagingDir: true,
    });
    console.log('📦 Package created: out/jellyrock.zip');

    await rokuDeploy.publish({
      host: ROKU_IP,
      password: ROKU_PASSWORD,
      outDir: OUT_DIR,
      outFile: 'jellyrock.zip',
    });
    console.log('✅ Deployment successful');
  } catch (error) {
    // Throw rather than exit: main() owns the device lock and must get the
    // chance to release it, or a failed deploy would wedge the device until the
    // TTL expires. No `{ cause }`: it was left out while the repo's ESLint targeted
    // Node >=16.0 (error-cause landed in 16.9). `engines` now sets Node 22, where it
    // lints clean; the message already carries the detail.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`Deployment failed: ${error.message}`);
  }
}

/**
 * Opens the console connection and reads it until the run ends. The console replays its
 * buffer on connect, so lines from the previous app can arrive first: nothing counts
 * until the line announcing this run's stamped title (see `createRunGate`). The log file
 * and stdout still get every line.
 *
 * Connect before the sideload so the small console buffer cannot lose that line. Returns
 * `connected` (settles when the socket is open), `watch()` (arms the idle timer, call it
 * once the sideload has returned), `cancel()` (tears the connection down) and `result`.
 */
function startCapture(runId) {
  console.log('🔌 Connecting to Roku debug console...');
  const logFile = 'roku-test-output.log';
  const writeStream = fs.createWriteStream(logFile);
  const socket = new net.Socket();
  const gate = createRunGate(runId);
  const results = [];
  const summary = createSummaryCollector();
  let idleTimeoutId;
  let lineBuffer = '';
  let markerSeen = false;
  let watching = false;
  let settled = false;
  let resolveResult;
  let rejectResult;

  const result = new Promise((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // A failure can arrive while main() is still deploying, before it awaits `result`.
  result.catch(() => {});

  function settle(settleFn, value) {
    if (settled) return;
    settled = true;
    clearTimeout(idleTimeoutId);
    socket.destroy();
    writeStream.end();
    settleFn(value);
  }

  // The reason a run that ended with no result gives, which differs when the new build
  // never started.
  function noResultError(message) {
    return new Error(
      markerSeen
        ? message
        : `${message}. The new build never started: its Running dev line never appeared`,
    );
  }

  function settleFromResults(message) {
    const lastResult = results.length > 0 ? results[results.length - 1] : null;
    if (lastResult) {
      settle(resolveResult, { passed: lastResult === 'PASS', logFile, summary: summary.summary() });
    } else {
      settle(rejectResult, noResultError(message));
    }
  }

  function resetIdleTimer() {
    if (!watching) return;
    clearTimeout(idleTimeoutId);
    idleTimeoutId = setTimeout(() => {
      settleFromResults(
        `No console output for ${IDLE_TIMEOUT_MS / 1000} seconds, Roku appears hung`,
      );
    }, IDLE_TIMEOUT_MS);
  }

  const connected = new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  connected.catch(() => {});
  socket.connect(8085, ROKU_IP, () => {
    console.log('✅ Connected to Roku console');
  });

  // Helper to process a single line for results and shutdown
  function processLine(line) {
    // Normalize line endings (handle CRLF from Roku console)
    const cleanLine = line.replace(/\r+$/, '');

    // Lines before this run's marker are the previous app's replay.
    if (!gate.accepts(cleanLine)) return false;
    markerSeen = true;

    // Capture test results in-memory to avoid file read race condition
    const resultMatch = cleanLine.match(/^\[Rooibos Result\]: (PASS|FAIL)$/);
    if (resultMatch) {
      results.push(resultMatch[1]);
    }
    summary.addLine(cleanLine);

    // Check for shutdown signal
    if (cleanLine.includes('[Rooibos Shutdown]')) {
      settleFromResults('Test run completed without result');
      return true; // Signal that shutdown was detected
    }
    return false;
  }

  socket.on('data', (data) => {
    resetIdleTimer();
    const chunk = data.toString();
    writeStream.write(data);
    process.stdout.write(data);

    // Line buffering to handle TCP chunk boundaries
    lineBuffer += chunk;
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop(); // Keep incomplete line for next chunk

    for (const line of lines) {
      if (processLine(line)) {
        return; // Shutdown detected
      }
    }
  });

  socket.on('error', (err) => {
    if (results.length > 0) {
      console.warn('Connection error, but result found:', err.message);
      settleFromResults('');
    } else {
      settle(rejectResult, noResultError(`Console connection error: ${err.message}`));
    }
  });

  socket.on('close', () => {
    // Process any remaining content in lineBuffer (handles shutdown without trailing newline)
    if (lineBuffer.length > 0 && processLine(lineBuffer)) {
      return; // Shutdown was detected and handled
    }
    settleFromResults('Console connection closed without test result');
  });

  return {
    connected,
    result,
    watch() {
      watching = true;
      resetIdleTimer();
    },
    cancel() {
      settle(rejectResult, new Error('Console capture cancelled'));
    },
  };
}

async function main() {
  // Claim the shared device before the sideload. The Rooibos suite has no
  // registry snapshot to protect it, so an overlapping run is pure corruption:
  // the deploy alone restarts whatever the other party was driving.
  const lock = await acquireDeviceLock({ what: 'roku device tests' });
  // Records to `.device-runs/device/`, not `.device-runs/rta/`: this is the Rooibos runner, and it
  // used to overwrite the RTA suite's run record on a path named for the other
  // harness. The window it stamps is not decoration: #800 went red on
  // `SessionManagement.spec.bs` -> "connects to Jellyfin stable demo server", and
  // the two surviving explanations (contention on the shared demo account, plain
  // flake) are both fixture-side. A run that straddled the hourly reset is now
  // visible after the fact instead of needing to be reconstructed.
  const run = beginRun({ lock, run: 'run-roku-tests' });
  // Guarded because `done` is both the normal exit AND the signal handler: a
  // Ctrl-C arriving while the release is in flight would otherwise re-enter and
  // release twice. The fold itself is idempotent, so the guard is about the lock.
  let exiting = false;
  const done = async (code) => {
    if (exiting) return;
    exiting = true;
    // `done` is the single exit for this runner, so its code IS the outcome. Worth
    // recording here specifically: #800 went red on a ROOIBOS test against the same
    // fixture, and re-deriving that from the ledger needs the red run to be
    // identifiable as red.
    run.close(
      code === 0
        ? RUN_OUTCOMES.PASSED
        : code === 130
          ? RUN_OUTCOMES.INTERRUPTED
          : RUN_OUTCOMES.FAILED,
    );
    await lock.release();
    process.exit(code);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => done(130));
  }

  try {
    const runId = randomBytes(4).toString('hex');
    const capture = startCapture(runId);
    await capture.connected;
    try {
      await deployToRoku(runId);
    } catch (error) {
      capture.cancel();
      throw error;
    }
    // The sideload prints nothing and can outlast the idle timeout, so the timer
    // starts only now.
    capture.watch();

    const result = await capture.result;
    console.log(`📝 Full log saved to ${result.logFile}`);

    // Every test in Total must land in exactly one reported bucket. One that does
    // not ran invisibly while the run still reads as a clean PASS.
    const unaccounted = result.summary ? unaccountedTests(result.summary) : 0;
    if (result.passed && unaccounted > 0) {
      console.error(
        `❌ ${unaccounted} test(s) counted in Total but reported as none of Passed, Crashed, Failed or Ignored. ` +
          "The known cause is an individually @ignore'd test on an unpatched Rooibos, whose Ignored count leaves " +
          'it out: check that `npm run patches:apply` applies patches/rooibos-roku+*.patch.',
      );
      await done(1);
    } else if (result.passed) {
      console.log('✅ All tests passed!');
      await done(0);
    } else {
      console.error('❌ Tests failed!');
      await done(1);
    }
  } catch (error) {
    console.error('❌ Test execution failed:', error.message);
    await done(1);
  }
}

main();

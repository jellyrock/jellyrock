/**
 * Roku Test Runner for CI/CD
 * Deploys test build to Roku and captures console output
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import dotenv from 'dotenv';
import * as rokuDeploy from 'roku-deploy';
import { acquireDeviceLock } from './device-lock.js';
import { beginRun, RUN_OUTCOMES } from './run-record.js';

dotenv.config();

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

async function deployToRoku() {
  console.log(`📱 Deploying to Roku at ${ROKU_IP}...`);
  const rootDir = path.join(__dirname, '..');
  const BUILD_DIR = path.join(rootDir, 'build');
  const OUT_DIR = path.join(rootDir, 'out');
  try {
    // BSC v1 only compiles to build/ — zip it for roku-deploy
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
    // TTL expires. No `{ cause }` — the repo's ESLint targets Node >=16.0 and
    // error-cause landed in 16.9; the message already carries the detail.
    // eslint-disable-next-line preserve-caught-error
    throw new Error(`Deployment failed: ${error.message}`);
  }
}

async function captureConsole() {
  console.log('🔌 Connecting to Roku debug console...');
  return new Promise((resolve, reject) => {
    const logFile = 'roku-test-output.log';
    const writeStream = fs.createWriteStream(logFile);
    const socket = new net.Socket();
    let idleTimeoutId;
    let lineBuffer = '';
    const results = [];

    function resetIdleTimer() {
      clearTimeout(idleTimeoutId);
      idleTimeoutId = setTimeout(() => {
        socket.destroy();
        writeStream.end();

        const lastResult = results.length > 0 ? results[results.length - 1] : null;
        if (lastResult) {
          resolve({ passed: lastResult === 'PASS', logFile });
        } else {
          reject(
            new Error(
              `No console output for ${IDLE_TIMEOUT_MS / 1000} seconds — Roku appears hung`,
            ),
          );
        }
      }, IDLE_TIMEOUT_MS);
    }

    socket.connect(8085, ROKU_IP, () => {
      console.log('✅ Connected to Roku console');
      resetIdleTimer();
    });

    // Helper to process a single line for results and shutdown
    function processLine(line) {
      // Normalize line endings (handle CRLF from Roku console)
      const cleanLine = line.replace(/\r+$/, '');

      // Capture test results in-memory to avoid file read race condition
      const resultMatch = cleanLine.match(/^\[Rooibos Result\]: (PASS|FAIL)$/);
      if (resultMatch) {
        results.push(resultMatch[1]);
      }

      // Check for shutdown signal
      if (cleanLine.includes('[Rooibos Shutdown]')) {
        clearTimeout(idleTimeoutId);
        socket.destroy();
        writeStream.end();

        const lastResult = results.length > 0 ? results[results.length - 1] : null;
        if (lastResult) {
          resolve({ passed: lastResult === 'PASS', logFile });
        } else {
          reject(new Error('Test run completed without result'));
        }
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
      clearTimeout(idleTimeoutId);
      socket.destroy();
      writeStream.end();

      const lastResult = results.length > 0 ? results[results.length - 1] : null;
      if (lastResult) {
        console.warn('Connection error, but result found:', err.message);
        resolve({ passed: lastResult === 'PASS', logFile });
      } else {
        reject(new Error(`Console connection error: ${err.message}`));
      }
    });

    socket.on('close', () => {
      clearTimeout(idleTimeoutId);
      writeStream.end();

      // Process any remaining content in lineBuffer (handles shutdown without trailing newline)
      if (lineBuffer.length > 0 && processLine(lineBuffer)) {
        return; // Shutdown was detected and handled
      }

      const lastResult = results.length > 0 ? results[results.length - 1] : null;
      if (lastResult) {
        resolve({ passed: lastResult === 'PASS', logFile });
      } else {
        reject(new Error('Console connection closed without test result'));
      }
    });
  });
}

async function main() {
  // Claim the shared device before the sideload. The Rooibos suite has no
  // registry snapshot to protect it, so an overlapping run is pure corruption:
  // the deploy alone restarts whatever the other party was driving.
  const lock = await acquireDeviceLock({ what: 'roku device tests' });
  // Records to `out/device/`, not `out/rta/` — this is the Rooibos runner, and it
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
    await deployToRoku();
    console.log('⏳ Waiting for app to start...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const result = await captureConsole();
    console.log(`📝 Full log saved to ${result.logFile}`);

    if (result.passed) {
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

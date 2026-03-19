#!/usr/bin/env node
/**
 * Roku Test Runner for CI/CD
 * Deploys test build to Roku and captures console output
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import net from 'net';
import dotenv from 'dotenv';
import * as rokuDeploy from 'roku-deploy';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROKU_IP = process.env.ROKU_IP;
const ROKU_PASSWORD = process.env.ROKU_PASSWORD;
const TIMEOUT_MS = 5 * 60 * 1000;

if (!ROKU_IP || !ROKU_PASSWORD) {
  console.error('❌ Missing required environment variables: ROKU_IP and ROKU_PASSWORD');
  process.exit(1);
}

async function deployToRoku() {
  console.log(`📱 Deploying to Roku at ${ROKU_IP}...`);
  const OUT_DIR = path.join(__dirname, '..', 'out');
  try {
    await rokuDeploy.publish({
      host: ROKU_IP,
      password: ROKU_PASSWORD,
      outDir: OUT_DIR,
      outFile: 'jellyrock.zip'
    });
    console.log('✅ Deployment successful');
  } catch (error) {
    console.error('❌ Deployment failed:', error.message);
    process.exit(1);
  }
}

function extractResult(logPath) {
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    const results = content.match(/^\[Rooibos Result\]: (PASS|FAIL)$/gm);
    if (results && results.length > 0) {
      const lastResult = results[results.length - 1];
      return {
        passed: lastResult.includes('PASS'),
        found: true
      };
    }
    return { found: false };
  } catch (err) {
    return { found: false, error: err.message };
  }
}

async function captureConsole() {
  console.log('🔌 Connecting to Roku debug console...');
  return new Promise((resolve, reject) => {
    const logFile = 'roku-test-output.log';
    const writeStream = fs.createWriteStream(logFile);
    const socket = new net.Socket();
    let timeoutId;

    socket.connect(8085, ROKU_IP, () => {
      console.log('✅ Connected to Roku console');
    });

    socket.on('data', (data) => {
      writeStream.write(data);
      process.stdout.write(data);

      // Check for shutdown signal to know when tests are truly done
      if (data.toString().includes('[Rooibos Shutdown]')) {
        writeStream.end();
        const result = extractResult(logFile);
        clearTimeout(timeoutId);
        socket.destroy();
        if (result.found) {
          resolve({ passed: result.passed, logFile });
        } else {
          reject(new Error('Test run completed without result'));
        }
      }
    });

    socket.on('error', (err) => {
      writeStream.end();
      const result = extractResult(logFile);
      if (result.found) {
        console.warn('Connection error, but result found:', err.message);
        clearTimeout(timeoutId);
        resolve({ passed: result.passed, logFile });
      } else {
        reject(new Error(`Console connection error: ${err.message}`));
      }
    });

    socket.on('close', () => {
      writeStream.end();
      const result = extractResult(logFile);
      clearTimeout(timeoutId);
      if (result.found) {
        resolve({ passed: result.passed, logFile });
      } else {
        reject(new Error('Console connection closed without test result'));
      }
    });

    timeoutId = setTimeout(() => {
      socket.destroy();
      writeStream.end();
      const result = extractResult(logFile);
      if (result.found) {
        resolve({ passed: result.passed, logFile });
      } else {
        reject(new Error(`Test timeout after ${TIMEOUT_MS / 1000} seconds`));
      }
    }, TIMEOUT_MS);
  });
}

async function main() {
  try {
    await deployToRoku();
    console.log('⏳ Waiting for app to start...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    const result = await captureConsole();
    console.log(`📝 Full log saved to ${result.logFile}`);

    if (result.passed) {
      console.log('✅ All tests passed!');
      process.exit(0);
    } else {
      console.error('❌ Tests failed!');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Test execution failed:', error.message);
    process.exit(1);
  }
}

main();

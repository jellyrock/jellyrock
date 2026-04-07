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
  const rootDir = path.join(__dirname, '..');
  const BUILD_DIR = path.join(rootDir, 'build');
  const OUT_DIR = path.join(rootDir, 'out');
  try {
    // BSC v1 only compiles to build/ — zip it for roku-deploy
    await rokuDeploy.zipPackage({
      stagingDir: BUILD_DIR,
      outDir: OUT_DIR,
      outFile: 'jellyrock',
      retainStagingDir: true
    });
    console.log('📦 Package created: out/jellyrock.zip');

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

async function captureConsole() {
  console.log('🔌 Connecting to Roku debug console...');
  return new Promise((resolve, reject) => {
    const logFile = 'roku-test-output.log';
    const writeStream = fs.createWriteStream(logFile);
    const socket = new net.Socket();
    let timeoutId;
    let lineBuffer = '';
    const results = [];

    socket.connect(8085, ROKU_IP, () => {
      console.log('✅ Connected to Roku console');
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
        clearTimeout(timeoutId);
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
      clearTimeout(timeoutId);
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
      clearTimeout(timeoutId);
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

    timeoutId = setTimeout(() => {
      socket.destroy();
      writeStream.end();
      
      const lastResult = results.length > 0 ? results[results.length - 1] : null;
      if (lastResult) {
        resolve({ passed: lastResult === 'PASS', logFile });
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

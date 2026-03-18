#!/usr/bin/env node
/**
 * Roku Test Runner for CI/CD
 * Deploys test build to Roku and captures console output
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROKU_IP = process.env.ROKU_IP;
const ROKU_PASSWORD = process.env.ROKU_PASSWORD;
const BUILD_DIR = path.join(__dirname, '..', 'build');
const TIMEOUT_MS = 5 * 60 * 1000;

if (!ROKU_IP || !ROKU_PASSWORD) {
  console.error('❌ Missing required environment variables: ROKU_IP and ROKU_PASSWORD');
  process.exit(1);
}

async function deployToRoku() {
  console.log(`📱 Deploying to Roku at ${ROKU_IP}...`);
  try {
    execSync(`npx roku-deploy --host ${ROKU_IP} --password ${ROKU_PASSWORD} --root-dir ${BUILD_DIR}`, {
      stdio: 'inherit',
      timeout: 60000
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
    const output = [];
    const socket = new net.Socket();
    let timeoutId;
    
    socket.connect(8085, ROKU_IP, () => {
      console.log('✅ Connected to Roku console');
    });
    
    socket.on('data', (data) => {
      const text = data.toString();
      output.push(text);
      process.stdout.write(text);
      
      if (text.includes('[Rooibos Result]: PASS')) {
        clearTimeout(timeoutId);
        socket.destroy();
        resolve({ output: output.join(''), passed: true });
      } else if (text.includes('[Rooibos Result]: FAIL')) {
        clearTimeout(timeoutId);
        socket.destroy();
        resolve({ output: output.join(''), passed: false });
      }
    });
    
    socket.on('error', (err) => {
      reject(new Error(`Console connection error: ${err.message}`));
    });
    
    socket.on('close', () => {
      reject(new Error('Console connection closed unexpectedly'));
    });
    
    timeoutId = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Test timeout after ${TIMEOUT_MS/1000} seconds`));
    }, TIMEOUT_MS);
  });
}

async function main() {
  try {
    await deployToRoku();
    console.log('⏳ Waiting for app to start...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const result = await captureConsole();
    const logFile = 'roku-test-output.log';
    fs.writeFileSync(logFile, result.output);
    console.log(`📝 Full log saved to ${logFile}`);
    
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

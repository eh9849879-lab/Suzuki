#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BUILD_ID = process.env.BUILD_ID;
if (!BUILD_ID) { console.error('BUILD_ID required'); process.exit(1); }

const STATE_PATH = `builds/${BUILD_ID}/state.json`;

function readState() {
  if (!fs.existsSync(STATE_PATH)) return { logs: [] };
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
  catch { return { logs: [] }; }
}

function writeState(state) {
  state.updatedAt = Date.now();
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function gitCommitPush(message) {
  try {
    execSync('git config user.email "bot@debugbuilder.local"', { stdio: 'pipe' });
    execSync('git config user.name "Debug Builder Bot"', { stdio: 'pipe' });
    execSync(`git add "${STATE_PATH}"`, { stdio: 'pipe' });
    execSync(`git diff --cached --quiet || git commit -m "${message.replace(/"/g, '\\"')}"`, { stdio: 'inherit' });
    execSync('git push origin HEAD', { stdio: 'inherit' });
    return true;
  } catch (e) {
    console.error('git push failed:', e.message);
    return false;
  }
}

function updateProgress(stage, progress, log) {
  const state = readState();
  state.status = 'running';
  state.stage = stage;
  state.progress = progress;
  state.startedAt = state.startedAt || Date.now();
  if (log) state.logs = [...(state.logs || []), log].slice(-300);
  writeState(state);
  gitCommitPush(`[build] ${BUILD_ID} — ${stage} (${progress}%)`);
  console.log(`✓ ${stage} (${progress}%)`);
}

function reportFailure(stage, errorMsg) {
  const state = readState();
  state.status = 'failed';
  state.stage = stage;
  state.error = errorMsg;
  state.finishedAt = Date.now();
  const logPath = 'build-workspace/gradle-log.txt';
  if (fs.existsSync(logPath)) {
    const lines = fs.readFileSync(logPath, 'utf8').split('\n').slice(-40);
    state.logs = [...(state.logs || []), ...lines];
  }
  state.logs = [...(state.logs || []), `✖ ${errorMsg}`].slice(-300);
  writeState(state);
  gitCommitPush(`[build] ${BUILD_ID} — FAILED`);
  console.error(`✖ ${stage}: ${errorMsg}`);
}

(async () => {
  const args = process.argv.slice(2);
  try {
    if (args[0] === '--fail') {
      reportFailure(args[1] || 'Failed', args.slice(2).join(' ') || 'Build failed');
    } else {
      const stage = args[0] || 'Working';
      const progress = parseInt(args[1] || '10', 10);
      const log = args.slice(2).join(' ');
      updateProgress(stage, progress, log);
    }
  } catch (e) {
    console.error('report.js failed:', e);
    process.exit(1);
  }
})();

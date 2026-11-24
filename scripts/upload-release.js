#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BUILD_ID = process.env.BUILD_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;

if (!BUILD_ID || !GITHUB_TOKEN || !GITHUB_REPOSITORY) {
  console.error('Missing BUILD_ID / GITHUB_TOKEN / GITHUB_REPOSITORY');
  process.exit(1);
}

async function ghApi(method, endpoint, body) {
  const res = await fetch(`https://api.github.com${endpoint}`, {
    method,
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub ${method} ${endpoint} → ${res.status}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function uploadAsset(uploadUrlBase, filePath, name) {
  const buf = fs.readFileSync(filePath);
  const url = uploadUrlBase.replace('{?name,label}', '') + `?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(buf.length)
    },
    body: buf
  });
  if (!res.ok) throw new Error('Asset upload failed: ' + res.status);
  return res.json();
}

async function main() {
  const meta = JSON.parse(fs.readFileSync('build-workspace/build-meta.json', 'utf8'));
  const artifactPath = meta.outputPath;
  if (!fs.existsSync(artifactPath)) throw new Error('Artifact missing: ' + artifactPath);

  const filename = path.basename(artifactPath);
  const tag = `build-${BUILD_ID}`;

  console.log('Creating release', tag);
  const release = await ghApi('POST', `/repos/${GITHUB_REPOSITORY}/releases`, {
    tag_name: tag,
    name: `Build ${BUILD_ID}`,
    body: `Automated build\n\nProject: ${meta.appName}\nType: ${meta.buildType} ${meta.variant}\nBuild ID: ${BUILD_ID}`,
    draft: false,
    prerelease: false
  });

  console.log('Uploading artifact', filename);
  const asset = await uploadAsset(release.upload_url, artifactPath, filename);
  console.log('Artifact URL:', asset.browser_download_url);

  // Update state.json (success)
  const statePath = `builds/${BUILD_ID}/state.json`;
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  state.status = 'success';
  state.stage = 'Completed';
  state.progress = 100;
  state.artifactUrl = asset.browser_download_url;
  state.artifactName = filename;
  state.artifactSize = fs.statSync(artifactPath).size;
  state.releaseUrl = release.html_url;
  state.finishedAt = Date.now();
  state.updatedAt = Date.now();
  state.logs = [
    ...(state.logs || []),
    '✔ Build complete',
    `  Release: ${release.html_url}`,
    `  Artifact: ${filename} (${(state.artifactSize / 1024).toFixed(1)} KB)`
  ].slice(-300);
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  // Commit & push state
  execSync('git config user.email "bot@debugbuilder.local"', { stdio: 'pipe' });
  execSync('git config user.name "Debug Builder Bot"', { stdio: 'pipe' });
  execSync(`git add "${statePath}"`, { stdio: 'pipe' });
  execSync(`git diff --cached --quiet || git commit -m "[build] ${BUILD_ID} — SUCCESS"`, { stdio: 'inherit' });
  execSync('git push origin HEAD', { stdio: 'inherit' });
  console.log('State committed ✓');
}

main().catch(e => {
  console.error('upload-release failed:', e.message);
  process.exit(1);
});

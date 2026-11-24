#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const BUILD_ID = process.env.BUILD_ID;
if (!BUILD_ID) { console.error('BUILD_ID required'); process.exit(1); }

async function main() {
  const zipPath = `builds/${BUILD_ID}/project.zip`;
  const cfgPath = `builds/${BUILD_ID}/config.json`;

  if (!fs.existsSync(zipPath)) throw new Error('project.zip not found in build branch');
  if (!fs.existsSync(cfgPath)) throw new Error('config.json not found in build branch');

  const zipBuf = fs.readFileSync(zipPath);
  fs.mkdirSync('build-data', { recursive: true });
  fs.copyFileSync(cfgPath, 'build-data/config.json');

  const zip = await JSZip.loadAsync(zipBuf);
  const outRoot = 'build-data/project';
  fs.mkdirSync(outRoot, { recursive: true });

  let count = 0;
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    const dest = path.join(outRoot, name);
    if (entry.dir) { fs.mkdirSync(dest, { recursive: true }); continue; }
    const buf = await entry.async('nodebuffer');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    count++;
  }
  console.log(`Extracted ${count} files`);

  // Validate entry point
  if (!fs.existsSync(path.join(outRoot, 'index.html'))) {
    throw new Error('index.html missing at project root — cannot build');
  }
  console.log('index.html verified ✓');
}

main().catch(e => {
  console.error('fetch-build failed:', e.message);
  process.exit(1);
});

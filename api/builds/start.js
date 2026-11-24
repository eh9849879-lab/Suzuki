import formidable from 'formidable';
import fs from 'fs';
import JSZip from 'jszip';
import crypto from 'crypto';
import { handlePreflight, json, error } from '../../lib/cors.js';
import { createBuildBranch } from '../../lib/storage.js';
import { triggerWorkflow } from '../../lib/github.js';

export const config = {
  api: { bodyParser: false, sizeLimit: '4.5mb' }
};

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const form = formidable({
      multiples: true,
      maxFileSize: 4.4 * 1024 * 1024,
      maxTotalFileSize: 4.4 * 1024 * 1024,
      allowEmptyFiles: true
    });
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);
      resolve({ fields, files });
    });
  });
}

function asArray(v) { return Array.isArray(v) ? v : v ? [v] : []; }
function asString(v) { return Array.isArray(v) ? v[0] : (v ?? ''); }

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return error(res, 405, 'Method not allowed');

  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) {
    return error(res, 503, 'Backend misconfigured: GITHUB_TOKEN and GITHUB_REPO required');
  }

  let parsed;
  try { parsed = await parseMultipart(req); }
  catch (e) { return error(res, 400, 'Invalid multipart: ' + e.message); }

  const { fields, files } = parsed;
  const rawFiles = asArray(files.files);
  const filePaths = asArray(fields.filePaths);

  if (!rawFiles.length) return error(res, 400, 'No files uploaded');
  if (rawFiles.length > 5000) return error(res, 400, 'Too many files (max 5000)');

  // Build ZIP
  const zip = new JSZip();
  for (let i = 0; i < rawFiles.length; i++) {
    const f = rawFiles[i];
    const path = String(filePaths[i] || f.originalFilename || `file-${i}`).replace(/^\/+/, '');
    const buf = await fs.promises.readFile(f.filepath);
    zip.file(path, buf);
  }
  let zipBuf;
  try {
    zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  } catch (e) {
    return error(res, 500, 'ZIP creation failed: ' + e.message);
  }

  // Parse config
  let configObj = {}, permissions = [], signing = null;
  try { configObj = JSON.parse(asString(fields.config) || '{}'); } catch {}
  try { permissions = JSON.parse(asString(fields.permissions) || '[]'); } catch {}
  try { const s = asString(fields.signing); signing = s ? JSON.parse(s) : null; } catch { signing = null; }

  const buildId = crypto.randomUUID();
  const startTime = Date.now();

  const buildType = asString(fields.buildType) === 'AAB' ? 'AAB' : 'APK';
  const variant = asString(fields.variant) === 'release' ? 'release' : 'debug';

  // Validate release signing
  if ((variant === 'release' || buildType === 'AAB') && !(signing && signing.keystore)) {
    return error(res, 400, 'Release signing key required. Generate one in the app first (Settings → Signing Key → Generate).');
  }

  const config = {
    projectId: asString(fields.projectId) || '',
    projectName: asString(fields.projectName) || 'Untitled',
    packageName: asString(fields.packageName) || 'com.debugbuilder.app',
    versionName: asString(fields.versionName) || '1.0.0',
    versionCode: parseInt(asString(fields.versionCode) || '1', 10) || 1,
    buildType,
    variant,
    config: configObj,
    permissions,
    signing,
    icon: asString(fields.icon) || ''
  };

  const initialState = {
    buildId,
    status: 'queued',
    stage: 'Queued',
    progress: 0,
    logs: [
      '► Build queued',
      `  Project: ${config.projectName}`,
      `  Package: ${config.packageName}`,
      `  Type: ${config.buildType} (${config.variant})`,
      `  Files: ${rawFiles.length} (${(zipBuf.length / 1024).toFixed(1)} KB)`
    ],
    createdAt: startTime,
    updatedAt: startTime
  };

  try {
    await createBuildBranch(buildId, { zipBuffer: zipBuf, config, state: initialState });
    await triggerWorkflow(buildId);
    return json(res, 200, { buildId });
  } catch (e) {
    console.error('start build failed:', e);
    return error(res, 500, 'Failed to start build: ' + e.message);
  }
}

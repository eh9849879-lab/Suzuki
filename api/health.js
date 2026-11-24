import { handlePreflight, json } from '../lib/cors.js';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });

  const checks = {
    github_token: !!process.env.GITHUB_TOKEN,
    github_repo: !!process.env.GITHUB_REPO
  };
  const ok = Object.values(checks).every(Boolean);

  return json(res, ok ? 200 : 503, {
    version: '2.0.0',
    service: 'debugbuilder-backend',
    status: ok ? 'ok' : 'misconfigured',
    checks,
    timestamp: new Date().toISOString()
  });
}

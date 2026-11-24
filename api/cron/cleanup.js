import { handlePreflight, json } from '../../lib/cors.js';
import { cleanupStaleBranches } from '../../lib/storage.js';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' });
  }

  try {
    const results = await cleanupStaleBranches();
    const deleted = results.filter(r => r.deleted).length;
    return json(res, 200, {
      ok: true,
      scanned: results.length,
      deleted,
      results
    });
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
}

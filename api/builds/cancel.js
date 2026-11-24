import { handlePreflight, json, error } from '../../lib/cors.js';
import { getBuildState, writeCancelledState } from '../../lib/storage.js';
import { cancelRun, getLatestRun } from '../../lib/github.js';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') return error(res, 405, 'Method not allowed');

  const buildId = (req.body || {}).buildId;
  if (!buildId) return error(res, 400, 'buildId required');

  const state = await getBuildState(buildId);
  if (!state) return error(res, 404, 'Build not found');
  if (['success', 'failed', 'cancelled'].includes(state.status)) {
    return json(res, 200, { ok: true, alreadyTerminal: true, status: state.status });
  }

  // Cancel GitHub Actions run (best-effort)
  try {
    const run = await getLatestRun();
    if (run && ['in_progress', 'queued', 'waiting'].includes(run.status)) {
      await cancelRun(run.id);
    }
  } catch (e) { console.warn('cancelRun failed:', e.message); }

  // Write cancelled state (unless already terminal)
  try {
    await writeCancelledState(buildId, state);
  } catch (e) { console.warn('write cancelled state failed:', e.message); }

  return json(res, 200, { ok: true, status: 'cancelled' });
}

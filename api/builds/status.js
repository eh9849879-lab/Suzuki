import { handlePreflight, json, error } from '../../lib/cors.js';
import { getBuildState } from '../../lib/storage.js';
import { STALE_AGE_MS } from '../../lib/constants.js';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'GET') return error(res, 405, 'Method not allowed');

  const buildId = req.query.buildId;
  if (!buildId) return error(res, 400, 'buildId required');

  const state = await getBuildState(buildId);
  if (!state) return error(res, 404, 'Build not found or branch already cleaned up');

  // Stale detection: if running for > 15 min without update, mark failed
  const now = Date.now();
  if (state.status === 'running' && (now - (state.updatedAt || 0)) > STALE_AGE_MS) {
    state.status = 'failed';
    state.stage = 'Timed Out';
    state.error = 'Build did not report progress in time';
    state.finishedAt = now;
  }

  return json(res, 200, {
    status: state.status,
    stage: state.stage,
    progress: state.progress || 0,
    logs: state.logs || [],
    artifactUrl: state.artifactUrl || null,
    artifactName: state.artifactName || null,
    artifactSize: state.artifactSize || 0,
    error: state.error || null,
    releaseUrl: state.releaseUrl || null,
    createdAt: state.createdAt,
    startedAt: state.startedAt || null,
    finishedAt: state.finishedAt || null
  });
}

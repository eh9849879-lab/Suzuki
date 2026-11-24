import {
  repoInfo, getBranchSha, getDefaultBranch, getCommitTreeSha,
  createBranchRef, createBlob, createTree, createCommit, updateBranchRef,
  getFileContent, putFileContent, deleteBranch, listBranches
} from './github.js';
import { BRANCH_PREFIX, STALE_AGE_MS } from './constants.js';

export function branchName(buildId) {
  return `${BRANCH_PREFIX}${buildId}`;
}

/**
 * Create a new build branch with project.zip, config.json, state.json.
 * All files committed atomically via Git Data API.
 */
export async function createBuildBranch(buildId, { zipBuffer, config, state }) {
  const branch = branchName(buildId);

  // Resolve base branch + tree
  const baseBranch = process.env.GITHUB_BRANCH || 'main';
  let baseSha;
  try {
    baseSha = await getBranchSha(baseBranch);
  } catch {
    const fallback = await getDefaultBranch();
    baseSha = await getBranchSha(fallback);
  }
  const baseTreeSha = await getCommitTreeSha(baseSha);

  // Create branch pointing at base
  await createBranchRef(branch, baseSha);

  // Create blobs
  const zipBlobSha = await createBlob(zipBuffer.toString('base64'));
  const configBlobSha = await createBlob(Buffer.from(JSON.stringify(config, null, 2)).toString('base64'));
  const stateBlobSha = await createBlob(Buffer.from(JSON.stringify(state, null, 2)).toString('base64'));

  // Create tree with base_tree so main's files are preserved
  const tree = await createTree(baseTreeSha, [
    { path: `builds/${buildId}/project.zip`, mode: '100644', type: 'blob', sha: zipBlobSha },
    { path: `builds/${buildId}/config.json`, mode: '100644', type: 'blob', sha: configBlobSha },
    { path: `builds/${buildId}/state.json`, mode: '100644', type: 'blob', sha: stateBlobSha }
  ]);

  // Create commit + point branch at it
  const commit = await createCommit(`[build] ${buildId} — init`, tree, baseSha);
  await updateBranchRef(branch, commit, false);

  return { branch, commit };
}

export async function getBuildState(buildId) {
  const content = await getFileContent(`builds/${buildId}/state.json`, branchName(buildId));
  if (!content) return null;
  try { return JSON.parse(content); } catch { return null; }
}

export async function getBuildConfig(buildId) {
  const content = await getFileContent(`builds/${buildId}/config.json`, branchName(buildId));
  if (!content) return null;
  try { return JSON.parse(content); } catch { return null; }
}

export async function writeCancelledState(buildId, currentState) {
  const updated = {
    ...currentState,
    status: 'cancelled',
    stage: 'Cancelled',
    error: 'Build cancelled by user',
    finishedAt: Date.now(),
    updatedAt: Date.now(),
    logs: [...(currentState.logs || []), '✖ Build cancelled by user'].slice(-300)
  };
  await putFileContent(
    `builds/${buildId}/state.json`,
    branchName(buildId),
    JSON.stringify(updated, null, 2),
    `[build] ${buildId} — cancelled`
  );
  return updated;
}

/**
 * Cleanup: delete build branches older than STALE_AGE_MS.
 */
export async function cleanupStaleBranches() {
  const branches = await listBranches(BRANCH_PREFIX);
  const cutoff = Date.now() - STALE_AGE_MS;
  const results = [];

  for (const b of branches) {
    const buildId = b.name.slice(BRANCH_PREFIX.length);
    try {
      const state = await getBuildState(buildId);
      const updatedAt = state?.updatedAt || 0;
      if (updatedAt < cutoff) {
        const ok = await deleteBranch(b.name);
        results.push({ buildId, deleted: ok, reason: 'stale' });
      } else {
        results.push({ buildId, deleted: false, reason: 'active' });
      }
    } catch (e) {
      results.push({ buildId, deleted: false, reason: 'error: ' + e.message });
    }
  }
  return results;
      }

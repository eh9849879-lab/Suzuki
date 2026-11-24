const API = 'https://api.github.com';

function headers() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN missing');
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'DebugBuilder-Backend'
  };
}

export function repoInfo() {
  const repo = process.env.GITHUB_REPO;
  if (!repo || !repo.includes('/')) throw new Error('GITHUB_REPO invalid (expected owner/name)');
  const [owner, name] = repo.split('/');
  return { owner, name, full: repo };
}

async function gh(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    method: opts.method || 'GET',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub ${opts.method || 'GET'} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function getDefaultBranch() {
  const { owner, name } = repoInfo();
  const repo = await gh(`/repos/${owner}/${name}`);
  return repo.default_branch || 'main';
}

export async function getBranchSha(branch) {
  const { owner, name } = repoInfo();
  const ref = await gh(`/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(branch)}`);
  return ref.object.sha;
}

export async function getCommitTreeSha(commitSha) {
  const { owner, name } = repoInfo();
  const commit = await gh(`/repos/${owner}/${name}/git/commits/${commitSha}`);
  return commit.tree.sha;
}

export async function createBranchRef(branchName, fromSha) {
  const { owner, name } = repoInfo();
  return gh(`/repos/${owner}/${name}/git/refs`, {
    method: 'POST',
    body: { ref: `refs/heads/${branchName}`, sha: fromSha }
  });
}

export async function createBlob(contentBase64) {
  const { owner, name } = repoInfo();
  const res = await gh(`/repos/${owner}/${name}/git/blobs`, {
    method: 'POST',
    body: { content: contentBase64, encoding: 'base64' }
  });
  return res.sha;
}

export async function createTree(baseTreeSha, treeEntries) {
  const { owner, name } = repoInfo();
  const res = await gh(`/repos/${owner}/${name}/git/trees`, {
    method: 'POST',
    body: { base_tree: baseTreeSha, tree: treeEntries }
  });
  return res.sha;
}

export async function createCommit(message, treeSha, parentSha) {
  const { owner, name } = repoInfo();
  const res = await gh(`/repos/${owner}/${name}/git/commits`, {
    method: 'POST',
    body: { message, tree: treeSha, parents: [parentSha] }
  });
  return res.sha;
}

export async function updateBranchRef(branchName, newSha, force = false) {
  const { owner, name } = repoInfo();
  return gh(`/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(branchName)}`, {
    method: 'PATCH',
    body: { sha: newSha, force }
  });
}

export async function getFileContent(path, branch) {
  const { owner, name } = repoInfo();
  try {
    const res = await fetch(
      `${API}/repos/${owner}/${name}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
      { headers: headers() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.content && data.encoding === 'base64') {
      return Buffer.from(data.content, 'base64').toString('utf8');
    }
    return null;
  } catch {
    return null;
  }
}

export async function putFileContent(path, branch, content, message) {
  const { owner, name } = repoInfo();
  let sha = null;
  try {
    const res = await fetch(
      `${API}/repos/${owner}/${name}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`,
      { headers: headers() }
    );
    if (res.ok) { const data = await res.json(); sha = data.sha; }
  } catch { /* ignore */ }
  return gh(`/repos/${owner}/${name}/contents/${encodeURIComponent(path)}`, {
    method: 'PUT',
    body: {
      message,
      content: Buffer.from(content).toString('base64'),
      branch,
      ...(sha ? { sha } : {})
    }
  });
}

export async function deleteBranch(branchName) {
  const { owner, name } = repoInfo();
  try {
    await gh(`/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(branchName)}`, { method: 'DELETE' });
    return true;
  } catch { return false; }
}

export async function listBranches(prefix) {
  const { owner, name } = repoInfo();
  try {
    const res = await gh(`/repos/${owner}/${name}/branches?per_page=100`);
    return (res || []).filter(b => b.name.startsWith(prefix));
  } catch { return []; }
}

export async function triggerWorkflow(buildId) {
  const { owner, name } = repoInfo();
  const workflow = process.env.GITHUB_WORKFLOW_FILE || 'android-build.yml';
  const branch = process.env.GITHUB_BRANCH || 'main';
  const res = await fetch(`${API}/repos/${owner}/${name}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: branch, inputs: { buildId } })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`workflow_dispatch failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return true;
}

export async function getLatestRun() {
  const { owner, name } = repoInfo();
  const workflow = process.env.GITHUB_WORKFLOW_FILE || 'android-build.yml';
  const ref = process.env.GITHUB_BRANCH || 'main';
  try {
    const res = await fetch(
      `${API}/repos/${owner}/${name}/actions/workflows/${workflow}/runs?branch=${encodeURIComponent(ref)}&per_page=5`,
      { headers: headers() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.workflow_runs?.[0] || null;
  } catch { return null; }
}

export async function cancelRun(runId) {
  const { owner, name } = repoInfo();
  try {
    const res = await fetch(`${API}/repos/${owner}/${name}/actions/runs/${runId}/cancel`, {
      method: 'POST', headers: headers()
    });
    return res.ok;
  } catch { return false; }
    }

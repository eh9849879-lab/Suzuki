export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export function handlePreflight(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}

export function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json(body);
}

export function error(res, status, message) {
  json(res, status, { error: message });
                     }

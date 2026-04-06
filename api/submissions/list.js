const { readAbsoluteUrl, readEnv } = require('../_lib/env');
const { formatErrorMessage } = require('../_lib/error-format');

const KV_LIST_KEY = 'levelup:buyer_submissions';

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { ok: false, message: 'Method not allowed' });
  }

  const kvUrl = readAbsoluteUrl('KV_REST_API_URL');
  const kvToken = readEnv('KV_REST_API_TOKEN');

  if (!kvUrl || !kvToken) {
    return json(res, 503, { ok: false, message: 'KV is not configured', entries: [] });
  }

  try {
    const response = await fetch(`${kvUrl}/lrange/${KV_LIST_KEY}/0/-1`, {
      headers: {
        Authorization: `Bearer ${kvToken}`
      }
    });

    if (!response.ok) {
      const text = await response.text();
      return json(res, 502, { ok: false, message: `KV read failed: ${text}`, entries: [] });
    }

    const payload = await response.json();
    const rawEntries = Array.isArray(payload?.result) ? payload.result : [];

    const entries = rawEntries.map((value) => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }).filter(Boolean);

    return json(res, 200, { ok: true, entries });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      message: formatErrorMessage(error, 'Server error while loading submissions'),
      entries: []
    });
  }
};

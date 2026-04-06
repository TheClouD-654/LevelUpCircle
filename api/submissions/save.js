const { readAbsoluteUrl, readEnv } = require('../_lib/env');
const { formatErrorMessage } = require('../_lib/error-format');

const KV_LIST_KEY = 'levelup:buyer_submissions';
const MAX_RECORDS = 500;

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

const parseJsonBody = (req) => new Promise((resolve) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    try {
      resolve(raw ? JSON.parse(raw) : {});
    } catch {
      resolve({});
    }
  });
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, message: 'Method not allowed' });
  }

  const kvUrl = readAbsoluteUrl('KV_REST_API_URL');
  const kvToken = readEnv('KV_REST_API_TOKEN');

  if (!kvUrl || !kvToken) {
    return json(res, 503, { ok: false, message: 'KV is not configured' });
  }

  const body = await parseJsonBody(req);
  const sessionId = String(body.sessionId || '').trim();
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const phone = String(body.phone || '').trim().replace(/\D/g, '');
  const product = String(body.product || 'LevelUp Circle Starter Bundle (ZIP)').trim();
  const amount = Number(body.amount || 1.99);
  const currency = String(body.currency || 'USD').trim();

  if (!name || !email || !phone) {
    return json(res, 400, { ok: false, message: 'Name, email, and phone are required' });
  }

  if (!/^\d{10}$/.test(phone)) {
    return json(res, 400, { ok: false, message: 'Invalid phone number' });
  }

  const entry = {
    sessionId: sessionId || `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    name,
    email,
    phone,
    product,
    amount,
    currency,
    paymentStatus: 'pending',
    createdAt: new Date().toISOString()
  };

  try {
    const pipelineUrl = `${kvUrl}/pipeline`;
    const response = await fetch(pipelineUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${kvToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([
        ['LPUSH', KV_LIST_KEY, JSON.stringify(entry)],
        ['LTRIM', KV_LIST_KEY, 0, MAX_RECORDS - 1]
      ])
    });

    if (!response.ok) {
      const text = await response.text();
      return json(res, 502, { ok: false, message: `KV write failed: ${text}` });
    }

    return json(res, 200, { ok: true, entry });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      message: formatErrorMessage(error, 'Server error while saving submission')
    });
  }
};

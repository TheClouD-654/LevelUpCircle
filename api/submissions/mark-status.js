const { readAbsoluteUrl, readEnv } = require('../_lib/env');

const KV_LIST_KEY = 'levelup:buyer_submissions';
const KV_PAYMENT_REQUEST_KEY_PREFIX = 'levelup:payment_request:';

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

const getKvConfig = () => {
  const kvUrl = readAbsoluteUrl('KV_REST_API_URL');
  const kvToken = readEnv('KV_REST_API_TOKEN');
  return { kvUrl, kvToken };
};

const kvGet = async (key) => {
  const { kvUrl, kvToken } = getKvConfig();
  if (!kvUrl || !kvToken) return null;

  const response = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${kvToken}` }
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return payload?.result ?? null;
};

const kvList = async () => {
  const { kvUrl, kvToken } = getKvConfig();
  if (!kvUrl || !kvToken) return null;

  const response = await fetch(`${kvUrl}/lrange/${KV_LIST_KEY}/0/-1`, {
    headers: { Authorization: `Bearer ${kvToken}` }
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return Array.isArray(payload?.result) ? payload.result : [];
};

const kvReplaceList = async (items) => {
  const { kvUrl, kvToken } = getKvConfig();
  if (!kvUrl || !kvToken) return false;

  const pipeline = [['DEL', KV_LIST_KEY]];
  for (const item of items) {
    pipeline.push(['RPUSH', KV_LIST_KEY, item]);
  }

  const response = await fetch(`${kvUrl}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kvToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(pipeline)
  });
  return response.ok;
};

const normalizeStatus = (value) => {
  const status = String(value || '').trim().toLowerCase();
  if (!status) return 'pending';
  if (status === 'successful' || status === 'success' || status === 'credit' || status === 'completed') return 'successful';
  if (status === 'cancelled' || status === 'canceled' || status === 'failed') return 'cancelled';
  if (status === 'pending') return 'pending';
  return status;
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, message: 'Method not allowed' });
  }

  const { kvUrl, kvToken } = getKvConfig();
  if (!kvUrl || !kvToken) {
    return json(res, 503, { ok: false, message: 'KV is not configured' });
  }

  const body = await parseJsonBody(req);
  const paymentRequestId = String(body.paymentRequestId || '').trim();
  const paymentId = String(body.paymentId || '').trim();
  const status = normalizeStatus(body.status);

  if (!paymentRequestId || !paymentId) {
    return json(res, 400, { ok: false, message: 'Missing payment identifiers' });
  }

  const mappingRaw = await kvGet(`${KV_PAYMENT_REQUEST_KEY_PREFIX}${paymentRequestId}`);
  let mappedSessionId = '';
  if (mappingRaw) {
    try {
      const mapping = JSON.parse(mappingRaw);
      mappedSessionId = String(mapping?.sessionId || '').trim();
    } catch {
      mappedSessionId = '';
    }
  }

  const rawEntries = await kvList();
  if (!rawEntries) {
    return json(res, 500, { ok: false, message: 'Failed to read submission records' });
  }

  let updatedCount = 0;
  const updatedEntries = rawEntries.map((item) => {
    try {
      const entry = JSON.parse(item);
      const sessionId = String(entry?.sessionId || '').trim();
      const sameSession = mappedSessionId && sessionId && mappedSessionId === sessionId;
      const samePaymentRequest = String(entry?.paymentRequestId || '').trim() === paymentRequestId;
      if (!sameSession && !samePaymentRequest) {
        return item;
      }

      updatedCount += 1;
      return JSON.stringify({
        ...entry,
        paymentStatus: status,
        paymentId,
        paymentRequestId,
        paymentUpdatedAt: new Date().toISOString()
      });
    } catch {
      return item;
    }
  });

  if (!updatedCount && rawEntries.length) {
    // Fallback: update newest entry for this payment cycle when mapping is unavailable.
    try {
      const newest = JSON.parse(updatedEntries[0]);
      updatedEntries[0] = JSON.stringify({
        ...newest,
        paymentStatus: status,
        paymentId,
        paymentRequestId,
        paymentUpdatedAt: new Date().toISOString()
      });
      updatedCount = 1;
    } catch {
      // Ignore fallback parse failure.
    }
  }

  const replaced = await kvReplaceList(updatedEntries);
  if (!replaced) {
    return json(res, 500, { ok: false, message: 'Failed to write updated status' });
  }

  return json(res, 200, { ok: true, updatedCount, status });
};

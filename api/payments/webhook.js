const crypto = require('crypto');
const { readAbsoluteUrl, readEnv } = require('../_lib/env');

const KV_WEBHOOK_KEY = 'levelup:payment_webhooks';
const MAX_RECORDS = 500;

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

const readRawBody = (req) => new Promise((resolve) => {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => resolve(raw));
});

const toWebhookPayload = (rawBody) => {
  const params = new URLSearchParams(rawBody);
  const payload = {};
  for (const [key, value] of params.entries()) {
    payload[key] = value;
  }
  return payload;
};

const verifyMac = (payload, salt) => {
  const providedMac = String(payload.mac || '').trim().toLowerCase();
  if (!providedMac || !salt) {
    return false;
  }

  const entries = Object.entries(payload)
    .filter(([key]) => key.toLowerCase() !== 'mac')
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const message = entries.map(([, value]) => String(value)).join('|');
  const calculatedMac = crypto
    .createHmac('sha1', salt)
    .update(message)
    .digest('hex')
    .toLowerCase();

  const providedBuffer = Buffer.from(providedMac, 'utf8');
  const calculatedBuffer = Buffer.from(calculatedMac, 'utf8');
  if (providedBuffer.length !== calculatedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, calculatedBuffer);
};

const saveToKv = async (entry) => {
  const kvUrl = readAbsoluteUrl('KV_REST_API_URL');
  const kvToken = readEnv('KV_REST_API_TOKEN');
  if (!kvUrl || !kvToken) {
    return;
  }

  await fetch(`${kvUrl}/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kvToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify([
      ['LPUSH', KV_WEBHOOK_KEY, JSON.stringify(entry)],
      ['LTRIM', KV_WEBHOOK_KEY, 0, MAX_RECORDS - 1]
    ])
  });
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, message: 'Method not allowed' });
  }

  const salt = readEnv('INSTAMOJO_PRIVATE_SALT');
  if (!salt) {
    return json(res, 503, { ok: false, message: 'Instamojo private salt is not configured' });
  }

  const rawBody = await readRawBody(req);
  const payload = toWebhookPayload(rawBody);
  const macValid = verifyMac(payload, salt);
  if (!macValid) {
    return json(res, 401, { ok: false, message: 'Invalid MAC signature' });
  }

  const record = {
    paymentId: String(payload.payment_id || '').trim(),
    paymentRequestId: String(payload.payment_request_id || '').trim(),
    status: String(payload.status || '').trim(),
    amount: String(payload.amount || '').trim(),
    currency: String(payload.currency || '').trim(),
    buyer: String(payload.buyer || '').trim(),
    buyerName: String(payload.buyer_name || '').trim(),
    buyerPhone: String(payload.buyer_phone || '').trim(),
    purpose: String(payload.purpose || '').trim(),
    fees: String(payload.fees || '').trim(),
    source: 'instamojo-webhook',
    receivedAt: new Date().toISOString()
  };

  try {
    await saveToKv(record);
  } catch {
    // Do not fail webhook acknowledgement if KV logging fails.
  }

  return json(res, 200, { ok: true });
};

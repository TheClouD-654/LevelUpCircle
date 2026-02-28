const { getProduct } = require('../../data/products');

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

const buildOrigin = (req) => {
  const explicit = process.env.PUBLIC_SITE_URL || process.env.SITE_URL || '';
  if (explicit) {
    return explicit.replace(/\/$/, '');
  }

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  return host ? `${proto}://${host}` : '';
};

const kvSet = async (key, value) => {
  const kvUrl = process.env.KV_REST_API_URL || '';
  const kvToken = process.env.KV_REST_API_TOKEN || '';
  if (!kvUrl || !kvToken) return false;

  const response = await fetch(`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
    headers: { Authorization: `Bearer ${kvToken}` }
  });
  return response.ok;
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, message: 'Method not allowed' });
  }

  const apiKey = process.env.INSTAMOJO_API_KEY || '';
  const authToken = process.env.INSTAMOJO_AUTH_TOKEN || '';
  const baseEndpoint = process.env.INSTAMOJO_API_BASE || 'https://www.instamojo.com/api/1.1';

  if (!apiKey || !authToken) {
    return json(res, 503, { ok: false, message: 'Instamojo credentials are not configured' });
  }

  const body = await parseJsonBody(req);
  const product = getProduct(body.productId);
  const buyerName = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const phone = String(body.phone || '').trim();
  const purpose = String(product.purpose || body.product || 'LevelUp Circle Starter Bundle (ZIP)').trim();
  const inputCurrency = String(product.chargeCurrency || body.currency || 'INR').trim().toUpperCase();
  const amountNumber = Number(product.chargeAmount || body.amount || 1);
  const usdToInrRate = Number(process.env.USD_TO_INR_RATE || 83);
  const minInrAmount = Number(process.env.INSTAMOJO_MIN_INR_AMOUNT || 9);
  const safeRate = Number.isFinite(usdToInrRate) && usdToInrRate > 0 ? usdToInrRate : 83;
  const safeMinInr = Number.isFinite(minInrAmount) && minInrAmount > 0 ? minInrAmount : 9;
  const safeInputAmount = Number.isFinite(amountNumber) && amountNumber > 0 ? amountNumber : 1.99;

  let chargeInrAmount = safeInputAmount;
  let chargedCurrency = inputCurrency;
  if (inputCurrency === 'USD') {
    chargeInrAmount = Math.ceil(safeInputAmount * safeRate);
    chargedCurrency = 'INR';
  }
  chargeInrAmount = Math.max(safeMinInr, chargeInrAmount);
  const amount = chargeInrAmount.toFixed(2);

  if (!buyerName || !email) {
    return json(res, 400, { ok: false, message: 'Name and email are required' });
  }

  const origin = buildOrigin(req);
  if (!origin) {
    return json(res, 500, { ok: false, message: 'Unable to determine site origin for redirects' });
  }

  const redirectUrl = `${origin}/help-success`;
  const webhookUrl = process.env.INSTAMOJO_WEBHOOK_URL || '';
  const endpoint = `${baseEndpoint.replace(/\/$/, '')}/payment-requests/`;

  const payload = new URLSearchParams({
    purpose,
    amount,
    buyer_name: buyerName,
    email,
    redirect_url: redirectUrl,
    allow_repeated_payments: 'false'
  });

  if (webhookUrl) {
    payload.set('webhook', webhookUrl);
  }

  if (phone) {
    payload.set('phone', phone);
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'X-Api-Key': apiKey,
        'X-Auth-Token': authToken,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: payload.toString()
    });

    const result = await response.json().catch(() => ({}));
    const checkoutUrl = result?.payment_request?.longurl || '';

    if (!response.ok || !result?.success || !checkoutUrl) {
      const message = result?.message || 'Instamojo payment request creation failed';
      return json(res, 502, { ok: false, message });
    }

    const paymentRequestId = String(result?.payment_request?.id || '').trim();
    if (paymentRequestId) {
      const mappingKey = `${KV_PAYMENT_REQUEST_KEY_PREFIX}${paymentRequestId}`;
      const mappingValue = JSON.stringify({
        productId: product.id,
        purpose,
        buyerEmail: email,
        createdAt: new Date().toISOString()
      });
      await kvSet(mappingKey, mappingValue);
    }

    return json(res, 200, {
      ok: true,
      checkoutUrl,
      paymentRequestId,
      chargedCurrency,
      chargedAmount: amount
    });
  } catch (error) {
    return json(res, 500, { ok: false, message: 'Server error while creating payment request' });
  }
};

const { getProduct } = require('../../data/products');
const { readAbsoluteUrl, readEnv, readNumberEnv } = require('../_lib/env');
const { formatErrorMessage, pickApiErrorMessage } = require('../_lib/error-format');

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
  const explicit = readAbsoluteUrl('PUBLIC_SITE_URL', 'SITE_URL');
  if (explicit) {
    return explicit;
  }

  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!host) return '';

  try {
    return new URL(`${proto}://${host}`).toString().replace(/\/$/, '');
  } catch {
    return '';
  }
};

const kvSet = async (key, value) => {
  const kvUrl = readAbsoluteUrl('KV_REST_API_URL');
  const kvToken = readEnv('KV_REST_API_TOKEN');
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

  const apiKey = readEnv('INSTAMOJO_API_KEY');
  const authToken = readEnv('INSTAMOJO_AUTH_TOKEN');
  const baseEndpoint = readEnv('INSTAMOJO_API_BASE') || 'https://www.instamojo.com/api/1.1';

  if (!apiKey || !authToken) {
    return json(res, 503, { ok: false, message: 'Instamojo credentials are not configured' });
  }

  const body = await parseJsonBody(req);
  const product = getProduct(body.productId);
  const buyerName = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const phone = String(body.phone || '').trim().replace(/\D/g, '');
  const purpose = String(product.purpose || body.product || 'LevelUp Circle Starter Bundle (ZIP)').trim();
  const inputCurrency = String(product.chargeCurrency || body.currency || 'INR').trim().toUpperCase();
  const amountNumber = Number(product.chargeAmount || body.amount || 1);
  const usdToInrRate = readNumberEnv('USD_TO_INR_RATE', 83);
  const minInrAmount = readNumberEnv('INSTAMOJO_MIN_INR_AMOUNT', 9);
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

  if (!buyerName || !email || !phone) {
    return json(res, 400, { ok: false, message: 'Name, email, and phone are required' });
  }

  if (!/^\d{10}$/.test(phone)) {
    return json(res, 400, { ok: false, message: 'Invalid phone number' });
  }

  const origin = buildOrigin(req);
  if (!origin) {
    return json(res, 500, { ok: false, message: 'Unable to determine site origin for redirects' });
  }

  const redirectUrl = `${origin}/help-success`;
  const webhookUrl = readAbsoluteUrl('INSTAMOJO_WEBHOOK_URL');
  let endpoint = '';
  try {
    endpoint = `${new URL(baseEndpoint).toString().replace(/\/$/, '')}/payment-requests/`;
  } catch {
    return json(res, 500, { ok: false, message: 'Instamojo API base URL is invalid' });
  }

  const payload = new URLSearchParams({
    purpose,
    amount,
    buyer_name: buyerName,
    email,
    redirect_url: redirectUrl,
    allow_repeated_payments: 'false',
    send_email: 'false',
    send_sms: 'false'
  });

  if (webhookUrl) {
    payload.set('webhook', webhookUrl);
  }

  payload.set('phone', phone);

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

    const responseText = await response.text();
    let result = {};
    try {
      result = responseText ? JSON.parse(responseText) : {};
    } catch {
      result = {};
    }
    const checkoutUrl = result?.payment_request?.longurl || '';

    if (!response.ok || !result?.success || !checkoutUrl) {
      const message = pickApiErrorMessage(
        result && Object.keys(result).length ? result : responseText,
        'Instamojo payment request creation failed'
      ).replace(/\s+/g, ' ').trim();
      return json(res, 502, {
        ok: false,
        message,
        upstreamStatus: response.status
      });
    }

    const paymentRequestId = String(result?.payment_request?.id || '').trim();
    if (paymentRequestId) {
      const mappingKey = `${KV_PAYMENT_REQUEST_KEY_PREFIX}${paymentRequestId}`;
      const mappingValue = JSON.stringify({
        productId: product.id,
        sessionId: String(body.sessionId || '').trim(),
        purpose,
        buyerEmail: email,
        createdAt: new Date().toISOString()
      });
      try {
        await kvSet(mappingKey, mappingValue);
      } catch {
        // Do not block checkout if KV mapping storage is temporarily unavailable.
      }
    }

    return json(res, 200, {
      ok: true,
      checkoutUrl,
      paymentRequestId,
      chargedCurrency,
      chargedAmount: amount
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      message: formatErrorMessage(error, 'Server error while creating payment request')
    });
  }
};

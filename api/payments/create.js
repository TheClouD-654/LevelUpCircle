const { getProduct } = require('../../data/products');
const { readEnv, readKvRestToken, readKvRestUrl, readNumberEnv } = require('../_lib/env');
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

const kvSet = async (key, value) => {
  const kvUrl = readKvRestUrl();
  const kvToken = readKvRestToken();
  if (!kvUrl || !kvToken) return false;

  const response = await fetch(`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
    headers: { Authorization: `Bearer ${kvToken}` }
  });
  return response.ok;
};

const buildBasicAuthHeader = (keyId, keySecret) => `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

const queueOptionalKvWrite = (key, value) => {
  kvSet(key, value).catch(() => {
    // Do not block checkout if KV mapping storage is temporarily unavailable.
  });
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, message: 'Method not allowed' });
  }

  const razorpayKeyId = readEnv('RAZORPAY_KEY_ID');
  const razorpayKeySecret = readEnv('RAZORPAY_KEY_SECRET');
  const razorpayThemeColor = readEnv('RAZORPAY_THEME_COLOR');

  if (!razorpayKeyId || !razorpayKeySecret) {
    return json(res, 503, { ok: false, message: 'Razorpay credentials are not configured' });
  }

  const body = await parseJsonBody(req);
  const product = getProduct(body.productId);
  const buyerName = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const phone = String(body.phone || '').trim().replace(/\D/g, '');
  const purpose = String(product.purpose || body.product || 'LevelUp Circle Starter Bundle (ZIP)').trim();
  const inputCurrency = String(product.chargeCurrency || body.currency || 'INR').trim().toUpperCase();
  const amountNumber = Number(product.chargeAmount || body.amount || 1);
  const usdToInrRate = readNumberEnv('USD_TO_INR_RATE', 93.03);
  const minInrAmount = readNumberEnv(['RAZORPAY_MIN_INR_AMOUNT', 'INSTAMOJO_MIN_INR_AMOUNT'], 9);
  const safeRate = Number.isFinite(usdToInrRate) && usdToInrRate > 0 ? usdToInrRate : 93.03;
  const safeMinInr = Number.isFinite(minInrAmount) && minInrAmount > 0 ? minInrAmount : 9;
  const safeInputAmount = Number.isFinite(amountNumber) && amountNumber > 0 ? amountNumber : 1.99;

  let chargeInrAmount = safeInputAmount;
  if (inputCurrency === 'USD') {
    chargeInrAmount = safeInputAmount * safeRate;
  }
  chargeInrAmount = Math.max(safeMinInr, chargeInrAmount);
  const amountPaise = Math.round(chargeInrAmount * 100);
  const chargedAmount = (amountPaise / 100).toFixed(2);

  if (!buyerName || !email || !phone) {
    return json(res, 400, { ok: false, message: 'Name, email, and phone are required' });
  }

  if (!/^\d{10}$/.test(phone)) {
    return json(res, 400, { ok: false, message: 'Invalid phone number' });
  }

  const endpoint = 'https://api.razorpay.com/v1/orders';
  const receiptBase = String(body.sessionId || `${Date.now()}`)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 28) || `${Date.now()}`;
  const payload = {
    amount: amountPaise,
    currency: 'INR',
    receipt: `luc_${receiptBase}`.slice(0, 40),
    notes: {
      product_id: product.id,
      session_id: String(body.sessionId || '').trim(),
      buyer_name: buyerName,
      buyer_email: email,
      buyer_phone: phone,
      purpose
    }
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: buildBasicAuthHeader(razorpayKeyId, razorpayKeySecret),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const responseText = await response.text();
    let result = {};
    try {
      result = responseText ? JSON.parse(responseText) : {};
    } catch {
      result = {};
    }
    const orderId = String(result?.id || '').trim();

    if (!response.ok || !orderId) {
      const message = pickApiErrorMessage(
        result && Object.keys(result).length ? result : responseText,
        'Razorpay order creation failed'
      ).replace(/\s+/g, ' ').trim();
      return json(res, 502, {
        ok: false,
        message,
        upstreamStatus: response.status
      });
    }

    const mappingKey = `${KV_PAYMENT_REQUEST_KEY_PREFIX}${orderId}`;
    const mappingValue = JSON.stringify({
      productId: product.id,
      sessionId: String(body.sessionId || '').trim(),
      purpose,
      buyerEmail: email,
      buyerName,
      buyerPhone: phone,
      amountPaise,
      chargedAmount,
      chargedCurrency: 'INR',
      createdAt: new Date().toISOString()
    });
    queueOptionalKvWrite(mappingKey, mappingValue);

    return json(res, 200, {
      ok: true,
      paymentProvider: 'razorpay',
      paymentRequestId: orderId,
      chargedCurrency: 'INR',
      chargedAmount,
      checkoutOptions: {
        key: razorpayKeyId,
        amount: amountPaise,
        currency: 'INR',
        name: readEnv('RAZORPAY_BRAND_NAME') || 'LevelUp Circle',
        description: purpose,
        orderId,
        prefill: {
          name: buyerName,
          email,
          contact: phone
        },
        notes: {
          productId: product.id,
          sessionId: String(body.sessionId || '').trim()
        },
        ...(razorpayThemeColor ? { theme: { color: razorpayThemeColor } } : {})
      }
    });
  } catch (error) {
    return json(res, 500, {
      ok: false,
      message: formatErrorMessage(error, 'Server error while creating Razorpay order')
    });
  }
};

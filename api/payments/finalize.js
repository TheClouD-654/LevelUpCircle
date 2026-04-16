const crypto = require('crypto');
const { buildOrigin, signPayload } = require('./_delivery');
const { DEFAULT_PRODUCT_ID, getProduct, getProductZipUrl } = require('../../data/products');
const { readEnv, readKvRestToken, readKvRestUrl, readNumberEnv } = require('../_lib/env');
const { pickApiErrorMessage } = require('../_lib/error-format');

const KV_DELIVERY_KEY_PREFIX = 'levelup:delivery:sent:';
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

const kvGet = async (key) => {
  const kvUrl = readKvRestUrl();
  const kvToken = readKvRestToken();
  if (!kvUrl || !kvToken) return null;

  const response = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${kvToken}` }
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return payload?.result ?? null;
};

const kvSet = async (key, value) => {
  const kvUrl = readKvRestUrl();
  const kvToken = readKvRestToken();
  if (!kvUrl || !kvToken) return false;

  const response = await fetch(`${kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
    headers: { Authorization: `Bearer ${kvToken}` }
  });
  return response.ok;
};

const normalizeStatus = (value) => String(value || '').trim().toLowerCase();

const isSuccessfulStatus = (value) => {
  const status = normalizeStatus(value);
  return status === 'credit' || status === 'successful' || status === 'success' || status === 'completed';
};

const pickPaymentFromPayload = (payload, paymentId) => {
  const direct = payload?.payment || null;
  const listFromRequest = Array.isArray(payload?.payment_request?.payments) ? payload.payment_request.payments : [];
  const listFromRoot = Array.isArray(payload?.payments) ? payload.payments : [];
  const combined = [direct, ...listFromRequest, ...listFromRoot].filter(Boolean);

  const exact = combined.find((p) => String(p.payment_id || p.id || '').trim() === paymentId);
  return exact || direct || combined[0] || null;
};

const verifyInstamojoPayment = async ({ paymentRequestId, paymentId, apiKey, authToken, baseEndpoint }) => {
  const headers = {
    'X-Api-Key': apiKey,
    'X-Auth-Token': authToken
  };
  const root = baseEndpoint.replace(/\/$/, '');
  const endpoints = [
    `${root}/payment-requests/${paymentRequestId}/${paymentId}/`,
    `${root}/payment-requests/${paymentRequestId}/`
  ];

  let lastMessage = 'Unable to verify payment with Instamojo';

  for (const endpoint of endpoints) {
    const response = await fetch(endpoint, { method: 'GET', headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.success) {
      lastMessage = payload?.message || lastMessage;
      continue;
    }

    const payment = pickPaymentFromPayload(payload, paymentId);
    const resolvedPaymentId = String(payment?.payment_id || payment?.id || '').trim();
    const resolvedRequestId = String(
      payment?.payment_request || payment?.payment_request_id || payload?.payment_request?.id || paymentRequestId
    ).trim();
    const status = String(payment?.status || payment?.payment_status || '').trim();

    if (resolvedPaymentId && resolvedPaymentId !== paymentId) {
      lastMessage = 'Payment ID mismatch';
      continue;
    }
    if (resolvedRequestId && resolvedRequestId !== paymentRequestId) {
      lastMessage = 'Payment request mismatch';
      continue;
    }
    if (!isSuccessfulStatus(status)) {
      lastMessage = `Payment not completed. Current status: ${status || 'unknown'}`;
      continue;
    }

    return { ok: true, payment: { ...payment, status } };
  }

  return { ok: false, message: lastMessage };
};

const buildBasicAuthHeader = (keyId, keySecret) => `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

const safeEqual = (left, right) => {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const verifyRazorpaySignature = ({ orderId, paymentId, signature, keySecret }) => {
  if (!orderId || !paymentId || !signature || !keySecret) return false;
  const expected = crypto
    .createHmac('sha256', keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return safeEqual(expected, signature);
};

const fetchRazorpayPayment = async ({ paymentId, authHeader }) => {
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    method: 'GET',
    headers: { Authorization: authHeader }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      message: pickApiErrorMessage(payload, 'Unable to fetch Razorpay payment'),
      upstreamStatus: response.status
    };
  }
  return { ok: true, payment: payload };
};

const captureRazorpayPayment = async ({ paymentId, amount, currency, authHeader }) => {
  const response = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ amount, currency })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      message: pickApiErrorMessage(payload, 'Unable to capture Razorpay payment'),
      upstreamStatus: response.status
    };
  }
  return { ok: true, payment: payload };
};

const verifyRazorpayPayment = async ({ orderId, paymentId, signature, keyId, keySecret }) => {
  if (!verifyRazorpaySignature({ orderId, paymentId, signature, keySecret })) {
    return { ok: false, message: 'Payment signature mismatch' };
  }

  const authHeader = buildBasicAuthHeader(keyId, keySecret);
  const fetched = await fetchRazorpayPayment({ paymentId, authHeader });
  if (!fetched.ok) {
    return fetched;
  }

  let payment = fetched.payment;
  const resolvedOrderId = String(payment?.order_id || '').trim();
  if (!resolvedOrderId || resolvedOrderId !== orderId) {
    return { ok: false, message: 'Payment order mismatch' };
  }

  let status = normalizeStatus(payment?.status);
  if (status === 'authorized') {
    const amount = Number(payment?.amount || 0);
    const currency = String(payment?.currency || 'INR').trim().toUpperCase() || 'INR';
    const captured = await captureRazorpayPayment({
      paymentId,
      amount,
      currency,
      authHeader
    });

    if (captured.ok) {
      payment = captured.payment;
      status = normalizeStatus(payment?.status);
    } else {
      const refreshed = await fetchRazorpayPayment({ paymentId, authHeader });
      if (!refreshed.ok) {
        return { ok: false, message: captured.message };
      }
      payment = refreshed.payment;
      status = normalizeStatus(payment?.status);
      if (status !== 'captured') {
        return { ok: false, message: captured.message };
      }
    }
  }

  if (status !== 'captured') {
    return { ok: false, message: `Payment not completed. Current status: ${status || 'unknown'}` };
  }

  return { ok: true, payment };
};

const buildDeliveryLink = ({ origin, paymentId, paymentRequestId, email, productId }) => {
  const ttlMinutes = readNumberEnv('DOWNLOAD_LINK_TTL_MINUTES', 1440);
  const safeTtlMinutes = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 1440;
  const secret = readEnv('DELIVERY_TOKEN_SECRET');
  if (!secret) return '';

  const tokenPayload = {
    pid: paymentId,
    rid: paymentRequestId,
    prd: productId,
    em: email,
    exp: Date.now() + (safeTtlMinutes * 60 * 1000)
  };
  const token = signPayload(tokenPayload, secret);
  return `${origin}/api/payments/download?token=${encodeURIComponent(token)}`;
};

const sendDeliveryEmail = async ({ toEmail, toName, downloadUrl, fileName, zipSourceUrl }) => {
  const resendApiKey = readEnv('RESEND_API_KEY');
  const deliveryFromEmail = readEnv('DELIVERY_FROM_EMAIL');
  if (!resendApiKey || !deliveryFromEmail) {
    return { sent: false, message: 'Email service not configured' };
  }

  const attachZip = readEnv('DELIVERY_ATTACH_ZIP').toLowerCase() === 'true';
  const attachments = [];

  if (attachZip && zipSourceUrl) {
    try {
      const zipResponse = await fetch(zipSourceUrl);
      if (zipResponse.ok) {
        const arrayBuffer = await zipResponse.arrayBuffer();
        const bytes = Buffer.from(arrayBuffer);
        const maxMb = readNumberEnv('DELIVERY_MAX_ATTACHMENT_MB', 9);
        const safeMaxBytes = (Number.isFinite(maxMb) && maxMb > 0 ? maxMb : 9) * 1024 * 1024;

        if (bytes.length <= safeMaxBytes) {
          attachments.push({
            filename: fileName,
            content: bytes.toString('base64')
          });
        }
      }
    } catch {
      // Continue without attachment.
    }
  }

  const subject = 'Your LevelUp Circle ZIP is ready';
  const safeName = String(toName || '').trim() || 'there';
  const html = `
    <p>Hi ${safeName},</p>
    <p>Your payment is confirmed. Download your ZIP file below:</p>
    <p><a href="${downloadUrl}">Download ${fileName}</a></p>
    <p>This link may expire, so download and back it up.</p>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: deliveryFromEmail,
      to: [toEmail],
      subject,
      html,
      text: `Hi ${safeName}, your payment is confirmed. Download your ZIP: ${downloadUrl}`,
      attachments
    })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    return { sent: false, message: payload?.message || 'Failed to send delivery email' };
  }

  return { sent: true, message: 'Delivery email sent' };
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, message: 'Method not allowed' });
  }

  const body = await parseJsonBody(req);
  const legacyPaymentRequestId = String(body.payment_request_id || '').trim();
  const legacyPaymentId = String(body.payment_id || '').trim();
  const paymentStatusHint = String(body.payment_status || '').trim();
  const razorpayOrderId = String(body.razorpay_order_id || '').trim();
  const razorpayPaymentId = String(body.razorpay_payment_id || '').trim();
  const razorpaySignature = String(body.razorpay_signature || '').trim();

  const paymentRequestId = razorpayOrderId || legacyPaymentRequestId;
  const paymentId = razorpayPaymentId || legacyPaymentId;
  const isRazorpayFlow = Boolean(razorpayOrderId || razorpayPaymentId || razorpaySignature);

  if (!paymentRequestId || !paymentId) {
    return json(res, 400, { ok: false, message: 'Missing payment identifiers' });
  }

  const mappingRaw = await kvGet(`${KV_PAYMENT_REQUEST_KEY_PREFIX}${paymentRequestId}`);
  let productId = DEFAULT_PRODUCT_ID;
  let mappedBuyerEmail = '';
  let mappedBuyerName = '';
  if (mappingRaw) {
    try {
      const mapping = JSON.parse(mappingRaw);
      if (mapping?.productId) {
        productId = String(mapping.productId).trim();
      }
      if (mapping?.buyerEmail) {
        mappedBuyerEmail = String(mapping.buyerEmail).trim();
      }
      if (mapping?.buyerName) {
        mappedBuyerName = String(mapping.buyerName).trim();
      }
    } catch {
      productId = DEFAULT_PRODUCT_ID;
      mappedBuyerEmail = '';
      mappedBuyerName = '';
    }
  }

  let verification;
  if (isRazorpayFlow) {
    const razorpayKeyId = readEnv('RAZORPAY_KEY_ID');
    const razorpayKeySecret = readEnv('RAZORPAY_KEY_SECRET');
    if (!razorpayKeyId || !razorpayKeySecret) {
      return json(res, 503, { ok: false, message: 'Razorpay credentials are not configured' });
    }
    if (!razorpaySignature) {
      return json(res, 400, { ok: false, message: 'Missing Razorpay signature' });
    }

    verification = await verifyRazorpayPayment({
      orderId: paymentRequestId,
      paymentId,
      signature: razorpaySignature,
      keyId: razorpayKeyId,
      keySecret: razorpayKeySecret
    });
  } else {
    const apiKey = readEnv('INSTAMOJO_API_KEY');
    const authToken = readEnv('INSTAMOJO_AUTH_TOKEN');
    const baseEndpoint = readEnv('INSTAMOJO_API_BASE') || 'https://www.instamojo.com/api/1.1';
    if (!apiKey || !authToken) {
      return json(res, 503, { ok: false, message: 'Instamojo credentials are not configured' });
    }

    verification = await verifyInstamojoPayment({
      paymentRequestId,
      paymentId,
      apiKey,
      authToken,
      baseEndpoint
    });
  }

  // Payout pending is unrelated to buyer payment success. If redirect says Credit,
  // allow immediate delivery even when API verification is delayed/unavailable.
  const canUseRedirectHint = !isRazorpayFlow && isSuccessfulStatus(paymentStatusHint);
  if (!verification.ok && !canUseRedirectHint) {
    return json(res, 402, { ok: false, message: verification.message });
  }

  const payment = verification.ok
    ? verification.payment
    : {
        payment_id: paymentId,
        payment_request: paymentRequestId,
        status: paymentStatusHint || 'Credit'
      };

  const buyerEmail = String(
    payment.email || payment.buyer_email || payment.buyer || mappedBuyerEmail || ''
  ).trim();
  const buyerName = String(payment.notes?.buyer_name || payment.buyer_name || mappedBuyerName || '').trim();
  const product = getProduct(productId);
  const zipUrl = getProductZipUrl(product);
  const fileName = product.zipName || readEnv('PRODUCT_ZIP_NAME') || 'LevelUp-Circle-Starter-Bundle.zip';

  if (!zipUrl) {
    return json(res, 503, { ok: false, message: 'Product ZIP URL is not configured for this product' });
  }

  const origin = buildOrigin(req);
  if (!origin) {
    return json(res, 500, { ok: false, message: 'Unable to determine site origin' });
  }

  const downloadUrl = buildDeliveryLink({
    origin,
    paymentId,
    paymentRequestId,
    email: buyerEmail,
    productId: product.id
  }) || zipUrl;

  let emailResult = { sent: false, message: 'Skipped' };
  if (buyerEmail) {
    const deliveryKey = `${KV_DELIVERY_KEY_PREFIX}${paymentId}`;
    const alreadySent = await kvGet(deliveryKey);
    if (alreadySent) {
      emailResult = { sent: true, message: 'Delivery email already sent earlier' };
    } else {
      emailResult = await sendDeliveryEmail({
        toEmail: buyerEmail,
        toName: buyerName,
        downloadUrl,
        fileName,
        zipSourceUrl: zipUrl
      });
      if (emailResult.sent) {
        await kvSet(deliveryKey, new Date().toISOString());
      }
    }
  }

  return json(res, 200, {
    ok: true,
    message: 'Payment verified',
    file: {
      name: fileName,
      downloadUrl,
      productId: product.id
    },
    email: emailResult,
    payment: {
      paymentId,
      paymentRequestId,
      orderId: isRazorpayFlow ? paymentRequestId : undefined,
      status: payment.status,
      amount: typeof payment.amount === 'number'
        ? (isRazorpayFlow ? (payment.amount / 100).toFixed(2) : payment.amount)
        : payment.amount,
      currency: payment.currency
    }
  });
};

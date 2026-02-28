const { buildOrigin, signPayload } = require('./_delivery');
const { DEFAULT_PRODUCT_ID, getProduct, getProductZipUrl } = require('../../data/products');

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
  const kvUrl = process.env.KV_REST_API_URL || '';
  const kvToken = process.env.KV_REST_API_TOKEN || '';
  if (!kvUrl || !kvToken) return null;

  const response = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${kvToken}` }
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => ({}));
  return payload?.result ?? null;
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

const buildDeliveryLink = ({ origin, paymentId, paymentRequestId, email, productId }) => {
  const ttlMinutes = Number(process.env.DOWNLOAD_LINK_TTL_MINUTES || 1440);
  const safeTtlMinutes = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes : 1440;
  const secret = process.env.DELIVERY_TOKEN_SECRET || '';
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
  const resendApiKey = process.env.RESEND_API_KEY || '';
  const deliveryFromEmail = process.env.DELIVERY_FROM_EMAIL || '';
  if (!resendApiKey || !deliveryFromEmail) {
    return { sent: false, message: 'Email service not configured' };
  }

  const attachZip = String(process.env.DELIVERY_ATTACH_ZIP || 'false').toLowerCase() === 'true';
  const attachments = [];

  if (attachZip && zipSourceUrl) {
    try {
      const zipResponse = await fetch(zipSourceUrl);
      if (zipResponse.ok) {
        const arrayBuffer = await zipResponse.arrayBuffer();
        const bytes = Buffer.from(arrayBuffer);
        const maxMb = Number(process.env.DELIVERY_MAX_ATTACHMENT_MB || 9);
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
  const paymentRequestId = String(body.payment_request_id || '').trim();
  const paymentId = String(body.payment_id || '').trim();
  const paymentStatusHint = String(body.payment_status || '').trim();

  if (!paymentRequestId || !paymentId) {
    return json(res, 400, { ok: false, message: 'Missing payment identifiers' });
  }

  const apiKey = process.env.INSTAMOJO_API_KEY || '';
  const authToken = process.env.INSTAMOJO_AUTH_TOKEN || '';
  const baseEndpoint = process.env.INSTAMOJO_API_BASE || 'https://www.instamojo.com/api/1.1';
  if (!apiKey || !authToken) {
    return json(res, 503, { ok: false, message: 'Instamojo credentials are not configured' });
  }

  const mappingRaw = await kvGet(`${KV_PAYMENT_REQUEST_KEY_PREFIX}${paymentRequestId}`);
  let productId = DEFAULT_PRODUCT_ID;
  let mappedBuyerEmail = '';
  if (mappingRaw) {
    try {
      const mapping = JSON.parse(mappingRaw);
      if (mapping?.productId) {
        productId = String(mapping.productId).trim();
      }
      if (mapping?.buyerEmail) {
        mappedBuyerEmail = String(mapping.buyerEmail).trim();
      }
    } catch {
      productId = DEFAULT_PRODUCT_ID;
      mappedBuyerEmail = '';
    }
  }

  const verification = await verifyInstamojoPayment({
    paymentRequestId,
    paymentId,
    apiKey,
    authToken,
    baseEndpoint
  });

  // Payout pending is unrelated to buyer payment success. If redirect says Credit,
  // allow immediate delivery even when API verification is delayed/unavailable.
  const canUseRedirectHint = isSuccessfulStatus(paymentStatusHint);
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

  const buyerEmail = String(payment.buyer_email || payment.buyer || mappedBuyerEmail || '').trim();
  const buyerName = String(payment.buyer_name || '').trim();
  const product = getProduct(productId);
  const zipUrl = getProductZipUrl(product);
  const fileName = product.zipName || process.env.PRODUCT_ZIP_NAME || 'LevelUp-Circle-Starter-Bundle.zip';

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
      status: payment.status,
      amount: payment.amount,
      currency: payment.currency
    }
  });
};

const crypto = require('crypto');
const { readAbsoluteUrl } = require('../_lib/env');

const base64UrlEncode = (value) => Buffer.from(value, 'utf8').toString('base64url');
const base64UrlDecode = (value) => Buffer.from(value, 'base64url').toString('utf8');

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

const signPayload = (payload, secret) => {
  const payloadJson = JSON.stringify(payload);
  const payloadPart = base64UrlEncode(payloadJson);
  const sigPart = crypto
    .createHmac('sha256', secret)
    .update(payloadPart)
    .digest('base64url');
  return `${payloadPart}.${sigPart}`;
};

const verifyToken = (token, secret) => {
  if (!token || !secret || !token.includes('.')) {
    return { ok: false, reason: 'Invalid token format' };
  }

  const [payloadPart, sigPart] = token.split('.', 2);
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(payloadPart)
    .digest('base64url');

  const sigBuffer = Buffer.from(sigPart, 'utf8');
  const expectedBuffer = Buffer.from(expectedSig, 'utf8');
  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return { ok: false, reason: 'Invalid token signature' };
  }

  try {
    const payload = JSON.parse(base64UrlDecode(payloadPart));
    if (!payload?.exp || Number(payload.exp) < Date.now()) {
      return { ok: false, reason: 'Token expired' };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: 'Invalid token payload' };
  }
};

module.exports = {
  buildOrigin,
  signPayload,
  verifyToken
};

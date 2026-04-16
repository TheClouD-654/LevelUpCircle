const crypto = require('crypto');
const { readEnv, readKvRestToken, readKvRestUrl, readNumberEnv } = require('./_lib/env');

const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MINUTES = readNumberEnv('SECURE_ADMIN_ATTEMPT_WINDOW_MINUTES', 60);
const LOCK_MINUTES = readNumberEnv('SECURE_ADMIN_LOCK_MINUTES', 1440);
const KV_KEY_PREFIX = 'levelup:secure_admin_attempts:';

const memoryStore = globalThis.__levelupSecureAdminAttempts || new Map();
globalThis.__levelupSecureAdminAttempts = memoryStore;

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

const readBody = async (req) => {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return parseJsonBody(req);
};

const getClientIp = (req) => {
  const headers = req.headers || {};
  const candidates = [
    headers['x-forwarded-for'],
    headers['x-vercel-forwarded-for'],
    headers['x-real-ip'],
    headers['cf-connecting-ip'],
    req.socket?.remoteAddress
  ];

  for (const value of candidates) {
    const first = String(value || '').split(',')[0].trim().replace(/^::ffff:/, '');
    if (first) return first;
  }

  return 'unknown';
};

const keyForIp = (ip) => {
  const hash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 40);
  return `${KV_KEY_PREFIX}${hash}`;
};

const safePositiveMinutes = (value, fallback) => (
  Number.isFinite(value) && value > 0 ? value : fallback
);

const attemptWindowMs = () => safePositiveMinutes(ATTEMPT_WINDOW_MINUTES, 60) * 60 * 1000;
const lockMs = () => safePositiveMinutes(LOCK_MINUTES, 1440) * 60 * 1000;

const getKvConfig = () => {
  const kvUrl = readKvRestUrl();
  const kvToken = readKvRestToken();
  return kvUrl && kvToken ? { kvUrl, kvToken } : null;
};

const kvGet = async (key) => {
  const config = getKvConfig();
  if (!config) return { available: false, result: null };

  try {
    const response = await fetch(`${config.kvUrl}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${config.kvToken}` }
    });
    if (!response.ok) return { available: false, result: null };
    const payload = await response.json().catch(() => ({}));
    return { available: true, result: payload?.result ?? null };
  } catch {
    return { available: false, result: null };
  }
};

const kvSet = async (key, value) => {
  const config = getKvConfig();
  if (!config) return false;

  try {
    const response = await fetch(
      `${config.kvUrl}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
      { headers: { Authorization: `Bearer ${config.kvToken}` } }
    );
    return response.ok;
  } catch {
    return false;
  }
};

const parseState = (value) => {
  if (!value) return null;
  try {
    const state = typeof value === 'string' ? JSON.parse(value) : value;
    return {
      count: Math.max(0, Number(state.count || 0)),
      blockedUntil: Math.max(0, Number(state.blockedUntil || 0)),
      expiresAt: Math.max(0, Number(state.expiresAt || 0))
    };
  } catch {
    return null;
  }
};

const normalizeState = (state, now) => {
  if (!state) return { count: 0, blockedUntil: 0, expiresAt: 0 };
  if (state.blockedUntil && state.blockedUntil <= now) {
    return { count: 0, blockedUntil: 0, expiresAt: 0 };
  }
  if (!state.blockedUntil && state.expiresAt && state.expiresAt <= now) {
    return { count: 0, blockedUntil: 0, expiresAt: 0 };
  }
  return state;
};

const readAttemptState = async (key, now) => {
  const kvState = await kvGet(key);
  if (kvState.available) {
    return normalizeState(parseState(kvState.result), now);
  }
  return normalizeState(parseState(memoryStore.get(key)), now);
};

const writeAttemptState = async (key, state) => {
  const value = JSON.stringify(state);
  const storedInKv = await kvSet(key, value);
  if (!storedInKv) {
    memoryStore.set(key, value);
  }
};

const resetAttemptState = async (key) => {
  await writeAttemptState(key, { count: 0, blockedUntil: 0, expiresAt: 0 });
};

const formatBlockMessage = (blockedUntil) => {
  const minutes = Math.max(1, Math.ceil((blockedUntil - Date.now()) / 60000));
  return `Too many failed attempts. This IP is blocked from the secure access portal for about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return json(res, 405, { ok: false, message: 'Method not allowed' });
  }

  const expectedCode = readEnv('SECURE_ADMIN_CODE');
  const detailsUrl = readEnv('SECURE_DETAILS_URL');
  const body = await readBody(req);
  const suppliedCode = typeof body?.code === 'string' ? body.code.trim() : '';
  const ip = getClientIp(req);
  const attemptKey = keyForIp(ip);
  const now = Date.now();
  const state = await readAttemptState(attemptKey, now);

  if (state.blockedUntil && state.blockedUntil > now) {
    res.setHeader('Retry-After', String(Math.ceil((state.blockedUntil - now) / 1000)));
    return json(res, 429, {
      ok: false,
      blocked: true,
      blockedUntil: new Date(state.blockedUntil).toISOString(),
      message: formatBlockMessage(state.blockedUntil)
    });
  }

  if (!expectedCode) {
    return json(res, 500, { ok: false, message: 'Server code is not configured' });
  }

  if (!suppliedCode || suppliedCode !== expectedCode) {
    const nextCount = state.count + 1;
    const remainingAttempts = Math.max(0, MAX_FAILED_ATTEMPTS - nextCount);

    if (nextCount >= MAX_FAILED_ATTEMPTS) {
      const blockedUntil = now + lockMs();
      await writeAttemptState(attemptKey, {
        count: nextCount,
        blockedUntil,
        expiresAt: blockedUntil
      });
      res.setHeader('Retry-After', String(Math.ceil((blockedUntil - now) / 1000)));
      return json(res, 429, {
        ok: false,
        blocked: true,
        remainingAttempts: 0,
        blockedUntil: new Date(blockedUntil).toISOString(),
        message: formatBlockMessage(blockedUntil)
      });
    }

    const expiresAt = now + attemptWindowMs();
    await writeAttemptState(attemptKey, {
      count: nextCount,
      blockedUntil: 0,
      expiresAt
    });

    return json(res, 401, {
      ok: false,
      remainingAttempts,
      expiresAt: new Date(expiresAt).toISOString(),
      message: `Invalid secure code. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} left before this IP is blocked.`
    });
  }

  await resetAttemptState(attemptKey);
  return json(res, 200, { ok: true, detailsUrl });
};

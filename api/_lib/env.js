const normalizeEnvValue = (value) => {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';

  const hasWrappingQuotes = (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  );

  return hasWrappingQuotes ? trimmed.slice(1, -1).trim() : trimmed;
};

const readEnv = (...keys) => {
  for (const key of keys) {
    const value = normalizeEnvValue(process.env[key]);
    if (value) return value;
  }
  return '';
};

const readAbsoluteUrl = (...keys) => {
  const raw = readEnv(...keys);
  if (!raw) return '';

  try {
    return new URL(raw).toString().replace(/\/$/, '');
  } catch {
    return '';
  }
};

const readNumberEnv = (keys, fallback) => {
  const keyList = Array.isArray(keys) ? keys : [keys];
  const raw = readEnv(...keyList);
  if (!raw) return fallback;

  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

module.exports = {
  normalizeEnvValue,
  readEnv,
  readAbsoluteUrl,
  readNumberEnv
};

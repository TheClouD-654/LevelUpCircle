const stringifyUnknown = (value) => {
  if (typeof value === 'string') return value.trim();
  if (value == null) return '';

  try {
    const json = JSON.stringify(value);
    return json === '{}' ? String(value) : json;
  } catch {
    return String(value);
  }
};

const formatErrorMessage = (error, fallback) => {
  const message = stringifyUnknown(error?.message);
  const cause = stringifyUnknown(error?.cause?.message || error?.cause);
  const combined = [message, cause]
    .filter(Boolean)
    .join(': ')
    .replace(/\s+/g, ' ')
    .trim();

  return combined || fallback;
};

const pickApiErrorMessage = (payload, fallback) => {
  const direct = stringifyUnknown(payload?.message);
  const error = stringifyUnknown(payload?.error);
  const errors = stringifyUnknown(payload?.errors);
  const full = stringifyUnknown(payload);

  const resolved = direct || error || errors || full;
  return resolved || fallback;
};

module.exports = {
  formatErrorMessage,
  pickApiErrorMessage
};

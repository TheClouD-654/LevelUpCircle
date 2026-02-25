module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, message: 'Method not allowed' });
  }

  const expectedCode = process.env.SECURE_ADMIN_CODE || '';
  const detailsUrl = process.env.SECURE_DETAILS_URL || '';
  const suppliedCode = typeof req.body?.code === 'string' ? req.body.code.trim() : '';

  if (!expectedCode) {
    return res.status(500).json({ ok: false, message: 'Server code is not configured' });
  }

  if (!suppliedCode || suppliedCode !== expectedCode) {
    return res.status(401).json({ ok: false });
  }

  return res.status(200).json({ ok: true, detailsUrl });
};

const { verifyToken } = require('./_delivery');
const { DEFAULT_PRODUCT_ID, getProduct, getProductZipUrl } = require('../../data/products');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.statusCode = 405;
    return res.end('Method not allowed');
  }

  const token = String(req.query?.token || '').trim();
  const secret = process.env.DELIVERY_TOKEN_SECRET || '';
  if (!secret) {
    const fallbackZip = process.env.PRODUCT_ZIP_URL || '';
    if (!fallbackZip) {
      res.statusCode = 503;
      return res.end('Delivery file is not configured');
    }
    // Fallback for early setup; use tokenless redirect only if explicit opt-in is set.
    const allowDirect = String(process.env.ALLOW_DIRECT_ZIP_REDIRECT || 'false').toLowerCase() === 'true';
    if (!allowDirect) {
      res.statusCode = 503;
      return res.end('Delivery token secret is not configured');
    }
    res.statusCode = 302;
    res.setHeader('Location', fallbackZip);
    return res.end();
  }

  const verified = verifyToken(token, secret);
  if (!verified.ok) {
    res.statusCode = 401;
    return res.end('Invalid or expired download link');
  }

  const productId = String(verified.payload?.prd || DEFAULT_PRODUCT_ID).trim();
  const product = getProduct(productId);
  const zipUrl = getProductZipUrl(product);
  if (!zipUrl) {
    res.statusCode = 503;
    return res.end('Delivery file is not configured for this product');
  }

  res.statusCode = 302;
  res.setHeader('Location', zipUrl);
  return res.end();
};

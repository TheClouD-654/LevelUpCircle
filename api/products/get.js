const { DEFAULT_PRODUCT_ID, getPublicProduct } = require('../../data/products');

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return json(res, 405, { ok: false, message: 'Method not allowed' });
  }

  const productId = String(req.query?.product_id || DEFAULT_PRODUCT_ID).trim();
  const product = getPublicProduct(productId);
  return json(res, 200, { ok: true, product });
};

const DEFAULT_PRODUCT_ID = 'starter_bundle';

const PRODUCTS = {
  starter_bundle: {
    id: 'starter_bundle',
    title: 'The LevelUp Circle Starter Bundle',
    subtitle: '5 beginner trading PDFs delivered in one ZIP file.',
    purpose: 'LevelUp Circle Starter Bundle (ZIP)',
    oldPriceDisplay: 'Rs 19',
    newPriceDisplay: 'Rs 9',
    displayAmount: 9,
    displayCurrency: 'INR',
    chargeAmount: 9,
    chargeCurrency: 'INR',
    zipName: 'LevelUp-Circle-Starter-Bundle.zip',
    zipUrlEnvKey: 'PRODUCT_STARTER_ZIP_URL'
  }
};

const getProduct = (productId) => {
  const key = String(productId || '').trim();
  return PRODUCTS[key] || PRODUCTS[DEFAULT_PRODUCT_ID];
};

const getPublicProduct = (productId) => {
  const p = getProduct(productId);
  return {
    id: p.id,
    title: p.title,
    subtitle: p.subtitle,
    purpose: p.purpose,
    oldPriceDisplay: p.oldPriceDisplay,
    newPriceDisplay: p.newPriceDisplay,
    displayAmount: p.displayAmount,
    displayCurrency: p.displayCurrency
  };
};

const getProductZipUrl = (product) => {
  if (!product) return process.env.PRODUCT_ZIP_URL || '';
  const envKey = product.zipUrlEnvKey;
  if (envKey && process.env[envKey]) return process.env[envKey];
  return process.env.PRODUCT_ZIP_URL || '';
};

module.exports = {
  DEFAULT_PRODUCT_ID,
  PRODUCTS,
  getProduct,
  getPublicProduct,
  getProductZipUrl
};

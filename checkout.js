const form = document.querySelector('#checkout-form');
const messageEl = document.querySelector('#form-message');
const continueBtn = document.querySelector('#continue-btn');
const consentCheckbox = document.querySelector('#consent-checkbox');
const checkoutPriceEl = document.querySelector('#checkout-new-price');
const checkoutOldPriceEl = document.querySelector('#checkout-old-price');
const productTitleEl = document.querySelector('#checkout-product-title');
const productSubtitleEl = document.querySelector('#checkout-product-subtitle');

const params = new URLSearchParams(window.location.search);
const requestedProductId = String(params.get('product_id') || 'starter_bundle').trim();
let redirectingToPayment = false;
const checkoutSessionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
let selectedProduct = {
  id: 'starter_bundle',
  purpose: 'LevelUp Circle Starter Bundle (ZIP)',
  title: 'The LevelUp Circle Starter Bundle',
  subtitle: '5 beginner trading PDFs delivered in one ZIP file.',
  oldPriceDisplay: '$3.99',
  newPriceDisplay: '$1.99',
  displayAmount: 1.99,
  displayCurrency: 'USD'
};

const applyProductView = (product) => {
  if (!product) return;
  selectedProduct = { ...selectedProduct, ...product };
  if (productTitleEl) productTitleEl.textContent = selectedProduct.title || selectedProduct.purpose;
  if (productSubtitleEl) productSubtitleEl.textContent = selectedProduct.subtitle || '';
  if (checkoutOldPriceEl) checkoutOldPriceEl.textContent = selectedProduct.oldPriceDisplay || '';
  if (checkoutPriceEl) checkoutPriceEl.textContent = selectedProduct.newPriceDisplay || '';
};

const loadProduct = async () => {
  try {
    const response = await fetch(`/api/products/get?product_id=${encodeURIComponent(requestedProductId)}`);
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload?.ok && payload.product) {
      applyProductView(payload.product);
    }
  } catch {
    // Keep default fallback product.
  }
};

loadProduct();

if (form && messageEl && continueBtn && consentCheckbox) {
  const toUserFacingError = (value) => String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const setMessage = (text, type) => {
    messageEl.textContent = text;
    messageEl.className = 'form-message';
    if (type) messageEl.classList.add(type);
  };

  const syncContinueState = () => {
    continueBtn.disabled = !consentCheckbox.checked;
  };

  const hasCheckoutProgress = () => {
    const name = String(form.querySelector('#buyer-name')?.value || '').trim();
    const email = String(form.querySelector('#buyer-email')?.value || '').trim();
    const phone = String(form.querySelector('#buyer-phone')?.value || '').trim();
    return Boolean(name || email || phone || consentCheckbox.checked);
  };

  window.addEventListener('beforeunload', (event) => {
    // Browser may show a generic confirmation dialog only.
    if (redirectingToPayment || !hasCheckoutProgress()) return;
    event.preventDefault();
    event.returnValue = '';
  });

  consentCheckbox.addEventListener('change', () => {
    syncContinueState();
    if (!consentCheckbox.checked) {
      setMessage('Please agree to terms before continuing.', 'error');
    } else {
      setMessage('', '');
    }
  });

  syncContinueState();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const name = String(formData.get('buyerName') || '').trim();
    const email = String(formData.get('buyerEmail') || '').trim();
    const rawPhone = String(formData.get('buyerPhone') || '').trim();
    const phone = rawPhone.replace(/\D/g, '');
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const phoneOk = /^\d{10}$/.test(phone);

    if (!name || !email || !rawPhone) {
      setMessage('Please fill in your name, email, and phone number.', 'error');
      return;
    }

    if (!emailOk) {
      setMessage('Please enter a valid email address.', 'error');
      return;
    }

    if (!phoneOk) {
      setMessage('Invalid phone number.', 'error');
      return;
    }

    if (!consentCheckbox.checked) {
      setMessage('Please agree to terms before continuing.', 'error');
      syncContinueState();
      return;
    }

    continueBtn.disabled = true;
    setMessage('Preparing secure checkout...', 'success');

    const submission = {
      sessionId: checkoutSessionId,
      productId: selectedProduct.id,
      name,
      email,
      phone,
      product: selectedProduct.purpose,
      amount: Number(selectedProduct.displayAmount || 1),
      currency: String(selectedProduct.displayCurrency || 'INR'),
      paymentStatus: 'pending',
      createdAt: new Date().toISOString()
    };

    localStorage.setItem('levelup_buyer_info', JSON.stringify(submission));

    let serverSaved = false;
    let saveError = '';
    try {
      const response = await fetch('/api/submissions/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submission)
      });

      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.ok) {
        serverSaved = true;
      } else {
        saveError = toUserFacingError(payload.message || 'Could not save buyer info on the server.');
      }
    } catch {
      serverSaved = false;
      saveError = 'Could not save buyer info on the server.';
    }

    if (!serverSaved) {
      const submissionsKey = 'levelup_buyer_submissions';
      const existing = JSON.parse(localStorage.getItem(submissionsKey) || '[]');
      const updated = [submission, ...existing].slice(0, 250);
      localStorage.setItem(submissionsKey, JSON.stringify(updated));
    }

    try {
      const paymentResponse = await fetch('/api/payments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submission)
      });

      const paymentPayload = await paymentResponse.json().catch(() => ({}));
      if (!paymentResponse.ok || !paymentPayload.ok || !paymentPayload.checkoutUrl) {
        throw new Error(
          toUserFacingError(paymentPayload.message || 'Unable to create payment session')
        );
      }

      setMessage('Redirecting to secure payment...', 'success');
      redirectingToPayment = true;
      window.location.href = paymentPayload.checkoutUrl;
    } catch (error) {
      syncContinueState();
      const paymentError = toUserFacingError(error?.message || '');
      if (paymentError && paymentError !== 'Unable to create payment session') {
        setMessage(paymentError, 'error');
      } else if (serverSaved) {
        setMessage('Buyer info saved, but payment session failed. Please try again.', 'error');
      } else if (saveError) {
        setMessage(`${saveError} Payment could not start.`, 'error');
      } else {
        setMessage('Could not start payment right now. Please try again.', 'error');
      }
    }
  });
}

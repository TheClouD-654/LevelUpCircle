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

  const openRazorpayCheckout = (checkoutOptions) => new Promise((resolve, reject) => {
    if (typeof window.Razorpay !== 'function') {
      reject(new Error('Razorpay checkout is unavailable right now. Please refresh and try again.'));
      return;
    }

    const safeOrderId = String(checkoutOptions?.orderId || '').trim();
    if (!safeOrderId) {
      reject(new Error('Payment session is missing an order ID.'));
      return;
    }

    let finished = false;
    const finalize = (callback, payload) => {
      if (finished) return;
      finished = true;
      callback(payload);
    };

    const razorpay = new window.Razorpay({
      key: checkoutOptions.key,
      amount: checkoutOptions.amount,
      currency: checkoutOptions.currency || 'INR',
      name: checkoutOptions.name || 'LevelUp Circle',
      description: checkoutOptions.description || selectedProduct.purpose,
      order_id: safeOrderId,
      prefill: checkoutOptions.prefill || {},
      notes: checkoutOptions.notes || {},
      theme: checkoutOptions.theme || { color: '#2f8cff' },
      handler: (response) => {
        const resolvedPaymentId = String(response?.razorpay_payment_id || '').trim();
        const resolvedSignature = String(response?.razorpay_signature || '').trim();
        if (!resolvedPaymentId || !resolvedSignature) {
          finalize(reject, new Error('Payment finished, but verification details were missing.'));
          return;
        }
        finalize(resolve, {
          orderId: String(response?.razorpay_order_id || safeOrderId).trim(),
          paymentId: resolvedPaymentId,
          signature: resolvedSignature
        });
      },
      modal: {
        ondismiss: () => finalize(reject, new Error('Payment window closed before completion.'))
      }
    });

    razorpay.on('payment.failed', (event) => {
      const errorText = toUserFacingError(
        event?.error?.description || event?.error?.reason || event?.error?.step || 'Payment failed.'
      );
      finalize(reject, new Error(errorText || 'Payment failed.'));
    });

    razorpay.open();
  });

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
      if (!paymentResponse.ok || !paymentPayload.ok || !paymentPayload.checkoutOptions?.orderId) {
        throw new Error(
          toUserFacingError(paymentPayload.message || 'Unable to create payment session')
        );
      }

      setMessage('Opening secure Razorpay checkout...', 'success');
      const paymentResult = await openRazorpayCheckout(paymentPayload.checkoutOptions);
      const successUrl = new URL('/help-success', window.location.origin);
      successUrl.searchParams.set('razorpay_order_id', paymentResult.orderId);
      successUrl.searchParams.set('razorpay_payment_id', paymentResult.paymentId);
      successUrl.searchParams.set('razorpay_signature', paymentResult.signature);
      successUrl.searchParams.set('payment_request_id', paymentResult.orderId);
      successUrl.searchParams.set('payment_id', paymentResult.paymentId);
      redirectingToPayment = true;
      window.location.href = successUrl.toString();
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

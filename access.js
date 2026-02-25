const form = document.querySelector('#access-form');
const messageEl = document.querySelector('#form-message');
const continueBtn = document.querySelector('#continue-btn');
const consentCheckbox = document.querySelector('#consent-checkbox');

if (form && messageEl && continueBtn && consentCheckbox) {
  const setMessage = (text, type) => {
    messageEl.textContent = text;
    messageEl.className = 'form-message';
    if (type) messageEl.classList.add(type);
  };

  const syncContinueState = () => {
    continueBtn.disabled = !consentCheckbox.checked;
  };

  consentCheckbox.addEventListener('change', () => {
    syncContinueState();
    if (!consentCheckbox.checked) {
      setMessage('Please agree to terms before continuing.', 'error');
    } else {
      setMessage('', '');
    }
  });

  syncContinueState();

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const formData = new FormData(form);
    const name = String(formData.get('buyerName') || '').trim();
    const email = String(formData.get('buyerEmail') || '').trim();
    const phone = String(formData.get('buyerPhone') || '').trim();
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

    if (!name || !email) {
      setMessage('Please fill in your name and email.', 'error');
      return;
    }

    if (!emailOk) {
      setMessage('Please enter a valid email address.', 'error');
      return;
    }

    if (!consentCheckbox.checked) {
      setMessage('Please agree to terms before continuing.', 'error');
      syncContinueState();
      return;
    }

    continueBtn.disabled = true;
    setMessage('Preparing secure checkout...', 'success');

    localStorage.setItem('levelup_buyer_info', JSON.stringify({
      name,
      email,
      phone,
      product: 'LevelUp Circle Starter Bundle (ZIP)',
      amount: 1.99,
      currency: 'USD'
    }));

    // Placeholder. Next step: replace with real backend call to create Instamojo payment session.
    window.setTimeout(() => {
      syncContinueState();
      setMessage('Buyer info saved. Soon payment and all the materials will be added.', 'success');
    }, 700);
  });
}

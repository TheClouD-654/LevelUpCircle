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

  form.addEventListener('submit', async (event) => {
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

    const submission = {
      name,
      email,
      phone,
      product: 'LevelUp Circle Starter Bundle (ZIP)',
      amount: 1.99,
      currency: 'USD',
      createdAt: new Date().toISOString()
    };

    localStorage.setItem('levelup_buyer_info', JSON.stringify(submission));

    let serverSaved = false;
    try {
      const response = await fetch('/api/submissions/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(submission)
      });

      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.ok) {
        serverSaved = true;
      }
    } catch (error) {
      serverSaved = false;
    }

    if (!serverSaved) {
      const submissionsKey = 'levelup_buyer_submissions';
      const existing = JSON.parse(localStorage.getItem(submissionsKey) || '[]');
      const updated = [submission, ...existing].slice(0, 250);
      localStorage.setItem(submissionsKey, JSON.stringify(updated));
    }

    // Placeholder. Next step: replace with real backend call to create Instamojo payment session.
    window.setTimeout(() => {
      syncContinueState();
      if (serverSaved) {
        setMessage('Buyer info saved securely.', 'success');
      } else {
        setMessage('Buyer info saved locally. Configure KV to store centrally.', 'success');
      }
    }, 700);
  });
}

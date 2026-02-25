const form = document.querySelector('#secure-form');
const input = document.querySelector('#secure-code');
const statusEl = document.querySelector('#secure-status');
const verifyBtn = document.querySelector('#verify-btn');
const detailsBox = document.querySelector('#details-box');
const detailsLink = document.querySelector('#details-link');

if (form && input && statusEl && verifyBtn && detailsBox && detailsLink) {
  const setStatus = (text, error = false) => {
    statusEl.textContent = text;
    statusEl.className = `status${error ? ' error' : ''}`;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const code = input.value.trim();
    if (!code) {
      setStatus('Please enter secure code.', true);
      return;
    }

    verifyBtn.disabled = true;
    setStatus('Verifying...');

    try {
      const response = await fetch('/api/verify-secure-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });

      const payload = await response.json().catch(() => ({}));
      if (response.status === 404) {
        setStatus('Secure API is not available in static preview. Test on deployed site.', true);
        detailsBox.classList.add('hidden');
        return;
      }

      if (response.status === 500 && payload.message) {
        setStatus(payload.message, true);
        detailsBox.classList.add('hidden');
        return;
      }

      if (!response.ok || !payload.ok) {
        setStatus('Invalid secure code.', true);
        detailsBox.classList.add('hidden');
        return;
      }

      if (!payload.detailsUrl) {
        setStatus('No details URL configured on server.', true);
        detailsBox.classList.add('hidden');
        return;
      }

      detailsLink.href = payload.detailsUrl;
      detailsBox.classList.remove('hidden');
      setStatus('Verified successfully.');
      input.value = '';
    } catch (error) {
      setStatus('Verification failed. Please try again.', true);
      detailsBox.classList.add('hidden');
    } finally {
      verifyBtn.disabled = false;
    }
  });
}

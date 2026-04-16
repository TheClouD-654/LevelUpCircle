const form = document.querySelector('#secure-form');
const input = document.querySelector('#secure-code');
const statusEl = document.querySelector('#secure-status');
const verifyBtn = document.querySelector('#verify-btn');
const detailsBox = document.querySelector('#details-box');
const detailsLink = document.querySelector('#details-link');
const ATTEMPT_STORAGE_KEY = 'levelup_secure_access_attempts';

if (form && input && statusEl && verifyBtn && detailsBox && detailsLink) {
  const setStatus = (text, error = false) => {
    statusEl.textContent = text;
    statusEl.className = `status${error ? ' error' : ''}`;
  };

  const setLocked = (locked) => {
    input.disabled = locked;
    verifyBtn.disabled = locked;
    form.classList.toggle('is-locked', locked);
  };

  const readAttemptMemory = () => {
    try {
      return JSON.parse(localStorage.getItem(ATTEMPT_STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  };

  const writeAttemptMemory = (state) => {
    try {
      localStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Server-side blocking still applies if localStorage is unavailable.
    }
  };

  const clearAttemptMemory = () => {
    try {
      localStorage.removeItem(ATTEMPT_STORAGE_KEY);
    } catch {
      // Nothing to clear.
    }
  };

  const formatClientBlockMessage = (blockedUntil) => {
    const remainingMs = Number(blockedUntil) - Date.now();
    const minutes = Math.max(1, Math.ceil(remainingMs / 60000));
    return `Too many failed attempts. This IP is blocked from the secure access portal for about ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  };

  const applyRememberedAttemptState = () => {
    const remembered = readAttemptMemory();
    const blockedUntil = Date.parse(remembered.blockedUntil || '');
    const expiresAt = Date.parse(remembered.expiresAt || '');

    if (Number.isFinite(blockedUntil) && blockedUntil > Date.now()) {
      setLocked(true);
      setStatus(formatClientBlockMessage(blockedUntil), true);
      return;
    }

    if (Number.isFinite(blockedUntil) && blockedUntil <= Date.now()) {
      clearAttemptMemory();
      return;
    }

    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      clearAttemptMemory();
      return;
    }

    const remainingAttempts = Number(remembered.remainingAttempts);
    if (Number.isFinite(remainingAttempts) && remainingAttempts > 0 && remainingAttempts < 5) {
      setStatus(`${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} left before this IP is blocked.`, true);
    }
  };

  applyRememberedAttemptState();

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
        if (response.status === 429) {
          setStatus(payload.message || 'Too many failed attempts. This IP is temporarily blocked.', true);
          if (payload.blockedUntil) {
            writeAttemptMemory({ blockedUntil: payload.blockedUntil, remainingAttempts: 0 });
          }
          setLocked(true);
          detailsBox.classList.add('hidden');
          return;
        }

        const remainingAttempts = Number(payload.remainingAttempts);
        const message = Number.isFinite(remainingAttempts)
          ? `Invalid secure code. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} left before this IP is blocked.`
          : (payload.message || 'Invalid secure code.');
        setStatus(message, true);
        if (Number.isFinite(remainingAttempts)) {
          writeAttemptMemory({ remainingAttempts, expiresAt: payload.expiresAt });
        }
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
      clearAttemptMemory();
      input.value = '';
    } catch (error) {
      setStatus('Verification failed. Please try again.', true);
      detailsBox.classList.add('hidden');
    } finally {
      if (!form.classList.contains('is-locked')) {
        verifyBtn.disabled = false;
      }
    }
  });
}

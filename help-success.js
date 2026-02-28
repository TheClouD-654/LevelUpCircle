const kickerEl = document.getElementById('successKicker');
const titleEl = document.getElementById('successTitle');
const bodyEl = document.getElementById('successBody');
const deliveryPanelEl = document.getElementById('deliveryPanel');
const deliveryNameEl = document.getElementById('deliveryName');
const deliveryMetaEl = document.getElementById('deliveryMeta');
const downloadBtnEl = document.getElementById('downloadBtn');
const emailStatusEl = document.getElementById('emailStatus');

const params = new URLSearchParams(window.location.search);

const sanitizeText = (value) => String(value || '').replace(/[<>]/g, '').trim();

const setSupportMode = () => {
  const name = sanitizeText(params.get('name'));
  if (name) {
    titleEl.textContent = `Thanks ${name}, we received your message.`;
  }
};

const setPaymentLoadingMode = () => {
  kickerEl.textContent = 'Payment Processing';
  titleEl.textContent = 'Verifying your payment...';
  bodyEl.textContent = 'Please wait while we validate your transaction and prepare your file.';
  deliveryPanelEl.hidden = false;
  deliveryNameEl.textContent = 'Starter Bundle ZIP';
  deliveryMetaEl.textContent = 'Checking payment status with Instamojo...';
  downloadBtnEl.hidden = true;
  emailStatusEl.textContent = '';
};

const setPaymentErrorMode = (message) => {
  kickerEl.textContent = 'Payment Pending';
  titleEl.textContent = 'We could not verify payment yet.';
  bodyEl.textContent = message || 'Please wait a minute and refresh this page, or contact support with your payment reference.';
  deliveryPanelEl.hidden = false;
  deliveryMetaEl.textContent = 'If money was deducted, your file will still be delivered once verification completes.';
  downloadBtnEl.hidden = true;
  emailStatusEl.textContent = '';
};

const setPaymentSuccessMode = (payload) => {
  const fileName = sanitizeText(payload?.file?.name || 'Starter Bundle ZIP');
  const downloadUrl = String(payload?.file?.downloadUrl || '').trim();
  const emailMessage = sanitizeText(payload?.email?.message || '');

  kickerEl.textContent = 'Payment Confirmed';
  titleEl.textContent = 'Your file is ready.';
  bodyEl.textContent = 'Download your ZIP below. A delivery email has been triggered automatically.';
  deliveryPanelEl.hidden = false;
  deliveryNameEl.textContent = fileName;
  deliveryMetaEl.textContent = 'File unlocked after successful payment verification.';

  if (downloadUrl) {
    downloadBtnEl.href = downloadUrl;
    downloadBtnEl.hidden = false;
  }

  if (emailMessage) {
    emailStatusEl.textContent = emailMessage;
  }
};

const runPaymentFlow = async () => {
  const paymentRequestId = String(params.get('payment_request_id') || '').trim();
  const paymentId = String(params.get('payment_id') || '').trim();

  if (!paymentRequestId || !paymentId) {
    setSupportMode();
    return;
  }

  setPaymentLoadingMode();

  try {
    const response = await fetch('/api/payments/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payment_request_id: paymentRequestId,
        payment_id: paymentId,
        payment_status: String(params.get('payment_status') || '').trim()
      })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) {
      throw new Error(sanitizeText(payload?.message || 'Payment verification failed.'));
    }

    setPaymentSuccessMode(payload);
  } catch (error) {
    setPaymentErrorMode(error?.message);
  }
};

runPaymentFlow();

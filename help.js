// Wait for EmailJS to load, then initialize
let emailInitAttempts = 0;
const MAX_EMAIL_INIT_ATTEMPTS = 100; // ~10 seconds with 100ms interval
const SUPPORT_EMAIL = 'support@levelupcircle.com';
const EMAILJS_SERVICE_ID = 'test-service-1';
const EMAILJS_CONTACT_TEMPLATE_ID = 'test-template-contactus';
const EMAILJS_AUTOREPLY_TEMPLATE_ID = 'test-template-autoreply';

function setFormStatus(message, isError = false) {
  const statusEl = document.getElementById('formStatus');
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle('is-error', isError);
  statusEl.classList.toggle('is-success', !isError && Boolean(message));
}

function initializeEmailJS() {
  if (typeof emailjs !== 'undefined') {
    emailjs.init("-NZWxEZYr2HF-V1wT");
    setupForm();
  } else {
    // Retry while script is loading, then fail safely.
    emailInitAttempts += 1;
    if (emailInitAttempts < MAX_EMAIL_INIT_ATTEMPTS) {
      setTimeout(initializeEmailJS, 100);
    } else {
      console.error('Email service failed to load. Form submission is unavailable.');
      setFormStatus(`Support form is temporarily unavailable. Please email ${SUPPORT_EMAIL} directly.`, true);
    }
  }
}

function setupForm() {
  const helpForm = document.getElementById('helpForm');
  const submitBtn = helpForm ? helpForm.querySelector('button[type="submit"]') : null;

  if (helpForm) {
    helpForm.addEventListener('submit', (event) => {
      event.preventDefault();
      setFormStatus('');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Sending...';
      }

      // Get form values
      const now = new Date();
      const formData = {
        from_name: document.getElementById('name').value,
        from_email: document.getElementById('email').value,
        topic: document.getElementById('topic').value,
        message: document.getElementById('message').value,
        reply_to: document.getElementById('email').value,
        time: now.toLocaleString(),
        time_utc: now.toISOString()
      };

      // Send owner notification first, then auto-reply to the user.
      emailjs.send(
        EMAILJS_SERVICE_ID,
        EMAILJS_CONTACT_TEMPLATE_ID,
        formData
      )
      .then(() => emailjs.send(
        EMAILJS_SERVICE_ID,
        EMAILJS_AUTOREPLY_TEMPLATE_ID,
        formData
      ))
      .then((response) => {
        console.log('Emails sent successfully!', response);
        const encodedName = encodeURIComponent(formData.from_name || 'there');
        window.location.href = `help-success.html?name=${encodedName}`;
      })
      .catch((error) => {
        console.error('Failed to send email:', error);
        setFormStatus(`Something went wrong. Please try again or email ${SUPPORT_EMAIL} directly.`, true);
      })
      .finally(() => {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send Message';
        }
      });
    });
  }
}

// Start initialization
initializeEmailJS();

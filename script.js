const revealEls = document.querySelectorAll('.reveal');

const io = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      io.unobserve(entry.target);
    }
  });
}, { threshold: 0.15 });

revealEls.forEach((el, i) => {
  el.style.transitionDelay = `${Math.min(i * 60, 240)}ms`;
  io.observe(el);
});

const navbar = document.querySelector('.navbar');
const topNavbar = document.querySelector('.top-navbar');

const toggleNavbar = () => {
  if (!navbar && !topNavbar) return;
  if (window.scrollY > 120) {
    if (navbar) navbar.classList.add('show');
    if (topNavbar) topNavbar.classList.add('hide');
  } else {
    if (navbar) navbar.classList.remove('show');
    if (topNavbar) topNavbar.classList.remove('hide');
  }
};

window.addEventListener('scroll', toggleNavbar, { passive: true });
toggleNavbar();

const offerBox = document.querySelector('.offer-box');
const offerTimer = document.querySelector('#offer-timer');
const oldPrice = document.querySelector('.old-price');
const newPrice = document.querySelector('.new-price');
const priceRow = document.querySelector('.price');

if (offerBox && offerTimer) {
  const parsedOfferDays = Number(offerBox.dataset.offerDays);
  const offerDays = Number.isFinite(parsedOfferDays) ? parsedOfferDays : 4;
  if (offerDays <= 0) {
    offerBox.style.display = 'none';
    if (newPrice) newPrice.style.display = 'none';
    if (oldPrice) oldPrice.classList.add('normal-price');
    if (priceRow) priceRow.classList.add('single-price');
  } else {
  if (priceRow) priceRow.classList.remove('single-price');
  const storageDeadlineKey = 'levelup_offer_deadline';
  const storageDaysKey = 'levelup_offer_days';
  const now = Date.now();

  let deadline = Number(localStorage.getItem(storageDeadlineKey));
  const savedDays = Number(localStorage.getItem(storageDaysKey));

  if (!deadline || deadline <= now || savedDays !== offerDays) {
    // Start slightly under full-day boundary so 4 days appears as 03:23:59:59.
    deadline = now + (offerDays * 24 * 60 * 60 * 1000) - 1000;
    localStorage.setItem(storageDeadlineKey, String(deadline));
    localStorage.setItem(storageDaysKey, String(offerDays));
  }

  const pad = (num) => String(num).padStart(2, '0');

  let timerInterval = null;

  const updateOfferTimer = () => {
    const remainingMs = Math.max(0, deadline - Date.now());
    const totalSeconds = Math.floor(remainingMs / 1000);

    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    offerTimer.textContent = `${pad(days)}:${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

    if (totalSeconds <= 0) {
      if (timerInterval) clearInterval(timerInterval);
    }
  };

  updateOfferTimer();
  timerInterval = setInterval(updateOfferTimer, 1000);
  }
}

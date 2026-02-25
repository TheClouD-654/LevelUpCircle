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

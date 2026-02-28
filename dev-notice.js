(() => {
  const SHOW_DEV_NOTICE = false;
  if (!SHOW_DEV_NOTICE) return;

  const style = document.createElement('style');
  style.textContent = `
    .dev-hover-wrap {
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 9999;
      overflow: hidden;
    }

    .dev-hover-ticker {
      position: absolute;
      top: 10px;
      left: 0;
      width: 100%;
      border-top: 1px solid rgba(255, 217, 102, 0.45);
      border-bottom: 1px solid rgba(255, 217, 102, 0.45);
      background: linear-gradient(90deg, rgba(255, 170, 0, 0.2), rgba(255, 78, 78, 0.22), rgba(255, 170, 0, 0.2));
      box-shadow: 0 0 24px rgba(255, 153, 0, 0.2);
      backdrop-filter: blur(3px);
    }

    .dev-hover-track {
      display: flex;
      width: max-content;
      white-space: nowrap;
      animation: devTickerMove 24s linear infinite;
      font: 700 0.84rem/1 "Inter", sans-serif;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #ffe6b3;
      padding: 9px 0;
    }

    .dev-hover-track span {
      margin-right: 44px;
      text-shadow: 0 0 10px rgba(255, 173, 71, 0.4);
    }

    .dev-hover-watermark {
      position: absolute;
      left: 50%;
      top: 52%;
      transform: translate(-50%, -50%) rotate(-16deg);
      font: 800 clamp(2rem, 7vw, 6rem)/1 "Inter", sans-serif;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: rgba(255, 214, 128, 0.08);
      text-shadow: 0 0 24px rgba(255, 173, 71, 0.12);
      animation: devPulse 2.8s ease-in-out infinite;
    }

    @keyframes devTickerMove {
      from { transform: translateX(0); }
      to { transform: translateX(-50%); }
    }

    @keyframes devPulse {
      0%, 100% { opacity: 0.46; }
      50% { opacity: 0.9; }
    }
  `;

  const wrap = document.createElement('div');
  wrap.className = 'dev-hover-wrap';
  wrap.setAttribute('aria-hidden', 'true');

  const ticker = document.createElement('div');
  ticker.className = 'dev-hover-ticker';

  const track = document.createElement('div');
  track.className = 'dev-hover-track';
  const text = 'SITE UNDER DEVELOPMENT - CONTENT, FEATURES, AND PRICING MAY CHANGE';
  track.innerHTML = `<span>${text}</span><span>${text}</span><span>${text}</span><span>${text}</span>`;

  const watermark = document.createElement('div');
  watermark.className = 'dev-hover-watermark';
  watermark.textContent = 'Under Development';

  ticker.appendChild(track);
  wrap.appendChild(ticker);
  wrap.appendChild(watermark);

  document.head.appendChild(style);
  document.body.appendChild(wrap);
})();

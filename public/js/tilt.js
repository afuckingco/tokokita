// public/js/tilt.js
// Efek tilt 3D pada product card: kartu seolah "dipegang" dan miring
// mengikuti posisi kursor, dengan highlight cahaya yang ikut bergerak.

(function () {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) return;

  function initTilt(card) {
    const inner = card.querySelector('.tilt-inner') || card;
    let bounds;

    function handleMove(e) {
      bounds = card.getBoundingClientRect();
      const x = e.clientX - bounds.left;
      const y = e.clientY - bounds.top;
      const px = x / bounds.width - 0.5;
      const py = y / bounds.height - 0.5;

      const rotateY = px * 14; // left-right tilt
      const rotateX = -py * 14; // up-down tilt

      inner.style.transform = `perspective(700px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateZ(8px)`;

      const glow = card.querySelector('.tilt-glow');
      if (glow) {
        glow.style.background = `radial-gradient(circle at ${x}px ${y}px, rgba(255,255,255,0.35), transparent 60%)`;
      }
    }

    function handleLeave() {
      inner.style.transform = 'perspective(700px) rotateX(0deg) rotateY(0deg) translateZ(0px)';
      const glow = card.querySelector('.tilt-glow');
      if (glow) glow.style.background = 'transparent';
    }

    card.addEventListener('mousemove', handleMove);
    card.addEventListener('mouseleave', handleLeave);
  }

  function init() {
    document.querySelectorAll('.product-card').forEach(initTilt);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

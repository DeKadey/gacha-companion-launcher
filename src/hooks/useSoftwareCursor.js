import { useEffect } from 'react';

// Inline the sparkle SVG so it renders as a real DOM element — not a CSS url()
// background that the OS can override. This element is part of Chromium's
// render tree, so DWM cannot touch it regardless of what it does with the OS cursor.
const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="48" height="48" viewBox="0 0 48 48">
  <defs>
    <path id="sc-star" d="M3,3 C16.02,16.02 28.56,19.44 36,12 C31.8,16.2 30.9,21.45 31.365,26.205 L21.06,21.06 L26.205,31.365 C21.45,30.9 16.2,31.8 12,36 C19.44,28.56 16.02,16.02 3,3 Z"/>
    <linearGradient id="sc-holo" gradientUnits="userSpaceOnUse" x1="4.5" y1="4.5" x2="42" y2="42">
      <stop offset="0"    stop-color="#8FF0DC"/>
      <stop offset="0.22" stop-color="#73C6F7"/>
      <stop offset="0.48" stop-color="#B0AAF4"/>
      <stop offset="0.74" stop-color="#D49EF0"/>
      <stop offset="1"    stop-color="#A3ABF4"/>
    </linearGradient>
    <radialGradient id="sc-core" gradientUnits="userSpaceOnUse" cx="22.5" cy="21.75" r="18">
      <stop offset="0"    stop-color="#FFFFFF" stop-opacity="1"/>
      <stop offset="0.34" stop-color="#FFF3CC" stop-opacity="0.62"/>
      <stop offset="0.82" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="sc-red" gradientUnits="userSpaceOnUse" cx="40.5" cy="40.5" r="13.5">
      <stop offset="0"    stop-color="#D02C20" stop-opacity="0.55"/>
      <stop offset="0.65" stop-color="#D02C20" stop-opacity="0"/>
    </radialGradient>
    <filter id="sc-glowF" filterUnits="userSpaceOnUse" x="-10" y="-10" width="68" height="68">
      <feGaussianBlur stdDeviation="4"/>
    </filter>
    <filter id="sc-shadowF" filterUnits="userSpaceOnUse" x="-8" y="-4" width="62" height="58">
      <feGaussianBlur stdDeviation="1.8"/>
    </filter>
  </defs>
  <use href="#sc-star" fill="#08041a" opacity="0.45" filter="url(#sc-shadowF)" transform="translate(-2,2)"/>
  <use href="#sc-star" fill="#A8E8FF" opacity="0.55" filter="url(#sc-glowF)"/>
  <use href="#sc-star" fill="url(#sc-holo)"/>
  <use href="#sc-star" fill="url(#sc-red)"/>
  <use href="#sc-star" fill="url(#sc-core)"/>
  <use href="#sc-star" fill="none" stroke="#FFFFFF" stroke-opacity="0.55" stroke-width="0.9" stroke-linejoin="round"/>
  <g shape-rendering="crispEdges">
    <path d="M25.2,25.2   L31.248,31.248 L33.552,28.944 Z" fill="#FFF0A0"/>
    <path d="M33.552,28.944 L31.248,31.248 L37.296,37.296 Z" fill="#E8A820"/>
    <path d="M28.944,33.552 L31.248,31.248 L25.2,25.2   Z" fill="#A87010"/>
    <path d="M37.296,37.296 L31.248,31.248 L28.944,33.552 Z" fill="#704806"/>
  </g>
  <path d="M25.2,25.2 L33.552,28.944 L37.296,37.296 L28.944,33.552 Z"
        fill="none" stroke="#C88A0A" stroke-opacity="0.85" stroke-width="0.75" stroke-linejoin="round"/>
</svg>`;

export function useSoftwareCursor() {
  useEffect(() => {
    // Create the cursor element. Position: fixed so it stays in viewport space.
    // pointer-events: none so it never intercepts clicks.
    // z-index: max so it's always on top of page content.
    // will-change: transform for GPU-composited movement (no layout reflow on move).
    const el = document.createElement('div');
    el.innerHTML = CURSOR_SVG;
    Object.assign(el.style, {
      position:      'fixed',
      top:           '0',
      left:          '0',
      width:         '48px',
      height:        '48px',
      pointerEvents: 'none',
      zIndex:        '2147483647',
      // Hotspot is (3, 3) — offset the element so the tip is at the mouse position.
      transform:     'translate(-200px, -200px)',
      willChange:    'transform',
      userSelect:    'none',
    });
    document.body.appendChild(el);

    const move = (e) => {
      el.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 3}px)`;
    };

    // Hide cursor element when mouse leaves the window.
    const hide = () => { el.style.opacity = '0'; };
    const show = () => { el.style.opacity = '1'; };

    document.addEventListener('mousemove', move, { passive: true });
    document.addEventListener('mouseleave', hide);
    document.addEventListener('mouseenter', show);

    return () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseleave', hide);
      document.removeEventListener('mouseenter', show);
      el.remove();
    };
  }, []);
}

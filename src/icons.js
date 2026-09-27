import { html } from '../vendor/preact-htm.js';

const svg = (d, size = 18) => html`<svg class="ico" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const Icon = {
  play: (s) => svg(html`<path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none" />`, s),
  stop: (s) => svg(html`<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />`, s),
  left: (s) => svg(html`<path d="M15 18l-6-6 6-6" />`, s),
  right: (s) => svg(html`<path d="M9 18l6-6-6-6" />`, s),
  gear: (s) => svg(html`<circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />`, s),
  plus: (s) => svg(html`<path d="M12 5v14M5 12h14" />`, s),
  check: (s) => svg(html`<path d="M5 12.5l4.5 4.5L19 7.5" />`, s),
  x: (s) => svg(html`<path d="M6 6l12 12M18 6L6 18" />`, s),
  flag: (s) => svg(html`<path d="M5 21V4M5 4h11l-2 4 2 4H5" />`, s),
  cal: (s) => svg(html`<rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />`, s),
  inbox: (s) => svg(html`<path d="M3 13l3-8h12l3 8v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><path d="M3 13h5l1 3h6l1-3h5" />`, s),
  alert: (s) => svg(html`<path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.01" />`, s),
  briefcase: (s) => svg(html`<rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />`, s),
  trash: (s) => svg(html`<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />`, s),
  image: (s) => svg(html`<rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 17l-5-5-9 8" />`, s),
  page: (s) => svg(html`<path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" />`, s),
  caret: (s) => svg(html`<path d="M9 6l6 6-6 6" />`, s),
  copy: (s) => svg(html`<rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />`, s),
};

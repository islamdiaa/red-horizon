/** Small inline SVG icons (emoji glyphs are not available on every system). */
const svg = (body: string, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  building: svg('<path d="M3 21h18M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/><path d="M12 5V2M12 2h5"/>'),
  defense: svg('<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  infantry: svg('<circle cx="12" cy="6" r="3"/><path d="M8 4.5c1-2 7-2 8 0"/><path d="M6 21v-5a6 6 0 0 1 12 0v5"/><path d="M12 13v4"/>'),
  vehicle: svg('<rect x="2" y="13" width="20" height="6" rx="3"/><path d="M6 13v-3h9v3"/><path d="M15 11h7"/><circle cx="6" cy="16" r="1"/><circle cx="12" cy="16" r="1"/><circle cx="18" cy="16" r="1"/>'),
  aircraft: svg('<path d="M12 2c1 0 1.5 1.5 1.5 3v4l8 5v2l-8-2.5V18l2.5 2v1.5L12 20.5 8 21.5V20l2.5-2v-4.5L2.5 16v-2l8-5V5c0-1.5.5-3 1.5-3z"/>'),
  wrench: svg('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/>'),
  sell: svg('<path d="M12 2v20"/><path d="M17 6.5c-1-1.5-3-2.5-5-2.5-3 0-5 1.5-5 4s2.5 3.3 5 4 5 1.5 5 4-2 4-5 4c-2.2 0-4.2-1-5.2-2.6"/>'),
  menu: svg('<path d="M4 6h16M4 12h16M4 18h16"/>'),
};

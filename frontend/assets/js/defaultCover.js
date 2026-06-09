// Generates a branded gradient cover image (data URI) for content items with no imageUrl.
// Returns a data:image/svg+xml,... string safe to use as <img src>.

const PALETTES = [
  ['#1a6b5a', '#0a3d32'],
  ['#1e5f9e', '#0d3a6e'],
  ['#7c3aed', '#4c1d95'],
  ['#b45309', '#78350f'],
  ['#0f766e', '#0d4a45'],
  ['#0e6fa8', '#0a4a72'],
  ['#6d28d9', '#3b0764'],
  ['#166534', '#052e16'],
]

// Feather-style 24×24 stroke icon paths per content type
const TYPE_ICONS = {
  NEWS: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><line x1="10" y1="14" x2="17" y2="14"/><line x1="10" y1="18" x2="14" y2="18"/><rect x="10" y="6" width="8" height="4"/>',
  ANNOUNCEMENT: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  EVENT: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
}

function titleHash(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i)
  }
  return Math.abs(h)
}

export function defaultCover(item) {
  const [c1, c2] = PALETTES[titleHash(item.title || '') % PALETTES.length]
  const iconPaths = TYPE_ICONS[item.type] || TYPE_ICONS.NEWS

  // 480×270 (16:9) SVG. Icon is a 24×24 path scaled ×3.5, centered at (240, 115).
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 270">` +
    `<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">` +
    `<stop offset="0%" stop-color="${c1}"/>` +
    `<stop offset="100%" stop-color="${c2}"/>` +
    `</linearGradient></defs>` +
    `<rect width="480" height="270" fill="url(#g)"/>` +
    // subtle diagonal stripe overlay
    `<rect width="480" height="270" fill="white" opacity="0.03"/>` +
    // icon: translate to center (240,115), scale up, offset by half the 24px unit box
    `<g transform="translate(240,115) scale(3.5) translate(-12,-12)" ` +
    `stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.85">` +
    iconPaths +
    `</g>` +
    // wordmark
    `<text x="240" y="206" font-family="system-ui,sans-serif" font-size="11" font-weight="700" ` +
    `letter-spacing="4" text-anchor="middle" fill="white" opacity="0.4">AIC RUIRU</text>` +
    `</svg>`

  return 'data:image/svg+xml,' + encodeURIComponent(svg)
}

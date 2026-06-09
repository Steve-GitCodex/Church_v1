import { toggleTheme, currentTheme } from '../theme.js'

// ── Theme FAB ──────────────────────────────────────────────────
const fab = document.getElementById('theme-fab')
const syncFab = () => { fab.textContent = currentTheme() === 'dark' ? '🌙' : '☀️' }
syncFab()
fab.addEventListener('click', () => { toggleTheme(); syncFab() })

// ── Nav login button ───────────────────────────────────────────
const loginBtn = document.getElementById('nav-login-btn')
if (loginBtn && localStorage.getItem('accessToken')) {
  loginBtn.textContent = 'Dashboard'
  loginBtn.href = 'dashboard.html'
}

// ── Scroll to top ──────────────────────────────────────────────
const scrollTopBtn = document.getElementById('scroll-top-btn')
window.addEventListener('scroll', () => {
  scrollTopBtn.classList.toggle('hidden', window.scrollY < 400)
}, { passive: true })
scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }))

// ── Footer year ────────────────────────────────────────────────
const yearEl = document.getElementById('footer-year')
if (yearEl) yearEl.textContent = new Date().getFullYear()

// ── Helpers ────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function initials(name) {
  return name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').slice(0, 2).join('')
}

// ── Render ─────────────────────────────────────────────────────
function render(data) {
  // Hero
  document.getElementById('about-heading').textContent   = data.hero?.heading    || 'About AIC Ruiru'
  document.getElementById('about-subheading').textContent = data.hero?.subheading || ''

  // Mission / Vision / Story
  document.getElementById('about-mission').textContent = data.mission || ''
  document.getElementById('about-vision').textContent  = data.vision  || ''
  document.getElementById('about-story').textContent   = data.story   || ''

  // Beliefs
  const beliefsList = document.getElementById('beliefs-list')
  beliefsList.innerHTML = (data.beliefs || []).map(b =>
    `<li>${escHtml(b)}</li>`
  ).join('')

  // Leaders
  const leadersGrid = document.getElementById('leaders-grid')
  if (!data.leaders?.length) {
    leadersGrid.innerHTML = '<p class="leaders-empty">Leadership information coming soon.</p>'
  } else {
    leadersGrid.innerHTML = data.leaders.map(l => {
      const avatar = l.imageUrl
        ? `<img class="leader-avatar" src="${escHtml(l.imageUrl)}" alt="${escHtml(l.name)}" loading="lazy">`
        : `<div class="leader-initials">${escHtml(initials(l.name))}</div>`
      return `<div class="leader-card">
        ${avatar}
        <p class="leader-name">${escHtml(l.name)}</p>
        <p class="leader-role">${escHtml(l.role)}</p>
      </div>`
    }).join('')
  }

  // Service times (reuse .service-card from home.css)
  const serviceGrid = document.getElementById('service-times-grid')
  const serviceIcons = { Sunday: '⛪', Wednesday: '📖', Friday: '🙏' }
  serviceGrid.innerHTML = (data.serviceTimes || []).map(s =>
    `<div class="service-card">
      <div class="service-icon">${serviceIcons[s.day] || '🕐'}</div>
      <div class="service-time-day">${escHtml(s.day)}</div>
      <div class="text-muted">${escHtml(s.label || '')}${s.label && s.time ? ' · ' : ''}${escHtml(s.time || '')}</div>
    </div>`
  ).join('')

  // Contact card
  const loc = data.location || {}
  const contactCard = document.getElementById('about-contact-card')
  contactCard.innerHTML = `<h3>Contact &amp; Location</h3>` +
    (loc.address ? `<div class="about-contact-row"><span class="about-contact-label">Address</span><span>${escHtml(loc.address)}</span></div>` : '') +
    (loc.phone   ? `<div class="about-contact-row"><span class="about-contact-label">Phone</span><a href="tel:${escHtml(loc.phone)}">${escHtml(loc.phone)}</a></div>` : '') +
    (loc.email   ? `<div class="about-contact-row"><span class="about-contact-label">Email</span><a href="mailto:${escHtml(loc.email)}">${escHtml(loc.email)}</a></div>` : '')

  const footerAddress = document.getElementById('footer-address')
  if (footerAddress && loc.address) footerAddress.textContent = loc.address

  // Map embed
  const mapWrap = document.getElementById('about-map-wrap')
  if (loc.mapEmbed) {
    mapWrap.innerHTML = loc.mapEmbed
  }
}

// ── Fetch ──────────────────────────────────────────────────────
async function loadAbout() {
  try {
    const res = await fetch('/api/site/about')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    render(await res.json())
  } catch {
    // Silently fall through; placeholders stay visible
  }
}

loadAbout()

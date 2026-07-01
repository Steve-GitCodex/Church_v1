import { api } from '../api.js'
import { toggleTheme, currentTheme } from '../theme.js'
import { defaultCover } from '../defaultCover.js'

document.getElementById('year').textContent = new Date().getFullYear()

const fab = document.getElementById('theme-fab')
const syncFab = () => { fab.textContent = currentTheme() === 'dark' ? '🌙' : '☀️' }
syncFab()
fab.addEventListener('click', () => { toggleTheme(); syncFab() })

// Show "Go to Dashboard" in navbar + hero when already logged in
if (localStorage.getItem('accessToken')) {
  const loginBtn = document.querySelector('.nav-links a.btn')
  if (loginBtn) {
    loginBtn.textContent = 'Dashboard'
    loginBtn.href = 'pages/dashboard.html'
  }
  const joinBtn = document.getElementById('hero-join-btn')
  if (joinBtn) {
    joinBtn.textContent = 'Go to Dashboard'
    joinBtn.href = 'pages/dashboard.html'
  }
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function typeLabel(type) {
  return type === 'ANNOUNCEMENT' ? 'Announcement' : type === 'EVENT' ? 'Event' : 'News'
}

function buildTickerHtml(items) {
  const set = items.map(item => {
    const slug = item.type.toLowerCase()
    const page = item.type === 'EVENT' ? 'events' : 'news'
    const href = `pages/${page}.html?open=${encodeURIComponent(item.id)}`
    const dateStr = item.publishedAt
      ? new Date(item.publishedAt).toLocaleDateString('en-KE', { dateStyle: 'medium' })
      : ''
    const imgSrc = item.imageUrl || defaultCover(item)
    const imgHtml = `<div class="ticker-card-img-wrap"><img src="${escHtml(imgSrc)}" alt="${escHtml(item.title)}" loading="lazy" onload="this.classList.add('loaded')"></div>`
    return `<a class="ticker-card" href="${href}">
      ${imgHtml}
      <div class="ticker-card-body">
        <span class="ticker-type ticker-type-${slug}">${typeLabel(item.type)}</span>
        <div class="ticker-card-title">${escHtml(item.title)}</div>
        ${dateStr ? `<div class="ticker-card-date">${dateStr}</div>` : ''}
      </div>
    </a>`
  }).join('')
  // Duplicate for seamless infinite scroll
  return set + set
}

async function loadTicker() {
  const track = document.getElementById('content-ticker')

  try {
    // Featured items first; fallback to announcements then news
    let items = []

    const featured = await api.get('/content?featured=1&limit=12')
    if (featured.items?.length) {
      items = featured.items
    } else {
      const [ann, news] = await Promise.all([
        api.get('/content?type=ANNOUNCEMENT&limit=8'),
        api.get('/content?type=NEWS&limit=6'),
      ])
      items = [...(ann.items || []), ...(news.items || [])]
    }

    if (!items.length) {
      track.innerHTML = '<span class="ticker-empty">No announcements yet. Check back soon!</span>'
      document.getElementById('ticker-outer').style.display = 'none'
      return
    }

    track.innerHTML = buildTickerHtml(items)

    // Adjust animation speed based on item count (more items = slower scroll)
    const duration = Math.max(20, items.length * 4)
    track.style.animationDuration = duration + 's'
  } catch {
    track.innerHTML = '<span class="ticker-empty">Could not load content.</span>'
  }
}

loadTicker()

// ── About section (CMS-fed) ───────────────────────────────────

async function loadAboutSection() {
  try {
    const res = await fetch('/api/site/about')
    if (!res.ok) return
    const data = await res.json()

    const aboutText = document.getElementById('about-text')
    if (aboutText && (data.mission || data.story)) {
      aboutText.textContent = data.mission || data.story
    }

    const serviceGrid = document.querySelector('.service-times')
    if (serviceGrid && data.serviceTimes?.length) {
      const icons = { Sunday: '⛪', Wednesday: '📖', Friday: '🙏' }
      serviceGrid.innerHTML = data.serviceTimes.map(s =>
        `<div class="service-card">
          <div class="service-icon">${icons[s.day] || '🕐'}</div>
          <div class="service-time-day">${s.day}</div>
          <div class="text-muted">${s.label ? s.label + ' · ' : ''}${s.time}</div>
        </div>`
      ).join('')
    }
  } catch {
    // Silently fall through — hardcoded copy remains visible
  }
}

loadAboutSection()

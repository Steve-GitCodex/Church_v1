import { toast, confirmDialog } from '../ui.js'
import { defaultCover } from '../defaultCover.js'

// ── State ─────────────────────────────────────────────────────
let _page = 1
let _hasMore = false
let _currentId = null
let _filterTimer = null
const PANEL_KEY = 'aicr_filter_collapsed'

// ── DOM refs ──────────────────────────────────────────────────
const grid         = document.getElementById('events-grid')
const loadMoreWrap = document.getElementById('load-more-wrap')
const loadMoreBtn  = document.getElementById('load-more-btn')
const emptyMsg     = document.getElementById('empty-msg')
const filterPanel  = document.getElementById('filter-panel')
const filterToggle = document.getElementById('filter-toggle-btn')
const categoryFilter = document.getElementById('category-filter')
const fromFilter   = document.getElementById('from-filter')
const toFilter     = document.getElementById('to-filter')
const clearBtn     = document.getElementById('clear-filters-btn')
const modal        = document.getElementById('detail-modal')
const detailContent = document.getElementById('detail-content')

// ── Helpers ───────────────────────────────────────────────────

function getToken() {
  return localStorage.getItem('accessToken')
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

async function apiFetch(path, options = {}) {
  const token = getToken()
  const res = await fetch('/api' + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status })
  return data
}

function buildParams(page) {
  const category = categoryFilter.value.trim()
  const from     = fromFilter.value
  const to       = toFilter.value

  const params = new URLSearchParams({ type: 'EVENT', sort: 'eventDate', limit: '12', page: String(page) })
  if (category) params.append('category', category)
  if (from)     params.append('from', new Date(from).toISOString())
  if (to)       params.append('to', new Date(to + 'T23:59:59').toISOString())
  return params
}

function cardHtml(item) {
  const dateStr = item.eventDate
    ? new Date(item.eventDate).toLocaleDateString('en-KE', { dateStyle: 'medium' })
    : item.publishedAt
      ? new Date(item.publishedAt).toLocaleDateString('en-KE', { dateStyle: 'medium' })
      : ''
  const rsvpPill = item.registrationOpen
    ? '<span class="content-card-rsvp-pill">RSVP Open</span>'
    : ''
  const pricePill = item.ticketPrice != null && Number(item.ticketPrice) > 0
    ? `<span class="content-card-price-pill">KES ${Number(item.ticketPrice).toLocaleString()}</span>`
    : '<span class="content-card-price-pill free">Free</span>'
  const imgSrc = item.imageUrl || defaultCover(item)
  const imgHtml = `<div class="content-card-img-wrap">
       <img src="${escHtml(imgSrc)}" alt="${escHtml(item.title)}" loading="lazy"
            onload="this.classList.add('loaded')">
     </div>`

  return `
    <article class="content-card" onclick="openDetail('${escHtml(item.id)}')">
      ${imgHtml}
      <div class="content-card-body">
        <div class="content-card-meta">
          <span class="content-card-type">Event</span>
          ${rsvpPill}
          ${pricePill}
        </div>
        <h3 class="content-card-title">${escHtml(item.title)}</h3>
        <div class="content-card-date">${dateStr}</div>
        ${item.location ? `<div class="content-card-date" style="margin-top:2px;">&#128205; ${escHtml(item.location)}</div>` : ''}
        ${item.category ? `<span class="content-card-category">${escHtml(item.category)}</span>` : ''}
      </div>
    </article>
  `
}

// ── Load events ───────────────────────────────────────────────

async function loadEvents(page = 1, append = false) {
  _page = page
  if (!append) {
    grid.innerHTML = `
      ${[1,2,3,4,5,6].map(() => `
        <article class="content-card">
          <div class="content-card-img-skeleton"></div>
          <div class="content-card-body">
            <div class="skeleton-line" style="width:40%;height:12px;margin-bottom:8px;"></div>
            <div class="skeleton-line" style="width:85%;height:18px;margin-bottom:6px;"></div>
            <div class="skeleton-line" style="width:55%;height:12px;"></div>
          </div>
        </article>
      `).join('')}
    `
    emptyMsg.style.display = 'none'
    loadMoreWrap.classList.add('hidden')
  }

  try {
    const res = await apiFetch('/content?' + buildParams(page).toString())

    if (!append) grid.innerHTML = ''

    if (!res.items.length && !append) {
      emptyMsg.style.display = 'block'
      loadMoreWrap.classList.add('hidden')
      return
    }

    grid.insertAdjacentHTML('beforeend', res.items.map(cardHtml).join(''))

    _hasMore = res.page < res.pages
    if (_hasMore) loadMoreWrap.classList.remove('hidden')
    else          loadMoreWrap.classList.add('hidden')
  } catch (err) {
    if (!append) grid.innerHTML = ''
    toast(err.message || 'Failed to load events', 'error')
  }
}

// ── Detail modal ──────────────────────────────────────────────

window.openDetail = async (id) => {
  _currentId = id
  detailContent.innerHTML = '<p class="text-muted">Loading…</p>'
  modal.classList.add('open')
  document.body.style.overflow = 'hidden'
  await renderDetail(id)
}

async function renderDetail(id) {
  try {
    const item = await apiFetch(`/content/${id}`)

    const startDate = item.eventDate
      ? new Date(item.eventDate).toLocaleString('en-KE', { dateStyle: 'long', timeStyle: 'short' })
      : null
    const endDate = item.eventEndDate
      ? new Date(item.eventEndDate).toLocaleString('en-KE', { timeStyle: 'short' })
      : null
    const dateStr = startDate
      ? (endDate ? `${startDate} – ${endDate}` : startDate)
      : item.publishedAt
        ? new Date(item.publishedAt).toLocaleDateString('en-KE', { dateStyle: 'long' })
        : ''

    let rsvpSection = ''
    if (item.registrationOpen) {
      const count = item.rsvpCount ?? 0
      if (!getToken()) {
        rsvpSection = `
          <div class="event-rsvp-bar">
            <span>${count} attendee${count !== 1 ? 's' : ''}</span>
            <a href="login.html" class="btn btn-primary btn-sm">Login to RSVP</a>
          </div>
        `
      } else if (item.isRegistered) {
        rsvpSection = `
          <div class="event-rsvp-bar">
            <span>${count} attendee${count !== 1 ? 's' : ''}</span>
            <span class="content-card-type" style="color:var(--color-success,#22c55e);">You're registered &#10003;</span>
            <button class="btn btn-outline btn-sm" id="rsvp-btn" onclick="handleCancelRsvp('${id}')" style="color:var(--color-danger)">Cancel RSVP</button>
          </div>
        `
      } else {
        rsvpSection = `
          <div class="event-rsvp-bar">
            <span>${count} attendee${count !== 1 ? 's' : ''}</span>
            <button class="btn btn-primary btn-sm" id="rsvp-btn" onclick="handleRsvp('${id}')">RSVP</button>
          </div>
        `
      }
    }

    detailContent.innerHTML = `
      <img class="content-detail-img" src="${escHtml(item.imageUrl || defaultCover(item))}" alt="${escHtml(item.title)}">
      <h2 style="font-size:1.4rem;font-weight:700;margin-bottom:0.5rem;">${escHtml(item.title)}</h2>
      <div class="content-detail-meta">
        <span>&#128197; ${dateStr}</span>
        ${item.location ? `<span>&#128205; ${escHtml(item.location)}</span>` : ''}
        <span>&#127915; ${item.ticketPrice != null && Number(item.ticketPrice) > 0 ? 'KES ' + Number(item.ticketPrice).toLocaleString() : 'Free'}</span>
        ${item.category ? `<span>${escHtml(item.category)}</span>` : ''}
        ${item.author?.name ? `<span>By ${escHtml(item.author.name)}</span>` : ''}
      </div>
      ${rsvpSection}
      <div class="content-detail-body">${item.body || ''}</div>
    `
  } catch (err) {
    detailContent.innerHTML = '<p class="text-muted">Failed to load event details.</p>'
    toast(err.message || 'Failed to load event', 'error')
  }
}

window.handleRsvp = async (id) => {
  const btn = document.getElementById('rsvp-btn')
  if (btn) { btn.disabled = true; btn.textContent = 'Registering…' }
  try {
    await apiFetch(`/content/${id}/rsvp`, { method: 'POST', body: {} })
    await renderDetail(id)
  } catch (err) {
    if (err.status === 401) { window.location.href = 'login.html'; return }
    if (btn) { btn.disabled = false; btn.textContent = 'RSVP' }
    toast(err.message || 'Failed to register', 'error')
  }
}

window.handleCancelRsvp = async (id) => {
  const confirmed = await confirmDialog({
    title: 'Cancel RSVP',
    message: 'Cancel your registration for this event?',
    confirmText: 'Yes, cancel',
    cancelText: 'Keep my spot',
    danger: true,
  })
  if (!confirmed) return
  const btn = document.getElementById('rsvp-btn')
  if (btn) { btn.disabled = true; btn.textContent = '…' }
  try {
    await apiFetch(`/content/${id}/rsvp`, { method: 'DELETE' })
    await renderDetail(id)
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Cancel RSVP' }
    toast(err.message || 'Failed to cancel', 'error')
  }
}

window.closeDetail = () => {
  modal.classList.remove('open')
  document.body.style.overflow = ''
  _currentId = null
}

modal.addEventListener('click', (e) => {
  if (e.target === e.currentTarget) window.closeDetail()
})

// ── Nav login button ──────────────────────────────────────────

const loginBtn = document.getElementById('nav-login-btn')
if (loginBtn && localStorage.getItem('accessToken')) {
  loginBtn.textContent = 'Dashboard'
  loginBtn.href = 'dashboard.html'
}

// ── Scroll to top ─────────────────────────────────────────────

const scrollTopBtn = document.getElementById('scroll-top-btn')
window.addEventListener('scroll', () => {
  scrollTopBtn.classList.toggle('hidden', window.scrollY < 400)
}, { passive: true })
scrollTopBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }))

// ── Collapsible filter panel ──────────────────────────────────

function applyPanelState(collapsed) {
  if (collapsed) filterPanel.classList.add('collapsed')
  else           filterPanel.classList.remove('collapsed')
  filterToggle.style.transform = collapsed ? 'rotate(180deg)' : ''
}

applyPanelState(localStorage.getItem(PANEL_KEY) === '1')

filterToggle.addEventListener('click', () => {
  const collapsed = !filterPanel.classList.contains('collapsed')
  applyPanelState(collapsed)
  localStorage.setItem(PANEL_KEY, collapsed ? '1' : '0')
})

// ── Filter listeners ──────────────────────────────────────────

clearBtn.addEventListener('click', () => {
  categoryFilter.value = ''
  fromFilter.value = ''
  toFilter.value = ''
  loadEvents(1)
})
;[categoryFilter, fromFilter, toFilter].forEach(el => {
  el.addEventListener('input', () => {
    clearTimeout(_filterTimer)
    _filterTimer = setTimeout(() => loadEvents(1), 400)
  })
})

loadMoreBtn.addEventListener('click', () => loadEvents(_page + 1, true))

// ── Footer year ───────────────────────────────────────────────

const yearEl = document.getElementById('footer-year')
if (yearEl) yearEl.textContent = new Date().getFullYear()

// ── Boot ──────────────────────────────────────────────────────
const _openId = new URLSearchParams(location.search).get('open')
loadEvents(1).then(() => {
  if (_openId) window.openDetail(_openId)
})

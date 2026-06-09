import { toast } from '../ui.js'
import { defaultCover } from '../defaultCover.js'

// ── State ─────────────────────────────────────────────────────
let _page = 1
let _hasMore = false
let _filterTimer = null
const PANEL_KEY = 'aicr_filter_collapsed'

// ── DOM refs ──────────────────────────────────────────────────
const grid        = document.getElementById('news-grid')
const loadMoreWrap = document.getElementById('load-more-wrap')
const loadMoreBtn  = document.getElementById('load-more-btn')
const emptyMsg    = document.getElementById('empty-msg')
const filterPanel = document.getElementById('filter-panel')
const filterToggle = document.getElementById('filter-toggle-btn')
const typeFilter  = document.getElementById('type-filter')
const categoryFilter = document.getElementById('category-filter')
const fromFilter  = document.getElementById('from-filter')
const toFilter    = document.getElementById('to-filter')
const clearBtn    = document.getElementById('clear-filters-btn')

// ── Helpers ───────────────────────────────────────────────────

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  return res.json()
}

function buildParams(page) {
  const type     = typeFilter.value
  const category = categoryFilter.value.trim()
  const from     = fromFilter.value
  const to       = toFilter.value

  const params = new URLSearchParams({ limit: '12', page: String(page) })
  if (type) params.append('type', type)
  else      { params.append('type', 'NEWS'); params.append('type', 'ANNOUNCEMENT') }
  if (category) params.append('category', category)
  if (from)     params.append('from', new Date(from).toISOString())
  if (to)       params.append('to', new Date(to + 'T23:59:59').toISOString())
  return params
}

function cardHtml(item) {
  const typeLabel = item.type === 'ANNOUNCEMENT' ? 'Announcement' : 'News'
  const dateStr   = item.publishedAt
    ? new Date(item.publishedAt).toLocaleDateString('en-KE', { dateStyle: 'medium' })
    : ''
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
          <span class="content-card-type">${typeLabel}</span>
        </div>
        <h3 class="content-card-title">${escHtml(item.title)}</h3>
        <div class="content-card-date">${dateStr}</div>
        ${item.category ? `<span class="content-card-category">${escHtml(item.category)}</span>` : ''}
      </div>
    </article>
  `
}

// ── Load news ─────────────────────────────────────────────────

async function loadNews(page = 1, append = false) {
  _page = page
  if (!append) {
    grid.innerHTML = `
      ${[1,2,3,4,5,6].map(() => `
        <article class="content-card">
          <div class="content-card-img-skeleton"></div>
          <div class="content-card-body">
            <div class="skeleton-line" style="width:60%;height:12px;margin-bottom:8px;"></div>
            <div class="skeleton-line" style="width:90%;height:18px;margin-bottom:6px;"></div>
            <div class="skeleton-line" style="width:40%;height:12px;"></div>
          </div>
        </article>
      `).join('')}
    `
    emptyMsg.style.display = 'none'
    loadMoreWrap.classList.add('hidden')
  }

  try {
    const res = await fetchJson('/api/content?' + buildParams(page).toString())

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
    toast(err.message || 'Failed to load news', 'error')
  }
}

// ── Detail modal ──────────────────────────────────────────────

const modal   = document.getElementById('detail-modal')
const detailContent = document.getElementById('detail-content')

window.openDetail = async (id) => {
  detailContent.innerHTML = '<p class="text-muted">Loading…</p>'
  modal.classList.add('open')
  document.body.style.overflow = 'hidden'

  try {
    const item = await fetchJson(`/api/content/${id}`)
    const dateStr = item.publishedAt
      ? new Date(item.publishedAt).toLocaleDateString('en-KE', { dateStyle: 'long' })
      : ''

    detailContent.innerHTML = `
      <img class="content-detail-img" src="${escHtml(item.imageUrl || defaultCover(item))}" alt="${escHtml(item.title)}">
      <h2 style="font-size:1.4rem;font-weight:700;margin-bottom:0.5rem;">${escHtml(item.title)}</h2>
      <div class="content-detail-meta">
        <span>${dateStr}</span>
        ${item.category ? `<span>${escHtml(item.category)}</span>` : ''}
        ${item.author?.name ? `<span>By ${escHtml(item.author.name)}</span>` : ''}
      </div>
      <div class="content-detail-body">${item.body || ''}</div>
    `
  } catch (err) {
    detailContent.innerHTML = '<p class="text-muted">Failed to load content.</p>'
    toast(err.message || 'Failed to load article', 'error')
  }
}

window.closeDetail = () => {
  modal.classList.remove('open')
  document.body.style.overflow = ''
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

function applyPanelState(collapsed, animate = false) {
  if (collapsed) {
    filterPanel.classList.add('collapsed')
  } else {
    filterPanel.classList.remove('collapsed')
  }
  filterToggle.style.transform = collapsed ? 'rotate(180deg)' : ''
}

const panelCollapsed = localStorage.getItem(PANEL_KEY) === '1'
applyPanelState(panelCollapsed)

filterToggle.addEventListener('click', () => {
  const collapsed = !filterPanel.classList.contains('collapsed')
  applyPanelState(collapsed)
  localStorage.setItem(PANEL_KEY, collapsed ? '1' : '0')
})

// ── Filter listeners ──────────────────────────────────────────

typeFilter.addEventListener('change', () => loadNews(1))
clearBtn.addEventListener('click', () => {
  typeFilter.value = ''
  categoryFilter.value = ''
  fromFilter.value = ''
  toFilter.value = ''
  loadNews(1)
})
;[categoryFilter, fromFilter, toFilter].forEach(el => {
  el.addEventListener('input', () => {
    clearTimeout(_filterTimer)
    _filterTimer = setTimeout(() => loadNews(1), 400)
  })
})

loadMoreBtn.addEventListener('click', () => loadNews(_page + 1, true))

// ── Footer year ───────────────────────────────────────────────

const yearEl = document.getElementById('footer-year')
if (yearEl) yearEl.textContent = new Date().getFullYear()

// ── Boot ──────────────────────────────────────────────────────
const _openId = new URLSearchParams(location.search).get('open')
loadNews(1).then(() => {
  if (_openId) window.openDetail(_openId)
})

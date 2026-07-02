import { api } from '../api.js'
import { toast, confirmDialog } from '../ui.js'
import { hasPermission } from '../auth.js'
import { defaultCover } from '../defaultCover.js'
import { escHtml, skeletonRows, setRailBadge, registerContentBadgePoll } from './core.js'

let _newsPage          = 1
let _newsHasMore       = false
let _eventsPage        = 1
let _eventsHasMore     = false
let _contentAdminPage  = 1
let _contentAdminHasMore = false
let _contentEditId     = null  // null = create, string = edit

// Badge polling: fetch unseen counts and update nav badges
async function refreshContentBadges() {
  try {
    const counts = await api.get('/content/unseen-counts')
    setRailBadge('news-badge', counts.news || 0)
    setRailBadge('events-badge', counts.events || 0)
    setRailBadge('updates-badge', (counts.news || 0) + (counts.events || 0))
  } catch {}
}

function startContentBadgePoll() {
  refreshContentBadges()
  setInterval(refreshContentBadges, 60_000)
}
registerContentBadgePoll(startContentBadgePoll)

// ── News section (all roles) ──────────────────────────────────

export async function loadNews(page = 1, append = false) {
  _newsPage = page
  const container = document.getElementById('news-list')
  const loadMore  = document.getElementById('news-load-more')
  if (!append) container.innerHTML = skeletonRows(3)

  try {
    const type     = document.getElementById('news-type-filter').value
    const category = document.getElementById('news-category-filter').value.trim()
    const from     = document.getElementById('news-from-filter').value
    const to       = document.getElementById('news-to-filter').value
    const unseen   = document.getElementById('news-unseen-filter').checked ? '1' : ''

    const params = new URLSearchParams({ limit: '12', page: String(page) })
    if (type)     params.append('type', type)
    else          { params.append('type', 'NEWS'); params.append('type', 'ANNOUNCEMENT') }
    if (category) params.append('category', category)
    if (from)     params.append('from', new Date(from).toISOString())
    if (to)       params.append('to', new Date(to + 'T23:59:59').toISOString())
    if (unseen)   params.append('unseen', '1')

    const res = await api.get('/content?' + params.toString())

    if (!res.items.length && !append) {
      container.innerHTML = '<p class="text-muted">No news found.</p>'
      loadMore?.classList.add('hidden')
      return
    }

    const html = res.items.map(item => contentCard(item)).join('')
    if (append) container.insertAdjacentHTML('beforeend', html)
    else        container.innerHTML = html

    _newsHasMore = res.page < res.pages
    loadMore?.classList.toggle('hidden', !_newsHasMore)
  } catch {
    if (!append) container.innerHTML = '<p class="text-muted">Failed to load news.</p>'
  }
}

window.loadMoreNews = () => loadNews(_newsPage + 1, true)

let _newsFilterTimer = null

// ── Events section ────────────────────────────────────────────

export async function loadEvents(page = 1, append = false) {
  _eventsPage = page
  const container = document.getElementById('events-list')
  const loadMore  = document.getElementById('events-load-more')
  if (!append) container.innerHTML = skeletonRows(3)

  try {
    const category = document.getElementById('events-category-filter')?.value.trim() || ''
    const from     = document.getElementById('events-from-filter')?.value || ''
    const to       = document.getElementById('events-to-filter')?.value || ''
    const unseen   = document.getElementById('events-unseen-filter')?.checked ? '1' : ''

    const params = new URLSearchParams({ type: 'EVENT', sort: 'eventDate', limit: '12', page: String(page) })
    if (category) params.append('category', category)
    if (from)     params.append('from', new Date(from).toISOString())
    if (to)       params.append('to', new Date(to + 'T23:59:59').toISOString())
    if (unseen)   params.append('unseen', '1')

    const res = await api.get('/content?' + params.toString())

    if (!res.items.length && !append) {
      container.innerHTML = '<p class="text-muted">No upcoming events.</p>'
      loadMore?.classList.add('hidden')
      return
    }

    const html = res.items.map(item => contentCard(item)).join('')
    if (append) container.insertAdjacentHTML('beforeend', html)
    else        container.innerHTML = html

    _eventsHasMore = res.page < res.pages
    loadMore?.classList.toggle('hidden', !_eventsHasMore)
  } catch {
    if (!append) container.innerHTML = '<p class="text-muted">Failed to load events.</p>'
  }
}

window.loadMoreEvents = () => loadEvents(_eventsPage + 1, true)

let _eventsFilterTimer = null

// Wires the news/events tab-panels — called once, right after updates.html is injected.
export function wireUpdatesPanel() {
  ;['news-type-filter', 'news-unseen-filter'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => loadNews(1))
  })
  ;['news-category-filter', 'news-from-filter', 'news-to-filter'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      clearTimeout(_newsFilterTimer)
      _newsFilterTimer = setTimeout(() => loadNews(1), 400)
    })
  })
  ;['events-unseen-filter'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => loadEvents(1))
  })
  ;['events-category-filter', 'events-from-filter', 'events-to-filter'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      clearTimeout(_eventsFilterTimer)
      _eventsFilterTimer = setTimeout(() => loadEvents(1), 400)
    })
  })
}

// ── Content card renderer (shared news + events member view) ──

function contentCard(item) {
  const typeLabel = item.type === 'ANNOUNCEMENT' ? 'Announcement' : item.type === 'EVENT' ? 'Event' : 'News'
  const dateStr   = item.eventDate
    ? new Date(item.eventDate).toLocaleDateString('en-KE', { dateStyle: 'medium' })
    : item.publishedAt
      ? new Date(item.publishedAt).toLocaleDateString('en-KE', { dateStyle: 'medium' })
      : ''
  const newPill  = item.isNew ? '<span class="content-card-new-pill">NEW</span>' : ''
  const rsvpPill = item.type === 'EVENT' && item.registrationOpen
    ? `<span class="content-card-new-pill" style="background:var(--color-success,#22c55e);color:#fff;">RSVP Open</span>`
    : ''
  const pricePill = item.type === 'EVENT'
    ? (item.ticketPrice != null && Number(item.ticketPrice) > 0
        ? `<span class="content-card-new-pill" style="background:var(--color-primary);color:#fff;">KES ${Number(item.ticketPrice).toLocaleString()}</span>`
        : `<span class="content-card-new-pill" style="background:var(--color-border);color:var(--color-text-muted);">Free</span>`)
    : ''
  const img = `<img class="content-card-img" src="${escHtml(item.imageUrl || defaultCover(item))}" alt="${escHtml(item.title)}" loading="lazy">`
  const locationLine = item.type === 'EVENT' && item.location
    ? `<div class="content-card-date" style="margin-top:2px;">📍 ${escHtml(item.location)}</div>`
    : ''

  return `
    <article class="content-card-item" onclick="openNewsDetail('${escHtml(item.id)}')">
      ${img}
      <div class="content-card-body">
        <div class="content-card-meta">
          <span class="content-card-type">${typeLabel}</span>
          ${newPill}
          ${rsvpPill}
          ${pricePill}
        </div>
        <h3 class="content-card-title">${escHtml(item.title)}</h3>
        <div class="content-card-date">${dateStr}</div>
        ${locationLine}
        ${item.category ? `<span class="content-card-category">${escHtml(item.category)}</span>` : ''}
      </div>
    </article>
  `
}

// ── News detail modal ─────────────────────────────────────────

window.openNewsDetail = async (id) => {
  const modal   = document.getElementById('news-detail-modal')
  const content = document.getElementById('news-detail-content')
  content.innerHTML = '<p class="text-muted">Loading…</p>'
  modal.classList.add('open')

  try {
    const item = await api.get(`/content/${id}`)

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

    const locationHtml = item.location ? `<span>📍 ${escHtml(item.location)}</span>` : ''
    const authorName   = item.author?.name || ''

    let rsvpSection = ''
    if (item.type === 'EVENT' && item.registrationOpen) {
      const count   = item.rsvpCount ?? 0
      const btnHtml = item.isRegistered
        ? `<button class="btn btn-outline btn-sm" onclick="cancelRsvpEvent('${id}', this)" style="color:var(--color-danger)">Cancel RSVP</button>`
        : `<button class="btn btn-primary btn-sm" onclick="rsvpEvent('${id}', this)">RSVP</button>`
      rsvpSection = `
        <div class="detail-rsvp-section" style="display:flex;align-items:center;gap:var(--space-md);margin:var(--space-lg) 0;padding:var(--space-md);background:var(--color-bg);border-radius:var(--radius-md);border:1px solid var(--color-border);">
          <span style="font-size:var(--font-size-sm);color:var(--color-text-muted);">${count} attendee${count !== 1 ? 's' : ''}</span>
          ${btnHtml}
        </div>
      `
    } else if (item.type === 'EVENT' && !item.registrationOpen) {
      rsvpSection = `<p style="margin:var(--space-md) 0;font-size:var(--font-size-sm);color:var(--color-text-muted);">Registration is not required for this event.</p>`
    }

    content.innerHTML = `
      <img class="content-detail-img" src="${escHtml(item.imageUrl || defaultCover(item))}" alt="${escHtml(item.title)}">
      <h2 style="font-size:var(--font-size-xl);font-weight:700;margin-bottom:var(--space-sm);">${escHtml(item.title)}</h2>
      <div class="content-detail-meta">
        <span>${dateStr}</span>
        ${locationHtml}
        ${item.category ? `<span>${escHtml(item.category)}</span>` : ''}
        ${authorName ? `<span>By ${escHtml(authorName)}</span>` : ''}
      </div>
      ${rsvpSection}
      <div class="content-detail-body">${item.body}</div>
    `

    // Mark this item as read and refresh unseen badges
    api.post(`/content/${id}/read`).then(() => refreshContentBadges()).catch(() => {})

    // Strip NEW pill from the card in the list
    document.querySelectorAll(`.content-card-item[onclick*="${id}"] .content-card-new-pill`).forEach(el => {
      if (el.textContent === 'NEW') el.remove()
    })
  } catch {
    content.innerHTML = '<p class="text-muted">Failed to load content.</p>'
  }
}

window.rsvpEvent = async (id, btn) => {
  btn.disabled = true; btn.textContent = 'Registering…'
  try {
    await api.post(`/content/${id}/rsvp`)
    toast('You\'re registered!', 'success')
    window.openNewsDetail(id)  // reload detail with updated state
  } catch (err) {
    btn.disabled = false; btn.textContent = 'RSVP'
    toast(err.message || 'Failed to register', 'danger')
  }
}

window.cancelRsvpEvent = async (id, btn) => {
  const ok = await confirmDialog({ title: 'Cancel RSVP?', message: 'Remove your registration for this event?', confirmText: 'Cancel RSVP', danger: true })
  if (!ok) return
  btn.disabled = true; btn.textContent = '…'
  try {
    await api.delete(`/content/${id}/rsvp`)
    toast('Registration cancelled', 'success')
    window.openNewsDetail(id)  // reload detail with updated state
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Cancel RSVP'
    toast(err.message || 'Failed to cancel', 'danger')
  }
}

window.closeNewsDetailModal = () => {
  document.getElementById('news-detail-modal').classList.remove('open')
}

document.getElementById('news-detail-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) window.closeNewsDetailModal()
})

// ── Admin content management ──────────────────────────────────

let _contentAdminTypeFilter   = ''
let _contentAdminStatusFilter = ''
let _contentAdminFilterTimer  = null

// Wires the content (posts) tab-panel — called once, right after content.html is injected.
export function wireContentPanel() {
  document.getElementById('content-type-seg')?.addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn')
    if (!btn) return
    document.querySelectorAll('#content-type-seg .seg-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    _contentAdminTypeFilter = btn.dataset.value
    loadContentAdmin(1)
  })
  document.getElementById('content-status-seg')?.addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn')
    if (!btn) return
    document.querySelectorAll('#content-status-seg .seg-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    _contentAdminStatusFilter = btn.dataset.value
    loadContentAdmin(1)
  })
  document.getElementById('content-admin-search')?.addEventListener('input', () => {
    clearTimeout(_contentAdminFilterTimer)
    _contentAdminFilterTimer = setTimeout(() => loadContentAdmin(1), 400)
  })
  ;['content-admin-category-filter', 'content-admin-from-filter', 'content-admin-to-filter'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      clearTimeout(_contentAdminFilterTimer)
      _contentAdminFilterTimer = setTimeout(() => loadContentAdmin(1), 400)
    })
  })
}

export async function loadContentAdmin(page = 1, append = false) {
  _contentAdminPage = page
  const container = document.getElementById('content-admin-list')
  const loadMore  = document.getElementById('content-admin-load-more')
  const countEl   = document.getElementById('content-admin-count')
  if (!append) container.innerHTML = skeletonRows()

  try {
    const params = new URLSearchParams({ limit: '20', page: String(page) })
    if (_contentAdminTypeFilter)   params.append('type', _contentAdminTypeFilter)
    if (_contentAdminStatusFilter) params.append('status', _contentAdminStatusFilter)
    const q        = document.getElementById('content-admin-search')?.value.trim()
    const category = document.getElementById('content-admin-category-filter')?.value.trim()
    const from     = document.getElementById('content-admin-from-filter')?.value
    const to       = document.getElementById('content-admin-to-filter')?.value
    if (q)        params.append('q', q)
    if (category) params.append('category', category)
    if (from)     params.append('from', new Date(from).toISOString())
    if (to)       params.append('to', new Date(to + 'T23:59:59').toISOString())

    const res = await api.get('/content/manage?' + params.toString())

    if (countEl) countEl.textContent = res.total ? `${res.total} item${res.total !== 1 ? 's' : ''}` : ''

    if (!res.items.length && !append) {
      container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">No content found.</p>'
      loadMore?.classList.add('hidden')
      return
    }

    const statusBadge = (s) => {
      const cls = s === 'PUBLISHED' ? 'badge-active' : s === 'ARCHIVED' ? 'badge-inactive' : 'badge-warning'
      return `<span class="badge ${cls}">${s.charAt(0) + s.slice(1).toLowerCase()}</span>`
    }

    const rows = res.items.map(item => {
      // manageEvents-only staff can only mutate EVENT items; all others can mutate everything
      const canMutate = hasPermission('manageContent') || item.type === 'EVENT'
      return `
      <tr>
        <td class="content-admin-title-cell" data-label="Title">${escHtml(item.title)}</td>
        <td data-label="Type"><span class="content-type-chip content-type-${item.type.toLowerCase()}">${item.type.charAt(0) + item.type.slice(1).toLowerCase()}</span></td>
        <td data-label="Category">${item.category ? escHtml(item.category) : '—'}</td>
        <td data-label="Status">${statusBadge(item.status)}</td>
        <td data-label="Date" style="white-space:nowrap;">${item.publishedAt ? new Date(item.publishedAt).toLocaleDateString('en-KE') : new Date(item.createdAt).toLocaleDateString('en-KE')}</td>
        <td data-label="">
          <div class="action-btns">
            ${canMutate && item.status === 'PUBLISHED' ? `<button class="btn btn-sm btn-outline${item.isFeatured ? ' btn-featured' : ''}" title="${item.isFeatured ? 'Remove from homepage ticker' : 'Feature on homepage ticker'}" onclick="toggleFeatureItem('${item.id}', this)">${item.isFeatured ? '★' : '☆'}</button>` : ''}
            ${canMutate && item.status !== 'ARCHIVED' ? `<button class="btn btn-sm btn-outline" onclick="openContentEditModal('${item.id}')">Edit</button>` : ''}
            ${canMutate && item.status === 'DRAFT'    ? `<button class="btn btn-sm btn-outline" onclick="publishContentItem('${item.id}', this)">Publish</button>` : ''}
            ${canMutate && item.status === 'ARCHIVED' ? `<button class="btn btn-sm btn-outline" onclick="restoreContentItem('${item.id}', this)">Restore</button>` : ''}
            ${item.type === 'EVENT'                   ? `<button class="btn btn-sm btn-outline" onclick="openAttendeesModal('${item.id}', ${JSON.stringify(item.title)})">Attendees (${item.registrationCount})</button>` : ''}
            ${canMutate && item.status !== 'ARCHIVED' ? `<button class="btn btn-sm btn-outline" style="color:var(--color-danger)" onclick="archiveContentItem('${item.id}', this)">Archive</button>` : ''}
          </div>
        </td>
      </tr>
    `}).join('')

    if (append) {
      container.querySelector('tbody')?.insertAdjacentHTML('beforeend', rows)
    } else {
      container.innerHTML = `
        <table class="table-stack">
          <thead><tr><th>Title</th><th>Type</th><th>Category</th><th>Status</th><th>Date</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `
    }

    _contentAdminHasMore = res.page < res.pages
    loadMore?.classList.toggle('hidden', !_contentAdminHasMore)
  } catch {
    if (!append) container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">Failed to load content.</p>'
  }
}

window.loadMoreContentAdmin = () => loadContentAdmin(_contentAdminPage + 1, true)

window.toggleFeatureItem = async (id, btn) => {
  btn.disabled = true
  try {
    const res = await api.post(`/content/${id}/feature`)
    btn.textContent = res.isFeatured ? '★' : '☆'
    btn.title = res.isFeatured ? 'Remove from homepage ticker' : 'Feature on homepage ticker'
    btn.classList.toggle('btn-featured', res.isFeatured)
  } catch (err) {
    toast(err.message || 'Failed to update', 'error')
  } finally {
    btn.disabled = false
  }
}

// ── Content create/edit modal ─────────────────────────────────

document.getElementById('content-type-input')?.addEventListener('change', () => {
  const isEvent = document.getElementById('content-type-input').value === 'EVENT'
  document.getElementById('event-fields').style.display = isEvent ? '' : 'none'
})

document.querySelectorAll('.rte-btn[data-cmd]').forEach(btn => {
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault()  // prevent blur on editor
    document.execCommand(btn.dataset.cmd, false, null)
    document.getElementById('content-body-editor')?.focus()
  })
})

let _rteSavedRange = null

document.getElementById('rte-link-btn')?.addEventListener('mousedown', (e) => {
  e.preventDefault()
  const sel = document.getSelection()
  _rteSavedRange = sel?.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null
  const row = document.getElementById('rte-link-row')
  const input = document.getElementById('rte-link-input')
  row.classList.remove('hidden')
  input.value = ''
  input.focus()
})

function _applyRteLink() {
  const url = document.getElementById('rte-link-input').value.trim()
  if (url && _rteSavedRange) {
    const sel = document.getSelection()
    sel.removeAllRanges()
    sel.addRange(_rteSavedRange)
    document.execCommand('createLink', false, url)
  }
  document.getElementById('rte-link-row').classList.add('hidden')
  document.getElementById('content-body-editor')?.focus()
  _rteSavedRange = null
}

document.getElementById('rte-link-confirm')?.addEventListener('click', _applyRteLink)

document.getElementById('rte-link-cancel')?.addEventListener('click', () => {
  document.getElementById('rte-link-row').classList.add('hidden')
  document.getElementById('content-body-editor')?.focus()
  _rteSavedRange = null
})

document.getElementById('rte-link-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); _applyRteLink() }
  if (e.key === 'Escape') {
    document.getElementById('rte-link-row').classList.add('hidden')
    document.getElementById('content-body-editor')?.focus()
    _rteSavedRange = null
  }
})

function _contentFormSnapshot() {
  return JSON.stringify({
    type: document.getElementById('content-type-input').value,
    category: document.getElementById('content-category-input').value,
    title: document.getElementById('content-title-input').value,
    body: document.getElementById('content-body-editor').innerHTML,
    imageUrl: document.getElementById('content-imageurl-input').value,
    eventDate: document.getElementById('content-eventdate-input').value,
    eventEndDate: document.getElementById('content-eventenddate-input').value,
    location: document.getElementById('content-location-input').value,
    maxAttendees: document.getElementById('content-maxattendees-input').value,
    ticketPrice: document.getElementById('content-ticketprice-input').value,
    regOpen: document.getElementById('content-regopen-input').checked,
  })
}

let _contentModalSnapshot = null

async function _confirmDiscardContentChanges() {
  if (_contentModalSnapshot === null || _contentFormSnapshot() === _contentModalSnapshot) return true
  return confirmDialog({
    title: 'Discard changes?',
    message: 'You have unsaved changes to this post. Closing now will lose them.',
    confirmText: 'Discard',
    danger: true,
  })
}

window.openContentCreateModal = () => {
  _contentEditId = null
  document.getElementById('content-modal-title').textContent = 'New Post'
  document.getElementById('content-modal-alert').className = 'hidden'
  const eventsOnly = !hasPermission('manageContent') && hasPermission('manageEvents')
  const typeInput = document.getElementById('content-type-input')
  typeInput.value = eventsOnly ? 'EVENT' : 'NEWS'
  typeInput.disabled = eventsOnly
  document.getElementById('content-category-input').value = ''
  document.getElementById('content-title-input').value = ''
  document.getElementById('content-body-editor').innerHTML = ''
  document.getElementById('content-imageurl-input').value = ''
  document.getElementById('content-upload-status').textContent = ''
  document.getElementById('event-fields').style.display = eventsOnly ? '' : 'none'
  document.getElementById('content-eventdate-input').value = ''
  document.getElementById('content-eventenddate-input').value = ''
  document.getElementById('content-location-input').value = ''
  document.getElementById('content-maxattendees-input').value = ''
  document.getElementById('content-ticketprice-input').value = ''
  document.getElementById('content-regopen-input').checked = false
  document.getElementById('content-save-btn').textContent = 'Save Draft'
  document.getElementById('content-publish-btn').style.display = 'none'
  document.getElementById('content-modal').classList.add('open')
  _contentModalSnapshot = _contentFormSnapshot()
}

window.openContentEditModal = async (id) => {
  _contentEditId = id
  _contentModalSnapshot = null
  document.getElementById('content-modal-title').textContent = 'Edit Post'
  document.getElementById('content-modal-alert').className = 'hidden'
  document.getElementById('content-modal').classList.add('open')

  try {
    const item = await api.get(`/content/${id}`)
    const typeInput = document.getElementById('content-type-input')
    typeInput.value    = item.type
    typeInput.disabled = false  // editing an existing item — type is read-only by fact, not by lock
    document.getElementById('content-category-input').value  = item.category || ''
    document.getElementById('content-title-input').value     = item.title
    document.getElementById('content-body-editor').innerHTML = item.body || ''
    document.getElementById('content-imageurl-input').value  = item.imageUrl || ''

    const isEvent = item.type === 'EVENT'
    document.getElementById('event-fields').style.display = isEvent ? '' : 'none'
    if (isEvent) {
      document.getElementById('content-eventdate-input').value    = item.eventDate ? item.eventDate.slice(0, 16) : ''
      document.getElementById('content-eventenddate-input').value = item.eventEndDate ? item.eventEndDate.slice(0, 16) : ''
      document.getElementById('content-location-input').value     = item.location || ''
      document.getElementById('content-maxattendees-input').value = item.maxAttendees || ''
      document.getElementById('content-ticketprice-input').value  = item.ticketPrice != null ? Number(item.ticketPrice) : ''
      document.getElementById('content-regopen-input').checked    = item.registrationOpen || false
    }

    document.getElementById('content-save-btn').textContent = 'Save Changes'
    const publishBtn = document.getElementById('content-publish-btn')
    publishBtn.style.display = item.status === 'DRAFT' ? '' : 'none'
    _contentModalSnapshot = _contentFormSnapshot()
  } catch (err) {
    document.getElementById('content-modal').classList.remove('open')
    _contentEditId = null
    toast('Failed to load content: ' + (err.message || 'Unknown error'), 'danger')
  }
}

function _closeContentModalForce() {
  document.getElementById('content-modal').classList.remove('open')
  _contentEditId = null
  _contentModalSnapshot = null
}

window.closeContentModal = async () => {
  if (!(await _confirmDiscardContentChanges())) return
  _closeContentModalForce()
}

document.getElementById('content-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) window.closeContentModal()
})

// ── Attendees modal ───────────────────────────────────────────

let _attendeesEventId = null, _attendeesTitle = '', _attendeesPrice = 0

function attendeeRow(r, isPaid) {
  const paid = !!r.paidAt
  const payCell = isPaid ? `<td data-label="Payment">${
    paid
      ? `<span class="badge badge-active">Paid · KES ${Number(r.amountPaid).toLocaleString()}</span> <button class="btn btn-sm btn-ghost" onclick="unpayTicket('${r.userId}')">Unpay</button>`
      : `<button class="btn btn-sm btn-outline" onclick="showPayForm(this,'${r.userId}')">Mark Paid</button>`
  }</td>` : ''
  return `<tr>
      <td data-label="Name">${escHtml(r.name)}</td>
      <td data-label="Email">${escHtml(r.email)}</td>
      <td data-label="Phone">${r.phone ? escHtml(r.phone) : '—'}</td>
      ${payCell}
      <td data-label="Registered" style="white-space:nowrap;">${new Date(r.registeredAt).toLocaleDateString('en-KE')}</td>
    </tr>`
}

window.openAttendeesModal = async (id, title) => {
  const modal = document.getElementById('attendees-modal')
  const titleEl = document.getElementById('attendees-modal-title')
  const listEl  = document.getElementById('attendees-list')
  _attendeesEventId = id
  _attendeesTitle = title
  titleEl.textContent = `Attendees — ${title}`
  listEl.innerHTML = '<p class="text-muted">Loading…</p>'
  modal.classList.add('open')

  try {
    const data = await api.get(`/content/${id}/registrations`)
    const price = data.ticketPrice != null ? Number(data.ticketPrice) : 0
    _attendeesPrice = price
    const isPaid = price > 0

    if (!data.count) {
      listEl.innerHTML = '<p class="text-muted">No registrations yet.</p>'
      return
    }

    const summary = isPaid
      ? `${data.count} attendee${data.count !== 1 ? 's' : ''} · Ticket KES ${price.toLocaleString()} · Paid ${data.summary.paidCount}/${data.count} · Collected KES ${data.summary.collected.toLocaleString()}`
      : `${data.count} attendee${data.count !== 1 ? 's' : ''} · Free event`

    listEl.innerHTML = `
      <p style="margin-bottom:var(--space-sm);font-size:var(--font-size-sm);color:var(--color-text-muted);">${summary}</p>
      <table class="table-stack">
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th>${isPaid ? '<th>Payment</th>' : ''}<th>Registered</th></tr></thead>
        <tbody>
          ${data.registrations.map(r => attendeeRow(r, isPaid)).join('')}
        </tbody>
      </table>
    `
  } catch (err) {
    listEl.innerHTML = '<p class="text-muted">Failed to load attendees.</p>'
  }
}

window.showPayForm = (btn, userId) => {
  btn.closest('td').innerHTML = `
    <div class="ticket-pay-form">
      <input class="form-input form-input-sm" type="number" min="0" step="0.01" value="${_attendeesPrice || ''}" id="pay-amt-${userId}" style="width:90px">
      <select class="form-select form-input-sm" id="pay-method-${userId}" style="width:auto">
        <option value="CASH">Cash</option>
        <option value="MPESA">M-Pesa</option>
        <option value="BANK_TRANSFER">Bank</option>
        <option value="CARD">Card</option>
        <option value="OTHER">Other</option>
      </select>
      <input class="form-input form-input-sm" type="text" placeholder="Ref" id="pay-ref-${userId}" style="width:80px">
      <button class="btn btn-sm btn-primary" onclick="confirmPay('${userId}')">Save</button>
    </div>`
}

window.confirmPay = async (userId) => {
  const amount = parseFloat(document.getElementById(`pay-amt-${userId}`).value)
  const method = document.getElementById(`pay-method-${userId}`).value
  const reference = document.getElementById(`pay-ref-${userId}`).value.trim() || null
  if (!Number.isFinite(amount) || amount < 0) { toast('Enter a valid amount', 'danger'); return }
  try {
    await api.post(`/content/${_attendeesEventId}/registrations/${userId}/pay`, { amount, method, reference })
    window.openAttendeesModal(_attendeesEventId, _attendeesTitle)
  } catch (err) { toast(err.message || 'Failed to record payment', 'danger') }
}

window.unpayTicket = async (userId) => {
  try {
    await api.post(`/content/${_attendeesEventId}/registrations/${userId}/unpay`, {})
    window.openAttendeesModal(_attendeesEventId, _attendeesTitle)
  } catch (err) { toast(err.message || 'Failed to update', 'danger') }
}

window.closeAttendeesModal = () => {
  document.getElementById('attendees-modal').classList.remove('open')
}

document.getElementById('attendees-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) window.closeAttendeesModal()
})

window.saveContent = async () => {
  const btn     = document.getElementById('content-save-btn')
  const alertEl = document.getElementById('content-modal-alert')
  btn.disabled = true; btn.textContent = 'Saving…'
  alertEl.className = 'hidden'

  const type = document.getElementById('content-type-input').value

  const body = {
    type,
    title:    document.getElementById('content-title-input').value.trim(),
    body:     document.getElementById('content-body-editor').innerHTML,
    imageUrl: document.getElementById('content-imageurl-input').value.trim() || null,
    category: document.getElementById('content-category-input').value.trim() || null,
  }

  if (type === 'EVENT') {
    const ed  = document.getElementById('content-eventdate-input').value
    const eed = document.getElementById('content-eventenddate-input').value
    body.eventDate        = ed  ? new Date(ed).toISOString()  : null
    body.eventEndDate     = eed ? new Date(eed).toISOString() : null
    body.location         = document.getElementById('content-location-input').value.trim() || null
    body.maxAttendees     = parseInt(document.getElementById('content-maxattendees-input').value) || null
    body.registrationOpen = document.getElementById('content-regopen-input').checked
    const tp = parseFloat(document.getElementById('content-ticketprice-input').value)
    body.ticketPrice      = Number.isFinite(tp) && tp > 0 ? tp : null
  }

  try {
    if (_contentEditId) {
      await api.put(`/content/${_contentEditId}`, body)
    } else {
      await api.post('/content', body)
    }
    _closeContentModalForce()
    loadContentAdmin()
    refreshContentBadges()
  } catch (err) {
    alertEl.className   = 'alert alert-danger'
    alertEl.textContent = err.message || 'Failed to save'
  } finally {
    btn.disabled = false
    btn.textContent = _contentEditId ? 'Save Changes' : 'Save Draft'
  }
}

window.publishCurrentContent = async () => {
  if (!_contentEditId) return
  const btn = document.getElementById('content-publish-btn')
  btn.disabled = true; btn.textContent = 'Publishing…'
  try {
    await api.post(`/content/${_contentEditId}/publish`)
    _closeContentModalForce()
    loadContentAdmin()
    refreshContentBadges()
    toast('Content published successfully', 'success')
  } catch (err) {
    toast(err.message || 'Failed to publish', 'danger')
    btn.disabled = false; btn.textContent = 'Publish'
  }
}

window.publishContentItem = async (id, btn) => {
  btn.disabled = true; btn.textContent = '…'
  try {
    await api.post(`/content/${id}/publish`)
    loadContentAdmin(_contentAdminPage)
    refreshContentBadges()
    toast('Published', 'success')
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Publish'
    toast(err.message || 'Failed to publish', 'danger')
  }
}

window.restoreContentItem = async (id, btn) => {
  btn.disabled = true; btn.textContent = '…'
  try {
    await api.post(`/content/${id}/restore`)
    loadContentAdmin(_contentAdminPage)
    toast('Restored to draft', 'success')
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Restore'
    toast(err.message || 'Failed to restore', 'danger')
  }
}

window.archiveContentItem = async (id, btn) => {
  const ok = await confirmDialog({
    title: 'Archive content?',
    message: 'This will hide the item from the public. You can view it in the archive.',
    confirmText: 'Archive', danger: true,
  })
  if (!ok) return
  btn.disabled = true; btn.textContent = '…'
  try {
    await api.delete(`/content/${id}`)
    loadContentAdmin(_contentAdminPage)
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Archive'
    toast(err.message || 'Failed to archive', 'danger')
  }
}

// ── Image upload helper ───────────────────────────────────────

window.uploadContentImage = async () => {
  const input    = document.getElementById('content-image-upload')
  const statusEl = document.getElementById('content-upload-status')
  const file = input.files?.[0]
  if (!file) return
  statusEl.textContent = 'Uploading…'

  const formData = new FormData()
  formData.append('image', file)

  try {
    const token = localStorage.getItem('accessToken')
    const res = await fetch('/api/content/upload', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Upload failed')
    document.getElementById('content-imageurl-input').value = data.url
    statusEl.textContent = 'Uploaded ✓'
  } catch (err) {
    statusEl.textContent = 'Upload failed: ' + (err.message || 'Unknown error')
    toast(err.message || 'Image upload failed', 'danger')
  } finally {
    input.value = ''
  }
}

// ── About page editor ─────────────────────────────────────────

function escAbout(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function aboutRepeaterRow(id, fields) {
  return `<div class="about-repeater-row" data-id="${escAbout(id)}">
    ${fields.map(f =>
      `<input class="form-input form-input-sm" placeholder="${escAbout(f.placeholder)}" data-field="${escAbout(f.field)}" value="${escAbout(f.value)}">`
    ).join('')}
    <button class="btn btn-sm btn-outline" style="color:var(--color-danger);flex-shrink:0;" onclick="this.closest('[data-id]').remove()">✕</button>
  </div>`
}

function buildAboutForm(data) {
  const d = data || {}
  const h = d.hero || {}
  const loc = d.location || {}
  const beliefs = (d.beliefs || []).join('\n')

  return `
  <div class="about-editor-section">
    <h3 class="about-editor-heading">Hero</h3>
    <label class="about-editor-label">Heading</label>
    <input id="ae-hero-heading" class="form-input" value="${escAbout(h.heading)}">
    <label class="about-editor-label">Sub-heading</label>
    <input id="ae-hero-subheading" class="form-input" value="${escAbout(h.subheading)}">
  </div>

  <div class="about-editor-section">
    <h3 class="about-editor-heading">Mission</h3>
    <textarea id="ae-mission" class="form-input" rows="3">${escAbout(d.mission)}</textarea>
  </div>

  <div class="about-editor-section">
    <h3 class="about-editor-heading">Vision</h3>
    <textarea id="ae-vision" class="form-input" rows="3">${escAbout(d.vision)}</textarea>
  </div>

  <div class="about-editor-section">
    <h3 class="about-editor-heading">Our Story</h3>
    <textarea id="ae-story" class="form-input" rows="5">${escAbout(d.story)}</textarea>
  </div>

  <div class="about-editor-section">
    <h3 class="about-editor-heading">What We Believe</h3>
    <p style="font-size:var(--font-size-sm);color:var(--color-text-muted);margin-bottom:var(--space-sm);">One belief per line.</p>
    <textarea id="ae-beliefs" class="form-input" rows="7">${escAbout(beliefs)}</textarea>
  </div>

  <div class="about-editor-section">
    <h3 class="about-editor-heading">Leadership</h3>
    <p style="font-size:var(--font-size-sm);color:var(--color-text-muted);margin-bottom:var(--space-sm);">Fill in name and role. Photo URL is optional.</p>
    <div id="ae-leaders-list">
      ${(d.leaders || []).map((l, i) => aboutRepeaterRow('leader-' + i, [
        { field: 'name', placeholder: 'Name', value: l.name || '' },
        { field: 'role', placeholder: 'Role', value: l.role || '' },
        { field: 'imageUrl', placeholder: 'Photo URL (optional)', value: l.imageUrl || '' },
      ])).join('')}
    </div>
    <button class="btn btn-outline btn-sm" style="margin-top:var(--space-sm)" onclick="addAboutLeader()">+ Add Leader</button>
  </div>

  <div class="about-editor-section">
    <h3 class="about-editor-heading">Service Times</h3>
    <div id="ae-services-list">
      ${(d.serviceTimes || []).map((s, i) => aboutRepeaterRow('svc-' + i, [
        { field: 'day', placeholder: 'Day (e.g. Sunday)', value: s.day || '' },
        { field: 'time', placeholder: 'Time (e.g. 9:00 AM)', value: s.time || '' },
        { field: 'label', placeholder: 'Label (e.g. Sunday Service)', value: s.label || '' },
      ])).join('')}
    </div>
    <button class="btn btn-outline btn-sm" style="margin-top:var(--space-sm)" onclick="addAboutService()">+ Add Service Time</button>
  </div>

  <div class="about-editor-section">
    <h3 class="about-editor-heading">Location &amp; Contact</h3>
    <label class="about-editor-label">Address</label>
    <input id="ae-loc-address" class="form-input" value="${escAbout(loc.address)}">
    <label class="about-editor-label">Phone</label>
    <input id="ae-loc-phone" class="form-input" value="${escAbout(loc.phone)}">
    <label class="about-editor-label">Email</label>
    <input id="ae-loc-email" class="form-input" value="${escAbout(loc.email)}">
    <label class="about-editor-label">Google Maps embed HTML</label>
    <textarea id="ae-loc-map" class="form-input" rows="3">${escAbout(loc.mapEmbed)}</textarea>
  </div>
  `
}

export async function loadAboutEditor() {
  const container = document.getElementById('about-editor-form')
  container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">Loading…</p>'
  try {
    const aboutData = await api.get('/site/about')
    container.innerHTML = buildAboutForm(aboutData)
  } catch (err) {
    container.innerHTML = `<p class="text-muted" style="padding:var(--space-lg)">Failed to load: ${escAbout(err.message)}</p>`
  }
}

function readAboutRows(containerId, fields) {
  return [...document.querySelectorAll('#' + containerId + ' .about-repeater-row')].map(row => {
    const obj = {}
    fields.forEach(f => {
      obj[f] = row.querySelector('[data-field="' + f + '"]')?.value?.trim() || ''
    })
    return obj
  }).filter(obj => obj[fields[0]])
}

window.addAboutLeader = () => {
  const list = document.getElementById('ae-leaders-list')
  const i = list.children.length
  list.insertAdjacentHTML('beforeend', aboutRepeaterRow('leader-new-' + i, [
    { field: 'name', placeholder: 'Name', value: '' },
    { field: 'role', placeholder: 'Role', value: '' },
    { field: 'imageUrl', placeholder: 'Photo URL (optional)', value: '' },
  ]))
}

window.addAboutService = () => {
  const list = document.getElementById('ae-services-list')
  const i = list.children.length
  list.insertAdjacentHTML('beforeend', aboutRepeaterRow('svc-new-' + i, [
    { field: 'day', placeholder: 'Day (e.g. Sunday)', value: '' },
    { field: 'time', placeholder: 'Time (e.g. 9:00 AM)', value: '' },
    { field: 'label', placeholder: 'Label (e.g. Sunday Service)', value: '' },
  ]))
}

window.saveAboutEditor = async () => {
  const payload = {
    hero: {
      heading:    document.getElementById('ae-hero-heading')?.value?.trim() || 'About AIC Ruiru',
      subheading: document.getElementById('ae-hero-subheading')?.value?.trim() || '',
    },
    mission: document.getElementById('ae-mission')?.value?.trim() || '',
    vision:  document.getElementById('ae-vision')?.value?.trim()  || '',
    story:   document.getElementById('ae-story')?.value?.trim()   || '',
    beliefs: (document.getElementById('ae-beliefs')?.value || '')
      .split('\n').map(s => s.trim()).filter(Boolean),
    leaders:      readAboutRows('ae-leaders-list',  ['name', 'role', 'imageUrl']),
    serviceTimes: readAboutRows('ae-services-list', ['day', 'time', 'label']),
    location: {
      address:  document.getElementById('ae-loc-address')?.value?.trim() || '',
      phone:    document.getElementById('ae-loc-phone')?.value?.trim()   || '',
      email:    document.getElementById('ae-loc-email')?.value?.trim()   || '',
      mapEmbed: document.getElementById('ae-loc-map')?.value?.trim()     || '',
    },
  }

  try {
    await api.put('/site/about', payload)
    toast('About page saved', 'success')
  } catch (err) {
    toast(err.message || 'Failed to save', 'danger')
  }
}

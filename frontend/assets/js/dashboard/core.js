import { api } from '../api.js'
import { requireAuth, isAtLeast, hasPermission } from '../auth.js'
import { toggleTheme, currentTheme } from '../theme.js'
import { toast } from '../ui.js'

export const user = requireAuth()

// ── Profile localStorage cache ────────────────────────────────
const PROFILE_TTL = 24 * 60 * 60_000 // 24 hours

export function saveCachedProfile(data) {
  try { localStorage.setItem('aicr_profile', JSON.stringify({ data, ts: Date.now() })) } catch {}
}

export function loadCachedProfile() {
  try {
    const raw = localStorage.getItem('aicr_profile')
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    return Date.now() - ts < PROFILE_TTL ? data : null
  } catch { return null }
}

export let memberData = null
export function setMemberData(data) { memberData = data }

let _pendingCount = 0, _updateReqCount = 0
export function setPendingCount(n) { _pendingCount = n }
export function setUpdateReqCount(n) { _updateReqCount = n }

// ── Helpers (shared across dashboard modules) ─────────────────
export function formatRole(role) {
  const labels = { MEMBER: 'Member', STAFF: 'Staff', ADMIN: 'Admin', SUPER_ADMIN: 'Super Admin', LEGEND: 'Legend', PENDING: 'Pending' }
  return labels[role] || role
}

export function roleLevel(role) {
  return { PENDING: 0, MEMBER: 1, STAFF: 2, ADMIN: 3, SUPER_ADMIN: 4, LEGEND: 5 }[role] ?? -1
}

export function skeletonRows(n = 6) {
  return Array(n).fill('<div class="skeleton-row"></div>').join('')
}

export function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Member-name table cell with avatar initials
export function memberNameCell(fullName) {
  if (!fullName) return '—'
  const parts = fullName.trim().split(/\s+/)
  const init  = ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
  return `<div class="cell-member"><span class="row-avatar">${escHtml(init)}</span><span>${escHtml(fullName)}</span></div>`
}

export function fmtKES(n) {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(Number(n) || 0)
}

export function paymentLabel(method) {
  return { CASH: 'Cash', MPESA: 'M-Pesa', BANK_TRANSFER: 'Bank Transfer', CARD: 'Card', OTHER: 'Other' }[method] || method
}

// ── Utility panel collapse ────────────────────────────────────
;(function initUtilityPanel() {
  const panel     = document.getElementById('utility-panel')
  const collapseBtn = document.getElementById('util-collapse')
  if (!panel || !collapseBtn) return
  const PREF_KEY  = 'aicr_utility_collapsed'
  if (localStorage.getItem(PREF_KEY) === '1') panel.classList.add('collapsed')
  collapseBtn.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('collapsed')
    localStorage.setItem(PREF_KEY, collapsed ? '1' : '0')
  })
})()

// ── Init ──────────────────────────────────────────────────────
function renderSidebar(data) {
  const p = data.profile
  document.getElementById('user-avatar').textContent   = p ? `${p.firstName[0]}${p.lastName[0]}` : '?'
  document.getElementById('user-fullname').textContent = p ? `${p.firstName} ${p.lastName}` : data.email
  document.getElementById('user-role').textContent     = formatRole(data.role ?? user.role)
}

function renderGreeting(firstName) {
  const hour = new Date().getHours()
  const tod  = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const el   = document.getElementById('greeting-text')
  if (el) el.textContent = firstName ? `${tod}, ${firstName}` : tod
}

export async function init({ loadDashboardStats, loadPendingCount, loadUpdateRequestsCount, renderProfile }) {
  try {
    // Show admin chrome immediately — role is already in the JWT, no API call needed
    if (isAtLeast('ADMIN')) {
      document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'))
      document.getElementById('quick-actions-admin')?.classList.remove('hidden')
    } else {
      document.getElementById('quick-actions-member')?.classList.remove('hidden')
    }

    // Content managers (Admin+ or Staff with manageContent or manageEvents) get the Content hub
    // and don't need the member-facing News/Events read-only tabs
    if (hasPermission('manageContent') || hasPermission('manageEvents')) {
      document.querySelectorAll('.content-manager-nav').forEach(el => el.classList.remove('hidden'))
      document.querySelectorAll('.member-content-nav').forEach(el => el.classList.add('hidden'))
    }

    // SUPER_ADMIN system nav
    if (user.role === 'SUPER_ADMIN' || user.role === 'LEGEND') {
      document.querySelectorAll('.super-admin-only').forEach(el => el.classList.remove('hidden'))
    }

    // Givings feature flag — check before revealing any givings UI
    const features = await api.get('/site/features').catch(() => ({ givings: true }))
    if (features.givings !== false) {
      // Feature is on: show member's My Givings + manager nav if permitted
      document.querySelectorAll('.giving-feature-nav').forEach(el => el.classList.remove('hidden'))
      if (hasPermission('manageGivings')) {
        document.querySelectorAll('.givings-manager-nav').forEach(el => el.classList.remove('hidden'))
      }
    }

    // Render sidebar + greeting instantly from localStorage cache (survives page refresh)
    const cached = loadCachedProfile()
    if (cached) {
      renderSidebar(cached)
      renderGreeting(cached.profile?.firstName)
    }

    // Fire all init requests in parallel — nothing waits for anything else
    const [meResult] = await Promise.allSettled([
      api.get('/members/me').then(me => {
        memberData = me
        setMemberData(me)
        renderSidebar(me)
        renderGreeting(me.profile?.firstName)
        saveCachedProfile(me)
        // Re-render profile page if it's already open (user navigated before API resolved)
        if (document.getElementById('page-account')?.classList.contains('active')) renderProfile()
      }),
      loadDashboardStats(),
      ...(isAtLeast('ADMIN') ? [loadPendingCount(), loadUpdateRequestsCount()] : []),
    ])

    startContentBadgePoll()
    startNotifPoll()

    if (meResult.status === 'rejected') {
      const err = meResult.reason
      if (err?.status === 401 || err?.status === 403 || !api.getAccessToken()) {
        api.clearTokens()
        window.location.href = 'login.html'
      }
    }
  } catch (err) {
    if (err?.status === 401 || !api.getAccessToken()) {
      api.clearTokens()
      window.location.href = 'login.html'
    }
  }
}

// ── Navigation ────────────────────────────────────────────────
function openPage(page, label) {
  document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  document.getElementById(`page-${page}`).classList.add('active')
  document.getElementById('page-title').textContent = label
  onPageLoad(page)
}

document.querySelectorAll('.nav-link[data-page]').forEach(btn => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page
    btn.classList.add('active')
    const label = btn.querySelector('.nav-label')?.textContent.trim() ?? btn.textContent.trim()
    openPage(page, label)
  })
})

// System Settings — utility-panel button (SUPER_ADMIN only), not part of the sidebar rail
document.getElementById('util-system-settings-btn')?.addEventListener('click', () => {
  openPage('system', 'System Settings')
})

// Merged tabbed pages: map page → tab container id and per-tab loaders.
// Loaders are registered by the entry point after all modules are imported (see registerTabLoaders).
export const TAB_CONTAINERS = {
  account:         'account-tabs',
  updates:         'updates-tabs',
  members:         'members-tabs',
  groups:          'groups-tabs',
  content:         'content-tabs',
  'givings-admin': 'givings-tabs',
}
export const TAB_LOADERS = {}
export function registerTabLoaders(loaders) {
  Object.assign(TAB_LOADERS, loaders)
}

function activateTabBtn(page, btn) {
  const container = document.getElementById(TAB_CONTAINERS[page])
  const tab = btn.dataset.tab
  container.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  document.getElementById(`page-${page}`)
    .querySelectorAll(':scope > .tab-panel')
    .forEach(p => p.classList.toggle('active', p.dataset.tab === tab))
  TAB_LOADERS[page]?.[tab]?.()
}

function activateTab(page, tab) {
  const container = document.getElementById(TAB_CONTAINERS[page])
  const btn = container?.querySelector(`.seg-btn[data-tab="${tab}"]`)
  if (btn) activateTabBtn(page, btn)
}

function loadActiveTab(page) {
  const container = document.getElementById(TAB_CONTAINERS[page])
  const active = container?.querySelector('.seg-btn.active') || container?.querySelector('.seg-btn')
  if (active) activateTabBtn(page, active)
}

// Wire every tabbed page's seg-control
Object.entries(TAB_CONTAINERS).forEach(([page, tabsId]) => {
  document.getElementById(tabsId)?.addEventListener('click', e => {
    const btn = e.target.closest('.seg-btn')
    if (btn) activateTabBtn(page, btn)
  })
})

// My Account has no rail item — it's opened from the avatar
function showAccountPage() {
  document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'))
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  document.getElementById('page-account').classList.add('active')
  document.getElementById('page-title').textContent = 'My Account'
  document.getElementById('nav-account-btn')?.classList.add('active')
}

// Aliases keep existing callers (quick actions, deep links) working after the merge
const PAGE_ALIASES = {
  profile:           ['account', 'profile'],
  givings:           ['account', 'givings'],
  pending:           ['members', 'pending'],
  'update-requests': ['members', 'requests'],
  news:              ['updates', 'news'],
  events:            ['updates', 'events'],
  households:        ['groups', 'households'],
  ministries:        ['groups', 'ministries'],
  'about-editor':    ['content', 'about'],
  'giving-projects': ['givings-admin', 'projects'],
  'giving-requests': ['givings-admin', 'corrections'],
  'giving-reports':  ['givings-admin', 'reports'],
}

export function goToPage(page) {
  const alias = PAGE_ALIASES[page]
  if (alias) {
    const [parent, tab] = alias
    if (parent === 'account') showAccountPage()
    else document.querySelector(`.nav-link[data-page="${parent}"]`)?.click()
    activateTab(parent, tab)
    return
  }
  document.querySelector(`.nav-link[data-page="${page}"]`)?.click()
}
window.goToPage = goToPage

let _onPageLoadExtra = {}
export function registerPageLoaders(loaders) {
  Object.assign(_onPageLoadExtra, loaders)
}

function onPageLoad(page) {
  if (TAB_CONTAINERS[page])  return loadActiveTab(page)
  if (page === 'system')     return loadSystemSettings()
  if (_onPageLoadExtra[page]) return _onPageLoadExtra[page]()
}

// Avatar (utility panel identity) opens the My Account page
const avatarEl = document.getElementById('user-avatar')
if (avatarEl) {
  avatarEl.style.cursor = 'pointer'
  avatarEl.title = 'My Account'
  avatarEl.addEventListener('click', () => goToPage('profile'))
}

// ── Collapsible sidebar sections ──────────────────────────────
const NAV_COLLAPSE_KEY = 'aicr_nav_collapsed'
function loadNavCollapsed() {
  try { return JSON.parse(localStorage.getItem(NAV_COLLAPSE_KEY)) || {} } catch { return {} }
}
function applyNavCollapsed() {
  const state = loadNavCollapsed()
  document.querySelectorAll('.nav-section-toggle').forEach(toggle => {
    const collapsed = !!state[toggle.dataset.group]
    toggle.setAttribute('aria-expanded', String(!collapsed))
    document.getElementById(`nav-group-${toggle.dataset.group}`)?.classList.toggle('collapsed', collapsed)
  })
}
document.querySelectorAll('.nav-section-toggle').forEach(toggle => {
  toggle.addEventListener('click', () => {
    const state = loadNavCollapsed()
    state[toggle.dataset.group] = !state[toggle.dataset.group]
    localStorage.setItem(NAV_COLLAPSE_KEY, JSON.stringify(state))
    applyNavCollapsed()
  })
})
applyNavCollapsed()

// ── Rail aggregate badges ─────────────────────────────────────
// Per-tab badges keep their own ids; these roll the counts up onto the rail item.
export function setRailBadge(id, n) {
  const el = document.getElementById(id)
  if (!el) return
  if (n > 0) { el.textContent = n; el.style.display = 'inline-block' }
  else el.style.display = 'none'
}
export function refreshMembersRailBadge() { setRailBadge('members-badge', _pendingCount + _updateReqCount) }

// ── Dashboard stats ───────────────────────────────────────────
export async function loadDashboardStats() {
  const grid  = document.getElementById('stats-grid')
  const stats = []

  if (isAtLeast('ADMIN')) {
    const [membersRes, pendingRes, householdsRes, ministriesRes] = await Promise.all([
      api.get('/members?limit=1'),
      api.get('/members/pending'),
      api.get('/households'),
      api.get('/ministries'),
    ])
    const usersIcon      = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`
    const clockIcon      = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
    const homeIcon       = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`
    const ministryIcon   = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="M5 8h14"/><path d="M5 8l-2 8a4 4 0 0 0 8 0z"/><path d="M19 8l2 8a4 4 0 0 1-8 0z"/></svg>`
    const householdCount  = Array.isArray(householdsRes)  ? householdsRes.length  : (householdsRes?.total  ?? '?')
    const ministryCount   = Array.isArray(ministriesRes)  ? ministriesRes.length  : (ministriesRes?.total  ?? '?')
    stats.push({ label: 'Total Members',    value: membersRes.total,          cls: '',        icon: usersIcon })
    stats.push({ label: 'Pending Approval', value: pendingRes.pending.length, cls: 'warning', icon: clockIcon })
    stats.push({ label: 'Households',       value: householdCount,            cls: 'accent',  icon: homeIcon })
    stats.push({ label: 'Ministries',       value: ministryCount,             cls: 'success', icon: ministryIcon })
  }

  grid.innerHTML = stats.map(s => `
    <div class="stat-card ${s.cls}">
      <div class="stat-icon">${s.icon || ''}</div>
      <div>
        <div class="stat-value">${s.value}</div>
        <div class="stat-label">${s.label}</div>
      </div>
    </div>
  `).join('') || '<p class="text-muted">No stats available.</p>'
}

// ── Theme ─────────────────────────────────────────────────────
const SVG_SUN  = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
const SVG_MOON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
const themeBtn = document.getElementById('theme-toggle')
const themeIconEl = document.getElementById('theme-icon')
export function syncThemeIcon() {
  if (themeIconEl) themeIconEl.innerHTML = currentTheme() === 'dark' ? SVG_MOON : SVG_SUN
  const themeIconElMobile = document.getElementById('theme-icon-user-settings')
  if (themeIconElMobile) themeIconElMobile.innerHTML = currentTheme() === 'dark' ? SVG_MOON : SVG_SUN
}
syncThemeIcon()
themeBtn?.addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect()
  toggleTheme({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  syncThemeIcon()
})

document.getElementById('theme-toggle-user-settings')?.addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect()
  toggleTheme({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  syncThemeIcon()
})

// ── Mobile drawer ─────────────────────────────────────────────
const sidebarEl = document.querySelector('.sidebar')
const navOverlay = document.getElementById('nav-overlay')
const closeDrawer = () => { sidebarEl?.classList.remove('open'); navOverlay?.classList.remove('open') }
document.getElementById('nav-hamburger')?.addEventListener('click', () => {
  sidebarEl?.classList.add('open'); navOverlay?.classList.add('open')
})
navOverlay?.addEventListener('click', closeDrawer)
document.querySelectorAll('.nav-link[data-page]').forEach(b => b.addEventListener('click', closeDrawer))
document.getElementById('nav-account-btn')?.addEventListener('click', closeDrawer)

document.getElementById('theme-toggle-mobile')?.addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect()
  toggleTheme({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  syncThemeIcon()
})

// ── Logout ────────────────────────────────────────────────────
document.getElementById('logout-btn').addEventListener('click', async () => {
  const rt = localStorage.getItem('refreshToken')
  await api.post('/auth/logout', { refreshToken: rt }).catch(() => {})
  api.clearTokens()
  localStorage.removeItem('aicr_profile')
  window.location.href = 'login.html'
})

// ── In-app notifications ──────────────────────────────────────

let _notifOpen = false

function timeAgo(dateStr) {
  const diff = Math.floor((Date.now() - new Date(dateStr)) / 1000)
  if (diff < 60)   return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(dateStr).toLocaleDateString('en-KE', { dateStyle: 'medium' })
}

async function fetchNotifications() {
  try {
    const data = await api.get('/notifications')
    const dot  = document.getElementById('notif-dot')
    if (dot) dot.style.display = data.unreadCount > 0 ? '' : 'none'

    if (_notifOpen) renderNotifList(data.notifications)
    return data
  } catch { /* silent — network or auth issue */ }
}

function renderNotifList(notifications) {
  const list = document.getElementById('notif-list')
  if (!list) return
  if (!notifications.length) {
    list.innerHTML = '<p class="text-muted notif-empty">No notifications yet.</p>'
    return
  }
  list.innerHTML = notifications.map(n => `
    <button class="notif-item ${n.readAt ? '' : 'unread'}" onclick="markNotifRead('${n.id}', this)">
      <div class="notif-item-title">${escHtml(n.title)}</div>
      <div class="notif-item-body">${escHtml(n.body)}</div>
      <div class="notif-item-time">${timeAgo(n.createdAt)}</div>
    </button>
  `).join('')
}

window.markNotifRead = async (id, btn) => {
  if (!btn.classList.contains('unread')) return
  try {
    await api.post(`/notifications/${id}/read`)
    btn.classList.remove('unread')
    await fetchNotifications()
  } catch { /* silent */ }
}

;(function wireNotifBell() {
  const btn      = document.getElementById('notif-btn')
  const dropdown = document.getElementById('notif-dropdown')
  const markAll  = document.getElementById('notif-mark-all-btn')
  if (!btn || !dropdown) return

  btn.addEventListener('click', async (e) => {
    e.stopPropagation()
    _notifOpen = !_notifOpen
    dropdown.style.display = _notifOpen ? '' : 'none'
    if (_notifOpen) {
      const data = await fetchNotifications()
      if (data) renderNotifList(data.notifications)
    }
  })

  markAll?.addEventListener('click', async (e) => {
    e.stopPropagation()
    try {
      await api.post('/notifications/read-all')
      await fetchNotifications()
      const data = await api.get('/notifications')
      renderNotifList(data.notifications)
    } catch { /* silent */ }
  })

  document.addEventListener('click', (e) => {
    if (_notifOpen && !document.getElementById('notif-wrapper')?.contains(e.target)) {
      _notifOpen = false
      dropdown.style.display = 'none'
    }
  })
}())

export function startNotifPoll() {
  fetchNotifications()
  setInterval(fetchNotifications, 60_000)
}

// Set by content-admin.js (badge polling lives there since it's content-badge specific)
let _startContentBadgePoll = () => {}
export function registerContentBadgePoll(fn) { _startContentBadgePoll = fn }
function startContentBadgePoll() { _startContentBadgePoll() }

// ── System Settings (SUPER_ADMIN) ────────────────────────────

export async function loadSystemSettings() {
  try {
    const features = await api.get('/site/features')
    const checkbox = document.getElementById('feature-givings-checkbox')
    if (checkbox) {
      checkbox.checked = features.givings !== false
      checkbox.onchange = saveFeatureToggles
    }
  } catch {
    toast('Failed to load settings', 'danger')
  }
  loadSecurityReviewSchedule()
}

async function loadSecurityReviewSchedule() {
  const enabledCheckbox = document.getElementById('security-schedule-enabled-checkbox')
  const daySelect  = document.getElementById('security-schedule-day')
  const hourSelect = document.getElementById('security-schedule-hour')
  const saveBtn    = document.getElementById('security-schedule-save-btn')
  if (!enabledCheckbox || !daySelect || !hourSelect) return

  if (!daySelect.options.length) {
    for (let d = 1; d <= 28; d++) daySelect.add(new Option(String(d), String(d)))
  }
  if (!hourSelect.options.length) {
    for (let h = 0; h < 24; h++) hourSelect.add(new Option(`${String(h).padStart(2, '0')}:00`, String(h)))
  }

  try {
    const schedule = await api.get('/site/security-review-schedule')
    enabledCheckbox.checked = schedule.enabled
    daySelect.value  = String(schedule.dayOfMonth)
    hourSelect.value = String(schedule.hour)
    if (saveBtn) saveBtn.onclick = saveSecurityReviewSchedule
    const runNowBtn = document.getElementById('security-review-run-now-btn')
    if (runNowBtn) runNowBtn.onclick = runSecurityReviewNow
  } catch {
    toast('Failed to load security review schedule', 'danger')
  }
}

async function saveSecurityReviewSchedule() {
  const enabledCheckbox = document.getElementById('security-schedule-enabled-checkbox')
  const daySelect  = document.getElementById('security-schedule-day')
  const hourSelect = document.getElementById('security-schedule-hour')
  const payload = {
    enabled: enabledCheckbox?.checked ?? true,
    dayOfMonth: Number(daySelect?.value ?? 1),
    hour: Number(hourSelect?.value ?? 8),
  }
  try {
    await api.put('/site/security-review-schedule', payload)
    toast('Security review schedule saved', 'success')
  } catch (err) {
    toast(err.message || 'Failed to save schedule', 'danger')
  }
}

async function saveFeatureToggles() {
  const checkbox = document.getElementById('feature-givings-checkbox')
  const givings  = checkbox?.checked ?? true
  try {
    await api.put('/site/features', { givings })
    toast(`Givings module ${givings ? 'enabled' : 'disabled'}`, 'success')
    // Immediately reflect change in nav
    if (givings) {
      document.querySelectorAll('.giving-feature-nav').forEach(el => el.classList.remove('hidden'))
      if (hasPermission('manageGivings')) {
        document.querySelectorAll('.givings-manager-nav').forEach(el => el.classList.remove('hidden'))
      }
    } else {
      document.querySelectorAll('.giving-feature-nav').forEach(el => el.classList.add('hidden'))
      document.querySelectorAll('.givings-manager-nav').forEach(el => el.classList.add('hidden'))
    }
  } catch (err) {
    toast(err.message || 'Failed to save settings', 'danger')
    if (checkbox) checkbox.checked = !givings  // revert
  }
}

async function runSecurityReviewNow() {
  const btn   = document.getElementById('security-review-run-now-btn')
  const emailInput = document.getElementById('security-review-run-now-email')
  const to    = emailInput?.value.trim() || undefined
  if (btn) { btn.disabled = true; btn.textContent = 'Running…' }
  try {
    await api.post('/site/security-review/run-now', to ? { to } : {})
    toast('Security review reminder sent', 'success')
  } catch (err) {
    toast(err.message || 'Failed to run security review', 'danger')
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Run Now' }
  }
}

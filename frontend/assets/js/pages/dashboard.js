import { api } from '../api.js'
import { requireAuth, isAtLeast, hasPermission } from '../auth.js'
import { toggleTheme, currentTheme } from '../theme.js'
import { toast, confirmDialog } from '../ui.js'
import { defaultCover } from '../defaultCover.js'

const user = requireAuth()
if (!user) throw new Error('redirecting')

// ── Profile localStorage cache ────────────────────────────────
const PROFILE_TTL = 24 * 60 * 60_000 // 24 hours

function saveCachedProfile(data) {
  try { localStorage.setItem('aicr_profile', JSON.stringify({ data, ts: Date.now() })) } catch {}
}

function loadCachedProfile() {
  try {
    const raw = localStorage.getItem('aicr_profile')
    if (!raw) return null
    const { data, ts } = JSON.parse(raw)
    return Date.now() - ts < PROFILE_TTL ? data : null
  } catch { return null }
}

let memberData        = null
let _modalUserId      = null
let _editMemberId     = null
let _editMemberActive = true
let _householdModalId = null  // null = create, string = rename
let _householdDetailId = null
let _ministryModalId  = null  // null = create, string = edit
let _ministryDetailId = null
const DEFAULT_MINISTRY_ROLES = [
  { name: 'ChairPerson',      max: 1 },
  { name: 'Vice Chairperson', max: 1 },
  { name: 'Treasurer',        max: 1 },
  { name: 'Secretary',        max: 1 },
  { name: 'Vice Secretary',   max: 1 },
  { name: 'Coordinator',      max: 1 },
]

let _householdsCache  = new Map()
let _ministriesCache  = new Map()
let _membersCache     = new Map()
let _householdAvailableMembers = []
let _ministryAvailableMembers  = []
let _ministrySelectedMember   = null  // { profileId, fullName }
let _ministryRoles            = []    // {name, max}[] being edited in the create/edit modal
let _ministryCurrentMembers   = []    // active members loaded in detail modal, for capacity display
let _editHouseholdId          = null  // household selected in edit-member modal
let _editHouseholdList        = []    // all households for search picker in edit-member modal
let _membersPage              = 1     // current page in members list
let _memberHouseholdFilterId  = ''    // selected household id in members filter
let _memberHouseholdList      = []    // all households for the members filter picker
let _ministriesPage           = 1     // current page in ministries list (client-side)
let _ministriesAll            = []    // full list loaded from server, sliced for display
const MINISTRIES_PER_PAGE     = 10

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

async function init() {
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
document.querySelectorAll('.nav-link[data-page]').forEach(btn => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page
    document.querySelectorAll('.nav-link').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
    document.getElementById(`page-${page}`).classList.add('active')
    const label = btn.querySelector('.nav-label')?.textContent.trim() ?? btn.textContent.trim()
    document.getElementById('page-title').textContent = label
    onPageLoad(page)
  })
})

// Merged tabbed pages: map page → tab container id and per-tab loaders.
// Loaders are wrapped in arrows so the (hoisted/later-defined) functions resolve at call time.
const TAB_CONTAINERS = {
  account:         'account-tabs',
  updates:         'updates-tabs',
  members:         'members-tabs',
  groups:          'groups-tabs',
  content:         'content-tabs',
  'givings-admin': 'givings-tabs',
}
const TAB_LOADERS = {
  account:         { profile: () => renderProfile(),     givings: () => loadMyGivings() },
  updates:         { news: () => loadNews(1),            events: () => loadEvents(1) },
  members:         { all: () => loadMembersPage(),       pending: () => loadPending(),       requests: () => loadUpdateRequests() },
  groups:          { households: () => loadHouseholds(), ministries: () => loadMinistries() },
  content:         { posts: () => loadContentAdmin(1),   about: () => loadAboutEditor() },
  'givings-admin': { ledger: () => loadGivingsLedger(1), projects: () => loadGivingProjects(), pledges: () => loadPledgesAdmin(), corrections: () => loadCorrectionRequests(), reports: () => loadGivingReports() },
}

function activateTabBtn(page, btn) {
  const container = document.getElementById(TAB_CONTAINERS[page])
  const tab = btn.dataset.tab
  container.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  document.getElementById(`page-${page}`)
    .querySelectorAll(':scope > .tab-panel')
    .forEach(p => p.classList.toggle('active', p.dataset.tab === tab))
  TAB_LOADERS[page][tab]?.()
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

function goToPage(page) {
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

function onPageLoad(page) {
  if (TAB_CONTAINERS[page])  return loadActiveTab(page)
  if (page === 'invites')    return loadInvites()
  if (page === 'system')     return loadSystemSettings()
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
let _pendingCount = 0, _updateReqCount = 0
function setRailBadge(id, n) {
  const el = document.getElementById(id)
  if (!el) return
  if (n > 0) { el.textContent = n; el.style.display = 'inline-block' }
  else el.style.display = 'none'
}
function refreshMembersRailBadge() { setRailBadge('members-badge', _pendingCount + _updateReqCount) }

// ── Dashboard stats ───────────────────────────────────────────
async function loadDashboardStats() {
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

// ── Profile ───────────────────────────────────────────────────
function renderProfile() {
  if (!memberData) return
  const p    = memberData.profile
  const grid = document.getElementById('profile-grid')

  grid.innerHTML = `
    <div class="profile-avatar-wrap card">
      <div class="profile-avatar-large">${p.firstName[0]}${p.lastName[0]}</div>
      <h3 style="margin-bottom:var(--space-xs)">${p.fullName}</h3>
      <div class="badge badge-${p.membershipStatus === 'ACTIVE' ? 'active' : 'inactive'}">${p.membershipStatus}</div>
      <div class="text-muted mt-md" style="font-size:var(--font-size-sm)">${memberData.email || memberData.phone || ''}</div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:var(--space-lg)">Personal Information</h3>
      ${infoRow('Full Name',    p.fullName)}
      ${infoRow('Email',        memberData.email || '—')}
      ${infoRow('Phone',        memberData.phone || p.phone || '—')}
      ${infoRow('Date of Birth', p.dateOfBirth ? new Date(p.dateOfBirth).toLocaleDateString('en-KE') : '—')}
      ${infoRow('Address',      p.address || '—')}
      ${infoRow('Date Joined',  p.dateJoined ? new Date(p.dateJoined).toLocaleDateString('en-KE') : '—')}
      ${infoRow('Baptism Date', p.baptismDate ? new Date(p.baptismDate).toLocaleDateString('en-KE') : '—')}
      ${infoRow('Household',    p.household?.name || '—')}
      ${infoRow('Ministries',   p.ministries.map(m => m.name).join(', ') || '—')}
    </div>
  `
}

function infoRow(label, value) {
  return `<div class="info-row"><span class="info-label">${label}</span><span>${value}</span></div>`
}

// Member-name table cell with avatar initials
function memberNameCell(fullName) {
  if (!fullName) return '—'
  const parts = fullName.trim().split(/\s+/)
  const init  = ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?'
  return `<div class="cell-member"><span class="row-avatar">${escHtml(init)}</span><span>${escHtml(fullName)}</span></div>`
}

// ── Pending approvals ─────────────────────────────────────────
async function loadPendingCount() {
  try {
    const res   = await api.get('/members/pending')
    const count = res.pending.length
    _pendingCount = count
    setRailBadge('pending-badge', count)
    refreshMembersRailBadge()
  } catch {}
}

async function loadPending() {
  const container = document.getElementById('pending-list')
  container.innerHTML = skeletonRows()
  try {
    const res = await api.get('/members/pending')
    if (!res.pending.length) {
      container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">No pending registrations.</p>'
      return
    }
    container.innerHTML = `
      <table class="table-stack">
        <thead><tr><th>Name</th><th>Contact</th><th>Registered</th><th>Actions</th></tr></thead>
        <tbody>
          ${res.pending.map(m => `
            <tr>
              <td data-label="Name">${memberNameCell(m.profile?.fullName)}</td>
              <td data-label="Contact">${m.email || m.phone || '—'}</td>
              <td data-label="Registered">${new Date(m.createdAt).toLocaleDateString('en-KE')}</td>
              <td>
                <div class="action-btns">
                  <button class="btn btn-sm btn-success" onclick="approveUser('${m.id}', this)">Approve</button>
                  <button class="btn btn-sm btn-danger" onclick="rejectUser('${m.id}', this)">Reject</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  } catch {
    container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">Failed to load pending members.</p>'
  }
}

window.approveUser = async (userId, btn) => {
  btn.disabled = true; btn.textContent = '…'
  try {
    await api.post(`/auth/approve/${userId}`)
    btn.closest('tr').remove()
    loadPendingCount()
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Approve'
    toast(err.message || 'Failed to approve', 'danger')
  }
}

window.rejectUser = async (userId, btn) => {
  const ok = await confirmDialog({
    title: 'Reject registration?',
    message: 'The user will be notified by email.',
    confirmText: 'Reject', danger: true,
  })
  if (!ok) return
  btn.disabled = true; btn.textContent = '…'
  try {
    await api.post(`/auth/reject/${userId}`)
    btn.closest('tr').remove()
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Reject'
    toast(err.message || 'Failed to reject', 'danger')
  }
}

// ── Members list ──────────────────────────────────────────────
async function loadMembersPage() {
  const [households, ministries] = await Promise.all([
    api.get('/households'),
    api.get('/ministries'),
  ])
  _memberHouseholdList = households
  const minSel = document.getElementById('member-ministry-filter')
  const currentMin = minSel.value
  minSel.innerHTML = '<option value="">All ministries</option>' +
    ministries.map(m => `<option value="${m.id}" ${currentMin === m.id ? 'selected' : ''}>${escHtml(m.name)}</option>`).join('')
  loadMembers()
}

async function loadMembers(search = '', status = '', page = _membersPage, householdId = '', ministryId = '') {
  const container   = document.getElementById('members-list')
  const pagination  = document.getElementById('members-pagination')
  container.innerHTML = skeletonRows()
  try {
    let url = `/members?limit=25&page=${page}`
    if (search)      url += `&search=${encodeURIComponent(search)}`
    if (status)      url += `&status=${encodeURIComponent(status)}`
    if (householdId) url += `&householdId=${encodeURIComponent(householdId)}`
    if (ministryId)  url += `&ministryId=${encodeURIComponent(ministryId)}`
    const res = await api.get(url)
    _membersPage = res.page

    if (!res.members.length) {
      container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">No members found.</p>'
      pagination.classList.add('hidden')
      return
    }

    _membersCache = new Map(res.members.map(m => [m.id, m]))
    container.innerHTML = `
      <table class="table-stack">
        <thead><tr><th>Name</th><th>Contact</th><th>Status</th><th>Role</th><th>Active</th><th></th></tr></thead>
        <tbody>
          ${res.members.map(m => {
            const isSelf      = m.id === user.userId
            const isLegend    = m.role === 'LEGEND'
            const targetLevel = roleLevel(m.role)
            const actorLevel  = roleLevel(user.role)
            const canManage   = !isSelf && !isLegend && (
              user.role === 'SUPER_ADMIN'
                ? targetLevel < roleLevel('LEGEND')
                : actorLevel > targetLevel && ['MEMBER', 'STAFF'].includes(m.role)
            )
            return `
              <tr>
                <td data-label="Name">${memberNameCell(m.profile?.fullName)}</td>
                <td data-label="Contact">${m.email || m.phone || '—'}</td>
                <td data-label="Status"><span class="badge badge-${m.profile?.membershipStatus === 'ACTIVE' ? 'active' : 'inactive'}">${m.profile?.membershipStatus || '—'}</span></td>
                <td data-label="Role">${formatRole(m.role)}</td>
                <td data-label="Active">${m.isActive ? '<span class="badge badge-active">Yes</span>' : '<span class="badge badge-inactive">No</span>'}</td>
                <td>
                  <div class="action-btns">
                    ${m.profile ? `<button class="btn btn-sm btn-outline" onclick="openMemberEditModal('${m.id}')">Edit</button>` : ''}
                    ${canManage ? `<button class="btn btn-sm btn-outline" onclick="openRoleModal('${m.id}')">Role</button>` : ''}
                  </div>
                </td>
              </tr>
            `
          }).join('')}
        </tbody>
      </table>
    `

    // Pagination controls
    if (res.pages > 1) {
      pagination.classList.remove('hidden')
      document.getElementById('members-page-info').textContent = `Page ${res.page} of ${res.pages} (${res.total} members)`
      document.getElementById('members-prev-btn').disabled = res.page <= 1
      document.getElementById('members-next-btn').disabled = res.page >= res.pages
    } else {
      pagination.classList.add('hidden')
    }
  } catch {
    container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">Failed to load members.</p>'
    pagination.classList.add('hidden')
  }
}

function currentMemberFilters() {
  return {
    search:      document.getElementById('member-search').value.trim(),
    status:      document.getElementById('member-status-filter').value,
    householdId: _memberHouseholdFilterId,
    ministryId:  document.getElementById('member-ministry-filter').value,
  }
}

window.goMembersPage = (delta) => {
  const { search, status, householdId, ministryId } = currentMemberFilters()
  loadMembers(search, status, _membersPage + delta, householdId, ministryId)
}

// Debounced search + filter
let _memberSearchTimer = null
document.getElementById('member-search').addEventListener('input', () => {
  clearTimeout(_memberSearchTimer)
  _memberSearchTimer = setTimeout(() => {
    _membersPage = 1
    const { search, status, householdId, ministryId } = currentMemberFilters()
    loadMembers(search, status, 1, householdId, ministryId)
  }, 300)
})
;['member-status-filter', 'member-ministry-filter'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    _membersPage = 1
    const { search, status, householdId, ministryId } = currentMemberFilters()
    loadMembers(search, status, 1, householdId, ministryId)
  })
})

// ── Members household filter picker ──────────────────────────
function renderMemberHouseholdSearch(query) {
  const resultsEl = document.getElementById('member-household-filter-results')
  if (!query) {
    // Show all when input is focused but empty — useful for browsing
    const all = _memberHouseholdList.slice(0, 20)
    if (!all.length) { resultsEl.classList.add('hidden'); return }
    resultsEl.innerHTML = all.map(h =>
      `<div class="msd-item" data-id="${h.id}" data-name="${escHtml(h.name)}">${escHtml(h.name)}</div>`
    ).join('')
    resultsEl.classList.remove('hidden')
    return
  }
  const q = query.toLowerCase()
  const matches = _memberHouseholdList.filter(h => h.name.toLowerCase().includes(q)).slice(0, 20)
  if (!matches.length) {
    resultsEl.innerHTML = '<div class="msd-item" style="color:var(--color-muted)">No households found</div>'
    resultsEl.classList.remove('hidden')
    return
  }
  resultsEl.innerHTML = matches.map(h =>
    `<div class="msd-item" data-id="${h.id}" data-name="${escHtml(h.name)}">${escHtml(h.name)}</div>`
  ).join('')
  resultsEl.classList.remove('hidden')
}

document.getElementById('member-household-filter-search').addEventListener('focus', e => {
  renderMemberHouseholdSearch(e.target.value.trim())
})
document.getElementById('member-household-filter-search').addEventListener('input', e => {
  renderMemberHouseholdSearch(e.target.value.trim())
})
document.getElementById('member-household-filter-results').addEventListener('click', e => {
  const item = e.target.closest('.msd-item')
  if (!item || !item.dataset.id) return
  _memberHouseholdFilterId = item.dataset.id
  document.getElementById('member-household-filter-search').value = item.dataset.name
  document.getElementById('member-household-filter-results').classList.add('hidden')
  _membersPage = 1
  const { search, status, householdId, ministryId } = currentMemberFilters()
  loadMembers(search, status, 1, householdId, ministryId)
})
document.getElementById('member-household-filter-search').addEventListener('blur', () => {
  setTimeout(() => {
    document.getElementById('member-household-filter-results').classList.add('hidden')
    // If input was cleared, remove the filter
    if (!document.getElementById('member-household-filter-search').value.trim()) {
      if (_memberHouseholdFilterId) {
        _memberHouseholdFilterId = ''
        _membersPage = 1
        const { search, status, householdId, ministryId } = currentMemberFilters()
        loadMembers(search, status, 1, householdId, ministryId)
      }
    }
  }, 150)
})

// ── Role modal ────────────────────────────────────────────────
window.openRoleModal = (userId) => {
  const m = _membersCache.get(userId)
  if (!m) return
  _modalUserId = userId
  const name = m.profile?.fullName || m.email || ''
  document.getElementById('modal-title').textContent = `Manage Role — ${name}`
  document.getElementById('modal-alert').className   = 'hidden'

  const roleSelect = document.getElementById('modal-role')
  const allowed    = user.role === 'SUPER_ADMIN'
    ? ['MEMBER', 'STAFF', 'ADMIN', 'SUPER_ADMIN']
    : ['MEMBER', 'STAFF']
  Array.from(roleSelect.options).forEach(o => { o.hidden = !allowed.includes(o.value) })
  roleSelect.value = m.role || 'MEMBER'
  togglePermissions()

  document.getElementById('role-modal').classList.add('open')
}

window.closeRoleModal = () => {
  document.getElementById('role-modal').classList.remove('open')
  _modalUserId = null
}

document.getElementById('modal-role').addEventListener('change', togglePermissions)

function togglePermissions() {
  const isStaff = document.getElementById('modal-role').value === 'STAFF'
  document.getElementById('permissions-section').style.display = isStaff ? 'block' : 'none'
}

window.saveRole = async () => {
  const btn     = document.getElementById('modal-save-btn')
  const alertEl = document.getElementById('modal-alert')
  const role    = document.getElementById('modal-role').value
  btn.disabled = true; btn.textContent = 'Saving…'
  alertEl.className = 'hidden'

  const body = { role }
  if (role === 'STAFF') {
    body.permissions = {
      manageContent: document.getElementById('perm-manageContent').checked,
      manageGivings: document.getElementById('perm-manageGivings').checked,
      manageEvents:  document.getElementById('perm-manageEvents').checked,
      manageMembers: document.getElementById('perm-manageMembers').checked,
    }
  }

  try {
    await api.post(`/members/${_modalUserId}/promote`, body)
    window.closeRoleModal()
    loadMembers()
  } catch (err) {
    alertEl.className   = 'alert alert-danger'
    alertEl.textContent = err.message || 'Failed to update role'
  } finally {
    btn.disabled = false; btn.textContent = 'Save'
  }
}

document.getElementById('role-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) window.closeRoleModal()
})

// ── Invite links ──────────────────────────────────────────────
document.querySelectorAll('input[name="invite-type"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const isIndividual = radio.value === 'INDIVIDUAL'
    document.getElementById('invite-email-group').style.display = isIndividual ? '' : 'none'
  })
})

document.querySelectorAll('.expiry-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.expiry-chip').forEach(c => c.classList.remove('active'))
    chip.classList.add('active')
    document.getElementById('expiry-custom').style.display =
      chip.dataset.minutes === 'custom' ? '' : 'none'
  })
})

let _invitesAll = []

function inviteStatus(inv) {
  const expired = inv.expiresAt && new Date(inv.expiresAt) < new Date()
  const status  = inv.usedAt ? 'Used' : expired ? 'Expired' : 'Active'
  const cls     = inv.usedAt ? 'badge-inactive' : expired ? 'badge-warning' : 'badge-active'
  return { status, cls }
}

async function loadInvites() {
  const container = document.getElementById('invites-list')
  try {
    const res = await api.get('/auth/invites')
    _invitesAll = res.invites
    renderInvitesList()
  } catch {
    container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">Failed to load invites.</p>'
  }
}

function renderInvitesList() {
  const container = document.getElementById('invites-list')
  if (!_invitesAll.length) {
    container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">No invite links created yet.</p>'
    return
  }

  const q      = document.getElementById('invite-search')?.value.trim().toLowerCase() || ''
  const type   = document.getElementById('invite-type-filter')?.value || ''
  const status = document.getElementById('invite-status-filter')?.value || ''

  const invites = _invitesAll.filter(inv => {
    if (type && inv.type !== type) return false
    if (status && inviteStatus(inv).status !== status) return false
    if (q && !(inv.targetEmail || '').toLowerCase().includes(q)) return false
    return true
  })

  if (!invites.length) {
    container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">No invites match your filters.</p>'
    return
  }

  container.innerHTML = `
    <table class="table-stack">
      <thead><tr><th>Type</th><th>Target</th><th>Expires</th><th>Status</th><th>Created</th><th></th></tr></thead>
      <tbody>
        ${invites.map(inv => {
          const { status, cls } = inviteStatus(inv)
          const canRevoke = !inv.usedAt
          return `<tr>
            <td data-label="Type">${inv.type === 'INDIVIDUAL' ? 'Individual' : 'Mass'}</td>
            <td data-label="Target">${inv.targetEmail ? inv.targetEmail.replace(/(?<=.).(?=[^@]*@)/g, '*') : '—'}</td>
            <td data-label="Expires">${inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString('en-KE') : '—'}</td>
            <td data-label="Status"><span class="badge ${cls}">${status}</span></td>
            <td data-label="Created">${new Date(inv.createdAt).toLocaleDateString('en-KE')}</td>
            <td data-label="">
              <div class="action-btns">
                <button class="btn btn-sm btn-outline" onclick="copyInviteLinkById('${inv.token}')">Copy Link</button>
                ${canRevoke ? `<button class="btn btn-sm btn-outline" style="color:var(--color-danger)" onclick="revokeInvite('${inv.id}', this)">Revoke</button>` : ''}
              </div>
            </td>
          </tr>`
        }).join('')}
      </tbody>
    </table>
  `
}

document.getElementById('invite-search')?.addEventListener('input', renderInvitesList)
document.getElementById('invite-type-filter')?.addEventListener('change', renderInvitesList)
document.getElementById('invite-status-filter')?.addEventListener('change', renderInvitesList)

window.createInviteLink = async () => {
  const btn      = document.getElementById('invite-create-btn')
  const alertEl  = document.getElementById('invite-alert')
  const resultEl = document.getElementById('invite-result')
  const type     = document.querySelector('input[name="invite-type"]:checked').value
  const email    = document.getElementById('invite-email').value.trim()

  alertEl.className = 'hidden'
  resultEl.classList.add('hidden')

  if (type === 'INDIVIDUAL' && !email) {
    alertEl.className = 'alert alert-danger'
    alertEl.textContent = 'Email is required for individual invites.'
    return
  }

  const activeChip = document.querySelector('.expiry-chip.active')
  let expiresInMinutes
  if (activeChip.dataset.minutes === 'custom') {
    const dateVal = document.getElementById('invite-expiry-date').value
    if (!dateVal) {
      alertEl.className = 'alert alert-danger'
      alertEl.textContent = 'Please select a custom expiry date and time.'
      return
    }
    expiresInMinutes = Math.round((new Date(dateVal) - Date.now()) / 60000)
    if (expiresInMinutes < 30) {
      alertEl.className = 'alert alert-danger'
      alertEl.textContent = 'Expiry must be at least 30 minutes from now.'
      return
    }
  } else {
    expiresInMinutes = parseInt(activeChip.dataset.minutes, 10)
  }

  btn.disabled = true
  btn.textContent = 'Generating…'
  try {
    const body = { type, expiresInMinutes }
    if (type === 'INDIVIDUAL') body.targetEmail = email
    const res = await api.post('/auth/invites', body)
    document.getElementById('invite-link-output').value = res.link
    resultEl.classList.remove('hidden')
    loadInvites()
  } catch (err) {
    alertEl.className = 'alert alert-danger'
    alertEl.textContent = err.message || 'Failed to create invite.'
  } finally {
    btn.disabled = false
    btn.textContent = 'Generate Link'
  }
}

window.copyInviteLink = () => {
  const input = document.getElementById('invite-link-output')
  navigator.clipboard.writeText(input.value).catch(() => {
    input.select()
    document.execCommand('copy')
  })
}

window.copyInviteLinkById = (token) => {
  const link = `${window.location.origin}/pages/register.html?invite=${token}`
  navigator.clipboard.writeText(link).catch(() => {
    const tmp = document.createElement('textarea')
    tmp.value = link; document.body.appendChild(tmp); tmp.select()
    document.execCommand('copy'); document.body.removeChild(tmp)
  })
}

window.revokeInvite = async (id, btn) => {
  const ok = await confirmDialog({
    title: 'Revoke invite link?',
    message: 'Anyone who has this link will no longer be able to use it.',
    confirmText: 'Revoke', danger: true,
  })
  if (!ok) return
  btn.disabled = true; btn.textContent = '…'
  try {
    await api.delete(`/auth/invites/${id}`)
    loadInvites()
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Revoke'
    toast(err.message || 'Failed to revoke invite', 'danger')
  }
}

// ── Theme ─────────────────────────────────────────────────────
const SVG_SUN  = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`
const SVG_MOON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`
const themeBtn = document.getElementById('theme-toggle')
const themeIconEl = document.getElementById('theme-icon')
function syncThemeIcon() {
  if (themeIconEl) themeIconEl.innerHTML = currentTheme() === 'dark' ? SVG_MOON : SVG_SUN
}
syncThemeIcon()
themeBtn.addEventListener('click', (e) => {
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

// ── Member edit modal ─────────────────────────────────────────
window.openMemberEditModal = async (memberId) => {
  _editMemberId = memberId
  const alertEl = document.getElementById('member-edit-alert')
  alertEl.className = 'hidden'

  // Open modal immediately with a loading state so the click feels instant
  document.getElementById('member-edit-title').textContent = 'Loading…'
  document.getElementById('member-edit-modal').classList.add('open')

  try {
    // api.get caches both calls in sessionStorage — second open is instant
    const [member, households] = await Promise.all([
      api.get(`/members/${memberId}`),
      api.get('/households'),
    ])
    const p = member.profile

    document.getElementById('edit-firstName').value       = p?.firstName    || ''
    document.getElementById('edit-lastName').value        = p?.lastName     || ''
    document.getElementById('edit-middleName').value      = p?.middleName   || ''
    document.getElementById('edit-phone').value           = member.phone || p?.phone || ''
    document.getElementById('edit-address').value         = p?.address      || ''
    document.getElementById('edit-membershipStatus').value = p?.membershipStatus || 'ACTIVE'
    document.getElementById('edit-dateOfBirth').value     = p?.dateOfBirth  ? p.dateOfBirth.split('T')[0] : ''
    document.getElementById('edit-dateJoined').value      = p?.dateJoined   ? p.dateJoined.split('T')[0]  : ''
    document.getElementById('edit-baptismDate').value     = p?.baptismDate  ? p.baptismDate.split('T')[0] : ''

    _editHouseholdList = households
    _editHouseholdId   = p?.household?.id || null
    const searchInput  = document.getElementById('edit-household-search')
    const selectedHint = document.getElementById('edit-household-selected')
    searchInput.value  = p?.household?.name || ''
    selectedHint.textContent = _editHouseholdId ? `Selected: ${p.household.name}` : 'No household assigned'

    _editMemberActive = member.isActive
    const deactivateBtn = document.getElementById('member-deactivate-btn')
    if (member.isActive) {
      deactivateBtn.textContent = 'Deactivate Account'
      deactivateBtn.style.cssText = 'border:1px solid var(--color-danger,#dc2626);color:var(--color-danger,#dc2626);background:none;'
    } else {
      deactivateBtn.textContent = 'Reactivate Account'
      deactivateBtn.style.cssText = 'border:1px solid var(--color-success,#16a34a);color:var(--color-success,#16a34a);background:none;'
    }

    document.getElementById('member-edit-title').textContent = `Edit — ${p?.fullName || member.email}`
  } catch (err) {
    window.closeMemberEditModal()
    toast('Failed to load member: ' + (err.message || 'Unknown error'), 'danger')
  }
}

window.closeMemberEditModal = () => {
  document.getElementById('member-edit-modal').classList.remove('open')
  _editMemberId = null
}

window.saveMemberEdit = async () => {
  const btn     = document.getElementById('member-edit-save-btn')
  const alertEl = document.getElementById('member-edit-alert')
  btn.disabled = true; btn.textContent = 'Saving…'
  alertEl.className = 'hidden'

  const toIso = (val) => val ? new Date(val).toISOString() : null

  const body = {
    firstName:        document.getElementById('edit-firstName').value.trim(),
    lastName:         document.getElementById('edit-lastName').value.trim(),
    middleName:       document.getElementById('edit-middleName').value.trim() || null,
    phone:            document.getElementById('edit-phone').value.trim() || undefined,
    address:          document.getElementById('edit-address').value.trim() || null,
    membershipStatus: document.getElementById('edit-membershipStatus').value,
    dateOfBirth:      toIso(document.getElementById('edit-dateOfBirth').value),
    dateJoined:       toIso(document.getElementById('edit-dateJoined').value),
    baptismDate:      toIso(document.getElementById('edit-baptismDate').value),
    householdId:      _editHouseholdId || null,
  }

  try {
    await api.put(`/members/${_editMemberId}`, body)
    window.closeMemberEditModal()
    loadMembers(
      document.getElementById('member-search').value.trim(),
      document.getElementById('member-status-filter').value,
    )
  } catch (err) {
    alertEl.className   = 'alert alert-danger'
    alertEl.textContent = err.message || 'Failed to save changes'
  } finally {
    btn.disabled = false; btn.textContent = 'Save Changes'
  }
}

window.toggleMemberActive = async () => {
  const btn     = document.getElementById('member-deactivate-btn')
  const alertEl = document.getElementById('member-edit-alert')
  btn.disabled = true
  alertEl.className = 'hidden'
  try {
    const endpoint = _editMemberActive ? 'deactivate' : 'reactivate'
    await api.post(`/members/${_editMemberId}/${endpoint}`)
    _editMemberActive = !_editMemberActive
    if (_editMemberActive) {
      btn.textContent  = 'Deactivate Account'
      btn.style.cssText = 'border:1px solid var(--color-danger,#dc2626);color:var(--color-danger,#dc2626);background:none;'
    } else {
      btn.textContent  = 'Reactivate Account'
      btn.style.cssText = 'border:1px solid var(--color-success,#16a34a);color:var(--color-success,#16a34a);background:none;'
    }
  } catch (err) {
    alertEl.className   = 'alert alert-danger'
    alertEl.textContent = err.message || 'Failed'
  } finally {
    btn.disabled = false
  }
}

document.getElementById('member-edit-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) window.closeMemberEditModal()
})

// ── Households ────────────────────────────────────────────────
let _householdsAll = []

async function loadHouseholds() {
  const container = document.getElementById('households-list')
  container.innerHTML = skeletonRows()
  try {
    const households = await api.get('/households')
    _householdsAll = households
    _householdsCache = new Map(households.map(h => [h.id, h]))
    renderHouseholdsList()
  } catch {
    container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">Failed to load households.</p>'
  }
}

function renderHouseholdsList() {
  const container = document.getElementById('households-list')
  const q = document.getElementById('household-search')?.value.trim().toLowerCase() || ''
  const households = q ? _householdsAll.filter(h => h.name.toLowerCase().includes(q)) : _householdsAll

  if (!_householdsAll.length) {
    container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">No households yet.</p>'
    return
  }
  if (!households.length) {
    container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">No households match your search.</p>'
    return
  }
  container.innerHTML = `
    <table class="table-stack">
      <thead><tr><th>Name</th><th>Members</th><th>Created</th><th></th></tr></thead>
      <tbody>
        ${households.map(h => `
          <tr>
            <td data-label="Name"><a href="#" style="color:var(--color-primary);text-decoration:none;" onclick="openHouseholdDetail('${h.id}');return false;">${escHtml(h.name)}</a></td>
            <td data-label="Members">${h.memberCount}</td>
            <td data-label="Created">${new Date(h.createdAt).toLocaleDateString('en-KE')}</td>
            <td data-label="">
              <div class="action-btns">
                <button class="btn btn-sm btn-outline" onclick="openHouseholdRenameModal('${h.id}')">Rename</button>
                <button class="btn btn-sm btn-outline" onclick="deleteHousehold('${h.id}')">Delete</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}

document.getElementById('household-search')?.addEventListener('input', renderHouseholdsList)

window.openHouseholdCreateModal = () => {
  _householdModalId = null
  document.getElementById('household-modal-title').textContent = 'New Household'
  document.getElementById('household-name-input').value = ''
  document.getElementById('household-modal-alert').className = 'hidden'
  document.getElementById('household-modal').classList.add('open')
}

window.openHouseholdRenameModal = (id) => {
  const h = _householdsCache.get(id)
  _householdModalId = id
  document.getElementById('household-modal-title').textContent = 'Rename Household'
  document.getElementById('household-name-input').value = h?.name || ''
  document.getElementById('household-modal-alert').className = 'hidden'
  document.getElementById('household-modal').classList.add('open')
}

window.closeHouseholdModal = () => {
  document.getElementById('household-modal').classList.remove('open')
}

window.saveHousehold = async () => {
  const btn     = document.getElementById('household-save-btn')
  const alertEl = document.getElementById('household-modal-alert')
  const name    = document.getElementById('household-name-input').value.trim()
  if (!name) { alertEl.className = 'alert alert-danger'; alertEl.textContent = 'Name is required.'; return }
  btn.disabled = true; btn.textContent = 'Saving…'
  alertEl.className = 'hidden'
  try {
    if (_householdModalId) {
      await api.put(`/households/${_householdModalId}`, { name })
    } else {
      await api.post('/households', { name })
    }
    window.closeHouseholdModal()
    loadHouseholds()
  } catch (err) {
    alertEl.className   = 'alert alert-danger'
    alertEl.textContent = err.message || 'Failed to save'
  } finally {
    btn.disabled = false; btn.textContent = 'Save'
  }
}

window.deleteHousehold = async (id) => {
  const h = _householdsCache.get(id)
  const ok = await confirmDialog({
    title: `Delete household?`,
    message: `"${h?.name || 'This household'}" will be deleted. Members will be unassigned but not deleted.`,
    confirmText: 'Delete', danger: true,
  })
  if (!ok) return
  try {
    await api.delete(`/households/${id}`)
    loadHouseholds()
  } catch (err) {
    toast(err.message || 'Failed to delete household', 'danger')
  }
}

window.openHouseholdDetail = async (id) => {
  const h = _householdsCache.get(id)
  _householdDetailId = id
  document.getElementById('household-detail-title').textContent = h?.name || 'Household'
  document.getElementById('household-detail-members').innerHTML = '<p class="text-muted">Loading…</p>'
  document.getElementById('household-member-search').value = ''
  document.getElementById('household-member-results').classList.add('hidden')
  document.getElementById('household-detail-modal').classList.add('open')

  try {
    const [detail, slimMembers] = await Promise.all([
      api.get(`/households/${id}`),
      api.get('/members/slim'),
    ])

    const assignedIds = new Set(detail.members.map(m => m.id))
    document.getElementById('household-detail-members').innerHTML = detail.members.length
      ? detail.members.map(m => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-sm) 0;border-bottom:1px solid var(--color-border);">
            <span>${escHtml(m.firstName)} ${escHtml(m.lastName)}</span>
            <button class="btn btn-sm btn-outline" onclick="removeFromHousehold('${m.id}')">Remove</button>
          </div>
        `).join('')
      : '<p class="text-muted">No members in this household.</p>'

    _householdAvailableMembers = slimMembers
      .filter(m => !m.householdId)
  } catch {
    document.getElementById('household-detail-members').innerHTML = '<p class="text-muted">Failed to load.</p>'
  }
}

window.closeHouseholdDetailModal = () => {
  document.getElementById('household-detail-modal').classList.remove('open')
  _householdDetailId = null
}

function renderHouseholdSearch(query) {
  const resultsEl = document.getElementById('household-member-results')
  const q = query.toLowerCase()
  const matches = q
    ? _householdAvailableMembers.filter(m => m.fullName.toLowerCase().includes(q))
    : []
  if (!matches.length) { resultsEl.classList.add('hidden'); return }
  resultsEl.innerHTML = matches.slice(0, 20).map(m =>
    `<div class="msd-item" data-profile-id="${m.profileId}">${escHtml(m.fullName)}</div>`
  ).join('')
  resultsEl.classList.remove('hidden')
}

document.getElementById('household-member-search').addEventListener('input', e => {
  renderHouseholdSearch(e.target.value.trim())
})

// ── Edit-member modal: household search picker ─────────────────
function renderEditHouseholdSearch(query) {
  const resultsEl = document.getElementById('edit-household-results')
  if (!query) { resultsEl.classList.add('hidden'); return }
  const q = query.toLowerCase()
  const matches = _editHouseholdList.filter(h => h.name.toLowerCase().includes(q))
  if (!matches.length) {
    resultsEl.innerHTML = '<div class="msd-item" style="color:var(--color-muted)">No households found</div>'
    resultsEl.classList.remove('hidden')
    return
  }
  resultsEl.innerHTML = matches.slice(0, 20).map(h =>
    `<div class="msd-item" data-id="${h.id}" data-name="${escHtml(h.name)}">${escHtml(h.name)}</div>`
  ).join('')
  resultsEl.classList.remove('hidden')
}

document.getElementById('edit-household-search').addEventListener('input', e => {
  renderEditHouseholdSearch(e.target.value.trim())
})

document.getElementById('edit-household-results').addEventListener('click', e => {
  const item = e.target.closest('.msd-item')
  if (!item || !item.dataset.id) return
  _editHouseholdId = item.dataset.id
  document.getElementById('edit-household-search').value  = item.dataset.name
  document.getElementById('edit-household-selected').textContent = `Selected: ${item.dataset.name}`
  document.getElementById('edit-household-results').classList.add('hidden')
})

// Allow clearing the household by clearing the input
document.getElementById('edit-household-search').addEventListener('blur', () => {
  // Small delay so click on a result fires first
  setTimeout(() => {
    const input = document.getElementById('edit-household-search')
    if (!input.value.trim()) {
      _editHouseholdId = null
      document.getElementById('edit-household-selected').textContent = 'No household assigned'
    }
    document.getElementById('edit-household-results').classList.add('hidden')
  }, 150)
})

document.getElementById('household-member-results').addEventListener('click', async e => {
  const item = e.target.closest('.msd-item')
  if (!item) return
  const profileId = item.dataset.profileId
  item.style.opacity = '0.5'
  try {
    await api.post(`/households/${_householdDetailId}/members`, { profileId })
    document.getElementById('household-member-search').value = ''
    document.getElementById('household-member-results').classList.add('hidden')
    openHouseholdDetail(_householdDetailId)
    loadHouseholds()
  } catch (err) {
    toast(err.message || 'Failed to assign member', 'danger')
    item.style.opacity = ''
  }
})

window.removeFromHousehold = async (profileId) => {
  try {
    await api.delete(`/households/${_householdDetailId}/members/${profileId}`)
    openHouseholdDetail(_householdDetailId)
    loadHouseholds()
  } catch (err) {
    toast(err.message || 'Failed to remove member', 'danger')
  }
}

document.getElementById('household-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) window.closeHouseholdModal() })
document.getElementById('household-detail-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) window.closeHouseholdDetailModal() })

// ── Ministries ────────────────────────────────────────────────
async function loadMinistries() {
  const container  = document.getElementById('ministries-list')
  const pagination = document.getElementById('ministries-pagination')
  container.innerHTML = skeletonRows()
  try {
    const ministries = await api.get('/ministries')
    _ministriesAll   = ministries
    _ministriesCache = new Map(ministries.map(m => [m.id, m]))
    renderMinistriesPage()
  } catch {
    container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">Failed to load ministries.</p>'
    pagination.classList.add('hidden')
  }
}

function getFilteredMinistries() {
  const q      = document.getElementById('ministry-search')?.value.trim().toLowerCase() || ''
  const active = document.getElementById('ministry-active-filter')?.value || ''
  return _ministriesAll.filter(m => {
    if (active === '1' && !m.isActive) return false
    if (active === '0' && m.isActive) return false
    if (q && !m.name.toLowerCase().includes(q) && !(m.description || '').toLowerCase().includes(q)) return false
    return true
  })
}

function renderMinistriesPage() {
  const container  = document.getElementById('ministries-list')
  const pagination = document.getElementById('ministries-pagination')
  if (!_ministriesAll.length) {
    container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">No ministries yet.</p>'
    pagination.classList.add('hidden')
    return
  }
  const filtered = getFilteredMinistries()
  if (!filtered.length) {
    container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">No ministries match your filters.</p>'
    pagination.classList.add('hidden')
    return
  }
  const totalPages = Math.ceil(filtered.length / MINISTRIES_PER_PAGE)
  _ministriesPage  = Math.min(_ministriesPage, totalPages)
  const slice = filtered.slice((_ministriesPage - 1) * MINISTRIES_PER_PAGE, _ministriesPage * MINISTRIES_PER_PAGE)
  container.innerHTML = `
    <table class="table-stack">
      <thead><tr><th>Name</th><th>Description</th><th>Members</th><th>Active</th><th></th></tr></thead>
      <tbody>
        ${slice.map(m => `
          <tr>
            <td data-label="Name"><a href="#" style="color:var(--color-primary);text-decoration:none;" onclick="openMinistryDetail('${m.id}');return false;">${escHtml(m.name)}</a></td>
            <td data-label="Description">${m.description ? escHtml(m.description) : '—'}</td>
            <td data-label="Members">${m.memberCount}</td>
            <td data-label="Active">${m.isActive ? '<span class="badge badge-active">Yes</span>' : '<span class="badge badge-inactive">No</span>'}</td>
            <td data-label="">
              <div class="action-btns">
                <button class="btn btn-sm btn-outline" onclick="openMinistryDetail('${m.id}')">Members</button>
                <button class="btn btn-sm btn-outline" onclick="openMinistryEditModal('${m.id}')">Edit</button>
                <button class="btn btn-sm btn-outline" onclick="deleteMinistry('${m.id}','${escHtml(m.name)}')">Delete</button>
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
  if (totalPages > 1) {
    pagination.classList.remove('hidden')
    document.getElementById('ministries-page-info').textContent = `Page ${_ministriesPage} of ${totalPages} (${filtered.length} ministries)`
    document.getElementById('ministries-prev-btn').disabled = _ministriesPage <= 1
    document.getElementById('ministries-next-btn').disabled = _ministriesPage >= totalPages
  } else {
    pagination.classList.add('hidden')
  }
}

window.goMinistriesPage = (delta) => {
  _ministriesPage += delta
  renderMinistriesPage()
}

document.getElementById('ministry-search')?.addEventListener('input', () => {
  _ministriesPage = 1
  renderMinistriesPage()
})
document.getElementById('ministry-active-filter')?.addEventListener('change', () => {
  _ministriesPage = 1
  renderMinistriesPage()
})

window.openMinistryCreateModal = () => {
  _ministryModalId = null
  document.getElementById('ministry-modal-title').textContent = 'New Ministry'
  document.getElementById('ministry-name-input').value = ''
  document.getElementById('ministry-desc-input').value = ''
  document.getElementById('ministry-active-input').checked = true
  document.getElementById('ministry-new-role-input').value = ''
  document.getElementById('ministry-modal-alert').className = 'hidden'
  _ministryRoles = [...DEFAULT_MINISTRY_ROLES]
  renderMinistryRoleChips()
  document.getElementById('ministry-modal').classList.add('open')
}

window.openMinistryEditModal = (id) => {
  const m = _ministriesCache.get(id)
  if (!m) return
  _ministryModalId = id
  document.getElementById('ministry-modal-title').textContent = 'Edit Ministry'
  document.getElementById('ministry-name-input').value = m.name
  document.getElementById('ministry-desc-input').value = m.description || ''
  document.getElementById('ministry-active-input').checked = m.isActive
  document.getElementById('ministry-new-role-input').value = ''
  document.getElementById('ministry-modal-alert').className = 'hidden'
  _ministryRoles = [...(m.roles?.length ? m.roles : DEFAULT_MINISTRY_ROLES)]
  renderMinistryRoleChips()
  document.getElementById('ministry-modal').classList.add('open')
}

window.closeMinistryModal = () => {
  document.getElementById('ministry-modal').classList.remove('open')
}

window.saveMinistry = async () => {
  const btn     = document.getElementById('ministry-save-btn')
  const alertEl = document.getElementById('ministry-modal-alert')
  const name    = document.getElementById('ministry-name-input').value.trim()
  if (!name) { alertEl.className = 'alert alert-danger'; alertEl.textContent = 'Name is required.'; return }
  btn.disabled = true; btn.textContent = 'Saving…'
  alertEl.className = 'hidden'

  const body = {
    name,
    description: document.getElementById('ministry-desc-input').value.trim() || null,
    isActive:    document.getElementById('ministry-active-input').checked,
    roles:       _ministryRoles,
  }

  try {
    if (_ministryModalId) {
      await api.put(`/ministries/${_ministryModalId}`, body)
    } else {
      await api.post('/ministries', body)
    }
    window.closeMinistryModal()
    _ministriesPage = 1
    loadMinistries()
  } catch (err) {
    alertEl.className   = 'alert alert-danger'
    alertEl.textContent = err.message || 'Failed to save'
  } finally {
    btn.disabled = false; btn.textContent = 'Save'
  }
}

window.deleteMinistry = async (id, name) => {
  const ok = await confirmDialog({
    title: 'Delete ministry?',
    message: `"${name}" will be permanently deleted.`,
    confirmText: 'Delete', danger: true,
  })
  if (!ok) return
  try {
    await api.delete(`/ministries/${id}`)
    _ministriesPage = 1
    loadMinistries()
  } catch (err) {
    toast(err.message || 'Failed to delete ministry', 'danger')
  }
}

window.openMinistryDetail = async (id) => {
  const cached = _ministriesCache.get(id)
  _ministryDetailId = id
  document.getElementById('ministry-detail-title').textContent = cached?.name || 'Ministry Members'
  document.getElementById('ministry-detail-members').innerHTML = '<p class="text-muted">Loading…</p>'
  clearMinistrySelection()
  document.getElementById('ministry-detail-modal').classList.add('open')

  try {
    const [members, slimMembers] = await Promise.all([
      api.get(`/ministries/${id}/members`),
      api.get('/members/slim'),
    ])

    const assignedProfileIds = new Set(members.map(m => m.profileId))

    // Sort by role power — order matches the ministry's roles array; no role = last
    const ministry = _ministriesCache.get(id)
    const roleOrder = (ministry?.roles?.length ? ministry.roles : DEFAULT_MINISTRY_ROLES).map(r => r.name)
    const roleRank  = role => { const i = roleOrder.indexOf(role); return i === -1 ? roleOrder.length : i }
    const sorted    = [...members].sort((a, b) => roleRank(a.role) - roleRank(b.role))

    document.getElementById('ministry-detail-members').innerHTML = sorted.length
      ? sorted.map(m => `
          <div style="display:flex;align-items:center;justify-content:space-between;padding:var(--space-sm) 0;border-bottom:1px solid var(--color-border);" id="mm-row-${m.id}">
            <span>${escHtml(m.firstName)} ${escHtml(m.lastName)} <span class="badge badge-inactive" style="font-size:0.7rem;margin-left:4px;" id="mm-role-${m.id}">${escHtml(m.role || 'Member')}</span></span>
            <div class="action-btns">
              <button class="btn btn-sm btn-outline" onclick="openEditMinistryMemberRole('${m.id}','${escHtml(m.role || 'Member')}')">Edit Role</button>
              <button class="btn btn-sm btn-outline" onclick="removeMinistryMember('${m.profileId}')">Remove</button>
            </div>
          </div>
        `).join('')
      : '<p class="text-muted">No members in this ministry.</p>'

    _ministryAvailableMembers  = slimMembers
      .filter(m => !assignedProfileIds.has(m.profileId))
    _ministryCurrentMembers = members

    const roles = ministry?.roles?.length ? ministry.roles : DEFAULT_MINISTRY_ROLES
    const roleCounts = {}
    members.forEach(m => { if (m.role && m.role !== 'Member') roleCounts[m.role] = (roleCounts[m.role] || 0) + 1 })
    const roleSelect = document.getElementById('ministry-assign-role')
    roleSelect.innerHTML = [{ name: 'Member', max: null }, ...roles].map(r => {
      const count = roleCounts[r.name] || 0
      const full  = r.max != null && count >= r.max
      const label = r.max != null ? `${r.name} (${count}/${r.max})` : r.name
      return `<option value="${escHtml(r.name)}" ${full ? 'disabled' : ''}>${escHtml(label)}</option>`
    }).join('')
  } catch {
    document.getElementById('ministry-detail-members').innerHTML = '<p class="text-muted">Failed to load.</p>'
  }
}

window.closeMinistryDetailModal = () => {
  document.getElementById('ministry-detail-modal').classList.remove('open')
  _ministryDetailId = null
  clearMinistrySelection()
}

function renderMinistrySearch(query) {
  const resultsEl = document.getElementById('ministry-member-results')
  const q = query.toLowerCase()
  const matches = q
    ? _ministryAvailableMembers.filter(m => m.fullName.toLowerCase().includes(q))
    : []
  if (!matches.length) { resultsEl.classList.add('hidden'); return }
  resultsEl.innerHTML = matches.slice(0, 20).map(m =>
    `<div class="msd-item" data-profile-id="${m.profileId}" data-name="${escHtml(m.fullName)}">${escHtml(m.fullName)}</div>`
  ).join('')
  resultsEl.classList.remove('hidden')
}

document.getElementById('ministry-member-search').addEventListener('input', e => {
  renderMinistrySearch(e.target.value.trim())
})

document.getElementById('ministry-member-results').addEventListener('click', e => {
  const item = e.target.closest('.msd-item')
  if (!item) return
  _ministrySelectedMember = { profileId: item.dataset.profileId, fullName: item.dataset.name }
  document.getElementById('ministry-member-search').value = ''
  document.getElementById('ministry-member-results').classList.add('hidden')
  document.getElementById('ministry-search-wrap').classList.add('hidden')
  document.getElementById('ministry-selected-name').textContent = item.dataset.name
  document.getElementById('ministry-selected-member').classList.remove('hidden')
  document.getElementById('ministry-assign-role').value = 'Member'
  document.getElementById('ministry-add-btn').disabled = false
})

window.clearMinistrySelection = () => {
  _ministrySelectedMember = null
  document.getElementById('ministry-member-search').value = ''
  document.getElementById('ministry-member-results').classList.add('hidden')
  document.getElementById('ministry-search-wrap').classList.remove('hidden')
  document.getElementById('ministry-selected-member').classList.add('hidden')
  document.getElementById('ministry-assign-role').value = 'Member'
  const addBtn = document.getElementById('ministry-add-btn')
  addBtn.disabled = true
  addBtn.textContent = 'Add'
}

window.addSelectedMinistryMember = async () => {
  if (!_ministrySelectedMember) return
  const btn  = document.getElementById('ministry-add-btn')
  const role = document.getElementById('ministry-assign-role').value.trim() || 'Member'
  btn.disabled = true; btn.textContent = 'Adding…'
  try {
    await api.post(`/ministries/${_ministryDetailId}/members`, {
      profileId: _ministrySelectedMember.profileId,
      role,
    })
    clearMinistrySelection()
    openMinistryDetail(_ministryDetailId)
    loadMinistries()
  } catch (err) {
    toast(err.message || 'Failed to add member', 'danger')
    btn.disabled = false; btn.textContent = 'Add'
  }
}

window.openEditMinistryMemberRole = (membershipId, currentRole) => {
  const row = document.getElementById(`mm-row-${membershipId}`)
  if (!row) return
  const ministry  = _ministriesCache.get(_ministryDetailId)
  const roles     = ministry?.roles?.length ? ministry.roles : DEFAULT_MINISTRY_ROLES
  const roleCounts = {}
  _ministryCurrentMembers
    .filter(m => m.id !== membershipId)
    .forEach(m => { if (m.role && m.role !== 'Member') roleCounts[m.role] = (roleCounts[m.role] || 0) + 1 })
  const options = [{ name: 'Member', max: null }, ...roles].map(r => {
    const count = roleCounts[r.name] || 0
    const full  = r.max != null && count >= r.max
    const label = r.max != null ? `${r.name} (${count}/${r.max})` : r.name
    return `<option value="${escHtml(r.name)}" ${r.name === currentRole ? 'selected' : ''} ${full ? 'disabled' : ''}>${escHtml(label)}</option>`
  }).join('')
  const roleEl    = document.getElementById(`mm-role-${membershipId}`)
  const actionDiv = row.querySelector('.action-btns')
  roleEl.outerHTML = `<select id="mm-role-input-${membershipId}" class="form-select" style="width:160px;padding:0.3rem 0.5rem;font-size:var(--font-size-sm);display:inline-block;">${options}</select>`
  actionDiv.innerHTML = `
    <button class="btn btn-sm btn-primary" onclick="saveMinistryMemberRole('${membershipId}')">Save</button>
    <button class="btn btn-sm btn-outline" onclick="openMinistryDetail('${_ministryDetailId}')">Cancel</button>
  `
}

window.saveMinistryMemberRole = async (membershipId) => {
  const input = document.getElementById(`mm-role-input-${membershipId}`)
  const role  = input?.value.trim()
  if (!role) return
  try {
    await api.patch(`/ministries/${_ministryDetailId}/members/${membershipId}`, { role })
    openMinistryDetail(_ministryDetailId)
  } catch (err) {
    toast(err.message || 'Failed to update role', 'danger')
  }
}

window.removeMinistryMember = async (profileId) => {
  try {
    await api.delete(`/ministries/${_ministryDetailId}/members/${profileId}`)
    openMinistryDetail(_ministryDetailId, document.getElementById('ministry-detail-title').textContent)
    loadMinistries()
  } catch (err) {
    toast(err.message || 'Failed to remove member', 'danger')
  }
}

document.getElementById('ministry-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) window.closeMinistryModal() })
document.getElementById('ministry-detail-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) window.closeMinistryDetailModal() })

// ── Create member modal ───────────────────────────────────────
window.openCreateMemberModal = () => {
  document.getElementById('new-firstName').value = ''
  document.getElementById('new-lastName').value  = ''
  document.getElementById('new-email').value     = ''
  document.getElementById('new-phone').value     = ''
  document.getElementById('create-member-alert').className = 'hidden'
  document.getElementById('create-member-modal').classList.add('open')
}

window.closeCreateMemberModal = () => {
  document.getElementById('create-member-modal').classList.remove('open')
}

window.saveNewMember = async () => {
  const btn     = document.getElementById('create-member-save-btn')
  const alertEl = document.getElementById('create-member-alert')
  const email   = document.getElementById('new-email').value.trim()
  alertEl.className = 'hidden'
  btn.disabled = true; btn.textContent = 'Adding…'
  try {
    await api.post('/members', {
      firstName: document.getElementById('new-firstName').value.trim(),
      lastName:  document.getElementById('new-lastName').value.trim(),
      email,
      phone:     document.getElementById('new-phone').value.trim() || undefined,
    })
    alertEl.className   = 'alert alert-success'
    alertEl.textContent = `Member created — a set-password email has been sent to ${email}.`
    loadMembers(
      document.getElementById('member-search').value.trim(),
      document.getElementById('member-status-filter').value,
    )
  } catch (err) {
    alertEl.className   = 'alert alert-danger'
    alertEl.textContent = err.message || 'Failed to create member'
  } finally {
    btn.disabled = false; btn.textContent = 'Add Member'
  }
}

document.getElementById('create-member-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) window.closeCreateMemberModal()
})

// ── Profile Update Requests ───────────────────────────────────
async function loadUpdateRequests() {
  const container = document.getElementById('update-requests-list')
  try {
    const res = await api.get('/members/update-requests')
    if (!res.requests.length) {
      container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">No pending update requests.</p>'
      return
    }
    container.innerHTML = `
      <table class="table-stack">
        <thead><tr><th>Member</th><th>Field</th><th>Current</th><th>Proposed</th><th>Reason</th><th>Date</th><th></th></tr></thead>
        <tbody>
          ${res.requests.map(r => {
            const name = r.requestedBy?.profile
              ? `${r.requestedBy.profile.firstName} ${r.requestedBy.profile.lastName}`
              : r.requestedBy?.email || '—'
            return `<tr>
              <td data-label="Member">${escHtml(name)}</td>
              <td data-label="Field">${escHtml(r.field)}</td>
              <td data-label="Current">${r.currentValue ? escHtml(r.currentValue) : '—'}</td>
              <td data-label="Proposed">${escHtml(r.proposedValue)}</td>
              <td data-label="Reason">${r.reason ? escHtml(r.reason) : '—'}</td>
              <td data-label="Date">${new Date(r.createdAt).toLocaleDateString('en-KE')}</td>
              <td>
                <div class="action-btns">
                  <button class="btn btn-sm btn-success" onclick="approveUpdateRequest('${r.id}', this)">Approve</button>
                  <button class="btn btn-sm btn-danger" onclick="rejectUpdateRequest('${r.id}', this)">Reject</button>
                </div>
              </td>
            </tr>`
          }).join('')}
        </tbody>
      </table>
    `
  } catch {
    container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">Failed to load requests.</p>'
  }
}

async function loadUpdateRequestsCount() {
  try {
    const res   = await api.get('/members/update-requests')
    const count = res.requests.length
    _updateReqCount = count
    setRailBadge('update-requests-badge', count)
    refreshMembersRailBadge()
  } catch {}
}

window.approveUpdateRequest = async (id, btn) => {
  btn.disabled = true; btn.textContent = '…'
  try {
    await api.post(`/members/update-requests/${id}/approve`)
    btn.closest('tr').remove()
    loadUpdateRequestsCount()
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Approve'
    toast(err.message || 'Failed to approve', 'danger')
  }
}

window.rejectUpdateRequest = async (id, btn) => {
  const ok = await confirmDialog({
    title: 'Reject update request?',
    message: 'The member will be notified that their request was rejected.',
    confirmText: 'Reject', danger: true,
  })
  if (!ok) return
  btn.disabled = true; btn.textContent = '…'
  try {
    await api.post(`/members/update-requests/${id}/reject`)
    btn.closest('tr').remove()
    loadUpdateRequestsCount()
  } catch (err) {
    btn.disabled = false; btn.textContent = 'Reject'
    toast(err.message || 'Failed to reject', 'danger')
  }
}

// ── Helpers ───────────────────────────────────────────────────
function formatRole(role) {
  const labels = { MEMBER: 'Member', STAFF: 'Staff', ADMIN: 'Admin', SUPER_ADMIN: 'Super Admin', LEGEND: 'Legend', PENDING: 'Pending' }
  return labels[role] || role
}

function roleLevel(role) {
  return { PENDING: 0, MEMBER: 1, STAFF: 2, ADMIN: 3, SUPER_ADMIN: 4, LEGEND: 5 }[role] ?? -1
}

function skeletonRows(n = 6) {
  return Array(n).fill('<div class="skeleton-row"></div>').join('')
}

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// ── Ministry role chip manager ─────────────────────────────────
function renderMinistryRoleChips() {
  const container = document.getElementById('ministry-roles-chips')
  if (!container) return
  container.innerHTML = _ministryRoles.map((r, i) => {
    const label = r.max != null ? `${escHtml(r.name)} · max ${r.max}` : escHtml(r.name)
    return `<span class="role-chip">${label} <button type="button" class="remove-role-chip" data-index="${i}" aria-label="Remove ${escHtml(r.name)}">×</button></span>`
  }).join('')
}

document.getElementById('ministry-roles-chips').addEventListener('click', e => {
  const btn = e.target.closest('.remove-role-chip')
  if (!btn) return
  _ministryRoles.splice(parseInt(btn.dataset.index), 1)
  renderMinistryRoleChips()
})

window.addMinistryRoleChip = () => {
  const nameInput = document.getElementById('ministry-new-role-input')
  const maxInput  = document.getElementById('ministry-new-role-max')
  const name = nameInput.value.trim()
  if (!name) return
  if (_ministryRoles.some(r => r.name.toLowerCase() === name.toLowerCase())) {
    nameInput.value = ''; return
  }
  const maxVal = maxInput ? parseInt(maxInput.value, 10) : NaN
  _ministryRoles.push({ name, max: (!isNaN(maxVal) && maxVal > 0) ? maxVal : null })
  nameInput.value = ''
  if (maxInput) maxInput.value = ''
  renderMinistryRoleChips()
}

document.getElementById('ministry-new-role-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); addMinistryRoleChip() }
})

// ── Content / News / Events ───────────────────────────────────

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

// ── News section (all roles) ──────────────────────────────────

async function loadNews(page = 1, append = false) {
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

;['news-type-filter', 'news-unseen-filter'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => loadNews(1))
})
let _newsFilterTimer = null
;['news-category-filter', 'news-from-filter', 'news-to-filter'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => {
    clearTimeout(_newsFilterTimer)
    _newsFilterTimer = setTimeout(() => loadNews(1), 400)
  })
})

// ── Events section ────────────────────────────────────────────

async function loadEvents(page = 1, append = false) {
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
;['events-unseen-filter'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => loadEvents(1))
})
;['events-category-filter', 'events-from-filter', 'events-to-filter'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => {
    clearTimeout(_eventsFilterTimer)
    _eventsFilterTimer = setTimeout(() => loadEvents(1), 400)
  })
})

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

let _detailOpenId = null

window.openNewsDetail = async (id) => {
  _detailOpenId = id
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

// Wire segmented controls
;(function wireContentSegments() {
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
}())

async function loadContentAdmin(page = 1, append = false) {
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
    openAttendeesModal(_attendeesEventId, _attendeesTitle)
  } catch (err) { toast(err.message || 'Failed to record payment', 'danger') }
}

window.unpayTicket = async (userId) => {
  try {
    await api.post(`/content/${_attendeesEventId}/registrations/${userId}/unpay`, {})
    openAttendeesModal(_attendeesEventId, _attendeesTitle)
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

function startNotifPoll() {
  fetchNotifications()
  setInterval(fetchNotifications, 60_000)
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

let _aboutData = null

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

async function loadAboutEditor() {
  const container = document.getElementById('about-editor-form')
  container.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">Loading…</p>'
  try {
    _aboutData = await api.get('/site/about')
    container.innerHTML = buildAboutForm(_aboutData)
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

// ── Givings ───────────────────────────────────────────────────

function fmtKES(n) {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(Number(n) || 0)
}

function paymentLabel(method) {
  return { CASH: 'Cash', MPESA: 'M-Pesa', BANK_TRANSFER: 'Bank Transfer', CARD: 'Card', OTHER: 'Other' }[method] || method
}

// ── Giving Reports (admin/treasurer) ──────────────────────────

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
let _reportsInit = false

async function loadGivingReports() {
  if (!_reportsInit) {
    _reportsInit = true

    // Year picker — current year back to 2020
    const yearSel = document.getElementById('report-year')
    const thisYear = new Date().getFullYear()
    yearSel.innerHTML = ''
    for (let y = thisYear; y >= 2020; y--) {
      yearSel.innerHTML += `<option value="${y}">${y}</option>`
    }

    // Default date range — start of this year to today
    document.getElementById('report-from').value = `${thisYear}-01-01`
    document.getElementById('report-to').value = new Date().toISOString().slice(0, 10)

    // Project filter
    try {
      const projects = await api.get('/givings/projects')
      document.getElementById('report-project').innerHTML = '<option value="">All projects</option>' +
        projects.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('')
    } catch { /* leave default */ }

    yearSel.addEventListener('change', loadSummaryReport)
    document.getElementById('report-project').addEventListener('change', loadRangeReport)
    let timer = null
    ;['report-from', 'report-to'].forEach(id => {
      document.getElementById(id).addEventListener('input', () => {
        clearTimeout(timer)
        timer = setTimeout(loadRangeReport, 400)
      })
    })
  }

  loadSummaryReport()
  loadRangeReport()
}

async function loadSummaryReport() {
  const cardsEl  = document.getElementById('summary-cards')
  const tablesEl = document.getElementById('summary-tables')
  tablesEl.innerHTML = skeletonRows()
  try {
    const year = document.getElementById('report-year').value
    const res = await api.get(`/givings/summary?year=${year}`)

    cardsEl.innerHTML = `
      <div class="giving-stat-card">
        <div class="giving-stat-value">${fmtKES(res.total)}</div>
        <div class="giving-stat-label">Total — ${res.year} (${res.count})</div>
      </div>`

    const projectRows = res.byProject.length
      ? res.byProject.map(b => `<tr><td>${escHtml(b.projectName)}</td><td>${fmtKES(b.total)}</td><td>${b.count}</td></tr>`).join('')
      : '<tr><td colspan="3" class="text-muted">No givings recorded this year.</td></tr>'

    const monthRows = res.byMonth
      .map((m, i) => ({ ...m, label: MONTH_NAMES[i] }))
      .filter(m => Number(m.total) > 0)
    const monthsHtml = monthRows.length
      ? monthRows.map(m => `<tr><td>${m.label}</td><td>${fmtKES(m.total)}</td><td>${m.count}</td></tr>`).join('')
      : '<tr><td colspan="3" class="text-muted">No givings recorded this year.</td></tr>'

    tablesEl.innerHTML = `
      <table>
        <thead><tr><th>By Project</th><th>Amount</th><th>Count</th></tr></thead>
        <tbody>${projectRows}</tbody>
      </table>
      <table style="margin-top:var(--space-lg)">
        <thead><tr><th>By Month</th><th>Amount</th><th>Count</th></tr></thead>
        <tbody>${monthsHtml}</tbody>
      </table>`
  } catch {
    tablesEl.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">Failed to load summary.</p>'
  }
}

async function loadRangeReport() {
  const totalEl  = document.getElementById('report-total')
  const tablesEl = document.getElementById('report-tables')
  tablesEl.innerHTML = skeletonRows()
  try {
    const params = new URLSearchParams()
    const from = document.getElementById('report-from').value
    const to   = document.getElementById('report-to').value
    const projectId = document.getElementById('report-project').value
    if (from)      params.append('from', new Date(from).toISOString())
    if (to)        params.append('to', new Date(to + 'T23:59:59').toISOString())
    if (projectId) params.append('projectId', projectId)

    const res = await api.get(`/givings/report?${params.toString()}`)
    totalEl.textContent = `Total: ${fmtKES(res.total)} across ${res.count} giving${res.count === 1 ? '' : 's'}`

    const projectRows = res.byProject.length
      ? res.byProject.map(b => `<tr><td>${escHtml(b.projectName)}</td><td>${fmtKES(b.total)}</td><td>${b.count}</td></tr>`).join('')
      : '<tr><td colspan="3" class="text-muted">No givings in this range.</td></tr>'

    const methodRows = res.byMethod.length
      ? res.byMethod.map(b => `<tr><td>${paymentLabel(b.paymentMethod)}</td><td>${fmtKES(b.total)}</td><td>${b.count}</td></tr>`).join('')
      : '<tr><td colspan="3" class="text-muted">No givings in this range.</td></tr>'

    tablesEl.innerHTML = `
      <table>
        <thead><tr><th>By Project</th><th>Amount</th><th>Count</th></tr></thead>
        <tbody>${projectRows}</tbody>
      </table>
      <table style="margin-top:var(--space-lg)">
        <thead><tr><th>By Method</th><th>Amount</th><th>Count</th></tr></thead>
        <tbody>${methodRows}</tbody>
      </table>`
  } catch {
    tablesEl.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">Failed to load report.</p>'
  }
}

window.downloadReceipt = async (id) => {
  try {
    await api.download(`/givings/${id}/receipt`, `receipt-${id.slice(-8)}.pdf`)
  } catch (err) {
    toast('Failed to download receipt: ' + (err.message || ''), 'danger')
  }
}

// ── My Givings (member view) ──────────────────────────────────

let _correctionGivingId = null

async function loadMyGivings() {
  const summaryEl = document.getElementById('my-givings-summary')
  const listEl    = document.getElementById('my-givings-list')
  listEl.innerHTML = skeletonRows()
  loadMyPledges()
  try {
    const res = await api.get('/givings/mine')
    // Summary cards
    summaryEl.innerHTML = `
      <div class="giving-stat-card">
        <div class="giving-stat-value">${fmtKES(res.totalGiven)}</div>
        <div class="giving-stat-label">Total Given</div>
      </div>
      ${res.byProject.map(b => `
        <div class="giving-stat-card">
          <div class="giving-stat-value">${fmtKES(b.total)}</div>
          <div class="giving-stat-label">${escHtml(b.projectName)} (${b.count})</div>
        </div>
      `).join('')}
    `
    if (!res.items.length) {
      listEl.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">No giving records yet.</p>'
      return
    }
    listEl.innerHTML = `
      <table class="table-stack">
        <thead><tr><th>Project</th><th>Amount</th><th>Method</th><th>Date</th><th>Reference</th><th></th></tr></thead>
        <tbody>
          ${res.items.map(g => `
            <tr>
              <td data-label="Project">${escHtml(g.projectName || '—')}</td>
              <td data-label="Amount">${fmtKES(g.amount)}</td>
              <td data-label="Method">${paymentLabel(g.paymentMethod)}</td>
              <td data-label="Date">${new Date(g.givenAt).toLocaleDateString('en-KE')}</td>
              <td data-label="Reference">${g.reference ? escHtml(g.reference) : '—'}</td>
              <td>
                <div class="action-btns">
                  <button class="btn btn-sm btn-outline" onclick="downloadReceipt('${g.id}')">Receipt</button>
                  <button class="btn btn-sm btn-outline" onclick="openCorrectionRequestModal('${g.id}',${JSON.stringify(g)})">Request Correction</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  } catch {
    listEl.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">Failed to load giving history.</p>'
  }
}

// ── Pledges ───────────────────────────────────────────────────

function pledgeBar(p) {
  const cls = p.status !== 'ACTIVE' ? 'muted' : (p.onTrack ? 'ok' : 'behind')
  return `<div class="pledge-bar"><span class="pledge-bar-fill ${cls}" style="width:${p.percent}%"></span></div>`
}

async function loadMyPledges() {
  const el = document.getElementById('my-pledges-list')
  if (!el) return
  el.innerHTML = '<p class="text-muted">Loading…</p>'
  try {
    const res = await api.get('/givings/pledges/mine')
    if (!res.pledges.length) {
      el.innerHTML = '<p class="text-muted">No pledges yet.</p>'
      return
    }
    el.innerHTML = res.pledges.map(p => `
      <div class="pledge-card">
        <div class="pledge-card-head">
          <strong>${escHtml(p.projectName || '—')}</strong>
          <span class="badge badge-${p.status === 'ACTIVE' ? 'active' : 'inactive'}">${p.status}</span>
        </div>
        <div class="text-muted" style="font-size:var(--font-size-sm)">${fmtKES(p.totalAmount)} over ${p.months} month${p.months !== 1 ? 's' : ''} · ${fmtKES(p.monthlyExpected)}/mo</div>
        ${pledgeBar(p)}
        <div class="pledge-card-foot">
          <span>${fmtKES(p.fulfilled)} of ${fmtKES(p.totalAmount)} (${p.percent}%)</span>
          ${p.status === 'ACTIVE' ? `<button class="btn btn-sm btn-ghost" onclick="cancelPledge('${p.id}')">Cancel</button>` : ''}
        </div>
      </div>
    `).join('')
  } catch {
    el.innerHTML = '<p class="text-muted">Failed to load pledges.</p>'
  }
}

let _pledgeFilterMemberId = ''
let _pledgeSlimMembers    = []

async function loadPledgesAdmin() {
  const el = document.getElementById('pledges-list')
  el.innerHTML = skeletonRows()
  try {
    // Populate project filter on first load
    const projectSel = document.getElementById('pledge-project-filter')
    if (projectSel && projectSel.options.length <= 1) {
      const projects = await api.get('/givings/projects')
      projectSel.innerHTML = '<option value="">All projects</option>' +
        projects.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('')
    }

    const params = new URLSearchParams()
    if (_pledgeFilterMemberId)                                       params.append('memberId', _pledgeFilterMemberId)
    if (document.getElementById('pledge-project-filter')?.value)     params.append('projectId', document.getElementById('pledge-project-filter').value)
    if (document.getElementById('pledge-status-filter')?.value)      params.append('status', document.getElementById('pledge-status-filter').value)

    const res = await api.get('/givings/pledges?' + params.toString())
    if (!res.pledges.length) {
      el.innerHTML = params.toString()
        ? '<p class="text-muted" style="padding:var(--space-lg)">No pledges match your filters.</p>'
        : '<p class="text-muted" style="padding:var(--space-lg)">No pledges yet.</p>'
      return
    }
    el.innerHTML = `
      <table class="table-stack">
        <thead><tr><th>Member</th><th>Project</th><th>Total</th><th>Monthly</th><th>Progress</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${res.pledges.map(p => `
            <tr>
              <td data-label="Member">${escHtml(p.memberName || '—')}</td>
              <td data-label="Project">${escHtml(p.projectName || '—')}</td>
              <td data-label="Total">${fmtKES(p.totalAmount)}</td>
              <td data-label="Monthly">${fmtKES(p.monthlyExpected)}</td>
              <td data-label="Progress" style="min-width:160px">${pledgeBar(p)}<span style="font-size:var(--font-size-sm);color:var(--color-text-muted)">${fmtKES(p.fulfilled)} (${p.percent}%)</span></td>
              <td data-label="Status"><span class="badge badge-${p.status === 'ACTIVE' ? 'active' : 'inactive'}">${p.status}</span></td>
              <td data-label="">${p.status === 'ACTIVE' ? `<button class="btn btn-sm btn-ghost" onclick="cancelPledge('${p.id}', true)">Cancel</button>` : ''}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `
  } catch {
    el.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">Failed to load pledges.</p>'
  }
}

// Pledge filter listeners
;['pledge-project-filter', 'pledge-status-filter'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => loadPledgesAdmin())
})

// Pledge filter member search picker
function renderPledgeMemberFilterSearch(query) {
  const resultsEl = document.getElementById('pledge-filter-member-results')
  if (!_pledgeSlimMembers.length) { resultsEl.classList.add('hidden'); return }
  const q = query.toLowerCase()
  const matches = q
    ? _pledgeSlimMembers.filter(m => m.fullName.toLowerCase().includes(q)).slice(0, 20)
    : _pledgeSlimMembers.slice(0, 20)
  if (!matches.length) { resultsEl.classList.add('hidden'); return }
  resultsEl.innerHTML = matches.map(m =>
    `<div class="msd-item" data-profile-id="${m.profileId}" data-name="${escHtml(m.fullName)}">${escHtml(m.fullName)}</div>`
  ).join('')
  resultsEl.classList.remove('hidden')
}

document.getElementById('pledge-filter-member-search')?.addEventListener('focus', e => {
  if (!_pledgeSlimMembers.length) {
    api.get('/members/slim').then(data => { _pledgeSlimMembers = data; renderPledgeMemberFilterSearch(e.target.value.trim()) }).catch(() => {})
  } else {
    renderPledgeMemberFilterSearch(e.target.value.trim())
  }
})
document.getElementById('pledge-filter-member-search')?.addEventListener('input', e => renderPledgeMemberFilterSearch(e.target.value.trim()))
document.getElementById('pledge-filter-member-results')?.addEventListener('click', e => {
  const item = e.target.closest('.msd-item')
  if (!item) return
  _pledgeFilterMemberId = item.dataset.profileId
  document.getElementById('pledge-filter-member-search').value = item.dataset.name
  document.getElementById('pledge-filter-member-results').classList.add('hidden')
  loadPledgesAdmin()
})
document.getElementById('pledge-filter-member-search')?.addEventListener('blur', () => {
  setTimeout(() => {
    document.getElementById('pledge-filter-member-results')?.classList.add('hidden')
    if (!document.getElementById('pledge-filter-member-search').value.trim() && _pledgeFilterMemberId) {
      _pledgeFilterMemberId = ''
      loadPledgesAdmin()
    }
  }, 150)
})

window.cancelPledge = async (id, isAdmin = false) => {
  const ok = await confirmDialog({ title: 'Cancel this pledge?', message: 'The pledge will be marked cancelled.', confirmText: 'Cancel pledge', danger: true })
  if (!ok) return
  try {
    await api.patch(`/givings/pledges/${id}/cancel`, {})
    isAdmin ? loadPledgesAdmin() : loadMyPledges()
    toast('Pledge cancelled', 'success')
  } catch (err) { toast(err.message || 'Failed to cancel', 'danger') }
}

// ── Pledge modal (shared: 'admin' shows member picker, 'self' hides it) ──
let _pledgeMode = 'self'
let _pledgeMemberId = null

window.openPledgeModal = async (mode) => {
  _pledgeMode = mode
  _pledgeMemberId = null
  document.getElementById('pledge-modal-alert').className = 'hidden'
  document.getElementById('pledge-total-input').value = ''
  document.getElementById('pledge-months-input').value = ''
  document.getElementById('pledge-note-input').value = ''
  clearPledgeMember()

  const memberGroup = document.getElementById('pledge-member-group')
  memberGroup.style.display = mode === 'admin' ? '' : 'none'
  if (mode === 'admin' && !_givingModalMembers.length) {
    _givingModalMembers = await api.get('/members/slim').catch(() => [])
  }

  const projectSel = document.getElementById('pledge-project-input')
  const projects = await api.get('/givings/projects?active=1').catch(() => [])
  projectSel.innerHTML = projects.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('')

  document.getElementById('pledge-modal').classList.add('open')
}

window.closePledgeModal = () => document.getElementById('pledge-modal').classList.remove('open')

function setPledgeMember(profileId, name) {
  _pledgeMemberId = profileId
  document.getElementById('pledge-member-results').classList.add('hidden')
  document.getElementById('pledge-member-search').closest('.member-search-wrap').style.display = 'none'
  document.getElementById('pledge-member-selected-name').textContent = name
  document.getElementById('pledge-member-selected').classList.remove('hidden')
}

window.clearPledgeMember = () => {
  _pledgeMemberId = null
  const search = document.getElementById('pledge-member-search')
  search.value = ''
  document.getElementById('pledge-member-results').classList.add('hidden')
  document.getElementById('pledge-member-selected').classList.add('hidden')
  search.closest('.member-search-wrap').style.display = ''
}

document.getElementById('pledge-member-search')?.addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase()
  const resultsEl = document.getElementById('pledge-member-results')
  const matches = q ? _givingModalMembers.filter(m => m.fullName.toLowerCase().includes(q)).slice(0, 20) : []
  if (!matches.length) { resultsEl.classList.add('hidden'); return }
  resultsEl.innerHTML = matches.map(m => `<div class="msd-item" data-profile-id="${m.profileId}" data-name="${escHtml(m.fullName)}">${escHtml(m.fullName)}</div>`).join('')
  resultsEl.classList.remove('hidden')
})
document.getElementById('pledge-member-results')?.addEventListener('click', e => {
  const item = e.target.closest('.msd-item')
  if (item) setPledgeMember(item.dataset.profileId, item.dataset.name)
})

window.savePledge = async () => {
  const alertEl = document.getElementById('pledge-modal-alert')
  alertEl.className = 'hidden'
  const projectId = document.getElementById('pledge-project-input').value
  const totalAmount = parseFloat(document.getElementById('pledge-total-input').value)
  const months = parseInt(document.getElementById('pledge-months-input').value)
  if (!projectId) { alertEl.className = 'alert alert-danger'; alertEl.textContent = 'Project is required.'; return }
  if (!totalAmount || totalAmount <= 0) { alertEl.className = 'alert alert-danger'; alertEl.textContent = 'Enter a positive total amount.'; return }
  if (!months || months < 1) { alertEl.className = 'alert alert-danger'; alertEl.textContent = 'Enter a number of months.'; return }
  if (_pledgeMode === 'admin' && !_pledgeMemberId) { alertEl.className = 'alert alert-danger'; alertEl.textContent = 'Select a member.'; return }

  const body = {
    projectId, totalAmount, months,
    note: document.getElementById('pledge-note-input').value.trim() || null,
    ...(_pledgeMode === 'admin' ? { memberId: _pledgeMemberId } : {}),
  }
  const btn = document.getElementById('pledge-save-btn')
  btn.disabled = true; btn.textContent = 'Saving…'
  try {
    await api.post('/givings/pledges', body)
    closePledgeModal()
    _pledgeMode === 'admin' ? loadPledgesAdmin() : loadMyPledges()
    toast('Pledge created', 'success')
  } catch (err) {
    alertEl.className = 'alert alert-danger'
    alertEl.textContent = err.message || 'Failed to create pledge'
  } finally {
    btn.disabled = false; btn.textContent = 'Save Pledge'
  }
}

document.getElementById('pledge-modal')?.addEventListener('click', e => {
  if (e.target === e.currentTarget) closePledgeModal()
})

// ── Correction request modal (member) ─────────────────────────

window.openCorrectionRequestModal = (givingId, giving) => {
  _correctionGivingId = givingId
  document.getElementById('correction-request-alert').className = 'hidden'
  document.getElementById('correction-reason-input').value    = ''
  document.getElementById('correction-amount-input').value    = ''
  document.getElementById('correction-reference-input').value = ''
  document.getElementById('correction-giving-summary').innerHTML = `
    <div><strong>Project:</strong> ${escHtml(giving.projectName || '—')}</div>
    <div><strong>Amount:</strong> ${fmtKES(giving.amount)}</div>
    <div><strong>Method:</strong> ${paymentLabel(giving.paymentMethod)}</div>
    <div><strong>Date:</strong> ${new Date(giving.givenAt).toLocaleDateString('en-KE')}</div>
    ${giving.reference ? `<div><strong>Reference:</strong> ${escHtml(giving.reference)}</div>` : ''}
  `
  document.getElementById('correction-request-modal').classList.add('open')
}

window.closeCorrectionRequestModal = () => {
  document.getElementById('correction-request-modal').classList.remove('open')
  _correctionGivingId = null
}

window.submitCorrectionRequest = async () => {
  const btn     = document.getElementById('correction-request-save-btn')
  const alertEl = document.getElementById('correction-request-alert')
  const reason  = document.getElementById('correction-reason-input').value.trim()
  const amount  = document.getElementById('correction-amount-input').value.trim()
  const ref     = document.getElementById('correction-reference-input').value.trim()
  alertEl.className = 'hidden'
  if (!reason) {
    alertEl.className = 'alert alert-danger'; alertEl.textContent = 'Reason is required.'; return
  }
  const proposedData = {}
  if (amount)  proposedData.amount    = parseFloat(amount)
  if (ref)     proposedData.reference = ref
  btn.disabled = true; btn.textContent = 'Submitting…'
  try {
    await api.post(`/givings/${_correctionGivingId}/request-update`, { reason, proposedData })
    window.closeCorrectionRequestModal()
    toast('Correction request submitted', 'success')
  } catch (err) {
    alertEl.className = 'alert alert-danger'
    alertEl.textContent = err.message || 'Failed to submit request'
  } finally {
    btn.disabled = false; btn.textContent = 'Submit'
  }
}

document.getElementById('correction-request-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) window.closeCorrectionRequestModal()
})

// ── Givings Ledger (admin view) ───────────────────────────────

let _ledgerPage          = 1
let _ledgerMemberFilterId = ''
let _ledgerSlimMembers    = []
let _givingEditId         = null
let _givingModalMembers   = []

async function loadGivingsLedger(page = 1) {
  _ledgerPage = page
  const listEl    = document.getElementById('ledger-list')
  const pagEl     = document.getElementById('ledger-pagination')
  const totalEl   = document.getElementById('ledger-total')
  listEl.innerHTML = skeletonRows()

  try {
    // Populate project filter on first load
    const projectSel = document.getElementById('ledger-project-filter')
    if (projectSel.options.length <= 1) {
      const projects = await api.get('/givings/projects')
      projectSel.innerHTML = '<option value="">All projects</option>' +
        projects.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('')
    }

    const params = new URLSearchParams({ page: String(page), limit: '25' })
    if (_ledgerMemberFilterId)                                     params.append('memberId', _ledgerMemberFilterId)
    if (document.getElementById('ledger-project-filter').value)   params.append('projectId', document.getElementById('ledger-project-filter').value)
    if (document.getElementById('ledger-method-filter').value)    params.append('paymentMethod', document.getElementById('ledger-method-filter').value)
    if (document.getElementById('ledger-from-filter').value)      params.append('from', new Date(document.getElementById('ledger-from-filter').value).toISOString())
    if (document.getElementById('ledger-to-filter').value)        params.append('to', new Date(document.getElementById('ledger-to-filter').value + 'T23:59:59').toISOString())
    if (document.getElementById('ledger-voided-filter').checked)  params.append('includeVoided', '1')

    const res = await api.get('/givings?' + params.toString())

    if (totalEl) totalEl.textContent = `Total: ${fmtKES(res.totalAmount)} across ${res.total} record${res.total !== 1 ? 's' : ''}`

    if (!res.items.length) {
      listEl.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">No givings found.</p>'
      pagEl?.classList.add('hidden'); return
    }

    listEl.innerHTML = `
      <table class="table-stack">
        <thead><tr><th>Member</th><th>Project</th><th>Amount</th><th>Method</th><th>Date</th><th>Ref</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${res.items.map(g => {
            const memberCell = g.isAnonymous
              ? (g.memberNameActual
                  ? `<em>Anonymous</em> <span style="color:var(--color-text-muted);font-size:0.75em;">(${escHtml(g.memberNameActual)})</span>`
                  : '<em>Anonymous</em>')
              : (g.memberName ? escHtml(g.memberName) : '<span class="text-muted">—</span>')
            const voidedStyle = g.voided ? 'opacity:0.55;' : ''
            return `
              <tr style="${voidedStyle}">
                <td data-label="Member">${memberCell}</td>
                <td data-label="Project">${escHtml(g.projectName || '—')}</td>
                <td data-label="Amount">${fmtKES(g.amount)}</td>
                <td data-label="Method">${paymentLabel(g.paymentMethod)}</td>
                <td data-label="Date" style="white-space:nowrap;">${new Date(g.givenAt).toLocaleDateString('en-KE')}</td>
                <td data-label="Ref">${g.reference ? escHtml(g.reference) : '—'}</td>
                <td data-label="Status">${g.voided ? '<span class="badge badge-inactive">Voided</span>' : '<span class="badge badge-active">Active</span>'}</td>
                <td>
                  <div class="action-btns">
                    ${!g.voided ? `<button class="btn btn-sm btn-outline" onclick="downloadReceipt('${g.id}')">Receipt</button>` : ''}
                    ${!g.voided ? `<button class="btn btn-sm btn-outline" onclick="openGivingModal('${g.id}')">Edit</button>` : ''}
                    ${!g.voided ? `<button class="btn btn-sm btn-outline" style="color:var(--color-danger)" onclick="voidGivingItem('${g.id}')">Void</button>` : ''}
                  </div>
                </td>
              </tr>
            `
          }).join('')}
        </tbody>
      </table>
    `

    if (res.pages > 1) {
      pagEl?.classList.remove('hidden')
      document.getElementById('ledger-page-info').textContent = `Page ${res.page} of ${res.pages}`
      document.getElementById('ledger-prev-btn').disabled = res.page <= 1
      document.getElementById('ledger-next-btn').disabled = res.page >= res.pages
    } else {
      pagEl?.classList.add('hidden')
    }
  } catch {
    listEl.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">Failed to load givings.</p>'
  }
}

window.goLedgerPage = (delta) => loadGivingsLedger(_ledgerPage + delta)

// Ledger filter listeners
;['ledger-project-filter', 'ledger-method-filter', 'ledger-voided-filter'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', () => { _ledgerPage = 1; loadGivingsLedger(1) })
})
let _ledgerFilterTimer = null
;['ledger-from-filter', 'ledger-to-filter'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => {
    clearTimeout(_ledgerFilterTimer)
    _ledgerFilterTimer = setTimeout(() => { _ledgerPage = 1; loadGivingsLedger(1) }, 400)
  })
})

// Ledger member search picker
function renderLedgerMemberSearch(query) {
  const resultsEl = document.getElementById('ledger-member-results')
  if (!_ledgerSlimMembers.length) { resultsEl.classList.add('hidden'); return }
  const q = query.toLowerCase()
  const matches = q
    ? _ledgerSlimMembers.filter(m => m.fullName.toLowerCase().includes(q)).slice(0, 20)
    : _ledgerSlimMembers.slice(0, 20)
  if (!matches.length) { resultsEl.classList.add('hidden'); return }
  resultsEl.innerHTML = matches.map(m =>
    `<div class="msd-item" data-profile-id="${m.profileId}" data-name="${escHtml(m.fullName)}">${escHtml(m.fullName)}</div>`
  ).join('')
  resultsEl.classList.remove('hidden')
}

document.getElementById('ledger-member-search')?.addEventListener('focus', e => {
  if (!_ledgerSlimMembers.length) {
    api.get('/members/slim').then(data => { _ledgerSlimMembers = data; renderLedgerMemberSearch(e.target.value.trim()) }).catch(() => {})
  } else {
    renderLedgerMemberSearch(e.target.value.trim())
  }
})
document.getElementById('ledger-member-search')?.addEventListener('input', e => renderLedgerMemberSearch(e.target.value.trim()))
document.getElementById('ledger-member-results')?.addEventListener('click', e => {
  const item = e.target.closest('.msd-item')
  if (!item) return
  _ledgerMemberFilterId = item.dataset.profileId
  document.getElementById('ledger-member-search').value = item.dataset.name
  document.getElementById('ledger-member-results').classList.add('hidden')
  _ledgerPage = 1; loadGivingsLedger(1)
})
document.getElementById('ledger-member-search')?.addEventListener('blur', () => {
  setTimeout(() => {
    document.getElementById('ledger-member-results')?.classList.add('hidden')
    if (!document.getElementById('ledger-member-search').value.trim() && _ledgerMemberFilterId) {
      _ledgerMemberFilterId = ''
      _ledgerPage = 1; loadGivingsLedger(1)
    }
  }, 150)
})

// ── Giving record/edit modal ──────────────────────────────────

window.openGivingModal = async (givingId) => {
  _givingEditId = givingId
  const alertEl  = document.getElementById('giving-modal-alert')
  alertEl.className = 'hidden'
  document.getElementById('giving-modal-title').textContent = givingId ? 'Edit Giving' : 'Record Giving'

  // Populate project dropdown
  const projectSel = document.getElementById('giving-project-input')
  const projects = await api.get('/givings/projects').catch(() => [])
  projectSel.innerHTML = projects.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('')

  // Load slim members for picker
  if (!_givingModalMembers.length) {
    _givingModalMembers = await api.get('/members/slim').catch(() => [])
  }

  // Reset form
  clearGivingMember()
  document.getElementById('giving-anon-check').checked = false
  document.getElementById('giving-amount-input').value = ''
  document.getElementById('giving-method-input').value = 'CASH'
  document.getElementById('giving-reference-input').value = ''
  document.getElementById('giving-note-input').value = ''
  const now = new Date(); now.setSeconds(0, 0)
  document.getElementById('giving-date-input').value = now.toISOString().slice(0, 16)

  if (givingId) {
    try {
      const g = await api.get(`/givings/${givingId}`)
      if (g.memberId) {
        setGivingMember(g.memberId, g.memberNameActual || (g.memberName !== 'Anonymous' ? g.memberName : null) || 'Member')
      }
      document.getElementById('giving-anon-check').checked     = g.isAnonymous
      projectSel.value                                          = g.projectId
      document.getElementById('giving-amount-input').value     = g.amount
      document.getElementById('giving-method-input').value     = g.paymentMethod
      document.getElementById('giving-reference-input').value  = g.reference || ''
      document.getElementById('giving-note-input').value       = g.note || ''
      document.getElementById('giving-date-input').value       = g.givenAt.slice(0, 16)
    } catch (err) {
      toast('Failed to load giving: ' + (err.message || ''), 'danger')
      return
    }
  }

  document.getElementById('giving-modal').classList.add('open')
}

window.closeGivingModal = () => {
  document.getElementById('giving-modal').classList.remove('open')
  _givingEditId = null
}

let _givingSelectedProfileId = null

function setGivingMember(profileId, name) {
  _givingSelectedProfileId = profileId
  document.getElementById('giving-member-search').value = ''
  document.getElementById('giving-member-results').classList.add('hidden')
  const wrap = document.getElementById('giving-member-search').closest('.member-search-wrap')
  if (wrap) wrap.style.display = 'none'
  document.getElementById('giving-member-selected-name').textContent = name
  document.getElementById('giving-member-selected').classList.remove('hidden')
}

window.clearGivingMember = () => {
  _givingSelectedProfileId = null
  document.getElementById('giving-member-search').value = ''
  document.getElementById('giving-member-results').classList.add('hidden')
  document.getElementById('giving-member-selected').classList.add('hidden')
  const wrap = document.getElementById('giving-member-search').closest('.member-search-wrap')
  if (wrap) wrap.style.display = ''
}

function renderGivingMemberSearch(query) {
  const resultsEl = document.getElementById('giving-member-results')
  const q = query.toLowerCase()
  const matches = q
    ? _givingModalMembers.filter(m => m.fullName.toLowerCase().includes(q)).slice(0, 20)
    : []
  if (!matches.length) { resultsEl.classList.add('hidden'); return }
  resultsEl.innerHTML = matches.map(m =>
    `<div class="msd-item" data-profile-id="${m.profileId}" data-name="${escHtml(m.fullName)}">${escHtml(m.fullName)}</div>`
  ).join('')
  resultsEl.classList.remove('hidden')
}

document.getElementById('giving-member-search')?.addEventListener('input', e => renderGivingMemberSearch(e.target.value.trim()))
document.getElementById('giving-member-results')?.addEventListener('click', e => {
  const item = e.target.closest('.msd-item')
  if (!item) return
  setGivingMember(item.dataset.profileId, item.dataset.name)
})

window.saveGiving = async () => {
  const btn     = document.getElementById('giving-save-btn')
  const alertEl = document.getElementById('giving-modal-alert')
  alertEl.className = 'hidden'
  const amount  = parseFloat(document.getElementById('giving-amount-input').value)
  const project = document.getElementById('giving-project-input').value
  if (!project)       { alertEl.className = 'alert alert-danger'; alertEl.textContent = 'Project is required.'; return }
  if (!amount || amount <= 0) { alertEl.className = 'alert alert-danger'; alertEl.textContent = 'A positive amount is required.'; return }

  const givenAt = document.getElementById('giving-date-input').value
  const body = {
    memberId:      _givingSelectedProfileId || null,
    isAnonymous:   document.getElementById('giving-anon-check').checked,
    projectId:     project,
    amount,
    paymentMethod: document.getElementById('giving-method-input').value,
    reference:     document.getElementById('giving-reference-input').value.trim() || null,
    note:          document.getElementById('giving-note-input').value.trim() || null,
    givenAt:       givenAt ? new Date(givenAt).toISOString() : undefined,
  }

  btn.disabled = true; btn.textContent = 'Saving…'
  try {
    if (_givingEditId) {
      await api.put(`/givings/${_givingEditId}`, body)
    } else {
      await api.post('/givings', body)
    }
    window.closeGivingModal()
    loadGivingsLedger(_ledgerPage)
    toast(_givingEditId ? 'Giving updated' : 'Giving recorded', 'success')
  } catch (err) {
    alertEl.className = 'alert alert-danger'
    alertEl.textContent = err.message || 'Failed to save giving'
  } finally {
    btn.disabled = false; btn.textContent = 'Save'
  }
}

window.voidGivingItem = async (id) => {
  const ok = await confirmDialog({
    title: 'Void this giving?',
    message: 'The record will be kept for audit but excluded from all totals. This cannot be undone.',
    confirmText: 'Void', danger: true,
  })
  if (!ok) return
  try {
    await api.delete(`/givings/${id}`)
    loadGivingsLedger(_ledgerPage)
    toast('Giving voided', 'success')
  } catch (err) {
    toast(err.message || 'Failed to void', 'danger')
  }
}

document.getElementById('giving-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) window.closeGivingModal()
})

// ── Giving Projects page ──────────────────────────────────────

let _projectsCache = new Map()
let _projectEditId = null

let _projectsAll = []

async function loadGivingProjects() {
  const listEl = document.getElementById('projects-list')
  listEl.innerHTML = skeletonRows()
  try {
    const projects = await api.get('/givings/projects')
    _projectsAll   = projects
    _projectsCache = new Map(projects.map(p => [p.id, p]))
    renderGivingProjectsList()
  } catch {
    listEl.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">Failed to load projects.</p>'
  }
}

function renderGivingProjectsList() {
  const listEl = document.getElementById('projects-list')
  if (!_projectsAll.length) {
    listEl.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">No projects yet.</p>'
    return
  }

  const q      = document.getElementById('project-search')?.value.trim().toLowerCase() || ''
  const active = document.getElementById('project-active-filter')?.value || ''

  const projects = _projectsAll.filter(p => {
    if (active === '1' && !p.isActive) return false
    if (active === '0' && p.isActive) return false
    if (q && !p.name.toLowerCase().includes(q) && !(p.description || '').toLowerCase().includes(q)) return false
    return true
  })

  if (!projects.length) {
    listEl.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">No projects match your filters.</p>'
    return
  }

  listEl.innerHTML = `
    <table class="table-stack">
      <thead><tr><th>Name</th><th>Description</th><th>Target</th><th>Raised</th><th>Records</th><th>Active</th><th></th></tr></thead>
      <tbody>
        ${projects.map(p => `
          <tr>
            <td data-label="Name">${escHtml(p.name)}</td>
            <td data-label="Description">${p.description ? escHtml(p.description) : '—'}</td>
            <td data-label="Target">${p.targetAmount ? fmtKES(p.targetAmount) : '—'}</td>
            <td data-label="Raised">${fmtKES(p.totalRaised)}</td>
            <td data-label="Records">${p.givingCount}</td>
            <td data-label="Active">${p.isActive ? '<span class="badge badge-active">Yes</span>' : '<span class="badge badge-inactive">No</span>'}</td>
            <td data-label="">
              <div class="action-btns">
                <button class="btn btn-sm btn-outline" onclick="openProjectModal('${p.id}')">Edit</button>
                ${p.isActive ? `<button class="btn btn-sm btn-outline" onclick="deactivateProject('${p.id}')">Deactivate</button>` : ''}
              </div>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `
}

document.getElementById('project-search')?.addEventListener('input', renderGivingProjectsList)
document.getElementById('project-active-filter')?.addEventListener('change', renderGivingProjectsList)

window.openProjectModal = (id) => {
  _projectEditId = id
  const alertEl = document.getElementById('project-modal-alert')
  alertEl.className = 'hidden'
  if (id) {
    const p = _projectsCache.get(id)
    document.getElementById('project-modal-title').textContent = 'Edit Project'
    document.getElementById('project-name-input').value   = p?.name   || ''
    document.getElementById('project-desc-input').value   = p?.description || ''
    document.getElementById('project-target-input').value = p?.targetAmount ?? ''
    document.getElementById('project-active-input').checked = p?.isActive ?? true
  } else {
    document.getElementById('project-modal-title').textContent = 'New Project'
    document.getElementById('project-name-input').value    = ''
    document.getElementById('project-desc-input').value    = ''
    document.getElementById('project-target-input').value  = ''
    document.getElementById('project-active-input').checked = true
  }
  document.getElementById('project-modal').classList.add('open')
}

window.closeProjectModal = () => {
  document.getElementById('project-modal').classList.remove('open')
  _projectEditId = null
}

window.saveProject = async () => {
  const btn     = document.getElementById('project-save-btn')
  const alertEl = document.getElementById('project-modal-alert')
  const name    = document.getElementById('project-name-input').value.trim()
  alertEl.className = 'hidden'
  if (!name) { alertEl.className = 'alert alert-danger'; alertEl.textContent = 'Name is required.'; return }
  const target = document.getElementById('project-target-input').value.trim()
  const body = {
    name,
    description: document.getElementById('project-desc-input').value.trim() || null,
    targetAmount: target ? parseFloat(target) : null,
    isActive: document.getElementById('project-active-input').checked,
  }
  btn.disabled = true; btn.textContent = 'Saving…'
  try {
    if (_projectEditId) {
      await api.put(`/givings/projects/${_projectEditId}`, body)
    } else {
      await api.post('/givings/projects', body)
    }
    window.closeProjectModal()
    loadGivingProjects()
    toast(_projectEditId ? 'Project updated' : 'Project created', 'success')
  } catch (err) {
    alertEl.className = 'alert alert-danger'
    alertEl.textContent = err.message || 'Failed to save project'
  } finally {
    btn.disabled = false; btn.textContent = 'Save'
  }
}

window.deactivateProject = async (id) => {
  const p = _projectsCache.get(id)
  const ok = await confirmDialog({
    title: 'Deactivate project?',
    message: `"${p?.name || 'This project'}" will be hidden from new giving records but historical data is preserved.`,
    confirmText: 'Deactivate', danger: false,
  })
  if (!ok) return
  try {
    await api.patch(`/givings/projects/${id}/deactivate`)
    loadGivingProjects()
    toast('Project deactivated', 'success')
  } catch (err) {
    toast(err.message || 'Failed to deactivate', 'danger')
  }
}

document.getElementById('project-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) window.closeProjectModal()
})

// ── Correction Requests (admin view) ─────────────────────────

let _correctionReviewId = null

let _correctionRequestsAll = []

function correctionStatusBadge(s) {
  const cls = s === 'APPROVED' ? 'badge-active' : s === 'REJECTED' ? 'badge-inactive' : 'badge-warning'
  return `<span class="badge ${cls}">${s.charAt(0) + s.slice(1).toLowerCase()}</span>`
}

async function loadCorrectionRequests() {
  const listEl = document.getElementById('correction-requests-list')
  listEl.innerHTML = skeletonRows()
  try {
    const res = await api.get('/givings/requests')
    _correctionRequestsAll = res.requests
    const pending = res.requests.filter(r => r.status === 'PENDING').length
    setRailBadge('giving-requests-badge', pending)
    setRailBadge('givings-badge', pending)
    renderCorrectionRequestsList()
  } catch {
    listEl.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">Failed to load requests.</p>'
  }
}

function renderCorrectionRequestsList() {
  const listEl = document.getElementById('correction-requests-list')
  if (!_correctionRequestsAll.length) {
    listEl.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">No correction requests.</p>'
    return
  }

  const status = document.getElementById('correction-status-filter')?.value || ''
  const requests = status ? _correctionRequestsAll.filter(r => r.status === status) : _correctionRequestsAll

  if (!requests.length) {
    listEl.innerHTML = '<p class="text-muted" style="padding:var(--space-lg)">No requests match this filter.</p>'
    return
  }

  listEl.innerHTML = `
    <table class="table-stack">
      <thead><tr><th>Requester</th><th>Giving</th><th>Proposed</th><th>Status</th><th>Date</th><th></th></tr></thead>
      <tbody>
        ${requests.map(r => {
          const proposed = r.proposedData || {}
          const proposedStr = Object.entries(proposed)
            .map(([k, v]) => `${k}: ${k === 'amount' ? fmtKES(v) : v}`)
            .join(', ') || '—'
          return `
            <tr>
              <td data-label="Requester">${escHtml(r.requester.name)}</td>
              <td data-label="Giving">${r.giving ? `${fmtKES(r.giving.amount)} · ${escHtml(r.giving.projectName || '—')}` : '—'}</td>
              <td data-label="Proposed" style="font-size:var(--font-size-sm);">${escHtml(proposedStr)}</td>
              <td data-label="Status">${correctionStatusBadge(r.status)}</td>
              <td data-label="Date" style="white-space:nowrap;">${new Date(r.createdAt).toLocaleDateString('en-KE')}</td>
              <td data-label="">
                ${r.status === 'PENDING' ? `<button class="btn btn-sm btn-outline" onclick="openCorrectionReviewModal('${r.id}')">Review</button>` : ''}
              </td>
            </tr>
          `
        }).join('')}
      </tbody>
    </table>
  `
}

document.getElementById('correction-status-filter')?.addEventListener('change', renderCorrectionRequestsList)

window.openCorrectionReviewModal = async (id) => {
  _correctionReviewId = id
  document.getElementById('correction-review-alert').className = 'hidden'
  document.getElementById('correction-reject-reason').value = ''
  document.getElementById('correction-review-modal').classList.add('open')
  const bodyEl = document.getElementById('correction-review-body')
  bodyEl.innerHTML = '<p class="text-muted">Loading…</p>'
  try {
    const res = await api.get('/givings/requests')
    const r = res.requests.find(x => x.id === id)
    if (!r) { bodyEl.innerHTML = '<p class="text-muted">Not found.</p>'; return }
    const g = r.giving || {}
    const proposed = r.proposedData || {}
    bodyEl.innerHTML = `
      <p style="font-size:var(--font-size-sm);color:var(--color-text-muted);margin-bottom:var(--space-md);">
        <strong>Requester:</strong> ${escHtml(r.requester.name)} — ${escHtml(r.reason)}
      </p>
      <table style="font-size:var(--font-size-sm);">
        <thead><tr><th>Field</th><th>Current</th><th>Proposed</th></tr></thead>
        <tbody>
          ${['amount','paymentMethod','reference','note'].map(f => {
            const cur = f === 'amount' ? fmtKES(g.amount) : (g[f] || '—')
            const prop = f in proposed
              ? (f === 'amount' ? fmtKES(proposed[f]) : (proposed[f] || '—'))
              : null
            if (!prop) return ''
            return `<tr><td>${f}</td><td>${cur}</td><td style="font-weight:600;color:var(--color-primary);">${escHtml(String(prop))}</td></tr>`
          }).join('')}
        </tbody>
      </table>
    `
  } catch {
    bodyEl.innerHTML = '<p class="text-muted">Failed to load details.</p>'
  }
}

window.closeCorrectionReviewModal = () => {
  document.getElementById('correction-review-modal').classList.remove('open')
  _correctionReviewId = null
}

window.resolveCorrection = async (action) => {
  const approveBtn = document.getElementById('correction-approve-btn')
  const rejectBtn  = document.getElementById('correction-reject-btn')
  const alertEl    = document.getElementById('correction-review-alert')
  alertEl.className = 'hidden'
  approveBtn.disabled = true; rejectBtn.disabled = true

  try {
    if (action === 'approve') {
      await api.post(`/givings/requests/${_correctionReviewId}/approve`)
      toast('Correction approved', 'success')
    } else {
      const reason = document.getElementById('correction-reject-reason').value.trim()
      await api.post(`/givings/requests/${_correctionReviewId}/reject`, reason ? { reason } : {})
      toast('Correction rejected', 'success')
    }
    window.closeCorrectionReviewModal()
    loadCorrectionRequests()
  } catch (err) {
    alertEl.className = 'alert alert-danger'
    alertEl.textContent = err.message || 'Failed to process request'
    approveBtn.disabled = false; rejectBtn.disabled = false
  }
}

document.getElementById('correction-review-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) window.closeCorrectionReviewModal()
})

// ── System Settings (SUPER_ADMIN) ────────────────────────────

async function loadSystemSettings() {
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

// ── About page editor ─────────────────────────────────────────

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

init()

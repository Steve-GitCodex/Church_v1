import { api } from '../api.js'
import { toast, confirmDialog } from '../ui.js'
import { escHtml, skeletonRows } from './core.js'

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

let _ministriesCache  = new Map()
let _ministryAvailableMembers = []
let _ministrySelectedMember   = null  // { profileId, fullName }
let _ministryRoles            = []    // {name, max}[] being edited in the create/edit modal
let _ministryCurrentMembers   = []    // active members loaded in detail modal, for capacity display
let _ministriesPage           = 1     // current page in ministries list (client-side)
let _ministriesAll            = []    // full list loaded from server, sliced for display
const MINISTRIES_PER_PAGE     = 10

export async function loadMinistries() {
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
  window.clearMinistrySelection()
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
  window.clearMinistrySelection()
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
    window.clearMinistrySelection()
    window.openMinistryDetail(_ministryDetailId)
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
    window.openMinistryDetail(_ministryDetailId)
  } catch (err) {
    toast(err.message || 'Failed to update role', 'danger')
  }
}

window.removeMinistryMember = async (profileId) => {
  try {
    await api.delete(`/ministries/${_ministryDetailId}/members/${profileId}`)
    window.openMinistryDetail(_ministryDetailId)
    loadMinistries()
  } catch (err) {
    toast(err.message || 'Failed to remove member', 'danger')
  }
}

document.getElementById('ministry-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) window.closeMinistryModal() })
document.getElementById('ministry-detail-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) window.closeMinistryDetailModal() })

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
  if (e.key === 'Enter') { e.preventDefault(); window.addMinistryRoleChip() }
})

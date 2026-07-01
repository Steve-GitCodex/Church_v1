import { api } from '../api.js'
import { toast, confirmDialog } from '../ui.js'
import {
  user, skeletonRows, escHtml, formatRole, roleLevel, memberNameCell,
  setRailBadge, refreshMembersRailBadge, setPendingCount, setUpdateReqCount,
} from './core.js'

let _modalUserId              = null
let _editMemberId              = null
let _editMemberActive          = true
let _membersCache              = new Map()
let _editHouseholdId           = null  // household selected in edit-member modal
let _editHouseholdList         = []    // all households for search picker in edit-member modal
let _membersPage                = 1     // current page in members list
let _memberHouseholdFilterId    = ''    // selected household id in members filter
let _memberHouseholdList        = []    // all households for the members filter picker

// ── Pending approvals ─────────────────────────────────────────
export async function loadPendingCount() {
  try {
    const res   = await api.get('/members/pending')
    const count = res.pending.length
    setPendingCount(count)
    setRailBadge('pending-badge', count)
    refreshMembersRailBadge()
  } catch {}
}

export async function loadPending() {
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
export async function loadMembersPage() {
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

export async function loadInvites() {
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
export async function loadUpdateRequests() {
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

export async function loadUpdateRequestsCount() {
  try {
    const res   = await api.get('/members/update-requests')
    const count = res.requests.length
    setUpdateReqCount(count)
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

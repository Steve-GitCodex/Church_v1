import { api } from '../api.js'
import { toast, confirmDialog } from '../ui.js'
import { escHtml, skeletonRows } from './core.js'

let _householdModalId = null  // null = create, string = rename
let _householdDetailId = null
let _householdsCache = new Map()
let _householdsAll = []
let _householdAvailableMembers = []

export async function loadHouseholds() {
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

// Wires the households tab-panel — called once, right after households.html is injected.
export function wireHouseholdsPanel() {
  document.getElementById('household-search')?.addEventListener('input', renderHouseholdsList)
}

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
  const btn = document.getElementById('household-save-btn')
  const alertEl = document.getElementById('household-modal-alert')
  const name = document.getElementById('household-name-input').value.trim()
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
    alertEl.className = 'alert alert-danger'
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

document.getElementById('household-member-results').addEventListener('click', async e => {
  const item = e.target.closest('.msd-item')
  if (!item) return
  const profileId = item.dataset.profileId
  item.style.opacity = '0.5'
  try {
    await api.post(`/households/${_householdDetailId}/members`, { profileId })
    document.getElementById('household-member-search').value = ''
    document.getElementById('household-member-results').classList.add('hidden')
    window.openHouseholdDetail(_householdDetailId)
    loadHouseholds()
  } catch (err) {
    toast(err.message || 'Failed to assign member', 'danger')
    item.style.opacity = ''
  }
})

window.removeFromHousehold = async (profileId) => {
  try {
    await api.delete(`/households/${_householdDetailId}/members/${profileId}`)
    window.openHouseholdDetail(_householdDetailId)
    loadHouseholds()
  } catch (err) {
    toast(err.message || 'Failed to remove member', 'danger')
  }
}

document.getElementById('household-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) window.closeHouseholdModal() })
document.getElementById('household-detail-modal').addEventListener('click', (e) => { if (e.target === e.currentTarget) window.closeHouseholdDetailModal() })

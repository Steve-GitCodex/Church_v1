import { api } from '../api.js'
import { toast, confirmDialog } from '../ui.js'
import { escHtml, skeletonRows, fmtKES, paymentLabel, setRailBadge } from './core.js'

// ── Giving Reports (admin/treasurer) ──────────────────────────

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
let _reportsInit = false

export async function loadGivingReports() {
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

export async function loadMyGivings() {
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

export async function loadPledgesAdmin() {
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
  window.clearPledgeMember()

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
    window.closePledgeModal()
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
  if (e.target === e.currentTarget) window.closePledgeModal()
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

export async function loadGivingsLedger(page = 1) {
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

let _ledgerFilterTimer = null

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
  window.clearGivingMember()
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

export async function loadGivingProjects() {
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

export async function loadCorrectionRequests() {
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

// Wires the givings-admin tab-panels (ledger/projects/pledges/corrections) — called once,
// right after givings-admin.html is injected. The reports tab wires its own filters lazily
// inside loadGivingReports() since it only needs to run once that tab is first opened.
export function wireGivingsAdminPanel() {
  document.getElementById('ledger-project-filter')?.addEventListener('change', () => { _ledgerPage = 1; loadGivingsLedger(1) })
  document.getElementById('ledger-method-filter')?.addEventListener('change', () => { _ledgerPage = 1; loadGivingsLedger(1) })
  document.getElementById('ledger-voided-filter')?.addEventListener('change', () => { _ledgerPage = 1; loadGivingsLedger(1) })
  ;['ledger-from-filter', 'ledger-to-filter'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', () => {
      clearTimeout(_ledgerFilterTimer)
      _ledgerFilterTimer = setTimeout(() => { _ledgerPage = 1; loadGivingsLedger(1) }, 400)
    })
  })
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

  document.getElementById('project-search')?.addEventListener('input', renderGivingProjectsList)
  document.getElementById('project-active-filter')?.addEventListener('change', renderGivingProjectsList)

  ;['pledge-project-filter', 'pledge-status-filter'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => loadPledgesAdmin())
  })
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

  document.getElementById('correction-status-filter')?.addEventListener('change', renderCorrectionRequestsList)
}

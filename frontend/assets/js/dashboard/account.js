import { memberData } from './core.js'

function infoRow(label, value) {
  return `<div class="info-row"><span class="info-label">${label}</span><span>${value}</span></div>`
}

export function renderProfile() {
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

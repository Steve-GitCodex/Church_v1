// Slim entry point — wires the split dashboard modules together and kicks off init().
// Domain logic lives in ../dashboard/{core,members,households,ministries,content-admin,account,givings}.js
import {
  init, loadDashboardStats, registerTabLoaders, registerPageLoaders, registerPagePartials,
} from '../dashboard/core.js'
import {
  loadMembersPage, loadPending, loadUpdateRequests, loadPendingCount, loadUpdateRequestsCount, loadInvites,
  wireMembersPanel, wireInvitesPanel,
} from '../dashboard/members.js'
import { loadHouseholds, wireHouseholdsPanel } from '../dashboard/households.js'
import { loadMinistries, wireMinistriesPanel } from '../dashboard/ministries.js'
import {
  loadNews, loadEvents, loadContentAdmin, loadAboutEditor,
  wireUpdatesPanel, wireContentPanel,
} from '../dashboard/content-admin.js'
import { renderProfile } from '../dashboard/account.js'
import {
  loadMyGivings, loadGivingsLedger, loadGivingProjects, loadPledgesAdmin,
  loadCorrectionRequests, loadGivingReports, wireGivingsAdminPanel,
} from '../dashboard/givings.js'

// Each domain page's heavy tab-panel markup is fetched once from pages/dashboard/*.html
// and injected into the empty container left in the dashboard.html shell (see core.js).
registerPagePartials('members', [
  { key: 'members', url: 'dashboard/members.html', containerId: 'members-panels', wire: wireMembersPanel },
])
registerPagePartials('invites', [
  { key: 'invites', url: 'dashboard/invites.html', containerId: 'invites-content', wire: wireInvitesPanel },
])
registerPagePartials('groups', [
  { key: 'households', url: 'dashboard/households.html', containerId: 'households-panel', wire: wireHouseholdsPanel },
  { key: 'ministries', url: 'dashboard/ministries.html', containerId: 'ministries-panel', wire: wireMinistriesPanel },
])
registerPagePartials('updates', [
  { key: 'updates', url: 'dashboard/updates.html', containerId: 'updates-panels', wire: wireUpdatesPanel },
])
registerPagePartials('content', [
  { key: 'content', url: 'dashboard/content.html', containerId: 'content-panels', wire: wireContentPanel },
])
registerPagePartials('account', [
  { key: 'account', url: 'dashboard/account.html', containerId: 'account-panels' },
])
registerPagePartials('givings-admin', [
  { key: 'givings-admin', url: 'dashboard/givings-admin.html', containerId: 'givings-admin-panels', wire: wireGivingsAdminPanel },
])

registerTabLoaders({
  account:         { profile: () => renderProfile(),     givings: () => loadMyGivings() },
  updates:         { news: () => loadNews(1),            events: () => loadEvents(1) },
  members:         { all: () => loadMembersPage(),       pending: () => loadPending(),       requests: () => loadUpdateRequests() },
  groups:          { households: () => loadHouseholds(), ministries: () => loadMinistries() },
  content:         { posts: () => loadContentAdmin(1),   about: () => loadAboutEditor() },
  'givings-admin': { ledger: () => loadGivingsLedger(1), projects: () => loadGivingProjects(), pledges: () => loadPledgesAdmin(), corrections: () => loadCorrectionRequests(), reports: () => loadGivingReports() },
})

registerPageLoaders({
  invites: () => loadInvites(),
})

init({ loadDashboardStats, loadPendingCount, loadUpdateRequestsCount, renderProfile })

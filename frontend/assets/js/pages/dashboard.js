// Slim entry point — wires the split dashboard modules together and kicks off init().
// Domain logic lives in ../dashboard/{core,members,households,ministries,content-admin,account,givings}.js
import {
  init, loadDashboardStats, registerTabLoaders, registerPageLoaders,
} from '../dashboard/core.js'
import {
  loadMembersPage, loadPending, loadUpdateRequests, loadPendingCount, loadUpdateRequestsCount, loadInvites,
} from '../dashboard/members.js'
import { loadHouseholds } from '../dashboard/households.js'
import { loadMinistries } from '../dashboard/ministries.js'
import {
  loadNews, loadEvents, loadContentAdmin, loadAboutEditor,
} from '../dashboard/content-admin.js'
import { renderProfile } from '../dashboard/account.js'
import {
  loadMyGivings, loadGivingsLedger, loadGivingProjects, loadPledgesAdmin,
  loadCorrectionRequests, loadGivingReports,
} from '../dashboard/givings.js'

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

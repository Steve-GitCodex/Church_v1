import { Router } from 'express'
import { authenticate, requirePermission } from '../middleware/auth.js'
import {
  requireGivingsFeature,
  listProjects, createProject, updateProject, deactivateProject,
  listGivings, recordGiving, getGiving, updateGiving, voidGiving,
  listMine, requestCorrection,
  listCorrectionRequests, approveCorrection, rejectCorrection,
} from '../controllers/givings.js'
import { givingReceipt, givingSummary, givingReport } from '../controllers/givingsReports.js'
import {
  createPledge, listPledges, listMyPledges, updatePledge, cancelPledge,
} from '../controllers/pledges.js'

const router = Router()

router.use(authenticate)
router.use(requireGivingsFeature)

// Member routes — no manageGivings required (ownership enforced in controller)
router.get('/mine', listMine)
router.get('/:id/receipt', givingReceipt)
router.post('/:id/request-update', requestCorrection)

// Project management — static paths before /:id
router.get('/projects',                   requirePermission('manageGivings'), listProjects)
router.post('/projects',                  requirePermission('manageGivings'), createProject)
router.put('/projects/:id',               requirePermission('manageGivings'), updateProject)
router.patch('/projects/:id/deactivate',  requirePermission('manageGivings'), deactivateProject)

// Reports — static paths before /:id
router.get('/summary',                    requirePermission('manageGivings'), givingSummary)
router.get('/report',                     requirePermission('manageGivings'), givingReport)

// Pledges — static paths before /:id. Create/mine open to members; ownership enforced in controller.
router.get('/pledges/mine',        listMyPledges)
router.post('/pledges',            createPledge)
router.get('/pledges',             requirePermission('manageGivings'), listPledges)
router.put('/pledges/:id',         updatePledge)
router.patch('/pledges/:id/cancel', cancelPledge)

// Correction request queue
router.get('/requests',                   requirePermission('manageGivings'), listCorrectionRequests)
router.post('/requests/:id/approve',      requirePermission('manageGivings'), approveCorrection)
router.post('/requests/:id/reject',       requirePermission('manageGivings'), rejectCorrection)

// Ledger
router.get('/',    requirePermission('manageGivings'), listGivings)
router.post('/',   requirePermission('manageGivings'), recordGiving)
router.get('/:id', requirePermission('manageGivings'), getGiving)
router.put('/:id', requirePermission('manageGivings'), updateGiving)
router.delete('/:id', requirePermission('manageGivings'), voidGiving)

export default router

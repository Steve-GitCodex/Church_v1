import { Router } from 'express'
import { authenticate, requireMinRole } from '../middleware/auth.js'
import { getMe, updateMe, requestProfileUpdate, listMembers, listPending, listMembersSlim, getMember, promoteMember, updateMember, deactivateMember, reactivateMember, createMember, listUpdateRequests, approveUpdateRequest, rejectUpdateRequest } from '../controllers/members.js'

const router = Router()

router.use(authenticate)

// Own profile
router.get('/me', getMe)
router.put('/me', updateMe)
router.post('/me/request-update', requestProfileUpdate)

// Admin+ routes — static paths MUST come before /:id to avoid param capture
router.get('/pending', requireMinRole('ADMIN'), listPending)
router.get('/slim', requireMinRole('ADMIN'), listMembersSlim)
router.get('/update-requests', requireMinRole('ADMIN'), listUpdateRequests)
router.post('/update-requests/:id/approve', requireMinRole('ADMIN'), approveUpdateRequest)
router.post('/update-requests/:id/reject', requireMinRole('ADMIN'), rejectUpdateRequest)
router.get('/', requireMinRole('ADMIN'), listMembers)
router.post('/', requireMinRole('ADMIN'), createMember)
router.get('/:id', requireMinRole('ADMIN'), getMember)
router.post('/:id/promote', requireMinRole('ADMIN'), promoteMember)
router.put('/:id', requireMinRole('ADMIN'), updateMember)
router.post('/:id/deactivate', requireMinRole('ADMIN'), deactivateMember)
router.post('/:id/reactivate', requireMinRole('ADMIN'), reactivateMember)

export default router

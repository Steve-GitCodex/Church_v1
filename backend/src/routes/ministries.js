import { Router } from 'express'
import { authenticate, requireMinRole } from '../middleware/auth.js'
import { listMinistries, createMinistry, updateMinistry, deleteMinistry, listMinistryMembers, addMinistryMember, updateMinistryMember, removeMinistryMember } from '../controllers/ministries.js'

const router = Router()

router.use(authenticate, requireMinRole('ADMIN'))

router.get('/', listMinistries)
router.post('/', createMinistry)
router.put('/:id', updateMinistry)
router.delete('/:id', deleteMinistry)
router.get('/:id/members', listMinistryMembers)
router.post('/:id/members', addMinistryMember)
router.patch('/:id/members/:membershipId', updateMinistryMember)
router.delete('/:id/members/:profileId', removeMinistryMember)

export default router

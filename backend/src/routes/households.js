import { Router } from 'express'
import { authenticate, requireMinRole } from '../middleware/auth.js'
import { listHouseholds, createHousehold, getHousehold, updateHousehold, deleteHousehold, addHouseholdMember, removeHouseholdMember } from '../controllers/households.js'

const router = Router()

router.use(authenticate, requireMinRole('ADMIN'))

router.get('/', listHouseholds)
router.post('/', createHousehold)
router.get('/:id', getHousehold)
router.put('/:id', updateHousehold)
router.delete('/:id', deleteHousehold)
router.post('/:id/members', addHouseholdMember)
router.delete('/:id/members/:profileId', removeHouseholdMember)

export default router

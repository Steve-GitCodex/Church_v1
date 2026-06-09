import { Router } from 'express'
import { authenticate, requireMinRole, requireRole } from '../middleware/auth.js'
import { getAbout, updateAbout, getFeatures, updateFeatures } from '../controllers/site.js'

const router = Router()

router.get('/about', getAbout)
router.put('/about', authenticate, requireMinRole('ADMIN'), updateAbout)

// Feature flags — read public, write SUPER_ADMIN only
router.get('/features', getFeatures)
router.put('/features', authenticate, requireRole('SUPER_ADMIN', 'LEGEND'), updateFeatures)

export default router

import { Router } from 'express'
import { authenticate, requireMinRole, requirePermission, requireContentPermission } from '../middleware/auth.js'
import {
  optionalAuth,
  listContent,
  listManage,
  unseenCounts,
  markRead,
  getContent,
  createContent,
  updateContent,
  publishContent,
  archiveContent,
  restoreContent,
  toggleFeatured,
  uploadImage,
  rsvp,
  cancelRsvp,
  listRegistrations,
} from '../controllers/content.js'

const router = Router()

// ── Public + optional-auth routes (static paths BEFORE /:id) ─────────────────

router.get('/unseen-counts', authenticate, unseenCounts)
router.post('/upload',       authenticate, requireContentPermission, uploadImage)
router.get('/manage',        authenticate, requireContentPermission, listManage)

router.get('/',    optionalAuth, listContent)
router.get('/:id', optionalAuth, getContent)

// ── Protected writes ──────────────────────────────────────────────────────────

router.post('/',                authenticate, requireContentPermission, createContent)
router.put('/:id',              authenticate, requireContentPermission, updateContent)
router.post('/:id/publish',     authenticate, requireContentPermission, publishContent)
router.post('/:id/restore',     authenticate, requireContentPermission, restoreContent)
router.post('/:id/feature',     authenticate, requireContentPermission, toggleFeatured)
router.delete('/:id',           authenticate, requireContentPermission, archiveContent)

// ── Per-item read tracking (member+) ─────────────────────────────────────────

router.post('/:id/read', authenticate, requireMinRole('MEMBER'), markRead)

// ── RSVP (member+) ────────────────────────────────────────────────────────────

router.post('/:id/rsvp',         authenticate, requireMinRole('MEMBER'), rsvp)
router.delete('/:id/rsvp',       authenticate, requireMinRole('MEMBER'), cancelRsvp)
router.get('/:id/registrations', authenticate, requireContentPermission, listRegistrations)

export default router

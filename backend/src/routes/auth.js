import { Router } from 'express'
import { register, resendOtp, verifyRegistrationOtp, login, refresh, logout, approveMember, rejectMember, bootstrapSuperAdmin, resumeVerification, forgotPassword, resetPassword, createInvite, listInvites, validateInvite, deleteInvite } from '../controllers/auth.js'
import { authenticate, requireRole, requireMinRole } from '../middleware/auth.js'
import { env } from '../config/env.js'
import rateLimit from 'express-rate-limit'

const router = Router()

// Stricter limit on auth endpoints (brute-force / OTP abuse protection).
// Tunable via env.rateLimit (see config/env.js); enforced in production only.
const authLimiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.maxAuth,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts, try again later' },
  skip: () => !env.rateLimit.enabled,
})

router.post('/register', authLimiter, register)
router.post('/resend-otp', authLimiter, resendOtp)
router.post('/verify-otp', authLimiter, verifyRegistrationOtp)
router.post('/resume-verification', authLimiter, resumeVerification)
router.post('/login', authLimiter, login)
router.post('/refresh', refresh)
router.post('/logout', logout)

// Password reset
router.post('/forgot-password', authLimiter, forgotPassword)
router.post('/reset-password', authLimiter, resetPassword)

// Invite links
router.post('/invites', authenticate, requireMinRole('ADMIN'), createInvite)
router.get('/invites', authenticate, requireMinRole('ADMIN'), listInvites)
router.get('/invites/:token', validateInvite)
router.delete('/invites/:id', authenticate, requireMinRole('ADMIN'), deleteInvite)

// Admin actions
router.post('/approve/:userId', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), approveMember)
router.post('/reject/:userId', authenticate, requireRole('ADMIN', 'SUPER_ADMIN'), rejectMember)

// Legend — seeds the first Super Admin (no auth required, guarded by DEV_SECRET in body)
router.post('/bootstrap', bootstrapSuperAdmin)

export default router

import bcrypt from 'bcryptjs'
import { z } from 'zod'
import prisma from '../config/db.js'
import { env } from '../config/env.js'
import { createOtp, verifyOtp, checkResendCooldown } from '../services/otp.js'
import { cacheInvalidate, cacheInvalidatePrefix } from '../services/cache.js'
import { sendOtpEmail, sendAdminNewMemberNotification, sendApprovalEmail, sendRejectionEmail, sendPasswordResetEmail, sendInviteEmail } from '../services/email.js'
import { signAccessToken, signRefreshToken, saveRefreshToken, rotateRefreshToken, revokeRefreshToken } from '../services/token.js'
import { createNotification } from '../services/notifications.js'

const registerSchema = z.object({
  firstName:   z.string().min(2),
  lastName:    z.string().min(2),
  email:       z.string().email(),
  phone:       z.string().min(9),
  password:    z.string().min(8),
  inviteToken: z.string().optional(),
})

const loginSchema = z.object({
  identifier: z.string(),
  password: z.string(),
})

// POST /api/auth/register
export async function register(req, res, next) {
  try {
    const data = registerSchema.parse(req.body)

    const emailExists = await prisma.user.findUnique({ where: { email: data.email } })
    if (emailExists) return res.status(409).json({ error: 'An account with that email already exists' })

    if (data.phone) {
      const phoneExists = await prisma.user.findUnique({ where: { phone: data.phone } })
      if (phoneExists) return res.status(409).json({ error: 'An account with that phone number already exists' })
    }

    // Validate invite token if provided
    let invite = null
    if (data.inviteToken) {
      invite = await prisma.inviteLink.findUnique({ where: { token: data.inviteToken } })
      if (!invite || invite.usedAt || (invite.expiresAt && invite.expiresAt < new Date())) {
        return res.status(400).json({ error: 'Invalid or expired invite link' })
      }
      if (invite.type === 'INDIVIDUAL' && invite.targetEmail && invite.targetEmail !== data.email) {
        return res.status(400).json({ error: 'This invite was issued for a different email address' })
      }
    }

    const passwordHash = await bcrypt.hash(data.password, 12)
    const user = await prisma.user.create({
      data: {
        email: data.email,
        phone: data.phone,
        passwordHash,
        role: 'PENDING',
        inviteToken: data.inviteToken ?? null,
        profile: { create: { firstName: data.firstName, lastName: data.lastName } },
      },
    })

    const otp = await createOtp(user.id, 'REGISTRATION')
    await sendOtpEmail(user.email, otp)

    res.status(201).json({
      message: 'Verification code sent to your email.',
      userId: user.id,
    })
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors })
    next(err)
  }
}

// POST /api/auth/resend-otp
export async function resendOtp(req, res, next) {
  try {
    const { userId } = req.body
    if (!userId) return res.status(400).json({ error: 'userId is required' })

    const cooldown = await checkResendCooldown(userId, 'REGISTRATION')
    if (!cooldown.allowed) {
      return res.status(429).json({
        error: `Please wait ${cooldown.secondsRemaining} seconds before requesting a new code.`,
        secondsRemaining: cooldown.secondsRemaining,
      })
    }

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return res.status(404).json({ error: 'User not found' })

    const otp = await createOtp(user.id, 'REGISTRATION')
    await sendOtpEmail(user.email, otp)

    res.json({ message: 'A new verification code has been sent to your email.' })
  } catch (err) {
    next(err)
  }
}

// POST /api/auth/verify-otp
export async function verifyRegistrationOtp(req, res, next) {
  try {
    const { userId, code } = req.body
    if (!userId || !code) return res.status(400).json({ error: 'userId and code are required' })

    const valid = await verifyOtp(userId, code, 'REGISTRATION')
    if (!valid) return res.status(400).json({ error: 'Invalid or expired code' })

    const user = await prisma.user.findUnique({ where: { id: userId }, include: { profile: true } })
    await prisma.user.update({ where: { id: userId }, data: { otpVerifiedAt: new Date() } })

    // Check for individual invite → auto-approve
    if (user.inviteToken) {
      const invite = await prisma.inviteLink.findUnique({ where: { token: user.inviteToken } })
      if (invite && !invite.usedAt && invite.type === 'INDIVIDUAL' &&
          (!invite.expiresAt || invite.expiresAt >= new Date())) {
        await prisma.user.update({ where: { id: userId }, data: { role: 'MEMBER' } })
        await prisma.inviteLink.update({ where: { token: user.inviteToken }, data: { usedAt: new Date() } })
        if (user.email) sendApprovalEmail(user.email, user.profile.firstName).catch(() => {})
        return res.json({ message: 'Verified and approved! You can now log in.', autoApproved: true })
      }
    }

    // Standard flow — notify admins
    const admins = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, isActive: true },
      select: { email: true },
    })
    for (const admin of admins) {
      if (admin.email) {
        sendAdminNewMemberNotification(admin.email, user.profile.firstName, user.profile.lastName)
          .catch(() => {})
      }
    }

    res.json({ message: 'Verified! Your account is pending admin approval. You will be notified once approved.' })
  } catch (err) {
    next(err)
  }
}

// POST /api/auth/login
export async function login(req, res, next) {
  try {
    const { identifier, password } = loginSchema.parse(req.body)

    const user = await prisma.user.findUnique({ where: { email: identifier } })

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }
    if (!user.isActive) {
      return res.status(403).json({ error: 'Your account has been deactivated. Contact the church office.' })
    }
    if (user.role === 'PENDING' && !user.otpVerifiedAt) {
      // Started registration but never completed OTP — send them back to verify
      return res.status(403).json({
        error: 'Please complete your registration by verifying your contact.',
        requiresVerification: true,
        userId: user.id,
      })
    }
    if (user.role === 'PENDING') {
      return res.status(403).json({ error: 'Your account is pending admin approval. You will be notified once approved.' })
    }

    const payload = { userId: user.id, role: user.role, permissions: user.permissions || {} }
    const accessToken = signAccessToken(payload)
    const refreshToken = signRefreshToken(payload)
    await saveRefreshToken(user.id, refreshToken)

    res.json({ accessToken, refreshToken, role: user.role })
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors })
    next(err)
  }
}

// POST /api/auth/refresh
export async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' })

    const tokens = await rotateRefreshToken(refreshToken)
    if (!tokens) return res.status(401).json({ error: 'Invalid or expired refresh token' })

    res.json(tokens)
  } catch (err) {
    next(err)
  }
}

// POST /api/auth/logout
export async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body
    if (refreshToken) await revokeRefreshToken(refreshToken)
    res.json({ message: 'Logged out' })
  } catch (err) {
    next(err)
  }
}

// POST /api/auth/approve/:userId  (Admin only)
export async function approveMember(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.userId },
      include: { profile: true },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.role !== 'PENDING') return res.status(400).json({ error: 'User is not pending approval' })

    await prisma.user.update({ where: { id: user.id }, data: { role: 'MEMBER' } })
    cacheInvalidatePrefix('members:list:')
    cacheInvalidate('members:pending', 'members:slim')

    if (user.email) await sendApprovalEmail(user.email, user.profile.firstName)
    // Awaited so a 200 response guarantees the notification is persisted; the
    // catch keeps a notification failure from failing the approval itself.
    await createNotification(user.id, 'Account Approved', 'Welcome! Your AIC Ruiru membership has been approved. You can now access all member features.').catch(() => {})

    res.json({ message: 'Member approved' })
  } catch (err) {
    next(err)
  }
}

// POST /api/auth/reject/:userId  (Admin only)
export async function rejectMember(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.userId },
      include: { profile: true },
    })
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.role !== 'PENDING') return res.status(400).json({ error: 'User is not pending approval' })

    await prisma.user.update({ where: { id: user.id }, data: { isActive: false } })
    cacheInvalidate('members:pending')

    if (user.email) await sendRejectionEmail(user.email, user.profile.firstName)

    res.json({ message: 'Registration rejected' })
  } catch (err) {
    next(err)
  }
}

// POST /api/auth/resume-verification
// For users who registered but closed the browser before completing OTP
export async function resumeVerification(req, res, next) {
  try {
    const { identifier } = req.body
    if (!identifier) return res.status(400).json({ error: 'identifier (email) is required' })

    const user = await prisma.user.findUnique({ where: { email: identifier } })

    // Return same message regardless of whether user exists (prevents enumeration)
    if (!user || user.role !== 'PENDING' || user.otpVerifiedAt || !user.isActive) {
      return res.json({ message: 'If an unverified account exists, a new code has been sent to your email.' })
    }

    const cooldown = await checkResendCooldown(user.id, 'REGISTRATION')
    if (!cooldown.allowed) {
      return res.status(429).json({
        error: `Please wait ${cooldown.secondsRemaining} seconds before requesting a new code.`,
        secondsRemaining: cooldown.secondsRemaining,
      })
    }

    const otp = await createOtp(user.id, 'REGISTRATION')
    await sendOtpEmail(user.email, otp)

    res.json({
      message: 'A verification code has been sent to your email.',
      userId: user.id,
    })
  } catch (err) {
    next(err)
  }
}

// POST /api/auth/forgot-password
export async function forgotPassword(req, res, next) {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body)

    const user = await prisma.user.findUnique({ where: { email }, include: { profile: true } })
    if (user && user.isActive && user.role !== 'PENDING') {
      const otp = await createOtp(user.id, 'PASSWORD_RESET')
      sendPasswordResetEmail(email, user.profile?.firstName ?? 'there', otp).catch(() => {})
      // Return userId so the client can submit it on the reset form.
      // Not a secret — the email address is already known to the requester.
      return res.json({ message: 'If that email is registered, a reset code has been sent.', userId: user.id })
    }

    res.json({ message: 'If that email is registered, a reset code has been sent.' })
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors })
    next(err)
  }
}

// POST /api/auth/reset-password
export async function resetPassword(req, res, next) {
  try {
    const { userId, code, newPassword } = z.object({
      userId: z.string(),
      code: z.string().length(6),
      newPassword: z.string().min(8),
    }).parse(req.body)

    const valid = await verifyOtp(userId, code, 'PASSWORD_RESET')
    if (!valid) return res.status(400).json({ error: 'Invalid or expired reset code' })

    const passwordHash = await bcrypt.hash(newPassword, 12)
    await prisma.user.update({ where: { id: userId }, data: { passwordHash } })
    await prisma.refreshToken.deleteMany({ where: { userId } })

    res.json({ message: 'Password updated. All existing sessions have been signed out.' })
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors })
    next(err)
  }
}

// POST /api/auth/invites  (Admin+)
export async function createInvite(req, res, next) {
  try {
    const { type, targetEmail, expiresInMinutes } = z.object({
      type: z.enum(['INDIVIDUAL', 'MASS']),
      targetEmail: z.string().email().optional(),
      expiresInMinutes: z.number().int().min(30).max(43200).default(10080),
    }).parse(req.body)

    if (type === 'INDIVIDUAL' && !targetEmail) {
      return res.status(400).json({ error: 'targetEmail is required for individual invites' })
    }

    if (type === 'INDIVIDUAL' && targetEmail) {
      const existing = await prisma.user.findUnique({ where: { email: targetEmail } })
      if (existing) return res.status(409).json({ error: 'That email address is already registered.' })
    }

    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000)
    const invite = await prisma.inviteLink.create({
      data: { type, targetEmail: targetEmail ?? null, createdById: req.user.userId, expiresAt },
    })

    if (type === 'INDIVIDUAL' && targetEmail) {
      sendInviteEmail(targetEmail, invite.token, env.frontendUrl).catch(() => {})
    }

    res.status(201).json({
      token: invite.token,
      link: `${env.frontendUrl}/pages/register.html?invite=${invite.token}`,
    })
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors })
    next(err)
  }
}

// GET /api/auth/invites  (Admin+)
export async function listInvites(req, res, next) {
  try {
    const where = req.user.role === 'SUPER_ADMIN' ? {} : { createdById: req.user.userId }
    const invites = await prisma.inviteLink.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, token: true, type: true, targetEmail: true, usedAt: true, expiresAt: true, createdAt: true },
    })
    res.json({ invites })
  } catch (err) {
    next(err)
  }
}

// DELETE /api/auth/invites/:id  (Admin+, own invites; SUPER_ADMIN any)
export async function deleteInvite(req, res, next) {
  try {
    const invite = await prisma.inviteLink.findUnique({ where: { id: req.params.id } })
    if (!invite) return res.status(404).json({ error: 'Invite not found' })
    if (req.user.role !== 'SUPER_ADMIN' && invite.createdById !== req.user.userId) {
      return res.status(403).json({ error: 'You can only revoke your own invite links' })
    }
    if (invite.usedAt) return res.status(409).json({ error: 'Cannot revoke a used invite' })
    await prisma.inviteLink.delete({ where: { id: req.params.id } })
    res.json({ message: 'Invite revoked' })
  } catch (err) {
    next(err)
  }
}

// GET /api/auth/invites/:token  (public)
export async function validateInvite(req, res, next) {
  try {
    const invite = await prisma.inviteLink.findUnique({ where: { token: req.params.token } })
    if (!invite) return res.status(404).json({ error: 'Invite not found' })
    if (invite.usedAt) return res.status(410).json({ error: 'This invite has already been used' })
    if (invite.expiresAt && invite.expiresAt < new Date()) {
      return res.status(410).json({ error: 'This invite has expired' })
    }
    res.json({
      type: invite.type,
      targetEmail: invite.targetEmail ?? null,
    })
  } catch (err) {
    next(err)
  }
}

// POST /api/auth/bootstrap  (Legend only — seeds the first Super Admin)
export async function bootstrapSuperAdmin(req, res, next) {
  try {
    const { devSecret, userId } = req.body
    if (!devSecret || devSecret !== env.devSecret) {
      return res.status(403).json({ error: 'Invalid developer secret' })
    }
    if (!userId) return res.status(400).json({ error: 'userId is required' })

    // Only allow if no Super Admin exists yet
    const existing = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } })
    if (existing) {
      return res.status(409).json({
        error: 'A Super Admin already exists. Use the promote endpoint to change roles.',
      })
    }

    const user = await prisma.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user) return res.status(404).json({ error: 'User not found' })

    await prisma.user.update({ where: { id: userId }, data: { role: 'SUPER_ADMIN' } })

    res.json({
      message: `${user.profile?.firstName ?? user.email} has been promoted to Super Admin.`,
    })
  } catch (err) {
    next(err)
  }
}


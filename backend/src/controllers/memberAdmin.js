import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import prisma from '../config/db.js'
import { createOtp } from '../services/otp.js'
import { sendPasswordResetEmail } from '../services/email.js'
import { cacheInvalidate } from '../services/cache.js'
import { revokeAllUserRefreshTokens } from '../services/token.js'
import { profileInclude, formatMember, REQUESTABLE_PROFILE_FIELDS, invalidateMemberLists } from './members/shared.js'

// POST /api/members/:id/promote  (Admin+ — change a member's role)
export async function promoteMember(req, res, next) {
  try {
    const { role, permissions } = req.body
    const actor = req.user
    const targetId = req.params.id

    const HIERARCHY = { PENDING: 0, MEMBER: 1, STAFF: 2, ADMIN: 3, SUPER_ADMIN: 4, LEGEND: 5 }
    const PROMOTABLE = ['MEMBER', 'STAFF', 'ADMIN', 'SUPER_ADMIN']

    if (!PROMOTABLE.includes(role)) {
      return res.status(400).json({ error: `Role must be one of: ${PROMOTABLE.join(', ')}` })
    }

    if (actor.role === 'ADMIN' && !['MEMBER', 'STAFF'].includes(role)) {
      return res.status(403).json({ error: 'Admins can only assign Member or Staff roles' })
    }

    const target = await prisma.user.findUnique({ where: { id: targetId }, include: { profile: true } })
    if (!target) return res.status(404).json({ error: 'User not found' })

    if (target.role === 'LEGEND') {
      return res.status(403).json({ error: 'Developer accounts cannot be modified through this endpoint' })
    }

    if (actor.role === 'ADMIN' && HIERARCHY[target.role] >= HIERARCHY['ADMIN']) {
      return res.status(403).json({ error: 'Insufficient permissions to modify this account' })
    }

    if (target.id === actor.userId) {
      return res.status(400).json({ error: 'You cannot change your own role' })
    }

    const updateData = { role }
    if (role === 'STAFF') {
      updateData.permissions = permissions || {}
    } else {
      updateData.permissions = {}
    }

    await prisma.user.update({ where: { id: targetId }, data: updateData })
    await revokeAllUserRefreshTokens(targetId)
    invalidateMemberLists()

    const name = target.profile ? `${target.profile.firstName} ${target.profile.lastName}` : target.email
    res.json({ message: `${name} has been updated to ${role}.` })
  } catch (err) {
    next(err)
  }
}

// PUT /api/members/:id  (Admin+ — direct profile edit)
export async function updateMember(req, res, next) {
  try {
    const schema = z.object({
      firstName:        z.string().min(1).optional(),
      lastName:         z.string().min(1).optional(),
      middleName:       z.string().optional().nullable(),
      phone:            z.string().min(9).optional(),
      address:          z.string().optional().nullable(),
      dateOfBirth:      z.string().datetime().optional().nullable(),
      dateJoined:       z.string().datetime().optional().nullable(),
      baptismDate:      z.string().datetime().optional().nullable(),
      membershipStatus: z.enum(['ACTIVE', 'INACTIVE', 'TRANSFERRED', 'DECEASED']).optional(),
      householdId:      z.string().optional().nullable(),
    })
    const data = schema.parse(req.body)

    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { profile: true },
    })
    if (!user || !user.profile) return res.status(404).json({ error: 'Member not found' })
    if (user.role === 'LEGEND') return res.status(403).json({ error: 'Developer accounts cannot be modified' })

    const profileData = {}
    const fields = ['firstName', 'lastName', 'middleName', 'phone', 'address', 'householdId']
    for (const f of fields) {
      if (f in data) profileData[f] = data[f]
    }
    for (const f of ['dateOfBirth', 'dateJoined', 'baptismDate']) {
      if (f in data) profileData[f] = data[f] ? new Date(data[f]) : null
    }
    if (data.membershipStatus !== undefined) {
      profileData.membershipStatus = data.membershipStatus
    }

    await prisma.$transaction(async (tx) => {
      await tx.memberProfile.update({ where: { id: user.profile.id }, data: profileData })
      if (data.membershipStatus && data.membershipStatus !== user.profile.membershipStatus) {
        await tx.membershipStatusHistory.create({
          data: { profileId: user.profile.id, status: data.membershipStatus, note: 'Admin update' },
        })
      }
    })

    invalidateMemberLists()
    // Also invalidate households cache in case householdId changed
    if ('householdId' in data) cacheInvalidate('households')

    const updated = await prisma.user.findUnique({ where: { id: req.params.id }, include: profileInclude })
    res.json(formatMember(updated))
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors })
    next(err)
  }
}

// POST /api/members/:id/deactivate  (Admin+ — lock account)
export async function deactivateMember(req, res, next) {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } })
    if (!target) return res.status(404).json({ error: 'Member not found' })
    if (['SUPER_ADMIN', 'LEGEND'].includes(target.role)) {
      return res.status(403).json({ error: 'This account cannot be deactivated' })
    }
    if (target.id === req.user.userId) {
      return res.status(400).json({ error: 'You cannot deactivate your own account' })
    }
    await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } })
    invalidateMemberLists()
    res.json({ message: 'Account deactivated' })
  } catch (err) {
    next(err)
  }
}

// POST /api/members/:id/reactivate  (Admin+ — unlock account)
export async function reactivateMember(req, res, next) {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } })
    if (!target) return res.status(404).json({ error: 'Member not found' })
    await prisma.user.update({ where: { id: req.params.id }, data: { isActive: true } })
    invalidateMemberLists()
    res.json({ message: 'Account reactivated' })
  } catch (err) {
    next(err)
  }
}

// POST /api/members  (Admin+ — create member directly, bypassing self-registration)
export async function createMember(req, res, next) {
  try {
    const schema = z.object({
      firstName: z.string().min(1),
      lastName:  z.string().min(1),
      email:     z.string().email(),
      phone:     z.string().optional(),
    })
    const { firstName, lastName, email, phone } = schema.parse(req.body)

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return res.status(409).json({ error: 'A user with this email already exists' })

    const placeholderPassword = await bcrypt.hash(randomUUID(), 10)

    const { user, profile } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          phone: phone || null,
          passwordHash: placeholderPassword,
          role: 'MEMBER',
          isActive: true,
          otpVerifiedAt: new Date(),
        },
      })
      const profile = await tx.memberProfile.create({
        data: { userId: user.id, firstName, lastName, membershipStatus: 'ACTIVE' },
      })
      return { user, profile }
    })

    invalidateMemberLists()

    const otp = await createOtp(user.id, 'PASSWORD_RESET')
    await sendPasswordResetEmail(email, firstName, otp)

    res.status(201).json({ id: user.id, email: user.email, profile: { firstName, lastName } })
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors })
    next(err)
  }
}

// POST /api/members/update-requests/:id/approve  (Admin+)
export async function approveUpdateRequest(req, res, next) {
  try {
    const request = await prisma.profileUpdateRequest.findUnique({ where: { id: req.params.id } })
    if (!request) return res.status(404).json({ error: 'Request not found' })
    if (request.status !== 'PENDING') return res.status(409).json({ error: 'Request is no longer pending' })
    if (!REQUESTABLE_PROFILE_FIELDS.includes(request.field)) {
      return res.status(400).json({ error: 'This request targets a field that can no longer be approved this way' })
    }

    const profile = await prisma.memberProfile.findUnique({ where: { userId: request.requestedById } })
    if (!profile) return res.status(404).json({ error: 'Member profile not found' })

    await prisma.$transaction([
      prisma.memberProfile.update({
        where: { id: profile.id },
        data: { [request.field]: request.proposedValue },
      }),
      prisma.profileUpdateRequest.update({
        where: { id: request.id },
        data: { status: 'APPROVED', handledById: req.user.userId, handledAt: new Date() },
      }),
    ])

    cacheInvalidate('members:update-requests', 'members:list', 'members:slim')
    res.json({ message: 'Request approved and profile updated' })
  } catch (err) {
    next(err)
  }
}

// POST /api/members/update-requests/:id/reject  (Admin+)
export async function rejectUpdateRequest(req, res, next) {
  try {
    const request = await prisma.profileUpdateRequest.findUnique({ where: { id: req.params.id } })
    if (!request) return res.status(404).json({ error: 'Request not found' })
    if (request.status !== 'PENDING') return res.status(409).json({ error: 'Request is no longer pending' })

    await prisma.profileUpdateRequest.update({
      where: { id: request.id },
      data: { status: 'REJECTED', handledById: req.user.userId, handledAt: new Date() },
    })

    cacheInvalidate('members:update-requests')
    res.json({ message: 'Request rejected' })
  } catch (err) {
    next(err)
  }
}

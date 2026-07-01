import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'
import prisma from '../config/db.js'
import { createOtp } from '../services/otp.js'
import { sendPasswordResetEmail } from '../services/email.js'
import { cacheGet, cacheSet, cacheInvalidate, cacheInvalidatePrefix } from '../services/cache.js'
import { revokeAllUserRefreshTokens } from '../services/token.js'

// Full include — for getMe and getMember (individual detail view)
const profileInclude = {
  profile: {
    include: {
      household: true,
      ministries: { include: { ministry: true } },
      statusHistory: { orderBy: { changedAt: 'desc' }, take: 5 },
    },
  },
}

// Light include — for list queries (no ministry joins; table doesn't show them)
const profileIncludeList = {
  profile: {
    include: {
      household: true,
    },
  },
}

const TTL_LIST    = 2 * 60_000  // 2 minutes
const TTL_PENDING = 30_000      // 30 seconds
const TTL_REQS    = 30_000      // 30 seconds
const TTL_SLIM    = 5 * 60_000  // 5 minutes

function invalidateMemberLists() {
  cacheInvalidatePrefix('members:list:')
  cacheInvalidate('members:pending', 'members:slim')
}

// GET /api/members/me
export async function getMe(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      include: profileInclude,
    })
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json(formatMember(user))
  } catch (err) {
    next(err)
  }
}

// GET /api/members  (Admin+)
export async function listMembers(req, res, next) {
  try {
    const { page = 1, limit = 20, status, search, householdId, ministryId } = req.query
    const skip = (Number(page) - 1) * Number(limit)

    const where = {
      AND: [
        { role: { not: 'PENDING' } },
        { OR: [{ role: { not: 'LEGEND' } }, { id: req.user.userId }] },
      ],
    }

    const profileFilter = {}
    if (status)      profileFilter.membershipStatus = status.toUpperCase()
    if (householdId) profileFilter.householdId = householdId
    if (ministryId)  profileFilter.ministries = { some: { ministryId, leftAt: null } }
    if (Object.keys(profileFilter).length) where.profile = profileFilter

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { profile: { firstName: { contains: search, mode: 'insensitive' } } },
        { profile: { lastName:  { contains: search, mode: 'insensitive' } } },
      ]
    }

    // Only cache the default unfiltered list (cache is per-user; include limit so stats limit=1 doesn't pollute the full list)
    const cacheKey = `members:list:${req.user.userId}:${limit}`
    const isDefaultList = !search && !status && !householdId && !ministryId && Number(page) === 1
    if (isDefaultList) {
      const cached = cacheGet(cacheKey)
      if (cached) return res.json(cached)
    }

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({ where, include: profileIncludeList, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
    ])

    const result = {
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      members: users.map(formatMember),
    }

    if (isDefaultList) cacheSet(cacheKey, result, TTL_LIST)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

// GET /api/members/pending  (Admin+)
export async function listPending(req, res, next) {
  try {
    const cached = cacheGet('members:pending')
    if (cached) return res.json(cached)

    const users = await prisma.user.findMany({
      where: { role: 'PENDING', isActive: true, otpVerifiedAt: { not: null } },
      include: profileIncludeList,
      orderBy: { createdAt: 'asc' },
    })
    const result = { pending: users.map(formatMember) }
    cacheSet('members:pending', result, TTL_PENDING)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

// GET /api/members/slim  (Admin+) — lightweight list for member-search pickers
export async function listMembersSlim(req, res, next) {
  try {
    const cached = cacheGet('members:slim')
    if (cached) return res.json(cached)

    const profiles = await prisma.memberProfile.findMany({
      where: { user: { role: { notIn: ['PENDING', 'LEGEND'] }, isActive: true } },
      select: { id: true, firstName: true, lastName: true, householdId: true },
      orderBy: { firstName: 'asc' },
    })
    const result = profiles.map(p => ({ profileId: p.id, fullName: `${p.firstName} ${p.lastName}`, householdId: p.householdId }))
    cacheSet('members:slim', result, TTL_SLIM)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

// GET /api/members/:id  (Admin+)
export async function getMember(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: profileInclude,
    })
    if (!user) return res.status(404).json({ error: 'Member not found' })
    res.json(formatMember(user))
  } catch (err) {
    next(err)
  }
}

// PUT /api/members/me  (own profile — limited fields)
export async function updateMe(req, res, next) {
  try {
    const schema = z.object({
      phone:       z.string().min(9).optional(),
      address:     z.string().optional(),
      dateOfBirth: z.string().datetime().optional(),
    })
    const data = schema.parse(req.body)

    const profile = await prisma.memberProfile.findUnique({ where: { userId: req.user.userId } })
    if (!profile) return res.status(404).json({ error: 'Profile not found' })

    const updated = await prisma.memberProfile.update({
      where: { id: profile.id },
      data: {
        ...(data.phone       && { phone: data.phone }),
        ...(data.address     && { address: data.address }),
        ...(data.dateOfBirth && { dateOfBirth: new Date(data.dateOfBirth) }),
      },
    })

    res.json({ message: 'Profile updated', profile: updated })
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors })
    next(err)
  }
}

// Fields a member may request a change to. Church-record fields (membershipStatus,
// householdId, baptismDate, dateJoined, photoUrl) are admin-only via updateMember.
const REQUESTABLE_PROFILE_FIELDS = ['firstName', 'lastName', 'middleName', 'phone', 'address', 'dateOfBirth']

// POST /api/members/me/request-update  (member requests a sensitive field change)
export async function requestProfileUpdate(req, res, next) {
  try {
    const { field, proposedValue, reason } = req.body
    if (!field || !proposedValue) return res.status(400).json({ error: 'field and proposedValue are required' })
    if (!REQUESTABLE_PROFILE_FIELDS.includes(field)) {
      return res.status(400).json({ error: `field must be one of: ${REQUESTABLE_PROFILE_FIELDS.join(', ')}` })
    }

    const profile = await prisma.memberProfile.findUnique({ where: { userId: req.user.userId } })
    if (!profile) return res.status(404).json({ error: 'Profile not found' })

    const currentValue = String(profile[field] ?? '')

    await prisma.profileUpdateRequest.create({
      data: {
        requestedById: req.user.userId,
        field,
        currentValue,
        proposedValue: String(proposedValue),
        reason: reason || null,
      },
    })

    res.status(201).json({ message: 'Update request submitted. An admin will review it shortly.' })
  } catch (err) {
    next(err)
  }
}

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

// GET /api/members/update-requests  (Admin+)
export async function listUpdateRequests(req, res, next) {
  try {
    const cached = cacheGet('members:update-requests')
    if (cached) return res.json(cached)

    const requests = await prisma.profileUpdateRequest.findMany({
      where: { status: 'PENDING' },
      include: {
        requestedBy: {
          select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    })
    const result = { requests }
    cacheSet('members:update-requests', result, TTL_REQS)
    res.json(result)
  } catch (err) {
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMember(user) {
  const p = user.profile
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt,
    profile: p ? {
      id: p.id,
      firstName: p.firstName,
      lastName: p.lastName,
      middleName: p.middleName,
      fullName: `${p.firstName} ${p.lastName}`,
      dateOfBirth: p.dateOfBirth,
      phone: p.phone,
      address: p.address,
      dateJoined: p.dateJoined,
      baptismDate: p.baptismDate,
      membershipStatus: p.membershipStatus,
      photoUrl: p.photoUrl,
      household: p.household ? { id: p.household.id, name: p.household.name } : null,
      ministries: p.ministries?.map(m => ({ id: m.ministry.id, name: m.ministry.name, role: m.role })) ?? [],
      statusHistory: p.statusHistory ?? [],
    } : null,
  }
}

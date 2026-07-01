import { z } from 'zod'
import prisma from '../config/db.js'
import { cacheGet, cacheSet } from '../services/cache.js'
import { profileInclude, profileIncludeList, formatMember, REQUESTABLE_PROFILE_FIELDS } from './members/shared.js'

const TTL_LIST    = 2 * 60_000  // 2 minutes
const TTL_PENDING = 30_000      // 30 seconds
const TTL_REQS    = 30_000      // 30 seconds
const TTL_SLIM    = 5 * 60_000  // 5 minutes

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

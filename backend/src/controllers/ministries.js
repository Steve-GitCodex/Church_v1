import { z } from 'zod'
import prisma from '../config/db.js'
import { cacheGet, cacheSet, cacheInvalidate } from '../services/cache.js'

const roleDefSchema = z.object({ name: z.string().min(1), max: z.number().int().positive().nullable() })
const DEFAULT_ROLES = [
  { name: 'ChairPerson',      max: 1 },
  { name: 'Vice Chairperson', max: 1 },
  { name: 'Treasurer',        max: 1 },
  { name: 'Secretary',        max: 1 },
  { name: 'Vice Secretary',   max: 1 },
  { name: 'Coordinator',      max: 1 },
]

const ministrySchema = z.object({
  name:        z.string().min(1).max(100),
  description: z.string().optional().nullable(),
  isActive:    z.boolean().optional(),
  roles:       z.array(roleDefSchema).optional(),
})

const TTL_MINISTRIES = 5 * 60_000  // 5 minutes
const TTL_MEMBERS    = 2 * 60_000  // 2 minutes

function invalidateMinistries(id) {
  cacheInvalidate('ministries')
  if (id) cacheInvalidate('ministries:members:' + id)
}

// GET /api/ministries
export async function listMinistries(req, res, next) {
  try {
    const cached = cacheGet('ministries')
    if (cached) return res.json(cached)

    const ministries = await prisma.ministry.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { members: { where: { leftAt: null } } } } },
    })
    const result = ministries.map(m => ({
      id: m.id, name: m.name, description: m.description,
      isActive: m.isActive, roles: m.roles, memberCount: m._count.members, createdAt: m.createdAt,
    }))
    cacheSet('ministries', result, TTL_MINISTRIES)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

// POST /api/ministries
export async function createMinistry(req, res, next) {
  try {
    const data = ministrySchema.parse(req.body)
    if (!data.roles) data.roles = DEFAULT_ROLES
    const ministry = await prisma.ministry.create({ data })
    cacheInvalidate('ministries')
    res.status(201).json({ ...ministry, memberCount: 0 })
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors })
    next(err)
  }
}

// PUT /api/ministries/:id
export async function updateMinistry(req, res, next) {
  try {
    const data = ministrySchema.partial().parse(req.body)

    let ministry
    await prisma.$transaction(async (tx) => {
      if (data.roles !== undefined) {
        const existing = await tx.ministry.findUnique({ where: { id: req.params.id }, select: { roles: true } })
        if (existing) {
          const removedNames = existing.roles
            .filter(r => !data.roles.some(nr => nr.name === r.name))
            .map(r => r.name)
          if (removedNames.length > 0) {
            await tx.memberMinistry.updateMany({
              where: { ministryId: req.params.id, role: { in: removedNames }, leftAt: null },
              data: { role: null },
            })
          }
        }
      }
      ministry = await tx.ministry.update({ where: { id: req.params.id }, data })
    })

    invalidateMinistries(req.params.id)
    res.json({ ...ministry, memberCount: 0 })
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors })
    if (err.code === 'P2025') return res.status(404).json({ error: 'Ministry not found' })
    next(err)
  }
}

// DELETE /api/ministries/:id
export async function deleteMinistry(req, res, next) {
  try {
    const activeCount = await prisma.memberMinistry.count({
      where: { ministryId: req.params.id, leftAt: null },
    })
    if (activeCount > 0) {
      return res.status(409).json({ error: `Cannot delete: ${activeCount} active member(s) still in this ministry` })
    }
    await prisma.ministry.delete({ where: { id: req.params.id } })
    invalidateMinistries(req.params.id)
    res.json({ message: 'Ministry deleted' })
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Ministry not found' })
    next(err)
  }
}

// GET /api/ministries/:id/members
export async function listMinistryMembers(req, res, next) {
  try {
    const cacheKey = 'ministries:members:' + req.params.id
    const cached = cacheGet(cacheKey)
    if (cached) return res.json(cached)

    const members = await prisma.memberMinistry.findMany({
      where: { ministryId: req.params.id, leftAt: null },
      include: { profile: { select: { id: true, firstName: true, lastName: true, userId: true } } },
      orderBy: { joinedAt: 'asc' },
    })
    const result = members.map(m => ({
      id: m.id,
      profileId: m.profileId,
      role: m.role,
      joinedAt: m.joinedAt,
      firstName: m.profile.firstName,
      lastName: m.profile.lastName,
      userId: m.profile.userId,
    }))
    cacheSet(cacheKey, result, TTL_MEMBERS)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

// POST /api/ministries/:id/members
export async function addMinistryMember(req, res, next) {
  try {
    const { profileId, role } = z.object({
      profileId: z.string(),
      role:      z.string().optional(),
    }).parse(req.body)

    const profile = await prisma.memberProfile.findUnique({ where: { id: profileId } })
    if (!profile) return res.status(404).json({ error: 'Member profile not found' })

    if (role && role !== 'Member') {
      const ministry = await prisma.ministry.findUnique({ where: { id: req.params.id }, select: { roles: true } })
      const roleDef  = ministry?.roles?.find(r => r.name === role)
      if (roleDef?.max != null) {
        const count = await prisma.memberMinistry.count({
          where: { ministryId: req.params.id, role, leftAt: null },
        })
        if (count >= roleDef.max) {
          return res.status(409).json({ error: `${role} is already filled (max ${roleDef.max})` })
        }
      }
    }

    const existing = await prisma.memberMinistry.findFirst({
      where: { profileId, ministryId: req.params.id },
    })

    if (existing) {
      if (!existing.leftAt) return res.status(409).json({ error: 'Member is already in this ministry' })
      const entry = await prisma.memberMinistry.update({
        where: { id: existing.id },
        data: { leftAt: null, joinedAt: new Date(), role: role || null },
      })
      invalidateMinistries(req.params.id)
      return res.status(201).json(entry)
    }

    const entry = await prisma.memberMinistry.create({
      data: { profileId, ministryId: req.params.id, role: role || null },
    })
    invalidateMinistries(req.params.id)
    res.status(201).json(entry)
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors })
    next(err)
  }
}

// PATCH /api/ministries/:id/members/:membershipId  (update role)
export async function updateMinistryMember(req, res, next) {
  try {
    const { role } = z.object({ role: z.string().min(1) }).parse(req.body)
    const entry = await prisma.memberMinistry.findFirst({
      where: { id: req.params.membershipId, ministryId: req.params.id, leftAt: null },
    })
    if (!entry) return res.status(404).json({ error: 'Member not found in this ministry' })

    if (role !== 'Member' && role !== (entry.role || 'Member')) {
      const ministry = await prisma.ministry.findUnique({ where: { id: req.params.id }, select: { roles: true } })
      const roleDef  = ministry?.roles?.find(r => r.name === role)
      if (roleDef?.max != null) {
        const count = await prisma.memberMinistry.count({
          where: { ministryId: req.params.id, role, leftAt: null, id: { not: entry.id } },
        })
        if (count >= roleDef.max) {
          return res.status(409).json({ error: `${role} is already filled (max ${roleDef.max})` })
        }
      }
    }

    const updated = await prisma.memberMinistry.update({ where: { id: entry.id }, data: { role } })
    invalidateMinistries(req.params.id)
    res.json(updated)
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors })
    next(err)
  }
}

// DELETE /api/ministries/:id/members/:profileId
export async function removeMinistryMember(req, res, next) {
  try {
    const entry = await prisma.memberMinistry.findFirst({
      where: { ministryId: req.params.id, profileId: req.params.profileId, leftAt: null },
    })
    if (!entry) return res.status(404).json({ error: 'Member not found in this ministry' })
    await prisma.memberMinistry.update({ where: { id: entry.id }, data: { leftAt: new Date(), role: null } })
    invalidateMinistries(req.params.id)
    res.json({ message: 'Member removed from ministry' })
  } catch (err) {
    next(err)
  }
}

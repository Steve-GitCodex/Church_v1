import { z } from 'zod'
import prisma from '../config/db.js'
import { cacheGet, cacheSet, cacheInvalidate } from '../services/cache.js'

const nameSchema = z.object({ name: z.string().min(1).max(100) })

const TTL_HOUSEHOLDS = 5 * 60_000 // 5 minutes

function invalidateHouseholds(id) {
  cacheInvalidate('households', 'members:slim')
  if (id) cacheInvalidate('households:' + id)
}

// GET /api/households
export async function listHouseholds(req, res, next) {
  try {
    const cached = cacheGet('households')
    if (cached) return res.json(cached)

    const households = await prisma.household.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { members: true } } },
    })
    const result = households.map(h => ({ id: h.id, name: h.name, memberCount: h._count.members, createdAt: h.createdAt }))
    cacheSet('households', result, TTL_HOUSEHOLDS)
    res.json(result)
  } catch (err) {
    next(err)
  }
}

// POST /api/households
export async function createHousehold(req, res, next) {
  try {
    const { name } = nameSchema.parse(req.body)
    const household = await prisma.household.create({ data: { name } })
    invalidateHouseholds()
    res.status(201).json({ id: household.id, name: household.name, memberCount: 0, createdAt: household.createdAt })
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors })
    next(err)
  }
}

// GET /api/households/:id
export async function getHousehold(req, res, next) {
  try {
    const cacheKey = 'households:' + req.params.id
    const cached = cacheGet(cacheKey)
    if (cached) return res.json(cached)

    const household = await prisma.household.findUnique({
      where: { id: req.params.id },
      include: {
        members: {
          select: { id: true, firstName: true, lastName: true, userId: true },
          orderBy: { firstName: 'asc' },
        },
      },
    })
    if (!household) return res.status(404).json({ error: 'Household not found' })
    cacheSet(cacheKey, household, TTL_HOUSEHOLDS)
    res.json(household)
  } catch (err) {
    next(err)
  }
}

// PUT /api/households/:id
export async function updateHousehold(req, res, next) {
  try {
    const { name } = nameSchema.parse(req.body)
    const household = await prisma.household.update({ where: { id: req.params.id }, data: { name } })
    invalidateHouseholds(req.params.id)
    res.json({ id: household.id, name: household.name })
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors })
    if (err.code === 'P2025') return res.status(404).json({ error: 'Household not found' })
    next(err)
  }
}

// DELETE /api/households/:id
export async function deleteHousehold(req, res, next) {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.memberProfile.updateMany({ where: { householdId: req.params.id }, data: { householdId: null } })
      await tx.household.delete({ where: { id: req.params.id } })
    })
    invalidateHouseholds(req.params.id)
    res.json({ message: 'Household deleted' })
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Household not found' })
    next(err)
  }
}

// POST /api/households/:id/members
export async function addHouseholdMember(req, res, next) {
  try {
    const { profileId } = z.object({ profileId: z.string() }).parse(req.body)
    const profile = await prisma.memberProfile.findUnique({ where: { id: profileId } })
    if (!profile) return res.status(404).json({ error: 'Member profile not found' })
    if (profile.householdId && profile.householdId !== req.params.id) {
      return res.status(409).json({ error: 'Member already belongs to another household. Remove them first.' })
    }
    await prisma.memberProfile.update({ where: { id: profileId }, data: { householdId: req.params.id } })
    invalidateHouseholds(req.params.id)
    res.json({ message: 'Member assigned to household' })
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors })
    next(err)
  }
}

// DELETE /api/households/:id/members/:profileId
export async function removeHouseholdMember(req, res, next) {
  try {
    const profile = await prisma.memberProfile.findUnique({ where: { id: req.params.profileId } })
    if (!profile || profile.householdId !== req.params.id) {
      return res.status(404).json({ error: 'Member not found in this household' })
    }
    await prisma.memberProfile.update({ where: { id: req.params.profileId }, data: { householdId: null } })
    invalidateHouseholds(req.params.id)
    res.json({ message: 'Member removed from household' })
  } catch (err) {
    next(err)
  }
}

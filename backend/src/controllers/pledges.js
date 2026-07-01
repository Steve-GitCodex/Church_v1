import { z } from 'zod'
import prisma from '../config/db.js'

const ROLE_LEVEL = { PENDING: 0, MEMBER: 1, STAFF: 2, ADMIN: 3, SUPER_ADMIN: 4, LEGEND: 5 }
const canManageGivings = (user) =>
  (ROLE_LEVEL[user.role] ?? -1) >= ROLE_LEVEL.ADMIN || !!user.permissions?.manageGivings

const MEMBER_SELECT = { select: { firstName: true, lastName: true, userId: true } }
const PROJECT_SELECT = { select: { name: true } }

// Whole months between two dates (0 on the start day).
function fullMonthsElapsed(start, now) {
  let m = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
  if (now.getDate() < start.getDate()) m -= 1
  return Math.max(0, m)
}

// Progress is derived from recorded givings, never stored.
async function computeProgress(pledge) {
  const agg = await prisma.giving.aggregate({
    where: {
      memberId: pledge.memberId,
      projectId: pledge.projectId,
      voided: false,
      givenAt: { gte: pledge.startDate },
    },
    _sum: { amount: true },
  })
  const fulfilled = agg._sum.amount ? Number(agg._sum.amount) : 0
  const total = Number(pledge.totalAmount)
  const monthlyExpected = pledge.months > 0 ? total / pledge.months : total
  const installmentsDue = Math.min(pledge.months, fullMonthsElapsed(pledge.startDate, new Date()) + 1)
  const expectedToDate = Math.min(total, monthlyExpected * installmentsDue)
  const percent = total > 0 ? Math.min(100, (fulfilled / total) * 100) : 0
  return { fulfilled, total, monthlyExpected, expectedToDate, percent, onTrack: fulfilled >= expectedToDate }
}

function fmtPledge(p, progress) {
  return {
    id: p.id,
    memberId: p.memberId,
    memberName: p.member ? `${p.member.firstName} ${p.member.lastName}` : null,
    projectId: p.projectId,
    projectName: p.project?.name ?? null,
    totalAmount: Number(p.totalAmount).toFixed(2),
    months: p.months,
    startDate: p.startDate,
    note: p.note ?? null,
    status: p.status,
    monthlyExpected: progress.monthlyExpected.toFixed(2),
    fulfilled: progress.fulfilled.toFixed(2),
    expectedToDate: progress.expectedToDate.toFixed(2),
    percent: Math.round(progress.percent),
    onTrack: progress.onTrack,
    createdAt: p.createdAt,
  }
}

async function withProgress(pledges) {
  return Promise.all(pledges.map(async p => fmtPledge(p, await computeProgress(p))))
}

const CreateSchema = z.object({
  memberId:    z.string().optional().nullable(), // omitted = self
  projectId:   z.string().min(1),
  totalAmount: z.coerce.number().positive(),
  months:      z.coerce.number().int().positive().max(120),
  startDate:   z.string().datetime().optional().nullable(),
  note:        z.string().max(500).optional().nullable(),
})

// POST /givings/pledges — member self-pledge, or manager pledge-for-member
export async function createPledge(req, res, next) {
  try {
    const parsed = CreateSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid data' })
    const { memberId, projectId, totalAmount, months, startDate, note } = parsed.data

    const callerProfile = await prisma.memberProfile.findUnique({ where: { userId: req.user.userId } })

    let targetMemberId
    if (memberId && memberId !== callerProfile?.id) {
      if (!canManageGivings(req.user)) {
        return res.status(403).json({ error: 'You can only create pledges for yourself' })
      }
      const member = await prisma.memberProfile.findUnique({ where: { id: memberId } })
      if (!member) return res.status(400).json({ error: 'Member not found' })
      targetMemberId = member.id
    } else {
      if (!callerProfile) return res.status(400).json({ error: 'No member profile found for your account' })
      targetMemberId = callerProfile.id
    }

    const project = await prisma.givingProject.findUnique({ where: { id: projectId } })
    if (!project) return res.status(400).json({ error: 'Project not found' })

    const pledge = await prisma.pledge.create({
      data: {
        memberId: targetMemberId,
        projectId,
        totalAmount,
        months,
        startDate: startDate ? new Date(startDate) : new Date(),
        note: note ?? null,
        createdById: req.user.userId,
      },
      include: { member: MEMBER_SELECT, project: PROJECT_SELECT },
    })
    res.status(201).json(fmtPledge(pledge, await computeProgress(pledge)))
  } catch (err) { next(err) }
}

// GET /givings/pledges — manager: all pledges (filterable)
export async function listPledges(req, res, next) {
  try {
    const where = {}
    if (req.query.memberId)  where.memberId = req.query.memberId
    if (req.query.projectId) where.projectId = req.query.projectId
    if (req.query.status)    where.status = req.query.status
    const pledges = await prisma.pledge.findMany({
      where,
      include: { member: MEMBER_SELECT, project: PROJECT_SELECT },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ pledges: await withProgress(pledges) })
  } catch (err) { next(err) }
}

// GET /givings/pledges/mine — caller's own pledges
export async function listMyPledges(req, res, next) {
  try {
    const profile = await prisma.memberProfile.findUnique({ where: { userId: req.user.userId } })
    if (!profile) return res.json({ pledges: [] })
    const pledges = await prisma.pledge.findMany({
      where: { memberId: profile.id },
      include: { member: MEMBER_SELECT, project: PROJECT_SELECT },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ pledges: await withProgress(pledges) })
  } catch (err) { next(err) }
}

const UpdateSchema = z.object({
  totalAmount: z.coerce.number().positive().optional(),
  months:      z.coerce.number().int().positive().max(120).optional(),
  note:        z.string().max(500).optional().nullable(),
  status:      z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED']).optional(),
})

// PUT /givings/pledges/:id — manager any; member own while ACTIVE
export async function updatePledge(req, res, next) {
  try {
    const parsed = UpdateSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid data' })

    const pledge = await prisma.pledge.findUnique({ where: { id: req.params.id }, include: { member: MEMBER_SELECT } })
    if (!pledge) return res.status(404).json({ error: 'Pledge not found' })

    const isManager = canManageGivings(req.user)
    const isOwner = pledge.member?.userId === req.user.userId
    if (!isManager && !(isOwner && pledge.status === 'ACTIVE')) {
      return res.status(403).json({ error: 'Not allowed to edit this pledge' })
    }
    if (parsed.data.status && !isManager) {
      return res.status(403).json({ error: 'Only a manager can change pledge status' })
    }

    const data = {}
    if (parsed.data.totalAmount !== undefined) data.totalAmount = parsed.data.totalAmount
    if (parsed.data.months !== undefined)      data.months = parsed.data.months
    if ('note' in parsed.data)                 data.note = parsed.data.note ?? null
    if (parsed.data.status !== undefined)      data.status = parsed.data.status

    const updated = await prisma.pledge.update({
      where: { id: pledge.id },
      data,
      include: { member: MEMBER_SELECT, project: PROJECT_SELECT },
    })
    res.json(fmtPledge(updated, await computeProgress(updated)))
  } catch (err) { next(err) }
}

// PATCH /givings/pledges/:id/cancel — owner or manager
export async function cancelPledge(req, res, next) {
  try {
    const pledge = await prisma.pledge.findUnique({ where: { id: req.params.id }, include: { member: MEMBER_SELECT } })
    if (!pledge) return res.status(404).json({ error: 'Pledge not found' })

    const isOwner = pledge.member?.userId === req.user.userId
    if (!canManageGivings(req.user) && !isOwner) {
      return res.status(403).json({ error: 'Not allowed to cancel this pledge' })
    }

    const updated = await prisma.pledge.update({
      where: { id: pledge.id },
      data: { status: 'CANCELLED' },
      include: { member: MEMBER_SELECT, project: PROJECT_SELECT },
    })
    res.json(fmtPledge(updated, await computeProgress(updated)))
  } catch (err) { next(err) }
}

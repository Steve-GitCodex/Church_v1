import { z } from 'zod'
import PDFDocument from 'pdfkit'
import prisma from '../config/db.js'
import { createNotification } from '../services/notifications.js'
import { writeReceipt } from '../services/receipt.js'

const ROLE_LEVEL = { PENDING: 0, MEMBER: 1, STAFF: 2, ADMIN: 3, SUPER_ADMIN: 4, LEGEND: 5 }
const isSuperAdmin = (role) => (ROLE_LEVEL[role] ?? -1) >= ROLE_LEVEL.SUPER_ADMIN

const MEMBER_SELECT = { select: { firstName: true, lastName: true } }
const PROJECT_SELECT = { select: { name: true } }

// Mask member identity for anonymous givings.
// SUPER_ADMIN sees the real name alongside 'Anonymous'; everyone else sees only 'Anonymous'.
function resolveMemberName(giving, viewerRole) {
  if (!giving.isAnonymous) {
    return {
      memberName: giving.member
        ? `${giving.member.firstName} ${giving.member.lastName}`
        : null,
    }
  }
  const base = { memberName: 'Anonymous' }
  if (isSuperAdmin(viewerRole) && giving.member) {
    base.memberNameActual = `${giving.member.firstName} ${giving.member.lastName}`
  }
  return base
}

function fmtGiving(g, viewerRole) {
  return {
    id: g.id,
    memberId: g.memberId,
    ...resolveMemberName(g, viewerRole),
    isAnonymous: g.isAnonymous,
    projectId: g.projectId,
    projectName: g.project?.name ?? null,
    amount: g.amount.toString(),
    paymentMethod: g.paymentMethod,
    reference: g.reference ?? null,
    note: g.note ?? null,
    givenAt: g.givenAt,
    recordedById: g.recordedById,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    voided: g.voided,
    voidedAt: g.voidedAt ?? null,
  }
}

// ── Feature-lock middleware ────────────────────────────────────
export async function requireGivingsFeature(req, res, next) {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: 'givings_enabled' } })
    const enabled = row ? row.value === true : true  // default: enabled
    if (!enabled) return res.status(404).json({ error: 'Not found' })
    next()
  } catch { next() }
}

// ── Projects ──────────────────────────────────────────────────

const ProjectSchema = z.object({
  name:         z.string().min(1).max(100),
  description:  z.string().max(500).optional().nullable(),
  targetAmount: z.coerce.number().positive().optional().nullable(),
  isActive:     z.boolean().optional().default(true),
})

export async function listProjects(req, res, next) {
  try {
    const activeOnly = req.query.active === '1'
    const projects = await prisma.givingProject.findMany({
      where: activeOnly ? { isActive: true } : {},
      orderBy: { name: 'asc' },
      include: {
        givings: { where: { voided: false }, select: { amount: true } },
      },
    })
    res.json(projects.map(p => ({
      id: p.id,
      name: p.name,
      description: p.description ?? null,
      isActive: p.isActive,
      targetAmount: p.targetAmount?.toString() ?? null,
      createdAt: p.createdAt,
      totalRaised: p.givings
        .reduce((sum, g) => sum + parseFloat(g.amount.toString()), 0)
        .toFixed(2),
      givingCount: p.givings.length,
    })))
  } catch (err) { next(err) }
}

export async function createProject(req, res, next) {
  try {
    const parsed = ProjectSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid data' })
    const { name, description, targetAmount, isActive } = parsed.data
    const existing = await prisma.givingProject.findUnique({ where: { name } })
    if (existing) return res.status(409).json({ error: 'A project with that name already exists' })
    const project = await prisma.givingProject.create({
      data: { name, description: description ?? null, targetAmount: targetAmount ?? null, isActive },
    })
    res.status(201).json({
      ...project,
      targetAmount: project.targetAmount?.toString() ?? null,
      totalRaised: '0.00',
      givingCount: 0,
    })
  } catch (err) { next(err) }
}

export async function updateProject(req, res, next) {
  try {
    const { id } = req.params
    const parsed = ProjectSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid data' })
    const { name, description, targetAmount, isActive } = parsed.data
    const conflict = await prisma.givingProject.findFirst({ where: { name, NOT: { id } } })
    if (conflict) return res.status(409).json({ error: 'A project with that name already exists' })
    const project = await prisma.givingProject.update({
      where: { id },
      data: { name, description: description ?? null, targetAmount: targetAmount ?? null, isActive },
    })
    res.json({ ...project, targetAmount: project.targetAmount?.toString() ?? null })
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Project not found' })
    next(err)
  }
}

export async function deactivateProject(req, res, next) {
  try {
    const { id } = req.params
    const project = await prisma.givingProject.update({
      where: { id },
      data: { isActive: false },
    })
    res.json({ ...project, targetAmount: project.targetAmount?.toString() ?? null })
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Project not found' })
    next(err)
  }
}

// ── Givings ───────────────────────────────────────────────────

const GivingSchema = z.object({
  memberId:      z.string().optional().nullable(),
  isAnonymous:   z.boolean().optional().default(false),
  projectId:     z.string().min(1),
  amount:        z.coerce.number().positive(),
  paymentMethod: z.enum(['CASH', 'MPESA', 'BANK_TRANSFER', 'CARD', 'OTHER']).optional().default('CASH'),
  reference:     z.string().max(200).optional().nullable(),
  note:          z.string().max(500).optional().nullable(),
  givenAt:       z.string().datetime().optional().nullable(),
})

export async function recordGiving(req, res, next) {
  try {
    const parsed = GivingSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid data' })
    const { memberId, isAnonymous, projectId, amount, paymentMethod, reference, note, givenAt } = parsed.data

    const project = await prisma.givingProject.findUnique({ where: { id: projectId } })
    if (!project) return res.status(400).json({ error: 'Project not found' })

    if (memberId) {
      const profile = await prisma.memberProfile.findUnique({ where: { id: memberId } })
      if (!profile) return res.status(400).json({ error: 'Member not found' })
    }

    const giving = await prisma.giving.create({
      data: {
        memberId: memberId ?? null,
        isAnonymous: isAnonymous ?? false,
        projectId,
        amount,
        paymentMethod: paymentMethod ?? 'CASH',
        reference: reference ?? null,
        note: note ?? null,
        givenAt: givenAt ? new Date(givenAt) : new Date(),
        recordedById: req.user.userId,
      },
      include: { member: MEMBER_SELECT, project: PROJECT_SELECT },
    })
    res.status(201).json(fmtGiving(giving, req.user.role))
  } catch (err) { next(err) }
}

export async function listGivings(req, res, next) {
  try {
    const page  = Math.max(1, parseInt(req.query.page) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 25))
    const skip  = (page - 1) * limit

    const where = {}
    if (req.query.memberId)      where.memberId = req.query.memberId
    if (req.query.projectId)     where.projectId = req.query.projectId
    if (req.query.paymentMethod) where.paymentMethod = req.query.paymentMethod
    if (req.query.from || req.query.to) {
      where.givenAt = {}
      if (req.query.from) where.givenAt.gte = new Date(req.query.from)
      if (req.query.to)   where.givenAt.lte = new Date(req.query.to)
    }
    if (req.query.includeVoided !== '1') where.voided = false

    const [items, total, agg] = await Promise.all([
      prisma.giving.findMany({
        where,
        include: { member: MEMBER_SELECT, project: PROJECT_SELECT },
        orderBy: { givenAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.giving.count({ where }),
      prisma.giving.aggregate({
        where: { ...where, voided: false },
        _sum: { amount: true },
      }),
    ])

    res.json({
      total,
      page,
      pages: Math.ceil(total / limit),
      totalAmount: agg._sum.amount?.toString() ?? '0.00',
      items: items.map(g => fmtGiving(g, req.user.role)),
    })
  } catch (err) { next(err) }
}

export async function getGiving(req, res, next) {
  try {
    const { id } = req.params
    const giving = await prisma.giving.findUnique({
      where: { id },
      include: { member: MEMBER_SELECT, project: PROJECT_SELECT },
    })
    if (!giving) return res.status(404).json({ error: 'Giving not found' })
    res.json(fmtGiving(giving, req.user.role))
  } catch (err) { next(err) }
}

const GivingUpdateSchema = z.object({
  memberId:      z.string().optional().nullable(),
  isAnonymous:   z.boolean().optional(),
  projectId:     z.string().optional(),
  amount:        z.coerce.number().positive().optional(),
  paymentMethod: z.enum(['CASH', 'MPESA', 'BANK_TRANSFER', 'CARD', 'OTHER']).optional(),
  reference:     z.string().max(200).optional().nullable(),
  note:          z.string().max(500).optional().nullable(),
  givenAt:       z.string().datetime().optional().nullable(),
})

export async function updateGiving(req, res, next) {
  try {
    const { id } = req.params
    const existing = await prisma.giving.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ error: 'Giving not found' })
    if (existing.voided) return res.status(409).json({ error: 'Cannot edit a voided giving' })

    const parsed = GivingUpdateSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid data' })

    const data = {}
    const d = parsed.data
    if ('memberId' in d)      data.memberId      = d.memberId ?? null
    if ('isAnonymous' in d)   data.isAnonymous   = d.isAnonymous
    if ('projectId' in d)     data.projectId     = d.projectId
    if ('amount' in d)        data.amount        = d.amount
    if ('paymentMethod' in d) data.paymentMethod = d.paymentMethod
    if ('reference' in d)     data.reference     = d.reference ?? null
    if ('note' in d)          data.note          = d.note ?? null
    if ('givenAt' in d)       data.givenAt       = d.givenAt ? new Date(d.givenAt) : null

    const giving = await prisma.giving.update({
      where: { id },
      data,
      include: { member: MEMBER_SELECT, project: PROJECT_SELECT },
    })
    res.json(fmtGiving(giving, req.user.role))
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Giving not found' })
    next(err)
  }
}

export async function voidGiving(req, res, next) {
  try {
    const { id } = req.params
    const existing = await prisma.giving.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ error: 'Giving not found' })
    if (existing.voided) return res.status(409).json({ error: 'Giving is already voided' })

    const giving = await prisma.giving.update({
      where: { id },
      data: { voided: true, voidedAt: new Date(), voidedById: req.user.userId },
      include: { member: MEMBER_SELECT, project: PROJECT_SELECT },
    })
    res.json(fmtGiving(giving, req.user.role))
  } catch (err) { next(err) }
}

// ── Receipt (PDF) ─────────────────────────────────────────────

// GET /givings/:id/receipt — streams a PDF receipt. Accessible to managers
// (ADMIN+/manageGivings) for any giving, or to the member who owns it.
export async function givingReceipt(req, res, next) {
  try {
    const { id } = req.params
    const giving = await prisma.giving.findUnique({
      where: { id },
      include: { member: MEMBER_SELECT, project: PROJECT_SELECT },
    })
    if (!giving) return res.status(404).json({ error: 'Giving not found' })

    const role = req.user.role
    const hasManage = (ROLE_LEVEL[role] ?? -1) >= ROLE_LEVEL.ADMIN || req.user.permissions?.manageGivings

    let viewerIsOwner = false
    if (giving.memberId) {
      const profile = await prisma.memberProfile.findUnique({ where: { userId: req.user.userId } })
      viewerIsOwner = !!profile && profile.id === giving.memberId
    }
    if (!hasManage && !viewerIsOwner) return res.status(404).json({ error: 'Giving not found' })

    if (giving.voided) return res.status(409).json({ error: 'Cannot issue a receipt for a voided giving' })

    let donorName = giving.member ? `${giving.member.firstName} ${giving.member.lastName}` : 'Anonymous Donor'
    if (giving.isAnonymous && !viewerIsOwner && !isSuperAdmin(role)) donorName = 'Anonymous'

    const doc = new PDFDocument({ size: 'A4', margin: 56 })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="receipt-${id.slice(-8)}.pdf"`)
    doc.pipe(res)
    writeReceipt(doc, {
      receiptNo:     id.slice(-8).toUpperCase(),
      issuedAt:      new Date(),
      donorName,
      givenAt:       giving.givenAt,
      projectName:   giving.project?.name ?? null,
      paymentMethod: giving.paymentMethod,
      reference:     giving.reference,
      note:          giving.note,
      amount:        giving.amount.toString(),
    })
    doc.end()
  } catch (err) { next(err) }
}

// ── Reports ───────────────────────────────────────────────────

// GET /givings/summary?memberId=&year= — annual summary, broken down by
// project and by month. Defaults to the current year; memberId is optional
// (omit for a whole-church summary).
export async function givingSummary(req, res, next) {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear()
    const start = new Date(Date.UTC(year, 0, 1))
    const end   = new Date(Date.UTC(year + 1, 0, 1))

    const where = { voided: false, givenAt: { gte: start, lt: end } }
    if (req.query.memberId) where.memberId = req.query.memberId

    const givings = await prisma.giving.findMany({
      where,
      include: { project: PROJECT_SELECT },
    })

    let total = 0
    const byProjectMap = {}
    const byMonth = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, total: 0, count: 0 }))

    for (const g of givings) {
      const amt = parseFloat(g.amount.toString())
      total += amt
      const m = new Date(g.givenAt).getUTCMonth()
      byMonth[m].total += amt
      byMonth[m].count++
      if (!byProjectMap[g.projectId]) {
        byProjectMap[g.projectId] = { projectId: g.projectId, projectName: g.project?.name ?? '—', total: 0, count: 0 }
      }
      byProjectMap[g.projectId].total += amt
      byProjectMap[g.projectId].count++
    }

    res.json({
      year,
      memberId: req.query.memberId ?? null,
      total: total.toFixed(2),
      count: givings.length,
      byProject: Object.values(byProjectMap).map(b => ({ ...b, total: b.total.toFixed(2) })),
      byMonth: byMonth.map(b => ({ ...b, total: b.total.toFixed(2) })),
    })
  } catch (err) { next(err) }
}

// GET /givings/report?from=&to=&projectId=&paymentMethod= — date-range report,
// broken down by project and by payment method. All filters optional.
export async function givingReport(req, res, next) {
  try {
    const where = { voided: false }
    if (req.query.from || req.query.to) {
      where.givenAt = {}
      if (req.query.from) where.givenAt.gte = new Date(req.query.from)
      if (req.query.to)   where.givenAt.lte = new Date(req.query.to)
    }
    if (req.query.projectId)     where.projectId = req.query.projectId
    if (req.query.paymentMethod) where.paymentMethod = req.query.paymentMethod

    const givings = await prisma.giving.findMany({
      where,
      include: { project: PROJECT_SELECT },
    })

    let total = 0
    const byProjectMap = {}
    const byMethodMap = {}

    for (const g of givings) {
      const amt = parseFloat(g.amount.toString())
      total += amt
      if (!byProjectMap[g.projectId]) {
        byProjectMap[g.projectId] = { projectId: g.projectId, projectName: g.project?.name ?? '—', total: 0, count: 0 }
      }
      byProjectMap[g.projectId].total += amt
      byProjectMap[g.projectId].count++
      if (!byMethodMap[g.paymentMethod]) {
        byMethodMap[g.paymentMethod] = { paymentMethod: g.paymentMethod, total: 0, count: 0 }
      }
      byMethodMap[g.paymentMethod].total += amt
      byMethodMap[g.paymentMethod].count++
    }

    res.json({
      from: req.query.from ?? null,
      to:   req.query.to ?? null,
      total: total.toFixed(2),
      count: givings.length,
      byProject: Object.values(byProjectMap).map(b => ({ ...b, total: b.total.toFixed(2) })),
      byMethod:  Object.values(byMethodMap).map(b => ({ ...b, total: b.total.toFixed(2) })),
    })
  } catch (err) { next(err) }
}

// ── Member: own givings ───────────────────────────────────────

export async function listMine(req, res, next) {
  try {
    const profile = await prisma.memberProfile.findUnique({ where: { userId: req.user.userId } })
    if (!profile) return res.json({ items: [], totalGiven: '0.00', byProject: [] })

    const givings = await prisma.giving.findMany({
      where: { memberId: profile.id, voided: false },
      include: { project: PROJECT_SELECT },
      orderBy: { givenAt: 'desc' },
    })

    let total = 0
    const byProjectMap = {}
    for (const g of givings) {
      const amt = parseFloat(g.amount.toString())
      total += amt
      if (!byProjectMap[g.projectId]) {
        byProjectMap[g.projectId] = {
          projectId: g.projectId,
          projectName: g.project?.name ?? '—',
          total: 0,
          count: 0,
        }
      }
      byProjectMap[g.projectId].total += amt
      byProjectMap[g.projectId].count++
    }

    res.json({
      items: givings.map(g => ({
        id: g.id,
        projectId: g.projectId,
        projectName: g.project?.name ?? null,
        amount: g.amount.toString(),
        paymentMethod: g.paymentMethod,
        reference: g.reference ?? null,
        note: g.note ?? null,
        givenAt: g.givenAt,
        isAnonymous: g.isAnonymous,
        createdAt: g.createdAt,
      })),
      totalGiven: total.toFixed(2),
      byProject: Object.values(byProjectMap).map(b => ({
        ...b,
        total: b.total.toFixed(2),
      })),
    })
  } catch (err) { next(err) }
}

// ── Correction requests ───────────────────────────────────────

const CorrectionSchema = z.object({
  reason:       z.string().min(1).max(500),
  proposedData: z.record(z.unknown()),
})

export async function requestCorrection(req, res, next) {
  try {
    const { id } = req.params
    const profile = await prisma.memberProfile.findUnique({ where: { userId: req.user.userId } })
    if (!profile) return res.status(403).json({ error: 'No member profile found' })

    const giving = await prisma.giving.findUnique({ where: { id } })
    if (!giving || giving.memberId !== profile.id) return res.status(404).json({ error: 'Giving not found' })
    if (giving.voided) return res.status(409).json({ error: 'Cannot correct a voided giving' })

    const parsed = CorrectionSchema.safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid data' })

    const existingPending = await prisma.givingUpdateRequest.findFirst({
      where: { givingId: id, status: 'PENDING' },
    })
    if (existingPending) return res.status(409).json({ error: 'A correction request is already pending for this giving' })

    const request = await prisma.givingUpdateRequest.create({
      data: {
        givingId: id,
        requestedById: req.user.userId,
        reason: parsed.data.reason,
        proposedData: parsed.data.proposedData,
        status: 'PENDING',
      },
    })
    res.status(201).json(request)
  } catch (err) { next(err) }
}

export async function listCorrectionRequests(req, res, next) {
  try {
    const requests = await prisma.givingUpdateRequest.findMany({
      include: {
        giving: { include: { member: MEMBER_SELECT, project: PROJECT_SELECT } },
        requestedBy: {
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    // PENDING items first, then everything else by date desc
    const sorted = [...requests].sort((a, b) => {
      if (a.status === 'PENDING' && b.status !== 'PENDING') return -1
      if (a.status !== 'PENDING' && b.status === 'PENDING') return 1
      return new Date(b.createdAt) - new Date(a.createdAt)
    })

    res.json({
      requests: sorted.map(r => ({
        id: r.id,
        givingId: r.givingId,
        status: r.status,
        reason: r.reason,
        proposedData: r.proposedData,
        createdAt: r.createdAt,
        handledAt: r.handledAt ?? null,
        giving: r.giving ? fmtGiving(r.giving, req.user.role) : null,
        requester: {
          id: r.requestedBy.id,
          email: r.requestedBy.email,
          name: r.requestedBy.profile
            ? `${r.requestedBy.profile.firstName} ${r.requestedBy.profile.lastName}`
            : r.requestedBy.email,
        },
      })),
    })
  } catch (err) { next(err) }
}

const CORRECTABLE_FIELDS = ['amount', 'paymentMethod', 'reference', 'note', 'givenAt']

export async function approveCorrection(req, res, next) {
  try {
    const { id } = req.params
    const request = await prisma.givingUpdateRequest.findUnique({ where: { id } })
    if (!request) return res.status(404).json({ error: 'Request not found' })
    if (request.status !== 'PENDING') return res.status(409).json({ error: 'Request is not pending' })

    const proposed = request.proposedData ?? {}
    const update = {}
    for (const field of CORRECTABLE_FIELDS) {
      if (!(field in proposed)) continue
      if (field === 'amount')  update.amount  = parseFloat(proposed[field])
      else if (field === 'givenAt') update.givenAt = proposed[field] ? new Date(proposed[field]) : undefined
      else update[field] = proposed[field]
    }

    await prisma.$transaction([
      prisma.giving.update({ where: { id: request.givingId }, data: update }),
      prisma.givingUpdateRequest.update({
        where: { id },
        data: { status: 'APPROVED', handledById: req.user.userId, handledAt: new Date() },
      }),
    ])

    createNotification(
      request.requestedById,
      'Giving correction approved',
      'Your correction request has been reviewed and your giving record has been updated.',
    ).catch(() => {})

    res.json({ message: 'Correction approved' })
  } catch (err) { next(err) }
}

export async function rejectCorrection(req, res, next) {
  try {
    const { id } = req.params
    const { reason: rejectReason } = z.object({ reason: z.string().optional() }).parse(req.body ?? {})
    const request = await prisma.givingUpdateRequest.findUnique({ where: { id } })
    if (!request) return res.status(404).json({ error: 'Request not found' })
    if (request.status !== 'PENDING') return res.status(409).json({ error: 'Request is not pending' })

    await prisma.givingUpdateRequest.update({
      where: { id },
      data: { status: 'REJECTED', handledById: req.user.userId, handledAt: new Date() },
    })

    createNotification(
      request.requestedById,
      'Giving correction not approved',
      `Your correction request was not approved.${rejectReason ? ' Reason: ' + rejectReason : ''}`,
    ).catch(() => {})

    res.json({ message: 'Correction rejected' })
  } catch (err) { next(err) }
}

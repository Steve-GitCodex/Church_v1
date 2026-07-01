import PDFDocument from 'pdfkit'
import prisma from '../config/db.js'
import { writeReceipt } from '../services/receipt.js'

const ROLE_LEVEL = { PENDING: 0, MEMBER: 1, STAFF: 2, ADMIN: 3, SUPER_ADMIN: 4, LEGEND: 5 }
const isSuperAdmin = (role) => (ROLE_LEVEL[role] ?? -1) >= ROLE_LEVEL.SUPER_ADMIN

const MEMBER_SELECT = { select: { firstName: true, lastName: true } }
const PROJECT_SELECT = { select: { name: true } }

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

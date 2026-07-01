import { z } from 'zod'
import prisma from '../config/db.js'
import { canManageItemType } from './content/shared.js'

// ─── POST /api/content/:id/rsvp ──────────────────────────────────────────────

export async function rsvp(req, res, next) {
  try {
    const item = await prisma.content.findUnique({ where: { id: req.params.id } })
    if (!item) return res.status(404).json({ error: 'Content not found' })
    if (item.type !== 'EVENT') return res.status(400).json({ error: 'Only events accept RSVPs' })
    if (!item.registrationOpen) return res.status(400).json({ error: 'Registration is not open for this event' })
    if (item.status !== 'PUBLISHED') return res.status(400).json({ error: 'Event is not published' })

    await prisma.eventRegistration.upsert({
      where: { contentId_userId: { contentId: item.id, userId: req.user.userId } },
      update: {},
      create: { contentId: item.id, userId: req.user.userId },
    })

    res.json({ registered: true })
  } catch (err) {
    next(err)
  }
}

// ─── DELETE /api/content/:id/rsvp ────────────────────────────────────────────

export async function cancelRsvp(req, res, next) {
  try {
    await prisma.eventRegistration.deleteMany({
      where: { contentId: req.params.id, userId: req.user.userId },
    })
    res.json({ registered: false })
  } catch (err) {
    next(err)
  }
}

// ─── GET /api/content/:id/registrations (admin) ──────────────────────────────

export async function listRegistrations(req, res, next) {
  try {
    const item = await prisma.content.findUnique({ where: { id: req.params.id } })
    if (!item) return res.status(404).json({ error: 'Content not found' })
    if (item.type !== 'EVENT') return res.status(400).json({ error: 'Only events have registrations' })

    const regs = await prisma.eventRegistration.findMany({
      where: { contentId: req.params.id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            profile: { select: { firstName: true, lastName: true, phone: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    const ticketPrice = item.ticketPrice ? Number(item.ticketPrice) : 0
    const paidCount = regs.filter(r => r.paidAt).length
    const collected = regs.reduce((sum, r) => sum + (r.amountPaid ? Number(r.amountPaid) : 0), 0)

    res.json({
      count: regs.length,
      ticketPrice: item.ticketPrice,
      summary: { paidCount, unpaidCount: regs.length - paidCount, collected, expected: ticketPrice * regs.length },
      registrations: regs.map(r => ({
        userId: r.userId,
        email: r.user.email,
        name: r.user.profile ? `${r.user.profile.firstName} ${r.user.profile.lastName}` : r.user.email,
        phone: r.user.profile?.phone ?? null,
        registeredAt: r.createdAt,
        paidAt: r.paidAt,
        amountPaid: r.amountPaid,
        paymentMethod: r.paymentMethod,
        paymentReference: r.paymentReference,
      })),
    })
  } catch (err) {
    next(err)
  }
}

// ─── POST /api/content/:id/registrations/:userId/pay (manager — mark ticket paid) ──
export async function markRegistrationPaid(req, res, next) {
  try {
    const schema = z.object({
      amount:    z.number().nonnegative(),
      method:    z.enum(['CASH', 'MPESA', 'BANK_TRANSFER', 'CARD', 'OTHER']),
      reference: z.string().max(255).optional().nullable(),
    })
    const data = schema.parse(req.body)

    const item = await prisma.content.findUnique({ where: { id: req.params.id } })
    if (!item) return res.status(404).json({ error: 'Content not found' })
    if (item.type !== 'EVENT') return res.status(400).json({ error: 'Only events have registrations' })
    if (!canManageItemType(req.user, item.type)) {
      return res.status(403).json({ error: 'You can only manage EVENT content with your current permissions' })
    }

    const reg = await prisma.eventRegistration.findUnique({
      where: { contentId_userId: { contentId: req.params.id, userId: req.params.userId } },
    })
    if (!reg) return res.status(404).json({ error: 'Registration not found' })

    await prisma.eventRegistration.update({
      where: { id: reg.id },
      data: {
        amountPaid:       data.amount,
        paymentMethod:    data.method,
        paymentReference: data.reference ?? null,
        paidAt:           new Date(),
      },
    })
    res.json({ paid: true })
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors })
    next(err)
  }
}

// ─── POST /api/content/:id/registrations/:userId/unpay (manager — clear payment) ──
export async function unmarkRegistrationPaid(req, res, next) {
  try {
    const item = await prisma.content.findUnique({ where: { id: req.params.id } })
    if (!item) return res.status(404).json({ error: 'Content not found' })
    if (item.type !== 'EVENT') return res.status(400).json({ error: 'Only events have registrations' })
    if (!canManageItemType(req.user, item.type)) {
      return res.status(403).json({ error: 'You can only manage EVENT content with your current permissions' })
    }

    await prisma.eventRegistration.updateMany({
      where: { contentId: req.params.id, userId: req.params.userId },
      data: { amountPaid: null, paymentMethod: null, paymentReference: null, paidAt: null },
    })
    res.json({ paid: false })
  } catch (err) {
    next(err)
  }
}

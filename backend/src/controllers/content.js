import { fileURLToPath } from 'url'
import { dirname, join, extname } from 'path'
import { z } from 'zod'
import { createId } from '@paralleldrive/cuid2'
import multer from 'multer'
import sanitizeHtml from 'sanitize-html'
import prisma from '../config/db.js'
import { verifyAccessToken } from '../services/token.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─── Multer (image uploads) ───────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, join(__dirname, '../../uploads')),
  filename: (req, file, cb) => {
    const ext = extname(file.originalname).toLowerCase()
    cb(null, `${createId()}${ext}`)
  },
})

const ALLOWED_MIMETYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export const uploadMiddleware = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIMETYPES.includes(file.mimetype)) return cb(null, true)
    cb(new Error('Only JPEG, PNG, WebP, and GIF images are allowed'))
  },
}).single('image')

// ─── HTML sanitization ────────────────────────────────────────────────────────

const SANITIZE_OPTS = {
  allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'blockquote'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
}

function sanitize(html) {
  return sanitizeHtml(html || '', SANITIZE_OPTS)
}

// ─── Optional auth (public routes that enrich if user is logged in) ───────────

export function optionalAuth(req, res, next) {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) {
    try {
      req.user = verifyAccessToken(header.slice(7))
    } catch {
      // invalid token — treat as public
    }
  }
  next()
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN', 'LEGEND'])

// Returns false when a Staff user has only manageEvents and the content type is not EVENT.
function canManageItemType(user, itemType) {
  if (ADMIN_ROLES.has(user.role)) return true
  if (user.permissions?.manageContent) return true
  if (user.permissions?.manageEvents && itemType === 'EVENT') return true
  return false
}

function formatItem(item, isNew) {
  return {
    id: item.id,
    type: item.type,
    status: item.status,
    title: item.title,
    body: item.body,
    imageUrl: item.imageUrl,
    category: item.category,
    isFeatured: item.isFeatured,
    eventDate: item.eventDate,
    eventEndDate: item.eventEndDate,
    location: item.location,
    maxAttendees: item.maxAttendees,
    registrationOpen: item.registrationOpen,
    ticketPrice: item.ticketPrice,
    publishedAt: item.publishedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    author: item.author ? {
      id: item.author.id,
      email: item.author.email,
      name: item.author.profile ? `${item.author.profile.firstName} ${item.author.profile.lastName}` : item.author.email,
    } : undefined,
    isNew: isNew,
  }
}

// ─── GET /api/content (public + optional auth) ────────────────────────────────

export async function listContent(req, res, next) {
  try {
    const { type, category, from, to, unseen, featured, sort, page = 1, limit = 20 } = req.query
    const skip = (Number(page) - 1) * Number(limit)

    const where = { status: 'PUBLISHED' }
    if (type) {
      const types = Array.isArray(type) ? type.map(t => t.toUpperCase()) : [type.toUpperCase()]
      where.type = types.length === 1 ? types[0] : { in: types }
    }
    if (category) where.category = category
    if (from || to) {
      where.publishedAt = {}
      if (from) where.publishedAt.gte = new Date(from)
      if (to) where.publishedAt.lte = new Date(to)
    }

    const userId = req.user?.userId ?? null

    // unseen filter: exclude items the user has already read
    if (unseen === '1' && userId) {
      where.reads = { none: { userId } }
    }

    if (featured === '1') where.isFeatured = true

    const orderBy = sort === 'eventDate' ? { eventDate: 'asc' } : { publishedAt: 'desc' }

    const includeClause = {
      author: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
      ...(userId ? { reads: { where: { userId }, select: { id: true } } } : {}),
    }

    const [total, items] = await Promise.all([
      prisma.content.count({ where }),
      prisma.content.findMany({ where, skip, take: Number(limit), orderBy, include: includeClause }),
    ])

    res.json({
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)) || 1,
      items: items.map(item => {
        const isNew = userId ? item.reads?.length === 0 : undefined
        return formatItem(item, isNew)
      }),
    })
  } catch (err) {
    next(err)
  }
}

// ─── GET /api/content/manage (admin — includes all statuses) ─────────────────

export async function listManage(req, res, next) {
  try {
    const { type, status, page = 1, limit = 20 } = req.query
    const skip = (Number(page) - 1) * Number(limit)

    const where = {}
    if (type) where.type = type.toUpperCase()
    if (status) where.status = status.toUpperCase()

    const [total, items] = await Promise.all([
      prisma.content.count({ where }),
      prisma.content.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          author: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
          _count: { select: { registrations: true } },
        },
      }),
    ])

    res.json({
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)) || 1,
      items: items.map(item => ({
        ...formatItem(item, null),
        registrationCount: item._count.registrations,
      })),
    })
  } catch (err) {
    next(err)
  }
}

// ─── GET /api/content/unseen-counts (authenticated) ──────────────────────────

export async function unseenCounts(req, res, next) {
  try {
    const userId = req.user.userId
    const baseWhere = { status: 'PUBLISHED', reads: { none: { userId } } }

    const [news, events] = await Promise.all([
      prisma.content.count({ where: { ...baseWhere, type: { in: ['NEWS', 'ANNOUNCEMENT'] } } }),
      prisma.content.count({ where: { ...baseWhere, type: 'EVENT' } }),
    ])

    res.json({ news, events })
  } catch (err) {
    next(err)
  }
}

// ─── POST /api/content/:id/read (authenticated — mark a single item read) ─────

export async function markRead(req, res, next) {
  try {
    const item = await prisma.content.findUnique({ where: { id: req.params.id } })
    if (!item) return res.status(404).json({ error: 'Content not found' })

    await prisma.contentRead.upsert({
      where: { contentId_userId: { contentId: item.id, userId: req.user.userId } },
      update: {},
      create: { contentId: item.id, userId: req.user.userId },
    })

    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
}

// ─── GET /api/content/:id (public + optional auth) ───────────────────────────

export async function getContent(req, res, next) {
  try {
    const item = await prisma.content.findUnique({
      where: { id: req.params.id },
      include: {
        author: { select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } } },
        _count: { select: { registrations: true } },
      },
    })

    if (!item) return res.status(404).json({ error: 'Content not found' })
    if (item.status !== 'PUBLISHED' && !req.user) {
      return res.status(404).json({ error: 'Content not found' })
    }

    let isRegistered = false
    if (req.user && item.type === 'EVENT') {
      const reg = await prisma.eventRegistration.findUnique({
        where: { contentId_userId: { contentId: item.id, userId: req.user.userId } },
      })
      isRegistered = !!reg
    }

    let isNew = undefined
    if (req.user) {
      const read = await prisma.contentRead.findUnique({
        where: { contentId_userId: { contentId: item.id, userId: req.user.userId } },
      })
      isNew = !read
    }

    res.json({
      ...formatItem(item, isNew),
      rsvpCount: item._count.registrations,
      isRegistered,
    })
  } catch (err) {
    next(err)
  }
}

// ─── POST /api/content (create — Staff with manageContent, Admin+) ────────────

export async function createContent(req, res, next) {
  try {
    const schema = z.object({
      type:             z.enum(['NEWS', 'ANNOUNCEMENT', 'EVENT']),
      title:            z.string().min(1).max(255),
      body:             z.string().min(1),
      imageUrl:         z.string().url().optional().nullable(),
      category:         z.string().max(100).optional().nullable(),
      eventDate:        z.string().datetime().optional().nullable(),
      eventEndDate:     z.string().datetime().optional().nullable(),
      location:         z.string().max(255).optional().nullable(),
      maxAttendees:     z.number().int().positive().optional().nullable(),
      registrationOpen: z.boolean().optional(),
      ticketPrice:      z.number().nonnegative().optional().nullable(),
      isFeatured:       z.boolean().optional(),
    })
    const data = schema.parse(req.body)
    if (!canManageItemType(req.user, data.type)) {
      return res.status(403).json({ error: 'You can only create EVENT content with your current permissions' })
    }

    const item = await prisma.content.create({
      data: {
        type:             data.type,
        title:            data.title,
        body:             sanitize(data.body),
        imageUrl:         data.imageUrl ?? null,
        category:         data.category ?? null,
        eventDate:        data.eventDate ? new Date(data.eventDate) : null,
        eventEndDate:     data.eventEndDate ? new Date(data.eventEndDate) : null,
        location:         data.location ?? null,
        maxAttendees:     data.maxAttendees ?? null,
        registrationOpen: data.registrationOpen ?? false,
        ticketPrice:      data.ticketPrice ?? null,
        isFeatured:       data.isFeatured ?? false,
        authorId:         req.user.userId,
        status:           'DRAFT',
      },
    })

    res.status(201).json({ id: item.id, title: item.title, status: item.status })
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors })
    next(err)
  }
}

// ─── PUT /api/content/:id (edit) ─────────────────────────────────────────────

export async function updateContent(req, res, next) {
  try {
    const schema = z.object({
      title:            z.string().min(1).max(255).optional(),
      body:             z.string().min(1).optional(),
      imageUrl:         z.string().url().optional().nullable(),
      category:         z.string().max(100).optional().nullable(),
      eventDate:        z.string().datetime().optional().nullable(),
      eventEndDate:     z.string().datetime().optional().nullable(),
      location:         z.string().max(255).optional().nullable(),
      maxAttendees:     z.number().int().positive().optional().nullable(),
      registrationOpen: z.boolean().optional(),
      ticketPrice:      z.number().nonnegative().optional().nullable(),
      isFeatured:       z.boolean().optional(),
    })
    const data = schema.parse(req.body)

    const item = await prisma.content.findUnique({ where: { id: req.params.id } })
    if (!item) return res.status(404).json({ error: 'Content not found' })
    if (!canManageItemType(req.user, item.type)) {
      return res.status(403).json({ error: 'You can only manage EVENT content with your current permissions' })
    }
    if (item.status === 'ARCHIVED') return res.status(409).json({ error: 'Archived content cannot be edited' })

    const updateData = {}
    if (data.title !== undefined) updateData.title = data.title
    if (data.body !== undefined)  updateData.body = sanitize(data.body)
    if ('imageUrl' in data)       updateData.imageUrl = data.imageUrl ?? null
    if ('category' in data)       updateData.category = data.category ?? null
    if ('location' in data)       updateData.location = data.location ?? null
    if ('maxAttendees' in data)   updateData.maxAttendees = data.maxAttendees ?? null
    if ('eventDate' in data)      updateData.eventDate = data.eventDate ? new Date(data.eventDate) : null
    if ('eventEndDate' in data)   updateData.eventEndDate = data.eventEndDate ? new Date(data.eventEndDate) : null
    if ('ticketPrice' in data)    updateData.ticketPrice = data.ticketPrice ?? null
    if (data.registrationOpen !== undefined) updateData.registrationOpen = data.registrationOpen
    if (data.isFeatured !== undefined) updateData.isFeatured = data.isFeatured

    const updated = await prisma.content.update({ where: { id: req.params.id }, data: updateData })
    res.json({ id: updated.id, title: updated.title, status: updated.status })
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors })
    next(err)
  }
}

// ─── POST /api/content/:id/publish ───────────────────────────────────────────

export async function publishContent(req, res, next) {
  try {
    const item = await prisma.content.findUnique({ where: { id: req.params.id } })
    if (!item) return res.status(404).json({ error: 'Content not found' })
    if (!canManageItemType(req.user, item.type)) {
      return res.status(403).json({ error: 'You can only manage EVENT content with your current permissions' })
    }
    if (item.status === 'ARCHIVED') return res.status(409).json({ error: 'Archived content cannot be published' })

    const updated = await prisma.content.update({
      where: { id: req.params.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: item.publishedAt ?? new Date(),
      },
    })
    res.json({ id: updated.id, status: updated.status, publishedAt: updated.publishedAt })
  } catch (err) {
    next(err)
  }
}

// ─── DELETE /api/content/:id (archive — soft delete) ─────────────────────────

export async function archiveContent(req, res, next) {
  try {
    const item = await prisma.content.findUnique({ where: { id: req.params.id } })
    if (!item) return res.status(404).json({ error: 'Content not found' })
    if (!canManageItemType(req.user, item.type)) {
      return res.status(403).json({ error: 'You can only manage EVENT content with your current permissions' })
    }

    await prisma.content.update({ where: { id: req.params.id }, data: { status: 'ARCHIVED' } })
    res.json({ message: 'Content archived' })
  } catch (err) {
    next(err)
  }
}

// ─── POST /api/content/:id/restore (ARCHIVED → DRAFT) ────────────────────────

export async function restoreContent(req, res, next) {
  try {
    const item = await prisma.content.findUnique({ where: { id: req.params.id } })
    if (!item) return res.status(404).json({ error: 'Content not found' })
    if (!canManageItemType(req.user, item.type)) {
      return res.status(403).json({ error: 'You can only manage EVENT content with your current permissions' })
    }
    if (item.status !== 'ARCHIVED') return res.status(409).json({ error: 'Content is not archived' })

    const restored = await prisma.content.update({ where: { id: req.params.id }, data: { status: 'DRAFT' } })
    res.json({ message: 'Content restored to draft', status: restored.status })
  } catch (err) {
    next(err)
  }
}

// ─── POST /api/content/:id/feature (toggle isFeatured) ───────────────────────

export async function toggleFeatured(req, res, next) {
  try {
    const item = await prisma.content.findUnique({ where: { id: req.params.id } })
    if (!item) return res.status(404).json({ error: 'Content not found' })
    if (!canManageItemType(req.user, item.type)) {
      return res.status(403).json({ error: 'You can only manage EVENT content with your current permissions' })
    }

    const updated = await prisma.content.update({
      where: { id: req.params.id },
      data: { isFeatured: !item.isFeatured },
    })
    res.json({ isFeatured: updated.isFeatured })
  } catch (err) {
    next(err)
  }
}

// ─── POST /api/content/upload (image upload via multer) ──────────────────────

export async function uploadImage(req, res, next) {
  uploadMiddleware(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message })
    if (!req.file) return res.status(400).json({ error: 'No image file provided' })
    res.json({ url: `/uploads/${req.file.filename}` })
  })
}

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

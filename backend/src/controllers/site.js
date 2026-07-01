import { z } from 'zod'
import prisma from '../config/db.js'
import {
  SCHEDULE_KEY as SECURITY_SCHEDULE_KEY,
  getSecurityReviewSchedule,
  scheduleSecurityReviewReminder,
  sendMonthlyReminder,
} from '../services/securityReviewReminder.js'

const ABOUT_KEY    = 'about'
const FEATURES_KEY = 'givings_enabled'

const DEFAULT_ABOUT = {
  hero: {
    heading: 'About AIC Ruiru',
    subheading: 'A vibrant, growing church in Ruiru, Kenya — part of the Africa Inland Church family.',
  },
  mission: 'We are committed to preaching the Gospel, discipling believers, and serving our community.',
  vision: 'To see every person in Ruiru transformed by the love of Christ and empowered to live for God\'s glory.',
  story: 'AIC Ruiru was established as part of the Africa Inland Church, one of Kenya\'s oldest and most widespread denominations. Over the years we have grown into a vibrant, multi-generational congregation devoted to worship, fellowship, and community service.',
  beliefs: [
    'We believe in the Holy Trinity — Father, Son, and Holy Spirit.',
    'We believe in the Bible as the inspired, authoritative Word of God.',
    'We believe in salvation by grace through faith in Jesus Christ.',
    'We believe in the Great Commission — making disciples of all nations.',
    'We believe in the power of prayer and the work of the Holy Spirit.',
  ],
  leaders: [],
  serviceTimes: [
    { day: 'Sunday', time: '9:00 AM', label: 'Sunday Service' },
    { day: 'Wednesday', time: '6:00 PM', label: 'Mid-week Service' },
    { day: 'Friday', time: '6:00 PM', label: 'Prayer Meeting' },
  ],
  location: {
    address: 'Ruiru Town, Kiambu County, Kenya',
    phone: '',
    email: '',
    mapEmbed: '',
  },
}

export async function getAbout(_req, res, next) {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: ABOUT_KEY } })
    res.json(row ? row.value : DEFAULT_ABOUT)
  } catch (err) {
    next(err)
  }
}

const LeaderSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  imageUrl: z.string().optional().default(''),
})

const ServiceTimeSchema = z.object({
  day: z.string().min(1),
  time: z.string().min(1),
  label: z.string().optional().default(''),
})

const AboutSchema = z.object({
  hero: z.object({
    heading: z.string().min(1),
    subheading: z.string().optional().default(''),
  }),
  mission: z.string().optional().default(''),
  vision: z.string().optional().default(''),
  story: z.string().optional().default(''),
  beliefs: z.array(z.string()).optional().default([]),
  leaders: z.array(LeaderSchema).optional().default([]),
  serviceTimes: z.array(ServiceTimeSchema).optional().default([]),
  location: z.object({
    address: z.string().optional().default(''),
    phone: z.string().optional().default(''),
    email: z.string().optional().default(''),
    mapEmbed: z.string().optional().default(''),
  }).optional().default({}),
})

// ── Feature flags ─────────────────────────────────────────────

export async function getFeatures(_req, res, next) {
  try {
    const row = await prisma.siteSetting.findUnique({ where: { key: FEATURES_KEY } })
    res.json({ givings: row ? row.value === true : true })
  } catch (err) { next(err) }
}

export async function updateFeatures(req, res, next) {
  try {
    const parsed = z.object({ givings: z.boolean() }).safeParse(req.body)
    if (!parsed.success) return res.status(400).json({ error: 'Expected { givings: boolean }' })
    await prisma.siteSetting.upsert({
      where:  { key: FEATURES_KEY },
      update: { value: parsed.data.givings },
      create: { key: FEATURES_KEY, value: parsed.data.givings },
    })
    res.json({ givings: parsed.data.givings })
  } catch (err) { next(err) }
}

// ── About ─────────────────────────────────────────────────────

export async function updateAbout(req, res, next) {
  try {
    const parsed = AboutSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid data' })
    }
    const row = await prisma.siteSetting.upsert({
      where: { key: ABOUT_KEY },
      update: { value: parsed.data },
      create: { key: ABOUT_KEY, value: parsed.data },
    })
    res.json(row.value)
  } catch (err) {
    next(err)
  }
}

// ── Security review reminder schedule (SUPER_ADMIN) ─────────────

export async function getSecurityReviewScheduleSetting(_req, res, next) {
  try {
    res.json(await getSecurityReviewSchedule())
  } catch (err) { next(err) }
}

const ScheduleSchema = z.object({
  enabled: z.boolean(),
  dayOfMonth: z.number().int().min(1).max(28),
  hour: z.number().int().min(0).max(23),
})

export async function updateSecurityReviewScheduleSetting(req, res, next) {
  try {
    const parsed = ScheduleSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid schedule' })
    }
    await prisma.siteSetting.upsert({
      where:  { key: SECURITY_SCHEDULE_KEY },
      update: { value: parsed.data },
      create: { key: SECURITY_SCHEDULE_KEY, value: parsed.data },
    })
    await scheduleSecurityReviewReminder()
    res.json(parsed.data)
  } catch (err) { next(err) }
}

const RunNowSchema = z.object({ to: z.string().email().optional() })

export async function runSecurityReviewNow(req, res, next) {
  try {
    const parsed = RunNowSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid recipient' })
    }
    await sendMonthlyReminder({ to: parsed.data.to })
    res.json({ sent: true })
  } catch (err) {
    if (err.message === 'No active Super Admin found with that email') {
      return res.status(400).json({ error: err.message })
    }
    next(err)
  }
}

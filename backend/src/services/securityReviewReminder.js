import cron from 'node-cron'
import prisma from '../config/db.js'
import { createNotification } from './notifications.js'
import { sendSecurityAlertEmail } from './email.js'

export const SCHEDULE_KEY = 'security_review_schedule'
export const DEFAULT_SCHEDULE = { enabled: true, dayOfMonth: 1, hour: 8 }

let scheduledTask = null

export async function getSecurityReviewSchedule() {
  const row = await prisma.siteSetting.findUnique({ where: { key: SCHEDULE_KEY } })
  return row ? { ...DEFAULT_SCHEDULE, ...row.value } : DEFAULT_SCHEDULE
}

function toCronExpression({ dayOfMonth, hour }) {
  return `0 ${hour} ${dayOfMonth} * *`
}

export async function sendMonthlyReminder() {
  const superAdmins = await prisma.user.findMany({
    where: { role: 'SUPER_ADMIN', isActive: true },
    select: { id: true, email: true },
  })

  const title = 'Monthly security review due'
  const body = 'It\'s time for the scheduled monthly security review of the AIC Ruiru system. ' +
    'Please coordinate with your developer to run a review and address any findings.'

  for (const admin of superAdmins) {
    await createNotification(admin.id, title, body)
    await sendSecurityAlertEmail(admin.email, title, body)
  }
}

// Reads the current schedule from the DB and (re)starts the cron task to match it.
// Call once at server startup, and again whenever the schedule setting is updated.
export async function scheduleSecurityReviewReminder() {
  if (scheduledTask) {
    scheduledTask.stop()
    scheduledTask = null
  }

  const schedule = await getSecurityReviewSchedule()
  if (!schedule.enabled) return

  scheduledTask = cron.schedule(toCronExpression(schedule), sendMonthlyReminder)
}

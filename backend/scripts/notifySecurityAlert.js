// Notifies every Super Admin (in-app + email) about a security finding.
// Usage: node scripts/notifySecurityAlert.js "<title>" "<body>"
// Run after a /security-review confirms a HIGH or MEDIUM finding.
import { PrismaClient } from '@prisma/client'
import { createNotification } from '../src/services/notifications.js'
import { sendSecurityAlertEmail } from '../src/services/email.js'

const prisma = new PrismaClient()

async function main() {
  const [title, body] = process.argv.slice(2)
  if (!title || !body) {
    console.error('Usage: node scripts/notifySecurityAlert.js "<title>" "<body>"')
    process.exitCode = 1
    return
  }

  const superAdmins = await prisma.user.findMany({
    where: { role: 'SUPER_ADMIN', isActive: true },
    select: { id: true, email: true },
  })

  if (superAdmins.length === 0) {
    console.warn('No active Super Admin accounts found — nothing to notify.')
    return
  }

  for (const admin of superAdmins) {
    await createNotification(admin.id, `Security alert: ${title}`, body)
    await sendSecurityAlertEmail(admin.email, title, body)
  }

  console.log(`Notified ${superAdmins.length} Super Admin(s).`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

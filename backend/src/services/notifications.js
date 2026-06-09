import prisma from '../config/db.js'

export async function createNotification(userId, title, body) {
  return prisma.notification.create({ data: { userId, title, body } })
}

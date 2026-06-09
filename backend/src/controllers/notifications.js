import prisma from '../config/db.js'

// GET /api/notifications
export async function listNotifications(req, res, next) {
  try {
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where: { userId: req.user.userId },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
      prisma.notification.count({
        where: { userId: req.user.userId, readAt: null },
      }),
    ])
    res.json({ notifications, unreadCount })
  } catch (err) {
    next(err)
  }
}

// POST /api/notifications/read-all
export async function markAllRead(req, res, next) {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.userId, readAt: null },
      data: { readAt: new Date() },
    })
    res.json({ message: 'All marked as read' })
  } catch (err) {
    next(err)
  }
}

// POST /api/notifications/:id/read
export async function markRead(req, res, next) {
  try {
    const notif = await prisma.notification.findUnique({ where: { id: req.params.id } })
    if (!notif) return res.status(404).json({ error: 'Notification not found' })
    if (notif.userId !== req.user.userId) return res.status(403).json({ error: 'Forbidden' })
    await prisma.notification.update({ where: { id: req.params.id }, data: { readAt: new Date() } })
    res.json({ message: 'Marked as read' })
  } catch (err) {
    next(err)
  }
}

import jwt from 'jsonwebtoken'
import prisma from '../config/db.js'
import { env } from '../config/env.js'

export function signAccessToken(payload) {
  return jwt.sign(payload, env.jwt.secret, { expiresIn: env.jwt.expiresIn })
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, env.jwt.refreshSecret, { expiresIn: env.jwt.refreshExpiresIn })
}

export function verifyAccessToken(token) {
  return jwt.verify(token, env.jwt.secret)
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, env.jwt.refreshSecret)
}

export async function saveRefreshToken(userId, token) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  await prisma.refreshToken.create({ data: { userId, token, expiresAt } })
}

export async function revokeRefreshToken(token) {
  await prisma.refreshToken.deleteMany({ where: { token } })
}

export async function revokeAllUserRefreshTokens(userId) {
  await prisma.refreshToken.deleteMany({ where: { userId } })
}

export async function rotateRefreshToken(oldToken) {
  const record = await prisma.refreshToken.findUnique({ where: { token: oldToken } })
  if (!record || record.expiresAt < new Date()) return null

  verifyRefreshToken(oldToken)

  // Re-derive claims from the current DB state, not the token being replaced —
  // otherwise a demoted/deactivated user could keep refreshing with stale role/permissions.
  const user = await prisma.user.findUnique({ where: { id: record.userId } })
  if (!user || !user.isActive) {
    await prisma.refreshToken.deleteMany({ where: { token: oldToken } })
    return null
  }

  const payload = { userId: user.id, role: user.role, permissions: user.permissions || {} }
  const newAccessToken = signAccessToken(payload)
  const newRefreshToken = signRefreshToken(payload)

  await prisma.refreshToken.deleteMany({ where: { token: oldToken } })
  await saveRefreshToken(user.id, newRefreshToken)

  return { accessToken: newAccessToken, refreshToken: newRefreshToken }
}

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

export async function rotateRefreshToken(oldToken) {
  const record = await prisma.refreshToken.findUnique({ where: { token: oldToken } })
  if (!record || record.expiresAt < new Date()) return null

  const payload = verifyRefreshToken(oldToken)
  const newAccessToken = signAccessToken({ userId: payload.userId, role: payload.role })
  const newRefreshToken = signRefreshToken({ userId: payload.userId, role: payload.role })

  await prisma.refreshToken.deleteMany({ where: { token: oldToken } })
  await saveRefreshToken(record.userId, newRefreshToken)

  return { accessToken: newAccessToken, refreshToken: newRefreshToken }
}

import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { randomInt } from 'crypto'
import prisma from '../config/db.js'
import { signAccessToken, signRefreshToken, saveRefreshToken } from '../services/token.js'

export const TEST_PASSWORD = 'TestPass123!'

// Random per-file id. Vitest isolates module state per test file, so a time-based
// id would collide when two files load in the same millisecond (identical phones →
// unique-constraint errors). A random id also avoids clashing with leftover rows
// from an earlier interrupted run.
const RUN_ID = randomInt(100000, 999999)
let seq = 0

export function testEmail(label) {
  return `test_${RUN_ID}_${++seq}_${label}@test.invalid`
}

export function testPhone() {
  return `+254${RUN_ID}${++seq}`
}

// Create a user directly in the DB (cost-1 hash so tests run fast)
export async function createTestUser({ email, phone, role = 'MEMBER', firstName = 'Test', lastName = 'User' } = {}) {
  const hash = await bcrypt.hash(TEST_PASSWORD, 1)
  return prisma.user.create({
    data: {
      email: email ?? testEmail(role.toLowerCase()),
      phone: phone ?? testPhone(),
      passwordHash: hash,
      role,
      isActive: true,
      otpVerifiedAt: new Date(),
      profile: {
        create: { firstName, lastName, membershipStatus: 'ACTIVE' },
      },
    },
    include: { profile: true },
  })
}

// Issue a real JWT for a user (bypasses the login endpoint for speed)
export async function tokenFor(user) {
  const payload = { userId: user.id, role: user.role, permissions: user.permissions ?? {} }
  const accessToken = signAccessToken(payload)
  const refreshToken = signRefreshToken(payload)
  await saveRefreshToken(user.id, refreshToken)
  return { accessToken, refreshToken }
}

// Read the latest valid OTP from the DB (avoids needing the email)
export async function getLatestOtp(userId, purpose = 'REGISTRATION') {
  const otp = await prisma.otpCode.findFirst({
    where: { userId, purpose, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
  })
  return otp?.code ?? null
}

// Delete test users and all their related rows
export async function cleanup(...emails) {
  for (const email of emails.flat()) {
    const user = await prisma.user.findUnique({ where: { email }, include: { profile: true } })
    if (!user) continue
    if (user.profile) {
      await prisma.memberMinistry.deleteMany({ where: { profileId: user.profile.id } })
      await prisma.profileUpdateRequest.deleteMany({ where: { requestedById: user.id } })
      await prisma.memberProfile.delete({ where: { id: user.profile.id } })
    }
    await prisma.otpCode.deleteMany({ where: { userId: user.id } })
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } })
    await prisma.inviteLink.deleteMany({ where: { createdById: user.id } })
    await prisma.user.delete({ where: { id: user.id } })
  }
}

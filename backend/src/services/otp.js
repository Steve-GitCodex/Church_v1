import prisma from '../config/db.js'

const OTP_TTL_MINUTES = 10

export function generateOtpCode() {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function createOtp(userId, purpose) {
  // Invalidate any existing unused OTPs for same user + purpose
  await prisma.otpCode.updateMany({
    where: { userId, purpose, usedAt: null },
    data: { usedAt: new Date() },
  })

  const code = generateOtpCode()
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000)

  await prisma.otpCode.create({ data: { userId, code, purpose, expiresAt } })
  return code
}

const RESEND_COOLDOWN_SECONDS = 60

// Returns { allowed: bool, secondsRemaining: number }
export async function checkResendCooldown(userId, purpose) {
  const latest = await prisma.otpCode.findFirst({
    where: { userId, purpose },
    orderBy: { createdAt: 'desc' },
  })
  if (!latest) return { allowed: true, secondsRemaining: 0 }

  const elapsed = (Date.now() - new Date(latest.createdAt).getTime()) / 1000
  if (elapsed < RESEND_COOLDOWN_SECONDS) {
    return { allowed: false, secondsRemaining: Math.ceil(RESEND_COOLDOWN_SECONDS - elapsed) }
  }
  return { allowed: true, secondsRemaining: 0 }
}

export async function verifyOtp(userId, code, purpose) {
  const otp = await prisma.otpCode.findFirst({
    where: {
      userId,
      code,
      purpose,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  })

  if (!otp) return false

  await prisma.otpCode.update({ where: { id: otp.id }, data: { usedAt: new Date() } })
  return true
}

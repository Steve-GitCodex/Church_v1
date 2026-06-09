import 'dotenv/config'

export const env = {
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5500',

  jwt: {
    secret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  resend: {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM || 'AIC Ruiru <noreply@aicruiru.co.ke>',
  },

  // Rate limiting — override any value via .env. Enforced in production only.
  rateLimit: {
    enabled:  (process.env.NODE_ENV || 'development') === 'production',
    windowMs: (Number(process.env.RATE_LIMIT_WINDOW_MIN) || 15) * 60 * 1000,
    maxApi:   Number(process.env.RATE_LIMIT_MAX_API)  || 300,
    maxAuth:  Number(process.env.RATE_LIMIT_MAX_AUTH) || 50,
  },

  devSecret: process.env.DEV_SECRET,
}

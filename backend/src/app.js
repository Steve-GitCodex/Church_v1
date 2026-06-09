import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

import { env } from './config/env.js'
import authRouter from './routes/auth.js'
import membersRouter from './routes/members.js'
import householdsRouter from './routes/households.js'
import ministriesRouter from './routes/ministries.js'
import contentRouter from './routes/content.js'
import givingsRouter from './routes/givings.js'
import notificationsRouter from './routes/notifications.js'
import siteRouter from './routes/site.js'

const app = express()

// CSP disabled: frontend uses inline onclick handlers (tighten before production)
app.use(helmet({ contentSecurityPolicy: false }))
const corsOrigin = env.nodeEnv === 'development'
  ? true  // allow all origins in dev
  : env.frontendUrl

app.use(cors({ origin: corsOrigin, credentials: true }))
app.use(express.json())

// Rate limiting: API only (never static assets). Tunable via env.rateLimit (see config/env.js).
const limiter = rateLimit({
  windowMs: env.rateLimit.windowMs,
  max: env.rateLimit.maxApi,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !env.rateLimit.enabled,
})
app.use('/api', limiter)

// Routes
app.use('/api/auth', authRouter)
app.use('/api/members', membersRouter)
app.use('/api/households', householdsRouter)
app.use('/api/ministries', ministriesRouter)
app.use('/api/content', contentRouter)
app.use('/api/givings', givingsRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/site', siteRouter)

// Health check
app.get('/api/health', (_req, res) => res.json({ status: 'ok', church: 'AIC Ruiru' }))

// Serve uploaded images
app.use('/uploads', express.static(join(__dirname, '../uploads')))

// Serve frontend — must come after API routes
app.use(express.static(join(__dirname, '../../frontend')))

// Unknown routes: JSON 404 for API paths, styled 404 page for everything else.
app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' })
  res.status(404).sendFile(join(__dirname, '../../frontend/404.html'))
})

// Global error handler
app.use((err, _req, res, _next) => {
  console.error(err)
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
})

export default app

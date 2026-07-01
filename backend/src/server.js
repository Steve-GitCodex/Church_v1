import app from './app.js'
import { env } from './config/env.js'
import { scheduleSecurityReviewReminder } from './services/securityReviewReminder.js'

app.listen(env.port, () => {
  console.log(`AIC Ruiru API running on port ${env.port} [${env.nodeEnv}]`)
})

scheduleSecurityReviewReminder()

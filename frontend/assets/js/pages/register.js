import { api } from '../api.js'
import { requireGuest } from '../auth.js'
import { toggleTheme, currentTheme } from '../theme.js'

requireGuest()

const fab = document.getElementById('theme-fab')
const syncFab = () => { fab.textContent = currentTheme() === 'dark' ? '🌙' : '☀️' }
syncFab()
fab.addEventListener('click', () => { toggleTheme(); syncFab() })

let userId            = null
let inviteToken       = null
let countdownInterval = null

const alertEl     = document.getElementById('alert')
const emailInput  = document.getElementById('email')
const inviteBanner = document.getElementById('invite-banner')

function showAlert(msg, type = 'danger') {
  alertEl.className = `alert alert-${type}`
  alertEl.textContent = msg
}

function goToStep(n) {
  document.querySelectorAll('.step').forEach((el, i) => el.classList.toggle('active', i + 1 === n))
  document.querySelectorAll('.step-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i + 1 === n)
    dot.classList.toggle('done', i + 1 < n)
  })
  alertEl.className = 'hidden'
}

// ── Invite flow: ?invite=TOKEN ────────────────────────────────
const params = new URLSearchParams(window.location.search)
const rawInviteToken = params.get('invite')

if (rawInviteToken) {
  ;(async () => {
    try {
      const inv = await api.get(`/auth/invites/${rawInviteToken}`)
      inviteToken = rawInviteToken
      if (inv.type === 'INDIVIDUAL' && inv.targetEmail) {
        emailInput.value    = inv.targetEmail
        emailInput.readOnly = true
        emailInput.style.background = 'var(--color-bg)'
      }
      inviteBanner.classList.remove('hidden')
    } catch {
      showAlert('This invite link is invalid or has expired.', 'danger')
      document.getElementById('register-btn').disabled = true
    }
  })()
}

// ── Resume flow: ?userId=xxx&identifier=yyy ───────────────────
if (params.get('userId')) {
  userId = params.get('userId')
  const email = params.get('identifier') || ''
  document.getElementById('otp-dest').textContent = email
  showAlert('Welcome back! Please verify your account to complete registration.', 'info')
  goToStep(2)
}

// ── Step 1 ────────────────────────────────────────────────────
document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = document.getElementById('register-btn')
  btn.disabled = true; btn.textContent = 'Submitting…'

  try {
    const body = {
      firstName: document.getElementById('firstName').value.trim(),
      lastName:  document.getElementById('lastName').value.trim(),
      email:     emailInput.value.trim(),
      phone:     document.getElementById('phone').value.trim(),
      password:  document.getElementById('password').value,
    }
    if (inviteToken) body.inviteToken = inviteToken

    const data = await api.post('/auth/register', body)
    userId = data.userId
    document.getElementById('otp-dest').textContent = body.email
    goToStep(2)
    startCountdown()
  } catch (err) {
    showAlert(err.message || 'Registration failed')
  } finally {
    btn.disabled = false; btn.textContent = 'Continue'
  }
})

// ── Step 2: verify OTP ────────────────────────────────────────
document.getElementById('otp-form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const btn = document.getElementById('otp-btn')
  btn.disabled = true; btn.textContent = 'Verifying…'
  alertEl.className = 'hidden'

  try {
    const res = await api.post('/auth/verify-otp', {
      userId,
      code: document.getElementById('otp').value.trim(),
    })
    clearInterval(countdownInterval)
    if (res.autoApproved) {
      document.getElementById('step-3-message').textContent =
        'Your account has been verified and approved. You can log in now.'
      document.getElementById('step-3-icon').textContent = '🎉'
    }
    goToStep(3)
  } catch (err) {
    showAlert(err.message || 'Verification failed')
  } finally {
    btn.disabled = false; btn.textContent = 'Verify'
  }
})

// ── Resend + countdown ────────────────────────────────────────
function startCountdown(seconds = 60) {
  clearInterval(countdownInterval)
  let remaining = seconds
  const waitEl  = document.getElementById('resend-waiting')
  const readyEl = document.getElementById('resend-ready')
  const display = document.getElementById('countdown')

  waitEl.classList.remove('hidden')
  readyEl.classList.add('hidden')
  display.textContent = remaining

  countdownInterval = setInterval(() => {
    remaining--
    display.textContent = remaining
    if (remaining <= 0) {
      clearInterval(countdownInterval)
      waitEl.classList.add('hidden')
      readyEl.classList.remove('hidden')
    }
  }, 1000)
}

document.getElementById('resend-btn').addEventListener('click', async () => {
  const btn = document.getElementById('resend-btn')
  btn.disabled = true
  alertEl.className = 'hidden'

  try {
    await api.post('/auth/resend-otp', { userId })
    document.getElementById('otp').value = ''
    startCountdown()
    showAlert('A new code has been sent.', 'info')
  } catch (err) {
    if (err.data?.secondsRemaining) startCountdown(err.data.secondsRemaining)
    showAlert(err.message || 'Could not resend code')
  } finally {
    btn.disabled = false
  }
})

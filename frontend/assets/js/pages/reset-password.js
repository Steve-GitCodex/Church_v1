import { api } from '../api.js'
import { requireGuest } from '../auth.js'
import { toggleTheme, currentTheme } from '../theme.js'

requireGuest()

const fab = document.getElementById('theme-fab')
const syncFab = () => { fab.textContent = currentTheme() === 'dark' ? '🌙' : '☀️' }
syncFab()
fab.addEventListener('click', () => { toggleTheme(); syncFab() })

const alertEl       = document.getElementById('alert')
const form          = document.getElementById('reset-form')
const codeEl        = document.getElementById('code')
const newPassEl     = document.getElementById('new-password')
const confirmPassEl = document.getElementById('confirm-password')
const submitBtn     = document.getElementById('submit-btn')

// userId comes from forgot-password flow; stored in sessionStorage for security
// (not URL param to avoid it being logged in server access logs)
const userId = sessionStorage.getItem('resetUserId') || new URLSearchParams(location.search).get('userId')

function showAlert(msg, type = 'danger') {
  alertEl.className = `alert alert-${type}`
  alertEl.textContent = msg
}

if (!userId) {
  showAlert('No reset session found. Please request a new reset code.')
  form.querySelector('button').disabled = true
}

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  alertEl.className = 'hidden'

  if (newPassEl.value !== confirmPassEl.value) {
    return showAlert('Passwords do not match.')
  }

  submitBtn.disabled = true
  submitBtn.textContent = 'Resetting…'

  try {
    await api.post('/auth/reset-password', {
      userId,
      code: codeEl.value.trim(),
      newPassword: newPassEl.value,
    })
    sessionStorage.removeItem('resetUserId')
    window.location.href = 'login.html?reset=1'
  } catch (err) {
    showAlert(err.message || 'Invalid or expired code. Please try again.')
    submitBtn.disabled = false
    submitBtn.textContent = 'Reset Password'
  }
})

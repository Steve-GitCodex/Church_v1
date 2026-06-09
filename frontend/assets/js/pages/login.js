import { api } from '../api.js'
import { toggleTheme, currentTheme } from '../theme.js'
const fab = document.getElementById('theme-fab')
const syncFab = () => { fab.textContent = currentTheme() === 'dark' ? '🌙' : '☀️' }
syncFab()
fab.addEventListener('click', () => { toggleTheme(); syncFab() })

const form      = document.getElementById('login-form')
const alertEl   = document.getElementById('alert')
const submitBtn = document.getElementById('submit-btn')

if (new URLSearchParams(location.search).get('reset') === '1') {
  alertEl.className = 'alert alert-success mt-md'
  alertEl.textContent = 'Password reset successfully. You can now log in with your new password.'
}

function showAlert(message, type = 'danger') {
  alertEl.className = `alert alert-${type} mt-md`
  alertEl.textContent = message
}

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  alertEl.className = 'hidden'
  submitBtn.disabled = true
  submitBtn.textContent = 'Logging in…'

  try {
    const data = await api.post('/auth/login', {
      identifier: form.identifier.value.trim(),
      password:   form.password.value,
    })

    if (data.requiresVerification) {
      window.location.href = `register.html?userId=${data.userId}&identifier=${encodeURIComponent(form.identifier.value.trim())}`
      return
    }

    api.saveTokens(data.accessToken, data.refreshToken)
    window.location.href = '/pages/dashboard.html'
  } catch (err) {
    if (err.data?.requiresVerification) {
      window.location.href = `register.html?userId=${err.data.userId}&identifier=${encodeURIComponent(form.identifier.value.trim())}`
      return
    }
    showAlert(err.message || 'Login failed')
  } finally {
    submitBtn.disabled = false
    submitBtn.textContent = 'Log In'
  }
})

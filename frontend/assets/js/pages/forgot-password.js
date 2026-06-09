import { api } from '../api.js'
import { toggleTheme, currentTheme } from '../theme.js'
const fab = document.getElementById('theme-fab')
const syncFab = () => { fab.textContent = currentTheme() === 'dark' ? '🌙' : '☀️' }
syncFab()
fab.addEventListener('click', () => { toggleTheme(); syncFab() })

const alertEl   = document.getElementById('alert')
const formView  = document.getElementById('form-view')
const successView = document.getElementById('success-view')
const form      = document.getElementById('forgot-form')
const emailEl   = document.getElementById('email')
const submitBtn = document.getElementById('submit-btn')

function showAlert(msg, type = 'danger') {
  alertEl.className = `alert alert-${type}`
  alertEl.textContent = msg
}

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  submitBtn.disabled = true
  submitBtn.textContent = 'Sending…'
  alertEl.className = 'hidden'

  try {
    const res = await api.post('/auth/forgot-password', { email: emailEl.value.trim() })
    if (res.userId) sessionStorage.setItem('resetUserId', res.userId)
    formView.classList.add('hidden')
    successView.classList.remove('hidden')
  } catch (err) {
    showAlert(err.message || 'Something went wrong. Please try again.')
    submitBtn.disabled = false
    submitBtn.textContent = 'Send Reset Code'
  }
})

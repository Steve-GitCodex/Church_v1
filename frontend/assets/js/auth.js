import { api } from './api.js'

// Decode JWT payload without verifying (verification is server-side)
export function decodeToken(token) {
  try {
    const payload = token.split('.')[1]
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

export function getCurrentUser() {
  const token = api.getAccessToken()
  if (!token) return null
  return decodeToken(token)
}

// Redirect already-logged-in users away from guest-only pages (login, register, password reset)
export function requireGuest() {
  const user = getCurrentUser()
  if (user) { window.location.href = '/pages/dashboard.html'; return user }
  return null
}

// Redirect to login if not authenticated
export function requireAuth() {
  const user = getCurrentUser()
  if (!user) { window.location.href = '/pages/login.html'; return null }
  return user
}

// Redirect to login if role is insufficient
export function requireRole(minRole) {
  const hierarchy = { PENDING: 0, MEMBER: 1, STAFF: 2, ADMIN: 3, SUPER_ADMIN: 4, LEGEND: 5 }
  const user = requireAuth()
  if (!user) return null
  if ((hierarchy[user.role] ?? -1) < (hierarchy[minRole] ?? 999)) {
    window.location.href = '/pages/dashboard.html'
    return null
  }
  return user
}

export function isAtLeast(role) {
  const hierarchy = { PENDING: 0, MEMBER: 1, STAFF: 2, ADMIN: 3, SUPER_ADMIN: 4, LEGEND: 5 }
  const user = getCurrentUser()
  if (!user) return false
  return (hierarchy[user.role] ?? -1) >= (hierarchy[role] ?? 999)
}

export function hasPermission(name) {
  const user = getCurrentUser()
  if (!user) return false
  if (isAtLeast('ADMIN')) return true   // admin+ bypass
  return user.permissions?.[name] === true
}

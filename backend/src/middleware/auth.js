import { verifyAccessToken } from '../services/token.js'

const ROLE_HIERARCHY = {
  PENDING: 0,
  MEMBER: 1,
  STAFF: 2,
  ADMIN: 3,
  SUPER_ADMIN: 4,
  LEGEND: 5,
}

export function authenticate(req, res, next) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  try {
    const payload = verifyAccessToken(header.slice(7))
    req.user = payload
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// requireRole('ADMIN', 'SUPER_ADMIN') — user must have one of the listed roles
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' })
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }
    next()
  }
}

// requireMinRole('STAFF') — user must be at or above the given role in the hierarchy
export function requireMinRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' })
    const userLevel = ROLE_HIERARCHY[req.user.role] ?? -1
    const minLevel = ROLE_HIERARCHY[minRole] ?? 999
    if (userLevel < minLevel) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }
    next()
  }
}

// requirePermission('manageGivings') — for granular STAFF permissions
export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' })

    // ADMIN and above bypass granular permission checks
    if (ROLE_HIERARCHY[req.user.role] >= ROLE_HIERARCHY['ADMIN']) return next()

    const perms = req.user.permissions || {}
    if (!perms[permission]) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }
    next()
  }
}

// requireContentPermission — passes for ADMIN+ or Staff with manageContent or manageEvents.
// Write operations that are EVENT-type-restricted are enforced in the controller.
export function requireContentPermission(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' })
  if (ROLE_HIERARCHY[req.user.role] >= ROLE_HIERARCHY['ADMIN']) return next()
  const perms = req.user.permissions || {}
  if (perms.manageContent || perms.manageEvents) return next()
  return res.status(403).json({ error: 'Insufficient permissions' })
}

const BASE_URL = '/api'

function getAccessToken() {
  return localStorage.getItem('accessToken')
}

function saveTokens(accessToken, refreshToken) {
  localStorage.setItem('accessToken', accessToken)
  if (refreshToken) localStorage.setItem('refreshToken', refreshToken)
}

function clearTokens() {
  localStorage.removeItem('accessToken')
  localStorage.removeItem('refreshToken')
}

// ── Session cache ─────────────────────────────────────────────────────────────
// TTLs keyed by path prefix (longest match wins)
const CACHE_TTLS = [
  ['/members/slim',            5 * 60_000],
  ['/members/pending',         30_000],
  ['/members/update-requests', 30_000],
  ['/members',                 2 * 60_000],
  ['/households',              5 * 60_000],
  ['/ministries',              5 * 60_000],
]

// Which sessionStorage key prefixes to clear when a write succeeds
const INVALIDATE_ON_WRITE = [
  ['/households',   ['/households']],
  ['/ministries',   ['/ministries']],
  ['/members',      ['/members']],
  ['/auth/approve', ['/members/pending', '/members']],
  ['/auth/reject',  ['/members/pending']],
]

function getTtl(path) {
  for (const [prefix, ttl] of CACHE_TTLS) {
    if (path.startsWith(prefix)) return ttl
  }
  return 0
}

function readCache(path) {
  try {
    const raw = sessionStorage.getItem('api:' + path)
    if (!raw) return null
    const { data, ts, ttl } = JSON.parse(raw)
    if (Date.now() - ts > ttl) { sessionStorage.removeItem('api:' + path); return null }
    return data
  } catch {
    return null
  }
}

function writeCache(path, data, ttl) {
  if (!ttl) return
  try {
    sessionStorage.setItem('api:' + path, JSON.stringify({ data, ts: Date.now(), ttl }))
  } catch {
    // sessionStorage quota exceeded — silently skip caching
  }
}

function invalidateCache(writePath) {
  for (const [prefix, keysToKill] of INVALIDATE_ON_WRITE) {
    if (writePath.startsWith(prefix)) {
      for (const k of Object.keys(sessionStorage)) {
        if (keysToKill.some(p => k.startsWith('api:' + p))) {
          sessionStorage.removeItem(k)
        }
      }
    }
  }
}

// ── Token refresh ─────────────────────────────────────────────────────────────
let _refreshPromise = null

async function refreshAccessToken() {
  if (_refreshPromise) return _refreshPromise

  _refreshPromise = (async () => {
    const refreshToken = localStorage.getItem('refreshToken')
    if (!refreshToken) return false

    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      })

      if (!res.ok) {
        if (res.status === 401) clearTokens()
        return false
      }

      const data = await res.json()
      saveTokens(data.accessToken, data.refreshToken)
      return true
    } catch {
      return false
    }
  })()

  try {
    return await _refreshPromise
  } finally {
    _refreshPromise = null
  }
}

// ── Core request ──────────────────────────────────────────────────────────────
async function request(method, path, body = null, retry = true) {
  // GET: serve from sessionStorage cache if available
  if (method === 'GET') {
    const cached = readCache(path)
    if (cached !== null) return cached
  }

  const headers = { 'Content-Type': 'application/json' }
  const token = getAccessToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  })

  if (res.status === 401 && retry) {
    const refreshed = await refreshAccessToken()
    if (refreshed) return request(method, path, body, false)
    if (!getAccessToken()) window.location.href = '/pages/login.html'
    return
  }

  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data })

  // GET: populate cache
  if (method === 'GET') {
    const ttl = getTtl(path)
    writeCache(path, data, ttl)
  }

  // Writes: invalidate related cache keys
  if (method !== 'GET') {
    invalidateCache(path)
  }

  return data
}

// ── Authenticated file download ───────────────────────────────────────────────
// Fetches a binary response with the bearer token and triggers a browser
// download. Used for endpoints (e.g. PDF receipts) that can't go through the
// JSON request() path or a plain link (which wouldn't carry the auth header).
async function download(path, filename, retry = true) {
  const headers = {}
  const token = getAccessToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE_URL}${path}`, { headers })

  if (res.status === 401 && retry) {
    const refreshed = await refreshAccessToken()
    if (refreshed) return download(path, filename, false)
    if (!getAccessToken()) window.location.href = '/pages/login.html'
    return
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw Object.assign(new Error(data.error || 'Download failed'), { status: res.status, data })
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export const api = {
  get:    (path)        => request('GET',    path),
  download,
  post:   (path, body)  => request('POST',   path, body),
  put:    (path, body)  => request('PUT',    path, body),
  patch:  (path, body)  => request('PATCH',  path, body),
  delete: (path)        => request('DELETE', path),
  saveTokens,
  clearTokens,
  getAccessToken,
}

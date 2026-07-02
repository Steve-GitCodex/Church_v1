// Bump this on any static asset change to invalidate old caches on the next visit.
const CACHE_VERSION = 'aicr-v5'
const STATIC_CACHE  = `${CACHE_VERSION}-static`

// Core app shell — cached on install so the site opens offline after first visit.
// Anything else (per-page JS, images) is picked up opportunistically by the fetch handler below.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/404.html',
  '/pages/login.html',
  '/pages/dashboard.html',
  '/assets/css/variables.css',
  '/assets/css/base.css',
  '/assets/css/dashboard.css',
  '/assets/css/home.css',
  '/assets/js/api.js',
  '/assets/js/auth.js',
  '/assets/js/theme.js',
  '/assets/js/ui.js',
  '/manifest.json',
  '/assets/icons/favicon-32.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('aicr-') && key !== STATIC_CACHE).map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET') return
  // Never cache API calls — member/giving data must always be fresh, and caching auth-sensitive
  // responses risks leaking data across accounts on a shared device. (A future "offline shell with
  // last-seen data" mode would add a *separate* cache here with an explicit network-first-then-cache
  // strategy for a small allowlist of read-only GET endpoints — not a blanket cache of /api/.)
  if (url.pathname.startsWith('/api/')) return
  // Cross-origin requests (Google Fonts, etc.) — let the browser's own HTTP cache handle these.
  if (url.origin !== self.location.origin) return

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      }).catch(() => cached)
      return cached || network
    }),
  )
})

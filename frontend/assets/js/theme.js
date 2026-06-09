export function applyTheme() {
  const saved = localStorage.getItem('theme') || 'light'
  _setAttr(saved)
  return saved
}

export function toggleTheme(originPoint) {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'
  localStorage.setItem('theme', next)

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (document.startViewTransition && !reduced) {
    // Default origin to screen center if caller didn't provide coordinates
    const x = originPoint?.x ?? window.innerWidth  / 2
    const y = originPoint?.y ?? window.innerHeight / 2
    const maxRadius = Math.hypot(
      Math.max(x, window.innerWidth  - x),
      Math.max(y, window.innerHeight - y)
    )
    const vt = document.startViewTransition(() => _setAttr(next))
    vt.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${maxRadius}px at ${x}px ${y}px)`] },
        { duration: 600, easing: 'ease-out', pseudoElement: '::view-transition-new(root)' }
      )
    })
  } else {
    _setAttr(next)
  }
  return next
}

export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'light'
}

function _setAttr(theme) {
  document.documentElement.setAttribute('data-theme', theme)
}

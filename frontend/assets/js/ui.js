// ── Toast notifications ───────────────────────────────────────

let _toastContainer = null

function getToastContainer() {
  if (!_toastContainer) {
    _toastContainer = document.createElement('div')
    _toastContainer.className = 'toast-container'
    document.body.appendChild(_toastContainer)
  }
  return _toastContainer
}

export function toast(message, type = 'info', { duration = 4000 } = {}) {
  const container = getToastContainer()
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.textContent = message

  function dismiss() {
    clearTimeout(el._timer)
    el.classList.remove('toast-show')
    el.classList.add('toast-hide')
    el.addEventListener('transitionend', () => el.remove(), { once: true })
  }

  el.addEventListener('click', dismiss)
  container.appendChild(el)

  // Double rAF ensures the element is in the DOM before the transition fires
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('toast-show')))
  el._timer = setTimeout(dismiss, duration)
}

// ── Confirm dialog ────────────────────────────────────────────

let _confirmOverlay = null

function getConfirmOverlay() {
  if (_confirmOverlay) return _confirmOverlay

  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `
    <div class="modal-box" style="max-width:380px;">
      <h3 id="_confirm-title"></h3>
      <p id="_confirm-message" style="color:var(--color-text-muted);font-size:var(--font-size-sm);margin-bottom:var(--space-lg);line-height:1.5;"></p>
      <div class="modal-footer">
        <button class="btn btn-outline btn-sm" id="_confirm-cancel"></button>
        <button class="btn btn-sm" id="_confirm-ok"></button>
      </div>
    </div>`
  document.body.appendChild(overlay)
  _confirmOverlay = overlay
  return overlay
}

export function confirmDialog({
  title       = 'Are you sure?',
  message     = '',
  confirmText = 'Confirm',
  cancelText  = 'Cancel',
  danger      = false,
} = {}) {
  return new Promise((resolve) => {
    const overlay   = getConfirmOverlay()
    const titleEl   = overlay.querySelector('#_confirm-title')
    const msgEl     = overlay.querySelector('#_confirm-message')
    const okBtn     = overlay.querySelector('#_confirm-ok')
    const cancelBtn = overlay.querySelector('#_confirm-cancel')

    titleEl.textContent   = title
    msgEl.textContent     = message
    okBtn.textContent     = confirmText
    cancelBtn.textContent = cancelText
    okBtn.className       = `btn btn-sm ${danger ? 'btn-danger' : 'btn-primary'}`

    overlay.classList.add('open')
    cancelBtn.focus()

    function cleanup(result) {
      overlay.classList.remove('open')
      document.removeEventListener('keydown', onKeydown)
      overlay.removeEventListener('click', onOverlay)
      okBtn.removeEventListener('click', onOk)
      cancelBtn.removeEventListener('click', onCancel)
      resolve(result)
    }

    const onOk      = () => cleanup(true)
    const onCancel  = () => cleanup(false)
    const onOverlay = (e) => { if (e.target === overlay) cleanup(false) }
    const onKeydown = (e) => { if (e.key === 'Escape') cleanup(false) }

    okBtn.addEventListener('click', onOk)
    cancelBtn.addEventListener('click', onCancel)
    overlay.addEventListener('click', onOverlay)
    document.addEventListener('keydown', onKeydown)
  })
}

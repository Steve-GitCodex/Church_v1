import sanitizeHtml from 'sanitize-html'

const SANITIZE_OPTS = {
  allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'blockquote'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
}

export function sanitize(html) {
  return sanitizeHtml(html || '', SANITIZE_OPTS)
}

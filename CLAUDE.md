# AIC Ruiru — Project Guidelines for AI Assistants

## Project Overview

Church management web app for AIC Ruiru (single campus, Ruiru, Kenya). Serves as both the public website and internal member management system.

**Stack:** Node.js + Express · Prisma + PostgreSQL (local) · Vanilla JS/HTML/CSS (no framework)
**Monorepo:** `backend/` and `frontend/` under the project root.

---

## Workflow: Plan → Develop → Test → Repeat

Before writing any code for a non-trivial change:
1. **Plan** — State what will change and why. If touching multiple files, list them.
2. **Develop** — Make the minimum change required. No scope creep.
3. **Test** — Verify the change works (see Testing section below).

For bug fixes, state the root cause before writing the fix.
For new features, confirm which phase it belongs to before starting (see PHASES.md).

---

## Frontend Conventions

### File Structure
```
frontend/
  assets/
    css/
      variables.css        ← design tokens only (colours, spacing, typography)
      base.css             ← global reset, layout, component classes (.btn, .card, .alert, .error-*)
      auth.css             ← login + register + forgot-password + reset-password styles
      dashboard.css        ← dashboard styles (.layout, .sidebar, .utility-panel, .topbar,
                             .stat-card, .page-head, .page-title-lg, .table-card, .quick-action…)
      home.css             ← index.html (public homepage) styles
      content.css          ← public news.html / events.html page styles
      about.css            ← about.html styles (hero, leaders grid, beliefs list, service cards)
    js/
      api.js               ← fetch wrapper, token storage
      auth.js              ← JWT decode, requireAuth, isAtLeast, hasPermission
      theme.js             ← toggleTheme (View Transitions circular reveal), currentTheme (shared across pages)
      ui.js                ← toast(message, type), confirmDialog({…}) — use these, never native alert/confirm
      defaultCover.js      ← defaultCover(item) → SVG data-URI for content with no imageUrl
      pages/
        register.js        ← register page logic
        login.js           ← login page logic
        forgot-password.js ← forgot password page logic
        reset-password.js  ← reset password page logic
        dashboard.js       ← dashboard page logic (news, events, content admin, badge polling, about editor)
        news.js            ← public news & announcements feed page logic
        events.js          ← public events feed page logic (RSVP for authenticated users)
        about.js           ← public about page logic (fetches /api/site/about, renders all sections)
  pages/
    login.html
    register.html
    forgot-password.html
    reset-password.html
    dashboard.html
    news.html              ← public news & announcements feed
    events.html            ← public events feed
    about.html             ← public About page (CMS-fed)
  index.html
  404.html                 ← styled 404 page; uses absolute asset path /assets/css/base.css
```

**Dashboard layout:** `.layout` has three children — `.sidebar` (left nav rail), `.main`
(page content area), and `.utility-panel` (right rail with identity, theme, website, settings).
The utility panel collapses to a 60 px icon rail; state persisted to `localStorage['aicr_utility_collapsed']`.

### HTML Rules
- **No inline `<style>` blocks.** All CSS goes in `assets/css/`.
- **No inline `<script>` blocks.** All JS goes in `assets/js/pages/<page>.js` loaded as `<script type="module" src="...">`.
- **No inline `style=""` attributes** for anything that isn't truly one-off dynamic (e.g. `display:none` toggled by JS is fine; layout/colour is not).
- One external CSS link per page (base.css + page-specific CSS). Variables are imported by base.css.
- Scripts at end of `<body>`, loaded as ES modules.

### JS Rules
- ES modules only (`import`/`export`). No CommonJS in the frontend.
- No global state except what's explicitly stored in `localStorage`.
- DOM queries at the top of the module, not scattered through functions.
- `window.xxx = fn` only when a function must be callable from an HTML `onclick` attribute (keep these to a minimum).
- Never use `alert()`, `confirm()`, or `prompt()`. Use `toast()` / `confirmDialog()` from `assets/js/ui.js`.

### CSS Rules
- Use CSS custom properties from `variables.css`. No hardcoded colours or spacing values.
- Utility classes from `base.css` first. Add page-specific rules only in the page CSS file.
- No `!important`.

---

## Backend Conventions

### File Structure
```
backend/src/
  config/       ← env.js (all config + env.rateLimit), db.js (singleton PrismaClient)
  controllers/  ← business logic, one file per domain
                   auth.js, members.js, households.js, ministries.js,
                   content.js, givings.js, notifications.js, site.js
  middleware/   ← auth.js (authenticate, requireRole, requireMinRole,
                   requirePermission, requireContentPermission)
  routes/       ← thin routers, import from controllers
                   auth.js, members.js, households.js, ministries.js,
                   content.js, givings.js, notifications.js, site.js
  services/     ← otp.js, email.js, token.js, notifications.js (reusable, no Express req/res)
  __tests__/    ← integration tests (vitest + supertest, real DB)
                   helpers.js, auth.test.js, members.test.js, content.test.js,
                   notifications.test.js, site.test.js
  app.js        ← Express app setup, exports app (used by server.js and tests)
  server.js     ← calls app.listen(); never imported by tests
```

### Rules
- Controllers own req/res. Services know nothing about Express.
- Zod validation at the top of each controller function that accepts user input.
- Never `console.log` secrets or user data.
- One Prisma client instance (`config/db.js`). Never `new PrismaClient()` elsewhere.
- Route files contain no logic — only `router.verb(path, [middleware], controller)`.
- Rate limit config lives in `env.rateLimit` (windowMs, maxApi, maxAuth, enabled). Tunable
  via `RATE_LIMIT_WINDOW_MIN`, `RATE_LIMIT_MAX_API`, `RATE_LIMIT_MAX_AUTH` env vars.
  Enforced in production only (`enabled: NODE_ENV === 'production'`).
- 404 fallback: API paths → JSON `{"error":"Not found"}`; all other paths → `frontend/404.html`
  with HTTP 404 status via `res.status(404).sendFile(...)`.

### Security Conventions

Lessons from a 2026-07-01 security audit — do not reintroduce these patterns:

- **Never build a Prisma `data: { [x]: y }` object from a user-supplied field name.** Always
  whitelist the allowed keys explicitly (e.g. `REQUESTABLE_PROFILE_FIELDS` in `members.js`).
  A dynamic key sourced from `req.body` can target any column on the model, including ones
  that should require a separate admin-only code path (role, status, foreign keys).
- **JWT `role`/`permissions` claims are a point-in-time snapshot.** Any code that re-issues
  tokens (refresh) must re-derive claims from the current DB row, never from the token being
  replaced — otherwise a demoted or deactivated user can keep refreshing with stale claims
  indefinitely. Any admin action that changes a user's role, permissions, or active status
  must call `revokeAllUserRefreshTokens(userId)` (`services/token.js`) so old refresh tokens
  can't outlive the change.
- **Use `crypto.randomInt`, never `Math.random`,** for OTPs, tokens, or anything
  security-sensitive.
- After a `/security-review` confirms a HIGH or MEDIUM finding, run
  `npm run security:notify -- "<title>" "<summary>"` from `backend/` to alert every Super
  Admin in-app and by email (`backend/scripts/notifySecurityAlert.js`).

---

## Testing

- Write test files in `backend/src/__tests__/` with the `.test.js` extension.
- Run tests with `npm test` (not inline terminal commands).
- **Never validate changes by running `node -e "..."` in the terminal.** Create a test file.
- Integration tests hit a real test database, not mocks, because mock/real divergence has caused production failures before.
- Test the happy path and the most likely error paths. Do not test every edge case by default.

---

## RBAC Quick Reference

| Role | Level | Notes |
|---|---|---|
| PENDING | 0 | OTP not yet verified — invisible to admin list |
| PENDING (verified) | 0 | OTP done, awaiting admin approval |
| MEMBER | 1 | Self-service profile, read-only givings |
| STAFF | 2 | Granular JSON permissions per account |
| ADMIN | 3 | Approve members, promote to Staff, manage content |
| SUPER_ADMIN | 4 | Full access, can promote to Admin/Super Admin |
| LEGEND | 5 | Developer backdoor — DB only, never via UI |

`requireMinRole('ADMIN')` uses the hierarchy. `requireRole('ADMIN', 'SUPER_ADMIN')` requires exact match.
ADMIN+ bypasses granular Staff permission checks automatically.

`requireContentPermission` — used on all content management routes. Passes for ADMIN+ or Staff with
`manageContent` (full access) or `manageEvents` (EVENT-type items only; enforced per-operation in the
controller via `canManageItemType(user, itemType)` after fetching the item).

**Known issue:** The rich-text link button in the Content admin modal uses `prompt()`, which violates the
no-native-dialog rule. It pre-dates the ui.js conventions; replace with a small inline URL input before
production.

---

## Code Quality Rules (from project-wide AI guidelines)

- **Read before editing.** Never propose changes to a file that hasn't been examined with the Read tool first.
- **No over-engineering.** Implement exactly what is requested. No helper abstractions for one-time operations.
- **No unnecessary files.** No example files, template files, or speculative future-use files.
- **No auto-generated comments.** Only comment when the WHY is non-obvious.
- **Security at boundaries only.** Validate at user input / external API boundaries. Trust internal code.
- **Match existing patterns.** Before solving a problem, check how similar problems are solved in the codebase.
- **Only commit when asked.** Never auto-commit or push without explicit user instruction.

---

## Environment

- Backend dev server: `npm run dev` in `backend/` (nodemon, port 3000)
- Frontend served by the backend at `http://localhost:3000` (same origin — no separate Live Server needed)
- Database: local PostgreSQL (`localhost:5432/aic_ruiru`). After schema changes: `npx prisma db push` then restart server for `prisma generate`.
- Secrets: `backend/.env` — gitignored. See SETUP.md for full reference.

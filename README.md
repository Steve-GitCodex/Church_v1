# AIC Ruiru — Church Management System

A web application for AIC Ruiru (Africa Inland Church, Ruiru, Kenya). It serves as both the public-facing church website and an internal management system for member records, content publishing, event registration, and in-app notifications.

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js (ESM) |
| Web framework | Express 4 |
| ORM | Prisma 5 |
| Database | PostgreSQL |
| Frontend | Vanilla JS (ES modules), HTML, CSS — no framework |
| Auth | JWT access + refresh tokens, bcrypt, email OTP |
| Email | Resend |
| Image uploads | Multer (stored in `backend/uploads/`) |
| Testing | Vitest + Supertest (integration tests, real DB) |

The frontend is served as static files by the same Express process on port 3000. There is no separate build step and no client-side framework.

---

## Prerequisites

- Node.js 18 or later
- PostgreSQL 14 or later (local instance)
- A [Resend](https://resend.com) API key (for OTP and approval emails)

---

## Project structure

```
.
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma       # 17 models
│   │   └── seed.js             # sample content and admin user
│   ├── src/
│   │   ├── config/             # env.js (all env vars), db.js (singleton PrismaClient)
│   │   ├── controllers/        # business logic per domain
│   │   ├── middleware/         # JWT auth, RBAC, content permission
│   │   ├── routes/             # thin routers — no logic
│   │   ├── services/           # OTP, email, token, notifications (no Express deps)
│   │   ├── __tests__/          # integration tests
│   │   ├── app.js              # Express app (exported — used by server and tests)
│   │   └── server.js           # binds port; not imported by tests
│   └── uploads/                # uploaded images (gitignored except .gitkeep)
└── frontend/
    ├── assets/
    │   ├── css/                # variables, base, auth, dashboard, home, content, about
    │   └── js/
    │       ├── api.js          # fetch wrapper + token storage
    │       ├── auth.js         # JWT decode, isAtLeast, hasPermission
    │       ├── theme.js        # dark/light toggle with View Transitions
    │       ├── ui.js           # toast(), confirmDialog() — no native alert/confirm
    │       ├── defaultCover.js # SVG data-URI generator for content with no image
    │       └── pages/          # one module per page
    ├── pages/                  # HTML pages
    └── index.html              # public homepage
```

---

## Setup

### 1. Clone and install

```bash
git clone <repo-url>
cd Church_v1/backend
npm install
```

### 2. Create the database

```sql
CREATE DATABASE aic_ruiru;
```

### 3. Configure environment variables

Create `backend/.env`:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/aic_ruiru"
DIRECT_URL="postgresql://user:password@localhost:5432/aic_ruiru"

JWT_SECRET=<long-random-string>
JWT_REFRESH_SECRET=<different-long-random-string>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d

RESEND_API_KEY=re_...
EMAIL_FROM="AIC Ruiru <noreply@yourdomain.com>"

DEV_SECRET=<secret-used-to-bootstrap-first-super-admin>

NODE_ENV=development
PORT=3000
```

`DIRECT_URL` can be the same as `DATABASE_URL` for local development. It is required by Prisma for connection pooling environments (e.g. PgBouncer in production).

### 4. Push schema and generate Prisma client

```bash
npx prisma db push
```

On Windows, stop any running dev server before running `prisma db push` or `prisma generate` — the Prisma query engine DLL is locked while the server is running.

### 5. (Optional) Seed sample data

```bash
npm run db:seed
```

This creates a set of sample news, announcement, and event items. It does not create users.

### 6. Bootstrap the first Super Admin

With the dev server running:

```bash
curl -X POST http://localhost:3000/api/auth/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"...","devSecret":"<DEV_SECRET>"}'
```

This endpoint is available in development only and creates the first SUPER_ADMIN account directly, bypassing the normal registration and approval flow.

---

## Running the application

```bash
cd backend
npm run dev    # nodemon, port 3000
```

The frontend is served from `http://localhost:3000`. No separate dev server is needed.

---

## API overview

All API routes are under `/api`. The base URL in development is `http://localhost:3000`.

| Prefix | Domain | Auth required |
|---|---|---|
| `/api/auth` | Registration, OTP, login, token refresh, password reset, invite links | Varies |
| `/api/members` | Member registry, profile updates, deactivate/reactivate | MEMBER+ |
| `/api/households` | Household CRUD, member assignment | ADMIN+ |
| `/api/ministries` | Ministry CRUD, member roles | ADMIN+ |
| `/api/content` | News, announcements, events — public read, gated writes | Public / Staff+ |
| `/api/notifications` | In-app notifications | MEMBER+ |
| `/api/site` | Site settings (About page CMS) | Public GET / ADMIN+ PUT |
| `/api/givings` | Giving ledger (Phase 3, stub only) | — |
| `/api/health` | Health check | None |

Uploaded images are served at `/uploads/<filename>`.

---

## RBAC model

| Role | Level | Description |
|---|---|---|
| PENDING | 0 | Registered but OTP not yet verified, or awaiting admin approval |
| MEMBER | 1 | Approved member — self-service profile, read-only givings |
| STAFF | 2 | Granular per-account JSON permissions |
| ADMIN | 3 | Full member management, content publishing, About editor |
| SUPER_ADMIN | 4 | Can promote to Admin/Super Admin |
| LEGEND | 5 | Developer backdoor — DB only, not available via UI |

ADMIN and above bypass all granular Staff permission checks.

### Staff permissions

Staff accounts hold a `permissions` JSON object on the User record. Available flags:

| Permission | Access granted |
|---|---|
| `manageContent` | Full content CRUD (all types: news, announcements, events) |
| `manageEvents` | Content tab (read-all) + create/edit/publish/archive/feature for EVENT type only |
| `manageGivings` | Giving ledger and correction requests (Phase 3) |
| `manageMembers` | Member list, edit, deactivate/reactivate |

---

## Testing

Tests are integration tests that run against a real PostgreSQL database. They do not use mocks for database access because mock/real divergence has caused production failures in the past.

```bash
cd backend
npm test
```

Test files are in `backend/src/__tests__/`. Each file manages its own setup and teardown — test users are created in `beforeAll` and removed in `afterAll` via the `cleanup()` helper. The `site.test.js` file additionally saves and restores any live `site_settings` rows it touches.

Current coverage: 73 tests across 5 files (auth, members, content, notifications, site).

---

## Key development notes

- **After schema changes:** run `npx prisma db push` then restart the dev server. On Windows, stop the server before running either command or `prisma generate` will fail with an EPERM error on the query engine DLL.
- **Rate limiting** is enforced in production only (`NODE_ENV=production`). Limits are tunable via `RATE_LIMIT_WINDOW_MIN`, `RATE_LIMIT_MAX_API`, `RATE_LIMIT_MAX_AUTH` environment variables.
- **Content Security Policy** is disabled in Helmet configuration because the dashboard uses inline `onclick` handlers. This should be addressed before production.
- **Image storage** is local disk (`backend/uploads/`). This is not suitable for multi-instance or serverless deployments without replacing the Multer storage backend.
- **Test database isolation:** tests share the development database. Running tests will create and delete rows in your dev DB. Do not run tests against a production database.

# Bookwise API

> The NestJS backend for Bookwise AI — a multi-tenant appointment platform for service businesses, with an AI voice agent that books over the phone.

![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-7.6-2D3748?logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-336791?logo=postgresql&logoColor=white)
![Node](https://img.shields.io/badge/Node-22.x-339933?logo=node.js&logoColor=white)

---

## About the project

Salons, barbershops, clinics and gyms lose bookings to missed calls. Bookwise gives each business a dashboard, a public booking page, and a voice AI agent that answers, checks real availability, and writes the appointment straight into the database.

This repo is the API behind all of that. It owns the data model, the availability engine, the tenancy and role rules, Stripe billing, transactional email, and the webhook surface that Clerk, Stripe and Vapi call into. The Next.js dashboard and booking page live in a separate repo and talk to this service over HTTP.

**Multi-tenant** means every row is scoped to an `Organisation`, and every authenticated request is resolved to a user *and* their org before a controller ever runs.

---

## Features

**For business owners and admins**
- Organisation profile, working hours, booking policy (buffer, lead time, slots per time)
- Staff invitations with token + expiry, role changes, freeze/unfreeze, removal
- Services catalogue with soft delete (past bookings keep their service)
- Bookings: list with filters and status stats, manual create, status change, reschedule
- Customer records auto-created on booking, unique per email *per org*
- Staff leave requests with an approve/reject flow
- Dashboard overview metrics and a per-org audit log

**For staff**
- Own working hours, own bookings, leave requests, in-app notifications

**For customers (no login)**
- Public org page by slug, live slot availability, self-service booking

**Voice AI (Vapi)**
- Four tools exposed to the agent: `getServices`, `getStaff`, `getAvailableSlots`, `createBooking`
- End-of-call reports persist transcript, duration and call ID onto the booking
- Per-org monthly voice minutes metered against the plan, with a warning email at the cap

**Billing (Stripe)**
- Checkout for Pro/Business, monthly and yearly
- Customer portal session for self-serve plan changes
- Webhook-driven plan tier sync, payment-failure email, suspension on non-payment

**Platform admin**
- Allowlisted super-admin endpoints: org stats, suspend, force plan tier, toggle voice AI — every mutation written to `PlatformAuditLog`

---

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js 22 | Native **ESM** — `"type": "module"` |
| Framework | NestJS 11 | Express platform, `rawBody` enabled for webhooks |
| Language | TypeScript 5.7 | `NodeNext` resolution |
| ORM | Prisma 7.6 | `prisma-client` generator, **PrismaPg driver adapter** |
| Database | PostgreSQL (Neon) | Pooled connection, `btree_gist` extension required |
| Auth | Clerk (`@clerk/backend`) | Token verification only — see [Auth model](#auth-model) |
| Payments | Stripe 22 | Checkout + Billing Portal + webhooks |
| Email | Resend | HTML templates inline in `email.service.ts` |
| Voice AI | Vapi | Webhook tool-calls, shared-secret header |
| Webhook verify | Svix | Clerk signature verification |
| Validation | class-validator / class-transformer | Global `ValidationPipe`, `whitelist: true` |
| Tests | Jest 30 + ts-jest | ESM mode |
| Package manager | pnpm | |

---

## Getting started

### Prerequisites

- Node.js 22.x and pnpm
- A PostgreSQL database (Neon works out of the box)
- Accounts for Clerk, Resend, Stripe (test mode) and Vapi
- The frontend running at `http://localhost:3000` — CORS rejects anything else by default

### Setup

```bash
git clone https://github.com/DManuProj/Bookwise-backend.git
cd Bookwise-backend
pnpm install

# create your .env from the table below, then:
pnpm prisma migrate dev      # applies migrations + generates the client
pnpm run start:dev
```

The API starts on `http://localhost:3001` and every route is served under the `/api/v1` prefix.

```bash
curl http://localhost:3001/api/v1/health
# {"status":"ok","timestamp":"..."}
```

> **First migration on a fresh database:** one migration creates a GiST exclusion constraint and runs `CREATE EXTENSION IF NOT EXISTS btree_gist`. Your database user needs permission to create extensions (Neon allows this).

### Receiving webhooks locally

Clerk, Stripe and Vapi all need to reach your machine. Tunnel it and point each dashboard at the matching path:

```bash
stripe listen --forward-to localhost:3001/api/v1/billing/webhook
# Clerk → https://<tunnel>/api/v1/webhooks/clerk
# Vapi  → https://<tunnel>/api/v1/vapi/webhook
```

Without the Clerk webhook, new sign-ups have no `User` row — see [Bootstrap mode](#bootstrap-mode) for why that still works.

---

## Environment variables

Create a `.env` in the project root. It is gitignored — never commit real values.

| Variable | Required | Where to get it |
|---|---|---|
| `PORT` | no | Defaults to `3001`. Render assigns this automatically. |
| `DATABASE_URL` | **yes** | Neon → project → Connection string (use the **pooled** one, `sslmode=require`) |
| `CLERK_SECRET_KEY` | **yes** | Clerk dashboard → API Keys |
| `CLERK_WEBHOOK_SECRET` | **yes** | Clerk dashboard → Webhooks → your endpoint → Signing Secret (`whsec_…`) |
| `RESEND_API_KEY` | **yes** | Resend dashboard → API Keys |
| `VAPI_PRIVATE_KEY` | for voice | Vapi dashboard → API Keys |
| `VAPI_WEBHOOK_SECRET` | for voice | Any random string; set the same value as the `x-vapi-secret` header on the Vapi server URL |
| `STRIPE_SECRET_KEY` | for billing | Stripe → Developers → API Keys (`sk_test_…` in test mode) |
| `STRIPE_WEBHOOK_SECRET` | for billing | Output of `stripe listen`, or Stripe → Webhooks → endpoint |
| `STRIPE_PRO_PRICE_ID` | for billing | Stripe → Products → Pro → monthly price (`price_…`) |
| `STRIPE_PRO_YEARLY_PRICE_ID` | for billing | Pro → yearly price |
| `STRIPE_BUSINESS_PRICE_ID` | for billing | Business → monthly price |
| `STRIPE_BUSINESS_YEARLY_PRICE_ID` | for billing | Business → yearly price |
| `FRONTEND_URL` | **yes** | Origin of the dashboard. Added to the CORS allowlist and used to build email links. |
| `SUPER_ADMIN_USER_IDS` | for `/admin` | Comma-separated Clerk user IDs (`user_…`). **Empty or unset denies everyone** — the guard fails closed. |
| `NODE_ENV` | no | Set to `production` on deploy |

---

## Project structure

```
prisma/
  schema.prisma            # single source of truth for the data model
  migrations/              # ordered SQL, including the raw GiST constraint
src/
  main.ts                  # bootstrap: CORS, /api/v1 prefix, pipes, filters
  app.module.ts            # every feature module registered here
  auth/                    # Clerk token verification + @CurrentUser()
  common/
    guards/                # OrgGuard, RolesGuard
    filters/               # GlobalExceptionFilter
    constants/             # TIER_LIMITS + checkTierCap()
    decorators/            # @Roles()
    types/                 # AuthenticatedUser, BootstrapUser, RequestUser
  prisma/                  # PrismaService (PrismaPg adapter, lifecycle hooks)
  webhooks/                # Clerk user sync (Svix-verified)
  onboarding/              # creates Organisation + OWNER in one transaction
  organisation/ services/ staff/ invitations/ leave/
  bookings/ customers/ public-booking/   # availability engine + booking writes
  AIBooking/               # vapi.* (webhook + tools), voice.* (public lookup)
  billing/                 # Stripe checkout, portal, webhook
  email/ notifications/ audit/           # side-effect services
  overview/ me/ slug/ health/
  admin/                   # super-admin-only platform endpoints
  generated/prisma/        # Prisma client output — gitignored, do not edit
```

Feature modules follow the same shape throughout: `*.controller.ts` (routing, guards, DTO binding) → `*.service.ts` (business rules, Prisma) → `*.dto.ts` (class-validator).

---

## Architecture & conventions

### Auth model

Clerk is the **identity provider only**. Clerk Organizations is deliberately unused — orgs, roles and membership all live in our own Postgres, because plan tiers, soft deletes, suspension and audit logging need to join against them.

Every protected request passes through up to three guards, in this order:

1. **`ClerkAuthGurad`** — verifies the `Authorization: Bearer <token>` JWT against `CLERK_SECRET_KEY`, looks the user up by `clerkId`, and attaches the row (with its org) to `request.user`.
2. **`OrgGuard`** — rejects users with no `orgId`, and rejects orgs that are soft-deleted.
3. **`RolesGuard`** — enforces `@Roles('OWNER', 'ADMIN')` when the handler declares it. No decorator means any authenticated member of the org.

Controllers read the user through `@CurrentUser()`, never off the raw request.

### Bootstrap mode

A valid token whose `clerkId` has no `User` row does **not** 401. The guard builds a `BootstrapUser` from the JWT claims (falling back to a Clerk API lookup, because default session tokens carry only `sub`), flags it `isBootstrapping`, and lets the request through with `orgId: null`.

This exists because the Clerk webhook can be delayed or lost, and a hard 401 would deadlock a brand-new user out of onboarding forever. `OrgGuard` still blocks every org-scoped route, so the only thing a bootstrapping user can reach is `POST /onboarding`, which provisions them.

### Response shape

There is **no success envelope**. Handlers return their data directly — an object, an array, or a paginated `{ data, total, page, limit, totalPages }`. The frontend consumes `res.data` as-is.

Errors *are* enveloped, by `GlobalExceptionFilter`:

```json
{ "success": false, "statusCode": 403, "message": "Requires OWNER or ADMIN role" }
```

Unhandled exceptions are logged server-side and always returned as a generic `500 "Something went wrong"` — internal details never reach the client.

### Double-booking is enforced by the database

Slot arithmetic in `booking.service.ts` filters out conflicts, but two concurrent requests can still pass the same check. The real guarantee is a Postgres exclusion constraint:

```sql
EXCLUDE USING gist ("userId" WITH =, tsrange("startAt","endAt",'[)') WITH &&)
WHERE (status NOT IN ('CANCELLED','NO_SHOW') AND "userId" IS NOT NULL)
```

A losing race surfaces as a constraint violation, not a corrupt calendar. Cancelled and no-show bookings are excluded so their slots free up immediately.

### Availability

Slots are derived, never stored. The engine intersects org working hours, the individual staff member's hours, approved leave, existing bookings, and the org's `bufferMins` / `minLeadTimeMins` / `maxPerSlot` settings — all evaluated in the org's own `timezone` via `date-fns-tz`, not the server's.

### Plan limits

`src/common/constants/tier-limits.constant.ts` is the single enforcement point. `checkTierCap()` throws a `ForbiddenException` before creating staff, services or bookings past the cap.

| | Staff | Services | Bookings/mo | Voice min/mo |
|---|---|---|---|---|
| **Starter** | 2 | 10 | 30 | 0 |
| **Pro** | 10 | ∞ | 100 | 100 |
| **Business** | ∞ | ∞ | ∞ | ∞ |

> These numbers are mirrored in the frontend's `lib/plans.ts`. **Change both together** — the backend enforces, the frontend advertises.

### Webhooks

Three unauthenticated-by-guard endpoints, each verified by its own signature scheme:

| Endpoint | Verification | Notes |
|---|---|---|
| `POST /api/v1/webhooks/clerk` | Svix headers + `CLERK_WEBHOOK_SECRET` | Upserts by `clerkId`, so retries are safe |
| `POST /api/v1/billing/webhook` | `stripe-signature` + raw body | Syncs plan tier, suspends on non-payment |
| `POST /api/v1/vapi/webhook` | `x-vapi-secret` shared secret | Tool calls + end-of-call report |

Clerk webhook failures **deliberately propagate** as 4xx/5xx rather than being swallowed into a 200 — a bad secret must be loud, and a 500 makes Clerk retry. Stripe and Clerk both need the unparsed body, which is why `main.ts` boots with `rawBody: true`.

### ESM gotcha

The project is native ESM with `NodeNext` resolution: **every relative import must end in `.js`**, even when importing a `.ts` file.

```ts
import { PrismaService } from '../prisma/prisma.service.js'; // ✅
import { PrismaService } from '../prisma/prisma.service';    // ❌ runtime failure
```

Jest maps that extension away via `moduleNameMapper`, so tests and runtime agree.

### Super admin

`/api/v1/admin/*` sits behind `SuperAdminGuard`, which is independent of the normal auth chain: it verifies the Clerk token itself and checks `payload.sub` against the `SUPER_ADMIN_USER_IDS` allowlist. **An empty allowlist denies everyone** — it fails closed on purpose. Every mutation is recorded in `PlatformAuditLog` with before/after snapshots.

---

## API surface

All routes are prefixed `/api/v1`.

| Area | Routes |
|---|---|
| Health | `GET /health` — no auth, no DB, for uptime monitors |
| Onboarding | `POST /onboarding` |
| Me | `GET /me`, `PUT /me` |
| Organisation | `GET /organisation`, `PUT /organisation`, `PUT /organisation/hours`, `DELETE /organisation` (OWNER) |
| Services | `GET /services`, `POST /services`, `PUT /services/:id`, `DELETE /services/:id` |
| Staff | `GET /staff`, `POST /staff/invite`, `PUT /staff/:id/role`, `PUT /staff/:id/freeze`, `PUT /staff/:id/unfreeze`, `DELETE /staff/:id` |
| Invitations | `GET /invitations/:token`, `POST /invitations/accept/:token`, `POST /invitations/:id/resend`, `PATCH /invitations/:id/cancel` |
| Bookings | `GET /bookings`, `GET /bookings/slots`, `POST /bookings`, `PATCH /bookings/:id`, `PUT /bookings/:id` |
| Customers | `GET /customers`, `GET /customers/:id`, `PUT /customers/:id/notes` |
| Leave | `GET /leave`, `POST /leave`, `PUT /leave/:id` (approve/reject), `DELETE /leave/:id` |
| Notifications | `GET /notifications`, `PUT /notifications/:id/read`, `PUT /notifications/read-all` |
| Overview | `GET /overview` |
| Billing | `GET /billing/status`, `GET /billing/usage`, `GET /billing/usage/voice-history`, `POST /billing/subscribe`, `POST /billing/portal` |
| Public | `GET /public/:slug`, `GET /public/:slug/slots`, `POST /public/bookings`, `GET /slug-check/:slug` |
| Voice | `GET /voice/availability?slug=` — public, called by the agent |
| Webhooks | `POST /webhooks/clerk`, `POST /billing/webhook`, `POST /vapi/webhook` |
| Admin | `GET /admin/stats`, `GET /admin/users`, `GET /admin/organisations`, `GET /admin/organisations/:id`, `GET /admin/organisations/:id/bookings`, `GET /admin/organisations/:id/logs`, `PATCH /admin/organisations/:id/voice-ai`, `PATCH /admin/organisations/:id/suspend`, `PATCH /admin/organisations/:id/plan-tier` |

---

## Data model

Twelve models, all tenant-scoped except `PlatformAuditLog`. The full ER diagram is generated from the schema into [erd.md](erd.md) (Mermaid, regenerated on every `prisma generate`).

| Model | Purpose |
|---|---|
| `Organisation` | The tenant — profile, booking policy, timezone, plan tier, Stripe IDs, soft delete, suspension |
| `User` | Owner or staff, linked to Clerk by `clerkId`, holds `role` and `status` |
| `Service` | What the business sells — duration, price, per-service buffer, soft delete |
| `Customer` | Who books. No login. `@@unique([email, orgId])` so the same person can exist in several orgs |
| `Booking` | The appointment — joins org, customer, service and optional staff; carries voice transcript/duration/call ID |
| `WorkingHour` | Org-level hours when `userId` is null, staff-level when set |
| `StaffLeave` | Time off with an approval flow and an approver reference |
| `StaffInvitation` | Tokenised invite with expiry and status |
| `Notification` | In-app notifications per user |
| `AuditLog` | Per-org activity trail |
| `VoiceUsage` | One row per call, indexed by `[orgId, createdAt]` for monthly metering |
| `PlatformAuditLog` | Super-admin actions, before/after JSON |

---

## Scripts

| Command | What it does |
|---|---|
| `pnpm run start:dev` | Watch mode on port 3001 |
| `pnpm run start:debug` | Watch mode with the inspector attached |
| `pnpm run build` | Compile to `dist/` |
| `pnpm run start:prod` | Run the build (`node dist/src/main.js`) |
| `pnpm run lint` | ESLint with `--fix` |
| `pnpm run format` | Prettier over `src/` and `test/` |
| `pnpm test` | Jest — needs the ESM flag, which the script already sets |
| `pnpm run test:watch` / `test:cov` / `test:e2e` | Watch, coverage, end-to-end |
| `pnpm prisma migrate dev` | Create/apply a migration and regenerate the client |
| `pnpm prisma generate` | Regenerate the client and `erd.md` |
| `pnpm prisma studio` | Browse the database |

---

## Deployment

Deployed on **Render** (free tier) at `https://bookwise-backend-hs58.onrender.com`, against **Neon** Postgres in `ap-southeast-1`.

- **Build:** `pnpm install && pnpm prisma generate && pnpm run build`
- **Start:** `pnpm run start:prod`
- **Migrations:** run `pnpm prisma migrate deploy` against the production `DATABASE_URL` before releasing schema changes
- Set every variable from the table above in Render's environment settings. Leave `PORT` unset — Render assigns it.
- Set `FRONTEND_URL` to the deployed dashboard origin, or CORS will reject it.
- Register the production webhook URLs in the Clerk, Stripe and Vapi dashboards, and use the **production** signing secrets.
- The free tier sleeps when idle. `GET /api/v1/health` is auth-free and DB-free so an uptime monitor can keep it warm.

---

## Related

- **Frontend:** [DManuProj/Bookwise-frontend](https://github.com/DManuProj/Bookwise-frontend) — Next.js 16 dashboard, public booking page and in-browser voice widget

---

## License

UNLICENSED — private project. Maintained by [dulana-wanigathunga](https://github.com/dulana-wanigathunga).

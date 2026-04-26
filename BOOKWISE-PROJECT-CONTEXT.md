# Bookwise AI — Full Project Context (Continue From Here)

## What is Bookwise AI
A multi-tenant B2B SaaS platform that helps service businesses (salons, barbershops, clinics, gyms, spas) manage appointments. Core features: AI voice booking agent (in-browser via Vapi), public booking page, business dashboard, staff management, automated email notifications, Stripe billing.

---

## Tech Stack

### Frontend
- Next.js 16.1.6, React 19, TypeScript
- Tailwind CSS v4 (config in globals.css via @theme {})
- shadcn/ui radix-nova style, radix-ui v1.4.3
- React Hook Form v7 + Zod v3 + @hookform/resolvers
- Clerk v7 (auth only — never use Clerk Organisations)
- TanStack Query v5, Zustand v5
- next-themes, lucide-react, date-fns, uuid, recharts
- Package manager: pnpm
- Middleware file: middleware.ts (renamed from proxy.ts)

### Backend
- NestJS 11, Node.js v22, TypeScript, ESM ("type": "module")
- Prisma 7.6.0 ORM with PrismaPg adapter
- NeonDB (PostgreSQL) — Singapore region
- Clerk webhooks for auth sync
- Resend for email notifications
- Stripe v22 for billing/subscriptions
- Vapi for voice AI booking
- Package manager: pnpm
- Port: 3001 (local), auto-assigned on Render

---

## Project Structure (Local)
```
bokking-sass/                    ← parent folder (no git)
  bookwise-frontend/             ← Next.js (own git repo)
  bookwise-backend/              ← NestJS (own git repo)
```

### GitHub Repos
- Frontend: github.com/DManuProj/Bookwise-frontend
- Backend: github.com/DManuProj/Bookwise-backend

---

## Deployment
- Backend: Render (free tier) — https://bookwise-backend-hs58.onrender.com
- Frontend: Vercel (not deployed yet)
- Database: NeonDB (PostgreSQL, Singapore region)
- Email: Resend (free tier, 100 emails/day)
- Voice AI: Vapi (10 credits, GPT 4.1 Nano)
- Payments: Stripe (test mode)

---

## Environment Variables

### Backend (.env)
```
PORT=3001
DATABASE_URL=postgresql://neondb_owner:...@ep-billowing-block-a11qblz5-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
CLERK_SECRET_KEY=sk_test_xxxxx
CLERK_WEBHOOK_SECRET=whsec_xxxxx
RESEND_API_KEY=re_xxxxx
VAPI_PRIVATE_KEY=xxxxx
VAPI_ASSISTANT_ID=488a9a44-99b0-4319-a4a6-7ced...
STRIPE_SECRET_KEY=sk_test_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_PRO_PRICE_ID=price_xxxxx
STRIPE_PRO_YEARLY_PRICE_ID=price_xxxxx
STRIPE_BUSINESS_PRICE_ID=price_xxxxx
STRIPE_BUSINESS_YEARLY_PRICE_ID=price_xxxxx
FRONTEND_URL=http://localhost:3000
APP_URL=http://localhost:3000
NODE_ENV=production
```

### Frontend (.env.local)
```
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_xxxxx
CLERK_SECRET_KEY=sk_test_xxxxx
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/onboarding
NEXT_PUBLIC_VAPI_PUBLIC_KEY=xxxxx
NEXT_PUBLIC_VAPI_ASSISTANT_ID=488a9a44-99b0-4319-a4a6-7ced...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_xxxxx
```

---

## Database Schema (All Models)

### Enums
```
Role: MEMBER | ADMIN | OWNER
BookingStatus: PENDING | CONFIRMED | CANCELLED | COMPLETED | NO_SHOW | RESCHEDULED
BookingSource: MANUAL_CUSTOMER | VOICE_AI | MANUAL_DASHBOARD
PlanTier: STARTER | PRO | BUSINESS
InviteStatus: PENDING | ACCEPTED | EXPIRED | RESENT
UserStatus: ACTIVE | INACTIVE | REMOVED
DayOfWeek: MON | TUE | WED | THU | FRI | SAT | SUN
LeaveStatus: PENDING | APPROVED | REJECTED | CANCELLED
```

### Models
```
Organisation  → business profile, settings, plan tier, Stripe IDs, soft delete (isDeleted, deletedAt)
User          → staff/owner, Clerk auth, roles, status
Service       → what the business offers
Customer      → who books (no login, auto-created, @@unique([email, orgId]))
Booking       → the appointment (connects all tables), voiceTranscript, voiceDuration
AuditLog      → activity history per org
Notification  → in-app notifications (title, message, type, entityType, entityId, isRead)
StaffInvitation → invite flow with token, expiry
WorkingHour   → org hours + individual staff hours
StaffLeave    → staff time off requests with approval flow
```

### Key Fields Added Beyond Initial Schema
```
Organisation:
  isDeleted       Boolean  @default(false)
  deletedAt       DateTime?
  stripeCustomerId     String?  @unique
  stripeSubscriptionId String?

Booking:
  voiceTranscript String?
  voiceDuration   Int?
```

### Migrations Run
```
20260406162432_init               → all tables created
20260406164036_add                → StaffLeave.orgId added
20260416150319_add_org_soft_delete → isDeleted + deletedAt on Organisation
20260419160353_add_voice_transcript → voiceTranscript + voiceDuration on Booking
[date]_add_stripe_fields          → stripeCustomerId + stripeSubscriptionId on Organisation
```

---

## Backend — Complete File Structure
```
bookwise-backend/
  src/
    main.ts                          ← entry point, CORS, ValidationPipe, GlobalExceptionFilter
    app.module.ts                    ← root module, all imports
    app.controller.ts
    app.service.ts
    
    prisma/
      prisma.service.ts              ← PrismaClient with PrismaPg adapter
      prisma.module.ts               ← @Global module
    
    generated/
      prisma/                        ← Prisma generated client (gitignored)
    
    common/
      types/
        index.ts                     ← AuthenticatedUser type
      guards/
        org.guard.ts                 ← checks user has org + org not deleted
        roles.guard.ts               ← checks user role against @Roles() decorator
      decorators/
        roles.decorator.ts           ← @Roles('OWNER', 'ADMIN') decorator
      filters/
        http-exception.filter.ts     ← global error handler
    
    auth/
      auth.guard.ts                  ← ClerkAuthGuard (verifies JWT, attaches user to request)
      auth.decorator.ts              ← @CurrentUser() param decorator
      auth.module.ts
    
    webhooks/
      webhooks.controller.ts         ← POST /api/webhooks/clerk
      webhooks.service.ts            ← handles user.created event from Clerk
      webhooks.module.ts
    
    onboarding/
      onboarding.controller.ts       ← POST /api/onboarding
      onboarding.service.ts          ← creates org + links user + hours + staff + services (transaction)
      onboarding.module.ts
      onboarding.dto.ts              ← OnboardingDto with nested WorkingHourDto, StaffDto, ServiceDto
    
    organisation/
      organisation.controller.ts     ← GET/PUT /api/organisation, PUT /api/organisation/hours, DELETE /api/organisation
      organisation.service.ts        ← CRUD org + working hours + soft delete with booking check
      organisation.module.ts
      organisation.dto.ts            ← UpdateOrganisationDto, UpdateWorkingHoursDto
    
    services/
      services.controller.ts         ← GET/POST/PUT/DELETE /api/services
      services.service.ts            ← CRUD services with org ownership check
      services.module.ts
      services.dto.ts                ← CreateServiceDto, UpdateServiceDto
    
    staff/
      staff.controller.ts            ← GET /api/staff, POST invite, POST resend, PUT role, DELETE
      staff.service.ts               ← invite (creates user + invitation), resend, change role, soft remove
      staff.module.ts
      staff.dto.ts                   ← ChangeRoleDto
    
    invitations/
      invitations.controller.ts      ← GET /api/invitations/:token, POST /api/invitations/:token/accept (PUBLIC, no auth)
      invitations.service.ts         ← get invite details, accept invitation (updates clerkId + status)
      invitations.module.ts
      invitations.dto.ts             ← AcceptInvitationDto (clerkId)
    
    me/
      me.controller.ts               ← GET/PUT /api/me (ClerkAuthGuard only, no OrgGuard)
      me.service.ts                  ← get/update profile, sets profileComplete = true
      me.module.ts
      me.dto.ts                      ← UpdateMeDto
    
    bookings/
      booking.controller.ts          ← GET/POST/PUT/DELETE /api/bookings with RolesGuard
      booking.service.ts             ← CRUD bookings, dynamic where filters, customer resolve, email + notification
      booking.module.ts
      booking.dto.ts                 ← CreateBookingDto (with BookingCustomerDto), UpdateBookingDto
    
    customers/
      customer.controller.ts         ← GET /api/customers, GET :id, PUT :id/notes
      customer.service.ts            ← search with partial match, booking history include, update notes
      customer.module.ts
      customer.dto.ts                ← UpdateCustomerNotesDto
    
    public-booking/
      public-booking.controller.ts   ← GET /api/public/:slug, GET :slug/slots, POST /api/public/bookings (PUBLIC, no auth)
      public-booking.service.ts      ← org data, available time slots calculation, public booking with find-or-create customer
      public-booking.module.ts
      public-booking.dto.ts          ← PublicCreateBookingDto, PublicCustomerDto
    
    email/
      email.service.ts               ← Resend integration, branded HTML templates, wrapInTemplate pattern
      email.module.ts                ← @Global module
      (templates are inline HTML with brand colors, not separate files)
    
    notifications/
      notifications.controller.ts    ← GET /api/notifications, PUT :id/read, PUT read-all
      notifications.service.ts       ← createNotification, notifyByRoles, notifyOrgAdmins helpers
      notifications.module.ts        ← @Global module (exported for all services to use)
    
    leave/
      leave.controller.ts            ← GET/POST/PUT/DELETE /api/leave
      leave.service.ts               ← CRUD with role-based access, email on approve/reject
      leave.module.ts
      leave.dto.ts                   ← CreateLeaveDto, UpdateLeaveStatusDto, GetLeaveQueryDto
    
    vapi/ (folder might be named AIBooking/)
      vapi.controller.ts             ← POST /api/vapi/webhook (PUBLIC, no auth)
      vapi.service.ts                ← handles function-call + end-of-call-report, 3 functions (getServices, getAvailableSlots, createBooking)
      vapi.module.ts
    
    billing/
      billing.controller.ts          ← GET status, POST subscribe, POST portal, POST webhook
      billing.service.ts             ← Stripe integration, subscribe/upgrade/downgrade, webhook handlers
      billing.module.ts
      billing.dto.ts                 ← SubscribeDto (planTier + billingPeriod)
  
  prisma/
    schema.prisma                    ← all models
    prisma.config.ts                 ← database connection config
    migrations/                      ← all migration folders
  
  .env
  package.json
  tsconfig.json
  tsconfig.build.json
  nest-cli.json
```

---

## All API Endpoints

### Webhooks (PUBLIC — no auth)
```
POST /api/webhooks/clerk           → Clerk user.created event → creates User in DB
```

### Auth
```
ClerkAuthGuard  → verifies JWT, finds user with include: { org: true }, attaches to request
OrgGuard        → checks user.orgId exists + org.isDeleted is false
RolesGuard      → checks user.role against @Roles() decorator
@CurrentUser()  → extracts user from request (set by auth guard)
```

### Onboarding (Protected: ClerkAuthGuard + OrgGuard not needed — no org yet)
```
POST /api/onboarding               → creates org + working hours + staff invitations + users + services (transaction)
```

### Organisation (Protected: ClerkAuthGuard + OrgGuard)
```
GET    /api/organisation            → org details with working hours + services
PUT    /api/organisation            → update business info / booking prefs (partial update)
PUT    /api/organisation/hours      → replace all working hours (delete + recreate in transaction)
DELETE /api/organisation            → soft delete (isDeleted=true, unlink users), blocks if upcoming bookings exist, OWNER only
```

### Services (Protected: ClerkAuthGuard + OrgGuard)
```
GET    /api/services                → all services for org
POST   /api/services                → create service
PUT    /api/services/:id            → update service (with org ownership check)
DELETE /api/services/:id            → delete service (with org ownership check)
```

### Staff (Protected: ClerkAuthGuard + OrgGuard)
```
GET    /api/staff                   → all staff in org
POST   /api/staff/invite            → invite staff (creates invitation + user record, sends email)
POST   /api/staff/resend/:id        → resend invitation (new token + expiry, sends email)
PUT    /api/staff/role/:id          → change role (OWNER only, can't change own role or assign OWNER)
DELETE /api/staff/:id               → soft remove (status=REMOVED, orgId=null, delete invitation)
```

### Invitations (PUBLIC — no auth)
```
GET  /api/invitations/:token        → get invite details + org name (checks expiry, updates status on read)
POST /api/invitations/:token/accept → accept invitation (sets clerkId, status=ACTIVE)
```

### Me (Protected: ClerkAuthGuard only — no OrgGuard)
```
GET  /api/me                        → current user profile (from @CurrentUser, no DB call)
PUT  /api/me                        → update profile (firstName, lastName, phone, photoUrl, sets profileComplete=true)
```

### Bookings (Protected: ClerkAuthGuard + OrgGuard + RolesGuard)
```
GET    /api/bookings                → list with filters (?status, ?date, ?staffId), includes service + customer + user
POST   /api/bookings                → create (OWNER/ADMIN only), resolves customer (existing or new), source=MANUAL_DASHBOARD
PUT    /api/bookings/:id            → update status (OWNER/ADMIN only), blocks cancelled/completed updates
DELETE /api/bookings/:id            → cancel (OWNER/ADMIN only), soft cancel (status=CANCELLED), blocks already cancelled/completed
```

### Customers (Protected: ClerkAuthGuard + OrgGuard + RolesGuard)
```
GET  /api/customers                 → list with search (?name, ?email), partial match, case insensitive
GET  /api/customers/:id             → single customer with booking history
PUT  /api/customers/:id/notes       → update customer notes
```

### Public Booking (PUBLIC — no auth)
```
GET  /api/public/:slug              → org data (name, logo, services, staff, working hours) — filtered for public display
GET  /api/public/:slug/slots        → available time slots (?serviceId, ?date, ?staffId) — full slot calculation
POST /api/public/bookings           → create booking (source=MANUAL_CUSTOMER, find-or-create customer, sends email)
```

### Leave (Protected: ClerkAuthGuard + OrgGuard + RolesGuard)
```
GET    /api/leave                   → all leave requests (OWNER/ADMIN see all, MEMBER sees own only)
POST   /api/leave                   → request leave (any role)
PUT    /api/leave/:id               → approve/reject (OWNER/ADMIN only, can't approve own, sends email)
DELETE /api/leave/:id               → cancel leave (own pending or OWNER/ADMIN can cancel any pending)
```

### Notifications (Protected: ClerkAuthGuard + OrgGuard)
```
GET  /api/notifications             → unread notifications for current user, ordered by time desc
PUT  /api/notifications/:id/read    → mark single as read (checks userId ownership)
PUT  /api/notifications/read-all    → mark all as read (updateMany)
```

### Vapi Voice AI (PUBLIC — no auth, Vapi calls this)
```
POST /api/vapi/webhook              → handles function-call (getServices, getAvailableSlots, createBooking) + end-of-call-report (saves transcript)
```

### Billing (Mixed auth)
```
GET  /api/billing/status            → current plan info (Protected)
POST /api/billing/subscribe         → create/update subscription, returns clientSecret (Protected, OWNER only)
POST /api/billing/portal            → Stripe customer portal URL (Protected, OWNER only)
POST /api/billing/webhook           → Stripe events (PUBLIC, signature verified)
```

---

## Key Architecture Decisions

### Auth Flow
- Clerk handles authentication (signup/signin)
- Clerk webhook syncs user to our DB (user.created event)
- ClerkAuthGuard verifies JWT on every protected request
- User created with role=OWNER, status=INACTIVE, onboardingComplete=false
- After onboarding: status=ACTIVE, onboardingComplete=true, linked to org

### Staff Invitation Flow
- Owner invites staff → creates StaffInvitation + User (INACTIVE, placeholder clerkId)
- Staff clicks invite link → sees org details
- Staff accepts → Clerk signup → clerkId updated, status=ACTIVE
- Staff completes /profile/setup → profileComplete=true
- Staff redirected to /dashboard

### Booking Slot Calculation
1. Get org working hours for the requested day
2. Generate all possible slots (every 30 min within open hours)
3. Get existing PENDING/CONFIRMED bookings for that day
4. Remove conflicting slots (overlap check with buffer time)
5. If today: remove past slots + apply minLeadTimeMins
6. Return available slots

### Email Notifications (Resend)
- Branded HTML templates using wrapInTemplate() helper
- Brand colors: #22c55e (green), #0f172a (dark), #f8fafc (light)
- Emails: invitation, booking confirmation, booking status, leave status
- try/catch around every email — failure doesn't break the operation

### Dashboard Notifications
- Created by services using NotificationService helpers
- createNotification() → one specific user
- notifyByRoles() → any combination of roles
- notifyOrgAdmins() → shortcut for OWNER + ADMIN
- Triggered on: booking create/cancel, staff invite/join/remove, leave request/decision, role change, service add/delete

### Stripe Billing
- Stripe v22 SDK
- Products: Bookwise Pro ($15/mo, $150/yr), Bookwise Business ($25/mo, $250/yr)
- Starter is free (no Stripe involvement)
- Subscribe endpoint creates Stripe customer + subscription, returns clientSecret
- Frontend uses Stripe Elements to confirm payment (embedded form, not redirect)
- Upgrades: proration_behavior='always_invoice' (Stripe calculates difference)
- Downgrades/cancels: handled via Stripe Customer Portal
- Webhook handles: invoice.payment_succeeded, customer.subscription.updated, customer.subscription.deleted

### Soft Deletes
- Organisation: isDeleted + deletedAt (OrgGuard checks isDeleted)
- User/Staff: status=REMOVED + orgId=null (keeps booking history)
- Bookings: status=CANCELLED (never hard deleted)
- Invitations: status changes (PENDING → ACCEPTED/EXPIRED/RESENT)

### Voice AI (Vapi)
- Assistant: Riley (GPT 4.1 Nano, conversational prompt)
- 3 tools: getServices, getAvailableSlots, createBooking
- Webhook endpoint handles function-call and end-of-call-report
- Transcript + duration saved on booking record
- Source: VOICE_AI (distinct from MANUAL_DASHBOARD and MANUAL_CUSTOMER)
- In-browser via Vapi Web SDK (not phone calls)

---

## Frontend — Completed Pages ✅

### Landing page
- Navbar, Hero, LogoStrip, Features, HowItWorks
- VoiceDemo, Pricing, Testimonials, FAQ, CTA, Footer
- Voice AI shown as in-browser agent (not phone calls)
- Sign in/up via Clerk modal (forceRedirectUrl)

### Onboarding flow (/onboarding)
- Step 1: Business info (name, slug, type, phone, country, currency)
- Step 2: Working hours (Switch + time selects per day)
- Step 3: Staff (add team members with name, email, phone, role)
- Step 4: Services (add services with duration, price, buffer)
- Step 5: Review (edit any section before submitting)
- DoneScreen (booking URL copy, staff invite note)
- Single POST on confirm, cameFromReview edit pattern

### Dashboard layout
- Sidebar (shadcn Sidebar, collapsible icon mode)
- Topbar (mobile only, Sheet drawer)
- Clerk auth guard

### Dashboard pages
- Overview: stats cards, alerts, recent bookings, charts (recharts)
- Bookings: table, filters, status badges, NewBookingModal
- Services: card grid, ServiceFormModal (add/edit)
- Staff: table with phone, status, resend invite, InviteStaffModal, EditRoleModal
- Customers: table, search, pagination, CustomerDetailModal (notes + booking history)
- Settings: 6 sections with edit mode pattern using SettingsCard component
  - BusinessInfo, WorkingHours, BookingPrefs, Notifications, Profile, DangerZone

### Public booking page (/book/[slug])
- layout.tsx: minimal topbar "Powered by Bookwise"
- BookingChannelSelector: Manual or AI voice booking choice
- BookingFlow.tsx: owns all state, left panel + right panel
- VoiceBookingWidget: idle/active states, orb animation, waveform, transcript
- Steps: StepService, StepStaff, StepDateTime, StepDetails, StepConfirmation
- BookingProgress: 4-step indicator

### Staff invite page (/invite/[token])
- 4 states: Valid, Expired, Used, Invalid
- InviteCard component with colored gradient bar per state
- Clerk SignUpButton with forceRedirectUrl="/profile/setup"

### Profile setup (/profile/setup)
- Photo upload, first name, last name, phone
- Email read-only from Clerk
- Redirects to /dashboard on submit

### 404 page (app/not-found.tsx)

---

## Frontend — Pending Items (Phase 7)

### 1. Middleware routing logic
```
onboardingComplete=false AND role=OWNER → redirect to /onboarding
profileComplete=false AND role≠OWNER → redirect to /profile/setup
Both complete → allow to /dashboard
```

### 2. Connect all TODO API calls to real backend
Every component has placeholder data and TODO comments:
```
// TODO: GET /api/services
// TODO: POST /api/bookings
// TODO: PUT /api/organisation
```

### 3. TanStack Query setup
- useQuery for fetching
- useMutation for creating/updating
- Polling for notifications (refetchInterval: 30000)

### 4. Wire Stripe Elements for billing
- Install @stripe/stripe-js + @stripe/react-stripe-js
- Payment modal with CardElement
- Confirm payment with clientSecret from backend

### 5. Wire Vapi Web SDK for voice booking
- Install @vapi-ai/web
- Initialize with public key + assistant ID
- Pass slug as metadata
- Listen for transcript events
- Display live transcript in VoiceBookingWidget

### 6. Role-based UI
- Sidebar NAV_ITEMS filter by role
- Hide Staff/Customers pages from MEMBER
- Show read-only services to MEMBER

### 7. Staff onboarding Step 3 needs phone field
- Currently has: name, email, role
- Add: phone number input

### 8. Update /invite/[token] page
- Wire to real GET /api/invitations/:token API
- Currently uses mock tokens

---

## Frontend Types — All in types/index.ts
```typescript
// Enums
Role: "OWNER" | "ADMIN" | "MEMBER"
BookingStatus: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW" | "RESCHEDULED"
BookingSource: "MANUAL_CUSTOMER" | "VOICE_AI" | "MANUAL_DASHBOARD"
PlanTier: "STARTER" | "PRO" | "BUSINESS"
InviteStatus: "PENDING" | "ACCEPTED" | "EXPIRED" | "RESENT"

// Core entities
Organisation, User, Service, Customer, Booking
StaffMember, WorkingHourRow

// Dashboard view types
BookingRow, BookingHistoryItem, CustomerRow

// Public booking
OrgData, BookingFormData, BookingPayload

// Onboarding
Step1Data, Step2Data, Step3Data, Step4Data, OnboardingData

// Zod schemas
businessFormSchema, serviceSchema, bookingDetailsSchema
```

---

## Response/Teaching Pattern (IMPORTANT)

### Always follow this pattern:
1. **Explain the concept first** — use real world analogies, explain WHY before HOW
2. **Ask questions before building** — make the user think about the design
3. **Give tasks not just code** — tell what to build, give field names/types, user writes the code
4. **Explain every new concept** — what is it, why do we need it, real world analogy
5. **Step by step, one thing at a time** — never give 5 steps at once, wait for confirmation
6. **Corrections** — when mistakes happen, explain why it's wrong, give correct approach with reasoning
7. **Top to bottom data flow** — always explain from controller → service → database
8. **Return format** — all endpoints return { success: true, data/message }
9. **Security checks** — always verify orgId ownership, use guards consistently

### NestJS patterns established
- Controller receives → Service processes → Prisma queries
- @UseGuards(ClerkAuthGuard, OrgGuard, RolesGuard) on controllers
- @Roles('OWNER', 'ADMIN') on specific methods
- @CurrentUser() to get authenticated user
- DTOs with class-validator (! for required, ? for optional)
- @Global() modules for shared services (Prisma, Email, Notification)
- Transactions for multi-step operations
- Dynamic where clause for filters
- try/catch on external service calls (email, Stripe)
- user.orgId! with OrgGuard guarantee

### Brand Colors (for any UI/email work)
```
Brand green: #22c55e (brand-500)
Dark green: #16a34a (brand-600)
Light green: #f0fdf4 (brand-50)
Background: #f8fafc (slate-50)
Text dark: #0f172a (slate-900)
Text medium: #475569 (slate-600)
Text light: #94a3b8 (slate-400)
Border: #e2e8f0 (slate-200)
Card bg: #ffffff
```

---

## What's COMPLETED ✅
```
Phase 1-3: Backend core (all APIs built)
Phase 4:   Email notifications (Resend, branded templates)
Phase 5:   Voice AI (Vapi assistant + webhook + transcript storage)
Phase 6:   Production (CORS, error handling, deployed to Render)
Billing:   Stripe integration (subscribe, upgrade, portal, webhooks)
```

## What's NEXT → Phase 7: Wire Frontend to Backend
```
1. Deploy frontend to Vercel
2. Set up TanStack Query + API client
3. Connect onboarding page to POST /api/onboarding
4. Connect dashboard pages to real APIs
5. Connect settings page
6. Wire Stripe Elements for billing
7. Wire Vapi Web SDK for voice booking
8. Wire public booking page
9. Wire invite page
10. Middleware routing logic (onboarding/profile checks)
11. Role-based UI restrictions
12. Update webhook URLs (Clerk, Vapi, Stripe) to production
```

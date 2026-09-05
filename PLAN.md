# PeoplePay360 — 24-Hour Implementation Plan

Three people, three branches, three sections. **Read "Shared spine" and "Auth contract"
first — they are the two things all three sections depend on.** Then go to your section
and ignore the other two.

---

## Shared spine (already exists — do not rewrite)

| File | What it is |
|---|---|
| `backend/src/schema.sql` | 15 tables, constraints, indexes. **Read this first.** |
| `backend/src/db.js` | `pg` pool, `query` / `one` / `tx` helpers, type parsers, `migrate()` |
| `backend/src/auth.js` | Role matrix + `can(module, action)` middleware — **Section 1 replaces the identity half of this** |
| `backend/src/lib/crud.js` | `crudRouter()` factory: list/get/create/update/delete for any table |
| `backend/src/lib/dates.js` | `weeklyHours`, `scheduledDays`, `overlapDays`, `daysBetween` |
| `backend/src/lib/payroll.js` | The rule engine: contract-for-period, period stats, sequenced rules, warnings |
| `backend/src/seed.js` | 6 months of demo data |
| `frontend/src/styles.css` | Design tokens. Never write a raw colour anywhere else. |
| `frontend/src/components/ui.jsx` | `useApi`, `States`, `Card`, `Kpi`, `Table`, `Badge`, `Field`, `Modal`, `Alert` |
| `frontend/src/api.js` | `api.get/post/patch/del`, `qs()`, `money()` |
| `frontend/src/pages/Dashboard.jsx` | Working vertical slice — copy its shape for your pages |
| `backend/test/logic.test.mjs` | `npm test` — date maths and salary formulas. Add cases as you go. |

Each section's route file exists as a **CRUD scaffold only**. The business logic,
validation, and every screen is the actual work.

---

## How the payroll engine works (everyone reads this once)

A payslip is computed from three inputs:

1. **The contract that covers the period.** `contractForPeriod()` picks the one contract
   whose `[start_date, end_date]` overlaps the payroll period; latest start wins. The seed
   gives some employees an expired contract *plus* a renewal — run payroll for an older
   month and the **old** wage is used. This is the single most demo-able business rule.
2. **Period stats** from attendance + approved leave: worked days, attended days,
   overtime hours, paid vs unpaid leave days.
3. **The structure's salary rules, in `sequence` order.** Each rule is `fixed`, `percent`
   (of another rule's code or a category total), or `formula`. A formula sees:

   ```js
   wage, worked_days, working_days, attended_days, attendance_hours,
   overtime_hours, paid_leave_days, unpaid_leave_days, leave_days, late_days,
   RULE.<CODE>     // any rule that already ran, e.g. RULE.BASIC
   CAT.<CATEGORY>  // running total, e.g. CAT.ALW, CAT.DED
   ```

   Seeded example: Net Salary is `RULE.GROSS - CAT.DED` at sequence 200, which only works
   because PF / PT / TDS / LOP ran at 110–140 first. **Sequence is the whole point.**

---

# Auth contract (frozen — Section 1 implements it, Sections 2 and 3 code against it)

The current `x-user-id` header is a placeholder. It is being replaced by a real login.
**This contract is frozen at hour 0 so Sections 2 and 3 never wait on Section 1.**

### Scope of "robust"

In scope: bcrypt password hashing · JWT access token + httpOnly refresh cookie · rotation
on refresh · rate limiting · account lockout · Zod-validated payloads · no user
enumeration · server-side RBAC on every route · protected client routes · role-gated nav ·
logout that actually invalidates · forced password change on seeded accounts.

Out of scope, say so on the roadmap slide: SSO/OAuth, MFA/TOTP, email verification,
password reset via email, audit log of logins.

### Schema additions (Section 1 owns this migration, lands by hour 2)

```
users:  + password_hash        TEXT NOT NULL
        + is_active            BOOLEAN NOT NULL DEFAULT TRUE
        + must_change_password BOOLEAN NOT NULL DEFAULT FALSE
        + failed_attempts      INTEGER NOT NULL DEFAULT 0
        + locked_until         TIMESTAMPTZ
        + last_login_at        TIMESTAMPTZ

new table refresh_tokens(
  id, user_id -> users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,   -- store the hash, never the token
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

### Endpoints

| Method | Path | Body / effect | Returns |
|---|---|---|---|
| `POST` | `/api/auth/login` | `{ email, password }` | `{ user, accessToken }` + sets `refresh_token` httpOnly cookie |
| `POST` | `/api/auth/refresh` | cookie only | new `{ accessToken }`, rotates the refresh cookie |
| `POST` | `/api/auth/logout` | cookie only | `204`, revokes the refresh row and clears the cookie |
| `GET` | `/api/auth/me` | Bearer token | `{ user, permissions }` |
| `POST` | `/api/auth/change-password` | `{ currentPassword, newPassword }` | `204`, revokes all other sessions |
| `GET/POST/PATCH` | `/api/users` | Admin only — create user, assign role, link to employee, activate/deactivate, reset password | user rows (never `password_hash`) |

### Rules Sections 2 and 3 can rely on

- **Access token**: JWT, 15-minute expiry, sent as `Authorization: Bearer <token>`.
  `api.js` attaches it automatically — you never touch headers.
- **Refresh**: httpOnly, `SameSite=Lax` cookie, 7-day expiry, rotated on every use.
  `api.js` retries a `401` once through `/api/auth/refresh` transparently.
- **`req.user`** is populated by the auth middleware exactly as it is today
  (`{ id, name, email, role, employee_id }`), so **every existing `can(module, action)`
  call keeps working unchanged**. Your route files need no edits for auth.
- **`403` shape** stays `{ error: "Your role (x) cannot write y" }`.
- **`401`** means "log in again" — the client handles it globally; do not handle it per page.
- **Employee-scoped reads**: `scopeToSelf(req)` returns the caller's `employee_id` when
  their role is `employee`, else `null`. Sections 2 and 3 apply it to their own list
  queries so an Employee only sees their own attendance / leave / payslips.

### Error contract for the login screen

| Case | Status | Body |
|---|---|---|
| Bad email **or** bad password | `401` | `{ error: "Invalid email or password" }` — identical both ways, no enumeration |
| Account locked | `423` | `{ error: "Account locked. Try again in N minutes." }` |
| Rate limited | `429` | `{ error: "Too many attempts. Try again shortly." }` |
| Inactive account | `403` | `{ error: "This account has been deactivated." }` |
| Must change password | `200` | normal login, `user.must_change_password === true` → client redirects to the change screen |

### Seeded accounts (documented in README, password change forced on first login)

| Email | Role |
|---|---|
| `admin@peoplepay360.com` | Admin |
| `meera.hr@peoplepay360.com` | HR Manager |
| `arjun.pay@peoplepay360.com` | Payroll Manager |
| `ishita.pay@peoplepay360.com` | Payroll User |
| `priya.emp@peoplepay360.com` | Employee |

---

# Working independently: branches and shared files

### Branches

```
main                      protected — merge via PR only, never push directly
feat/s1-auth              Section 1, lands FIRST (hour 0–2 gate)
feat/s1-<thing>           Section 1 thereafter
feat/s2-<thing>           Section 2
feat/s3-<thing>           Section 3
```

Branch from `main`, merge `main` into your branch **twice a day**, open a PR, get a
30-second review from either teammate, merge.

### The four shared files — the only real conflict risk

| File | Protocol |
|---|---|
| `frontend/src/App.jsx` | **All routes get registered in hour 0–2, by Section 1, before anyone builds pages.** After that nobody edits it. You build behind a route that already exists. |
| `backend/src/index.js` | Same: all `app.use('/api/...')` mounts land in hour 0–2. Adding an endpoint *inside* your own route file needs no edit here. |
| `backend/src/schema.sql` | Section 1 lands the auth migration by hour 2. After that, any schema change is announced in chat and made by its section owner in a single-purpose PR. |
| `frontend/src/styles.css` · `components/ui.jsx` · `api.js` | Additive only. Announce before editing. If you need a new shared component, add it here rather than making a local copy — but say so in chat first. |

Everything else below is owned by exactly one person and touched by exactly one person.

---

# SECTION 1 — Identity, Access & Employee Master

**Owner:** _name_  ·  **Branches:** `feat/s1-*`

### Files you own

```
backend/src/auth.js                     (rewrite: real tokens, keep can() signature)
backend/src/routes/auth.js              (new)
backend/src/routes/users.js             (new)
backend/src/routes/employees.js
frontend/src/pages/auth/*                (new — Login, ChangePassword, RouteGuard)
frontend/src/pages/users/*               (new — user + role admin)
frontend/src/pages/employees/*
```

### API you already have

```
GET/POST/PATCH/DELETE  /api/employees        ?department_id= &status= &employee_type= &search=
GET                    /api/employees/:id/summary   smart-button counts + live leave balances
GET/POST               /api/departments  /api/positions
```

### Build

**Phase 1 — the hour 0–2 gate (do this before anything else, everyone is blocked on it)**

1. Land the schema migration above, plus `bcryptjs`, `jsonwebtoken`, `cookie-parser`,
   `express-rate-limit` in `backend/package.json`.
2. Update `seed.js` to hash the seeded passwords and set `must_change_password = true`.
3. Register **all seven routes** in `frontend/src/App.jsx` and **all route mounts** in
   `backend/src/index.js`, pointing at the existing placeholder pages. Merge it.
   From this moment Sections 2 and 3 never touch either file.
4. Announce in chat: "auth contract live, App.jsx and index.js frozen."

**Phase 2 — authentication**

5. `POST /api/auth/login` — Zod-validated, bcrypt compare, constant-ish response time,
   generic `401` for both bad email and bad password.
6. Access token (15 min JWT) + refresh token: random 32 bytes, **store only its SHA-256
   hash** in `refresh_tokens`, return the raw value in an httpOnly `SameSite=Lax` cookie.
7. `POST /api/auth/refresh` with **rotation** — issue a new refresh row, revoke the old
   one. Reuse of a revoked token revokes that user's whole token family.
8. `POST /api/auth/logout` — revoke the row, clear the cookie.
9. **Rate limit** `/api/auth/login` to 10 attempts per IP per 15 min → `429`.
   **Account lockout**: 5 consecutive failures → `locked_until = now() + 15 min` → `423`.
   Reset `failed_attempts` and stamp `last_login_at` on success.
10. Rewrite `attachUser` in `auth.js` to verify the Bearer JWT instead of reading
    `x-user-id`. **`can()` and `MATRIX` keep their exact current shape** — that is what
    lets Sections 2 and 3 stay untouched.
11. `POST /api/auth/change-password` — verify current, enforce policy (min 10 chars, not
    equal to the old one), revoke every other refresh token for that user.

**Phase 3 — client auth**

12. **Login page** — email + password, inline field errors, a distinct message per case in
    the error table above, loading state on submit, Enter-to-submit, autofocus, and
    `autocomplete="email"` / `"current-password"` so password managers work.
13. **Auth context + `<RequireAuth>` / `<RequireRole roles={[...]}>` route wrappers.**
    Unauthenticated → redirect to `/login` and return to the intended page after login.
    Wrong role → a clear "you don't have access" page, not a blank screen.
14. **Token handling in `frontend/src/api.js`** (announce this edit — it is shared): attach
    the Bearer header, and on a `401` retry once through `/api/auth/refresh` before
    giving up. Access token in memory only; never `localStorage`.
15. **Forced password change** — `must_change_password` redirects to the change screen and
    blocks navigation until it is done.
16. **Role-gated nav** — hide nav items the current role cannot read, using the
    `permissions` object from `/api/auth/me`. Header shows the logged-in name, role badge,
    and a working Logout.

**Phase 4 — user & employee administration**

17. **User management (Admin only)** — list users with role, linked employee, active flag,
    last login. Create a user, assign a role, link to an employee record, deactivate,
    trigger a password reset. Never render or return `password_hash`.
18. **Employee List view** — name, department, position, manager, type, status. Filters for
    department / status / type, plus search. (A1, B1)
19. **Employee Kanban view** — same data grouped by department, one header toggles
    List ⇄ Kanban. Cards show name, position, status badge. (A1)
20. **Employee Form** — identity, work email, phone, department, position, manager,
    schedule, employee type, status, bank account, join date. (B2)
21. **Smart buttons** — Contracts / Attendance / Time Off / Allocations / Payslips, each
    showing its live count from `/summary` and linking to that module pre-filtered by
    `?employee_id=`. (B2)
22. **Leave balance panel** on the employee form, from `summary.balances`.
23. **Zod validation** on employee create/update: required name, valid email, unique work
    email handled as a `400` not a `500`.

### Done when

A logged-out visitor cannot reach any page. Logging in as Priya (Employee) hides Payroll
from the nav and a hand-typed `/payroll` URL is refused. Five wrong passwords locks the
account with a countdown message. An admin can create a user, assign HR Manager, and that
user's new permissions are correct on their next login. Employee kanban, list, form and
smart buttons all work against live counts.

---

# SECTION 2 — Contracts, Time & Attendance

**Owner:** _name_  ·  **Branches:** `feat/s2-*`

### Files you own

```
backend/src/routes/contracts.js
backend/src/routes/schedules.js
backend/src/routes/attendance.js
backend/src/routes/timeoff.js
frontend/src/pages/contracts/*
frontend/src/pages/attendance/*
frontend/src/pages/schedules/*
frontend/src/pages/timeoff/*
```

### API you already have

```
GET/POST/PATCH/DELETE  /api/contracts        ?employee_id= &state=
POST                   /api/contracts/:id/check-overlap
GET/POST/PATCH/DELETE  /api/attendance       ?employee_id= &status=
POST                   /api/attendance/:id/check-out
GET/POST/PATCH/DELETE  /api/schedules        (lines nested; hours_per_week derived)
GET/POST/PATCH/DELETE  /api/time-off/types
GET/POST/PATCH/DELETE  /api/time-off/allocations    POST /:id/approve  /:id/refuse
GET/POST/PATCH/DELETE  /api/time-off/requests       POST /:id/approve  /:id/refuse
GET                    /api/time-off/requests/balances/:employeeId
```

**You are not blocked by Section 1.** Until auth merges, keep sending `x-user-id`; when it
merges, `api.js` swaps the header for you and nothing in your files changes.

### Build

**Contracts (A2)**

1. **Contract List** — employee, dates, wage, structure, state. The contract active *today*
   is clearly highlighted. Filter by employee and state; deep-link `?employee_id=` from
   Section 1's smart button must work.
2. **Contract Form** — duration, department, position, schedule, wage, salary structure,
   state.
3. **Concurrent-contract guard** — on save, call `check-overlap` and **block a second
   running contract covering the same dates**, with a message naming the conflicting
   contract. Enforce it server-side too, not only in the form. This is the rule payroll
   depends on; if it is loose, Section 3's demo breaks.
4. Zod validation: `end_date >= start_date`, `wage > 0`, structure required when `running`.

**Working schedules (A3)**

5. **Schedule List** — name, type, day count, and **weekly hours computed from the lines,
   never typed in**.
6. **Schedule Form** — add/remove day rows (day, start, end, break minutes) with the total
   weekly hours updating live as you edit. Reject `end_time <= start_time`.

**Attendance (B3)**

7. **Attendance List** — employee, check-in, check-out, worked hours, status. Filter by
   employee and status. Rows missing a check-out are visually flagged as exceptions.
8. **Attendance Form** — create and correct entries. Corrections set `manual_edit` and are
   restricted to HR Manager and above; an Employee may create their own entry but not edit
   anyone else's. Apply `scopeToSelf` on the list query so an Employee sees only their own.
9. **Check In / Check Out buttons** — one click; `/check-out` derives the status
   (> 9 h overtime, < 4 h half day).

**Time off (A4, B4)**

10. **Time Off Types config** — name, code, unit, requires allocation, requires approval,
    paid/unpaid, colour. Paid/unpaid is what drives the LOP deduction in payroll, so label
    it clearly.
11. **Allocations List + Form** — employee, type, amount, validity, state, with
    allocated / taken / remaining per row. Approve and refuse actions. An allocation counts
    toward a balance **only once approved**.
12. **Requests List** — employee, type, dates, duration, status. Filter by state, plus a
    "needs my approval" view.
13. **Request Form + approve/refuse workflow.** The server already refuses when the balance
    is short — **surface that error inline**, and show the balance dropping immediately
    after a successful approval.
14. **Balance widget** — remaining per type for the selected employee, reusable by
    Section 1's employee form.

### Done when

Allocate 18 PTO days → request 3 → approve → remaining goes 18 → 15 in the UI without a
refresh. Requesting 40 is rejected with the actual remaining balance in the message. A
second overlapping running contract is refused. A schedule's weekly hours change as you
edit its day rows and are never entered by hand.

---

# SECTION 3 — Payroll, Payslips & Reporting

**Owner:** _name_  ·  **Branches:** `feat/s3-*`

### Files you own

```
backend/src/routes/payroll.js
backend/src/routes/dashboard.js
backend/src/lib/payroll.js
backend/src/lib/pdf.js
backend/src/lib/mail.js
frontend/src/pages/payroll/*
frontend/src/pages/config/*
frontend/src/pages/Dashboard.jsx
```

### API you already have

```
GET/POST/PATCH/DELETE  /api/structures        GET /api/structures/:id/rules
GET/POST/PATCH/DELETE  /api/rules             ?structure_id=   POST /api/rules/preview
POST                   /api/payruns/eligible          wizard step 2 — creates nothing
POST                   /api/payruns/wizard            creates the batch + payslips
GET                    /api/payruns/:id/detail
POST                   /api/payruns/:id/compute  /validate  /mark-paid  /send-payslips
GET                    /api/payslips  ?payrun_id= &employee_id= &state=
GET                    /api/payslips/:id      POST /:id/compute   POST /:id/send
GET                    /api/payslips/:id/pdf
GET                    /api/dashboard   ?period_start= &period_end= &department_id= &employee_type=
```

**You are not blocked by Section 1.** One thing to handle when auth lands: the PDF route
is a browser navigation, not a `fetch`, so a Bearer header will not be attached. Either
open it via `fetch` + blob URL, or ask Section 1 for a short-lived signed download token.
**Agree this with Section 1 in hour 1** so it is not a surprise at hour 18.

### Build

**Salary configuration (A5, A6)**

1. **Salary Structure List + Form** — name, code, active, rule count, employee count. The
   form manages the included rules and their execution sequence.
2. **Salary Rule List + Form** — name, code, category, sequence, compute type, and then
   amount / percent base / formula depending on the type. Sequence must be reorderable,
   and the list must be sorted by it so the dependency order is visible.
3. **Rule preview panel** — call `/api/rules/preview` with a sample employee and period so
   the config screen shows what the rules actually produce. Guideline 3 says these screens
   must be functional, not mockups; this is how you prove it.
4. Guard rails: duplicate `code` within a structure is a `400`; a formula that throws
   already becomes a visible `formula error` line rather than a silent zero — surface it.

**Payrun wizard (B5)**

5. Clicking **NEW** opens a wizard modal and **does not create a record**.
6. **Step 1** — salary structure, period start/end, optional department and employee-type
   scope. Continue does not persist anything.
7. **Step 2** — eligible employees from `/eligible`, each with their contract, wage and
   blockers (no contract for the period, missing bank details, duplicate payslip).
   Checkbox selection, select-all, and a running count of the selection.
8. **Create Payrun** creates the batch containing only the selected employees and opens
   the processing view.

**Payrun processing (B6)**

9. Header: run name, structure, period, state badge, payslip count, total net.
10. Actions **Compute → Validate → Mark Paid → Send Payslips**, each disabled when the
    state machine does not allow it, each showing a pending state while it runs.
11. **Warnings panel** above the actions, grouped by employee. Error-level warnings block
    Validate; the button explains why it is disabled.
12. Finalised and paid payruns render read-only, preserved as history.

**Payslips (B7, B8)**

13. **Payslip screen** — employee, structure, payrun, period, state, worked days, and the
    **Salary Computation table**: every rule line with code, name, category and amount in
    sequence order, Gross and Net emphasised. Show which contract was used, so the
    period-based contract selection is visible to a judge.
14. **Print Payslip** → the PDF route. **Send Payslips** on the payrun for bulk email, with
    a per-employee result list (sent / skipped and why).
15. **Payslips list view** — standalone, filterable by payrun / employee / state. Apply
    `scopeToSelf` so an Employee sees only their own payslips.

**Dashboard (B9) — already built, extend it**

16. Make each operational alert click through to its module, pre-filtered.
17. Add the payroll-status breakdown (draft / computed / validated / paid) to the KPI row.
18. Confirm every filter combination still returns live numbers — no static charts.

### Done when

The wizard runs on the seeded draft payrun without creating anything until the final
click. Compute produces correct nets. A "missing bank details" warning blocks Validate;
fixing it unblocks. Mark Paid moves state. A payslip PDF opens with the full breakdown, and
Send Payslips reports per-employee results. The dashboard KPIs and trend line move after
the run.

---

# Timeline

| Hours | Section 1 | Section 2 | Section 3 | Hard gate |
|---|---|---|---|---|
| 0–1 | `npm run setup`, `npm run dev`, dashboard loads with real numbers | same | same | **Every dev pushes a commit.** Three names in the README, three branches on origin |
| 1–2 | **Auth migration + all routes registered in `App.jsx` and `index.js`, merged** | read `schema.sql`, agree the PDF-download approach with S3 | read `lib/payroll.js`, agree the PDF-download approach with S1 | Shared files frozen. Demo script written down. |
| 2–8 | Login, tokens, refresh, rate limit, lockout | Contract list + form + overlap guard | Structure + rules + preview | Each section has one screen working end to end |
| 8–14 | Route guards, role-gated nav, forced password change | Attendance list/form, schedules | Payrun wizard + processing screen | Each merged to `main` and working |
| 14–17 | User & role admin, employee kanban/list/form/smart buttons | Time off types, allocations, requests, approval | Payslip screen, PDF, bulk email | Every guard produces a readable error, never a 500 |
| 17–19 | Empty / loading / error states, 375 px check | same | same, plus dashboard polish | Demo works with wifi off |
| **19** | **FEATURE FREEZE** | | | `main` runs clean from a fresh `npm run setup` |
| 19–21 | Bug fixes only. Record a 90-second backup video. | | | Video saved on the demo laptop |
| 21–23 | Rehearse the demo three times, timed | | | Under 5 minutes, twice in a row |
| 23–24 | Buffer, future-roadmap slide | | | — |

---

# Demo script (5 minutes, two end-to-end scenarios)

**Open on the login screen.** Log in as the HR Manager — 10 seconds, and it sets up
everything that follows.

**Scenario 1 — Leave allocation to request (≈2 min, Section 2 drives)**
Dashboard shows pending requests → open an Employee → smart buttons show live counts →
Allocations: 18 PTO days approved → Requests: raise 3 days → approve → balance 18 → 15 →
try 40 days → rejected with the real balance in the message.

**Scenario 2 — Employee to payslip (≈3 min, Section 3 drives)**
Log out, log in as the Payroll Manager — **the nav is visibly different**, which is the
RBAC proof in one second. Payroll → NEW → wizard step 1 (Regular Salary, current month) →
step 2 shows eligible employees with blockers → select → Create Payrun → **Compute** →
payslip list with nets → open one payslip and walk the rule breakdown top to bottom
(Basic → allowances → Gross → deductions → Net), pointing out it used the **renewal**
contract, not the expired one → back to the payrun, warnings block **Validate** → fix the
bank detail → Validate → Mark Paid → **Print Payslip** PDF → **Send Payslips**.
Finish on the Dashboard: the new payrun has moved the KPIs and the trend line.

**If there is a spare 15 seconds:** log in as Priya (Employee) and show that Payroll is
gone from the nav and typing `/payroll` is refused.

---

# Risks

| Risk | Mitigation |
|---|---|
| Auth lands late and blocks everyone | The contract above is frozen at hour 0. Sections 2 and 3 keep using `x-user-id` until it merges; `api.js` swaps the header for them. |
| Everyone edits `App.jsx` at once | All seven routes registered in hour 0–2, then nobody touches it. |
| PDF download breaks under Bearer auth | Agreed between Sections 1 and 3 in hour 1, not discovered at hour 18. |
| Docker not running on the demo laptop | Start Docker Desktop before the demo; `npm run db:up` is on the checklist. |
| Payroll formulas silently return 0 | The engine records a `formula error` line instead of failing — check the payslip lines. |
| Seeded passwords leak into the repo | Dev passwords live in `.env.example` only; `.env` is gitignored. |
| Demo laptop pulls a broken `main` | After hour 19 nobody pulls to the demo laptop. |

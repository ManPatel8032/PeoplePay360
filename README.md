# PeoplePay360 — HR & Payroll

```
Problem:      HR data (employees, contracts, attendance, leave) lives in silos, so payroll
              is manual, error-prone, and blind to the context it depends on.
User:         HR Managers and Payroll Officers at a 50–500 person company.
Demo path:    Dashboard → Employee form → Time Off request + approve (balance drops)
              → Payrun wizard (scope → select employees) → Compute → warnings → Validate
              → Mark Paid → Payslip breakdown → Print PDF → Send Payslips.
Out of scope: real authentication, multi-company, multi-currency, mobile app.
```

## Team

| Dev | Section | Owns | Branches |
|---|---|---|---|
| _name_ | **1 — Identity, Access & Employee Master** | Login/tokens/RBAC enforcement, User & role admin, Employees (Kanban/List/Form), Departments, Positions | `feat/s1-*` |
| _name_ | **2 — Contracts, Time & Attendance** | Contracts + overlap guard, Working Schedules, Attendance, Time Off (types, allocations, requests) | `feat/s2-*` |
| _name_ | **3 — Payroll, Payslips & Reporting** | Salary Structures & Rules, Payrun wizard, Payrun processing, Payslips, PDF/email, Dashboard | `feat/s3-*` |

Full task breakdown, auth contract, endpoint list and acceptance checklists: **[PLAN.md](PLAN.md)**

**Hour 0–2 gate:** Section 1 lands the auth migration and registers every route in
`frontend/src/App.jsx` and `backend/src/index.js`. After that those two files are frozen and the three
sections never touch the same file again.

## Stack

| Layer | Choice |
|---|---|
| Frontend | Vite + React 18 + React Router + Recharts, plain CSS design tokens |
| Backend | Node 22 + Express 4 (ESM, `async/await`) |
| DB | **PostgreSQL 16** in Docker (`docker-compose.yml`), driver `pg` |
| PDF | `pdfkit` · Email | `nodemailer` (falls back to `backend/outbox/` with no SMTP) |

## File Structure

```
PeoplePay360/
├── backend/                  # Node.js + Express API server (port 3000)
│   ├── src/
│   │   ├── routes/           # Feature endpoints
│   │   │   ├── auth.js       # Authentication endpoints (Section 1)
│   │   │   ├── users.js      # User management endpoints (Section 1)
│   │   │   ├── employees.js  # Employee master endpoints (Section 1)
│   │   │   ├── contracts.js  # Contracts & overlap checks (Section 2)
│   │   │   ├── schedules.js  # Working schedules & hours (Section 2)
│   │   │   ├── attendance.js # Attendance & check-in/out (Section 2)
│   │   │   ├── timeoff.js    # Types, allocations, requests (Section 2)
│   │   │   ├── payroll.js    # Structures, rules, payruns, payslips (Section 3)
│   │   │   └── dashboard.js  # Live KPI aggregation (Section 3)
│   │   ├── lib/              # Shared helpers (crud, dates, payroll, mail, pdf)
│   │   ├── auth.js           # RBAC permission matrix & JWT auth
│   │   ├── db.js             # Postgres pool & transaction helpers
│   │   ├── index.js          # Express app entry & route mounting
│   │   ├── schema.sql        # PostgreSQL 16 schema & migrations
│   │   └── seed.js           # 6-month demo dataset
│   └── test/                 # Business logic test suite (`npm test`)
├── frontend/                 # React 18 + Vite client (port 5173)
│   ├── src/
│   │   ├── pages/            # Application screens
│   │   │   ├── auth/         # Login, change password, guards (Section 1)
│   │   │   ├── users/        # User & role administration (Section 1)
│   │   │   ├── employees/    # Employee list, kanban, form (Section 1)
│   │   │   ├── contracts/    # Contract list & overlap guard (Section 2)
│   │   │   ├── schedules/    # Working schedules & dynamic hours (Section 2)
│   │   │   ├── attendance/   # Attendance list, check-in/out (Section 2)
│   │   │   ├── timeoff/      # Requests, allocations, leave types (Section 2)
│   │   │   ├── payroll/      # Payrun wizard, processing, payslips (Section 3)
│   │   │   ├── config/       # Salary structures & rules (Section 3)
│   │   │   └── Dashboard.jsx # Live operational payroll dashboard (Section 3)
│   │   ├── components/       # Shared UI kit (`ui.jsx`, widgets)
│   │   ├── api.js            # Unified API fetch client & formatting helpers
│   │   ├── styles.css        # Shared design tokens & responsive CSS
│   │   ├── App.jsx           # Top-level routing shell & navigation
│   │   └── main.jsx          # React DOM root entry
└── docker-compose.yml        # PostgreSQL 16 container definition
```

## Run it

**Prerequisite: Docker Desktop must be running** (the DB lives in a container).

```bash
npm run setup
```

That does `docker compose up -d db`, `npm install`, and seeds the database. Then:

```bash
npm run dev
```

- API → http://localhost:3000 (health check: `/api/health`)
- App → http://localhost:5173

| Command | What it does |
|---|---|
| `npm run db:up` | start Postgres (host port **5433**) |
| `npm run seed` | seed, only if the DB is empty |
| `npm run reset` | drop everything, recreate schema, reseed |
| `npm run db:nuke` | remove the container **and its volume** |

Postgres runs on host port `5433` so it never clashes with a local install.
Connection string lives in `.env` (copy from `.env.example`).

## What the seed gives you

15 employees across 6 departments, contract history including a mid-period renewal
(so period-based contract selection is visible), 3 working schedules, 4 time-off types
with allocations, ~6 months of attendance, 5 paid monthly payruns plus **one draft
payrun for the current month** — that draft is what you Compute live during the demo.

### Org chart

Every employee reports to someone. The Managing Director is the single root — the only
person whose `manager_id` is NULL — and department heads report to her, so managers have
managers too. The database enforces this with a no-self-manager constraint and a
cycle-detection trigger; `employee_hierarchy` is a view giving each person's level, path
and direct-report count.

```
Rohini Deshpande  (MD)
├── Aarav Sharma      Engineering  → Priya, Rohan, Sneha, Tara
├── Vikram Rao        Sales        → Ananya, Kabir
├── Meera Joshi       HR           → Devansh
├── Arjun Patel       Finance      → Ishita
└── Nisha Verma       Operations   → Farhan
```

## Authentication & roles

Real login: bcrypt password hashing, a 15-minute JWT access token, an httpOnly refresh
cookie with rotation, rate limiting, and account lockout. Every route is guarded
server-side by the permission matrix in [`backend/src/auth.js`](backend/src/auth.js), and
the client hides nav items the current role cannot read.

### Seeded logins

All use the dev password from `.env.example` and are forced to change it at first login.

| Email | Role | Who they are |
|---|---|---|
| `admin@peoplepay360.com` | Admin | **No employee record** — an IT account with no contract or payslip |
| `rohini.deshpande@peoplepay360.com` | Admin | Managing Director, root of the org chart |
| `meera.joshi@peoplepay360.com` | HR Manager | Heads HR |
| `arjun.patel@peoplepay360.com` | Payroll Manager | Heads Finance |
| `ishita.banerjee@peoplepay360.com` | Payroll User | Reports to Arjun |
| `aarav.sharma@peoplepay360.com` | Employee | **Manages 4 people** |
| `vikram.rao@peoplepay360.com` | Employee | **Manages 2 people** |
| `nisha.verma@peoplepay360.com` | Employee | **Manages 1 person** |
| `priya.nair@peoplepay360.com` | Employee | Individual contributor |

**Employees and users are deliberately not one-to-one.** Seven employees have no login at
all — plenty of real staff are paid without ever signing in — and `admin@` is a user with
no employee record. Aarav, Vikram and Nisha manage teams while holding the plain
`employee` role, which is the clearest demonstration that **being a manager is a position
in the org chart, not a permission level**.

### Admin-only rules

Two rules sit above the role matrix, because the person who would normally hold the
permission has a conflict of interest ([`backend/src/lib/guards.js`](backend/src/lib/guards.js)):

1. **A manager's own attendance** can only be reviewed, corrected or deleted by an Admin —
   not by HR or a peer. "Manager" is derived live from direct reports.
2. **The pay of payroll staff** (`payroll_user`, `payroll_manager`) can only be set by an
   Admin. Non-pay contract edits stay open to HR, so this locks pay decisions rather than
   the whole record.

The full auth contract (endpoints, token rules, error shapes, schema additions) is frozen
in [PLAN.md](PLAN.md#auth-contract) so all three sections can build against it in parallel.

### User Provisioning

Self-service signup is disabled. All user accounts (employee, HR, payroll, and admin) are provisioned directly by an administrator via `/users`. Any navigation to `/signup` redirects to `/login`.

### Dev note

The API still honours an `x-user-id` header outside production
(`backend/src/auth.js`), which is handy for `curl`. The browser app no longer uses it —
`frontend/src/api.js` sends the Bearer token and refreshes transparently on a 401.
Downloads (the payslip PDF) go through `downloadFile()` as an authenticated blob, because a
plain link would not carry the header.

## Ground rules

1. **Branch per feature**, `feat/<track>-<thing>`. Never commit to `main` directly.
2. **Stay in your files.** The owner column above is the conflict-avoidance plan.
   Shared files — `App.jsx`, `index.js`, `schema.sql`, `styles.css` — announce in chat before editing, keep the edit to a few lines.
3. **Never invent a colour or spacing value.** Use the tokens in `frontend/src/styles.css`
   and the components in `frontend/src/components/ui.jsx`.
4. **Every list view ships loading / error / empty / data.** `<States>` gives you all four.
5. **Feature freeze at hour 19.** Bugs only after that.


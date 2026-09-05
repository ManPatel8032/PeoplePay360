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

14 employees across 5 departments, contract history including a mid-period renewal
(so period-based contract selection is visible), 3 working schedules, 4 time-off types
with allocations, ~6 months of attendance, 5 paid monthly payruns plus **one draft
payrun for the current month** — that draft is what you Compute live during the demo.

## Authentication & roles

Real login: bcrypt password hashing, a 15-minute JWT access token, an httpOnly refresh
cookie with rotation, rate limiting, and account lockout. Every route is guarded
server-side by the permission matrix in [`backend/src/auth.js`](backend/src/auth.js), and
the client hides nav items the current role cannot read.

Seeded accounts cover all five roles — Employee, HR Manager, Payroll User, Payroll
Manager, Admin. Dev passwords are in `.env.example`; the seeded accounts are forced to
change password on first login.

The full auth contract (endpoints, token rules, error shapes, schema additions) is frozen
in [PLAN.md](PLAN.md#auth-contract) so all three sections can build against it in parallel.

> Until Section 1 merges the auth work, the API still accepts the placeholder `x-user-id`
> header. `frontend/src/api.js` swaps it for the Bearer token when auth lands — no other
> file changes.

## Ground rules

1. **Branch per feature**, `feat/<track>-<thing>`. Never commit to `main` directly.
2. **Stay in your files.** The owner column above is the conflict-avoidance plan.
   Shared files — `App.jsx`, `index.js`, `schema.sql`, `styles.css` — announce in chat before editing, keep the edit to a few lines.
3. **Never invent a colour or spacing value.** Use the tokens in `frontend/src/styles.css`
   and the components in `frontend/src/components/ui.jsx`.
4. **Every list view ships loading / error / empty / data.** `<States>` gives you all four.
5. **Feature freeze at hour 19.** Bugs only after that.


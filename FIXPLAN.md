# PeoplePay360 — Remediation Plan (2 people)

Findings from a live audit of `main`. Every item below was reproduced against the
running API, not inferred from reading code.

**Split:** Person A owns `backend/`, Person B owns `frontend/`. One shared contract,
frozen up front, so both can start immediately without waiting for each other.

---

## Current state

| Area | Status |
|---|---|
| Payroll engine (rule sequencing, proration, contract-for-period) | ✅ correct |
| Payrun state machine, duplicate detection, warning gate | ✅ correct |
| Contract overlap guard | ✅ correct |
| Employee scoping on attendance / contracts / payslips / time-off | ✅ IDOR-safe |
| Auth (no enumeration, refresh rotation, lockout, 20/20 tests) | ✅ correct |
| **Employee attendance creation** | 🔴 500 crash |
| **4 single-record endpoints** | 🔴 500 crash |
| **Employee sees all staff + bank accounts** | 🔴 data leak |
| **HR Manager reads every payslip** | 🔴 spec violation |
| **UI never checks role** | 🔴 shows edit forms that 403 |
| **Admin cannot create users or assign roles** | 🔴 not implemented |
| **Employees + Users screens** | 🔴 still `<Placeholder>` |

---

## FROZEN CONTRACT — agree this in the first 15 minutes

Person B codes against this before Person A has finished building it.

### 1. Permission shape returned by `GET /api/auth/me`

The current linear rank ladder **cannot express the roles** (see Person A, task A1).
It is replaced by explicit per-role scopes. `/auth/me` returns:

```json
{
  "user": { "id": 5, "name": "...", "role": "employee", "employee_id": 2 },
  "permissions": {
    "employees":  { "read": "own",  "write": "none" },
    "contracts":  { "read": "own",  "write": "none" },
    "payslips":   { "read": "own",  "write": "none" },
    "payruns":    { "read": "none", "write": "none" }
  }
}
```

- `read` / `write` are each one of: **`"all"` | `"own"` | `"none"`**
- The object contains **every module key**, always — no missing keys to guard against
- Module keys: `employees, contracts, schedules, attendance, timeoff,
  timeoff_approve, allocations, payruns, payslips, structures, rules,
  dashboard, users`

### 2. Client helper Person B builds on it

```js
const { can } = useAuth();
can('contracts', 'write')        // -> 'all' | 'own' | 'none'
can('contracts', 'write') !== 'none'
```

### 3. User-management endpoints Person A adds

| Method | Path | Body |
|---|---|---|
| `GET` | `/api/users` | — (exists) |
| `POST` | `/api/users` | `{ name, email, role, employee_id?, password }` |
| `PATCH` | `/api/users/:id` | `{ role?, is_active?, employee_id? }` |
| `POST` | `/api/users/:id/reset-password` | `{ newPassword }` → sets `must_change_password` |

Admin only. Never returns `password_hash`. A user cannot change their own role or
deactivate themselves (prevents locking the last admin out).

### 4. Error shape (unchanged)

`{ "error": "...", "fields": { "work_email": ["Already in use"] } }`

---

# PERSON A — Backend: access control, crashes, validation

**Owns:** everything under `backend/`. Touches no frontend file.

### A1 · Replace the rank ladder with capability sets 🔴
`backend/src/auth.js`

The bug: `MATRIX` stores a *minimum role* on a linear ladder
`[employee, hr_manager, payroll_user, payroll_manager, admin]`. Employees must see
their own payslip, so `payslips.read` was set to `'employee'` — which automatically
grants it to **every higher rank, including HR Manager**.

**Verified:** HR Manager currently reads all 74 payslips — every salary in the company.
The PS says HR Manager has *"no access to payroll features."*

HR Manager and Payroll User are **siblings**, not rungs. Rewrite as per-role scopes:

```js
// module -> role -> { read, write }  each 'all' | 'own' | 'none'
payslips: {
  employee:        { read: 'own',  write: 'none' },
  hr_manager:      { read: 'none', write: 'none' },   // <- fixes the leak
  payroll_user:    { read: 'all',  write: 'all'  },
  payroll_manager: { read: 'all',  write: 'all'  },
  admin:           { read: 'all',  write: 'all'  },
}
```

Keep `can(module, action)` middleware signature identical so no route file changes.
Add a `scope(req, module, action)` helper returning `'all' | 'own' | 'none'`.

Target matrix (from the PS, section 3):

| Module | employee | hr_manager | payroll_user | payroll_manager | admin |
|---|---|---|---|---|---|
| employees | own / – | all / all | all / all | all / all | all / all |
| contracts | own / – | all / all | all / all | all / all | all / all |
| schedules | all / – | all / all | all / all | all / all | all / all |
| attendance | own / own | all / all | all / all | all / all | all / all |
| timeoff | own / own | all / all | all / all | all / all | all / all |
| timeoff_approve | – | all | all | all | all |
| allocations | own / – | all / all | all / all | all / all | all / all |
| payruns | – | **–** | all / all | all / all | all / all |
| payslips | **own / –** | **–** | all / all | all / all | all / all |
| structures | – | – | **all / –** | all / all | all / all |
| rules | – | – | **all / –** | all / all | all / all |
| dashboard | – | *decide* | all | all | all |
| users | – | – | – | – | all / all |

> **Decision needed:** should HR Manager see the Dashboard? It is titled *Payroll*
> Dashboard but also carries attendance and leave analytics. Currently 403.
> Recommend: give HR Manager a filtered view without salary figures, or leave blocked
> and say so on the roadmap slide.

**Done when:** HR Manager gets 403 on `/payslips`; employee still sees only their own.

---

### A2 · Fix the attendance crash 🔴 (one character)
`backend/src/routes/attendance.js:162`

```js
if (selfId) {
  employeeId = selfId;     // ReferenceError: employeeId is not defined
}
```

`employeeId` is never declared in that scope; the destructured variable is
`employee_id`. In ESM strict mode this throws.

**Verified:** an employee creating attendance gets `500 {"error":"employeeId is not
defined"}` — every time, with or without a body `employee_id`. This is one of only
**two** things the PS says an employee must be able to do.

Note the same line is the *only* thing forcing self-scope, so fixing the typo also
closes the hole where an employee could log attendance against someone else.

**Done when:** employee POSTs attendance → 201, and `employee_id` is forced to their own.

---

### A3 · Fix the 4 crashing detail endpoints 🔴 (one line)
`backend/src/lib/crud.js:37`

```js
const row = await one(`${itemSql || `SELECT * FROM ${table}`} WHERE ${table}.id = $1`, ...)
```

`itemSql` aliases the table (`FROM employees e`), so `WHERE employees.id` is invalid:

```
error: invalid reference to FROM-clause entry for table "employees"
hint: Perhaps you meant to reference the table alias "e".
```

**Verified 500 for every role:** `GET /employees/:id`, `/structures/:id`,
`/rules/:id`, `/payruns/:id`. Contracts/attendance/payslips escape only because they
hand-wrote their own `GET /:id`.

Fix: accept an `idColumn` option (e.g. `'e.id'`), defaulting to `` `${table}.id` ``.

**Done when:** all four return 200. This unblocks Person B's Employee Form,
Salary Structure form, Salary Rule form.

---

### A4 · Close the employee data leak 🔴
`backend/src/routes/employees.js` · `backend/src/routes/timeoff.js`

`employees.js` is the **only** route file that never imports `scopeToSelf`.

**Verified as an Employee:**
- `GET /employees` → 14 rows including **12 colleagues' bank account numbers**
- `GET /employees/:id/summary` → 200 for a colleague (their leave balances)
- `GET /time-off/requests/balances/1` → 200 for a colleague

Apply the `own` scope: an employee's list returns only themselves; `:id` and
`:id/summary` return 403 for anyone else; same for `balances/:employeeId`.
Also drop `bank_account` from list responses for anyone without `write` on employees.

**Done when:** employee sees exactly 1 row and 403 on every other person's record.

---

### A5 · Validation: stop leaking DB errors as 500s 🟠
`backend/src/routes/employees.js` · `backend/src/routes/payroll.js`

| Input | Now | Should be |
|---|---|---|
| `POST /employees {"name":null}` | **500** | 400 |
| `POST /employees` duplicate `work_email` | **500** | 400 with `fields` |
| `POST /rules {"category":"NONSENSE"}` | **500** | 400 |
| `POST /employees {"work_email":"not-an-email"}` | **201 accepted** | 400 |
| Duplicate structure/rule `code` | **500** | 400 |

Section 2 already does this properly (contracts, attendance, time-off return clean
400s) — copy that Zod pattern. Catch Postgres `23505` (unique) and `23514` (check)
and map to 400.

---

### A6 · User management API 🔴
`backend/src/routes/users.js`

`users.js` currently has **only a GET handler**. `POST /api/users` returns 404 for
every role including admin — so there is **no way to create a user or assign a role**
in the running system. The PS gives Admin *"user management, role assignment,
permission updates."*

Build the four endpoints in the frozen contract above. Guard: an admin cannot change
their own role or deactivate themselves.

---

### A7 · Security hardening 🟡

| Issue | Fix |
|---|---|
| Login limiter counts **successful** logins — 10/15 min per IP. I hit 429 three times just switching roles; a 5-role demo will lock you out. | `skipSuccessfulRequests: true` |
| `x-user-id` header still accepted when `NODE_ENV !== 'production'` — full impersonation if the var is ever unset | Gate behind an explicit `ALLOW_DEV_AUTH=1`, or delete it |
| `JWT_SECRET` silently falls back to a hardcoded dev string | Fail loudly on boot in every env except test |
| `backend/outbox/` is untracked and not ignored (`.gitignore` has `payslips-out/`, wrong name) | Add `backend/outbox/` |
| All 5 seeded accounts have `must_change_password = true` — five password changes before you can demo | Seed only the admin with it, or add `SEED_FORCE_PASSWORD_CHANGE=false` |

---

### Person A verification

```bash
npm run reset && npm test
```

Then confirm, as each role:

- [ ] HR Manager → `GET /payslips` = **403**
- [ ] Employee → `GET /employees` returns **1** row, no `bank_account` on others
- [ ] Employee → `POST /attendance` = **201**, forced to own `employee_id`
- [ ] `GET /employees/1`, `/structures/1`, `/rules/1`, `/payruns/1` = **200**
- [ ] Admin → `POST /api/users` creates a user with a role
- [ ] Bad input returns **400** with `fields`, never 500
- [ ] 15 logins in a row do not trigger 429

---

# PERSON B — Frontend: role gating, Employees, Users

**Owns:** everything under `frontend/`. Touches no backend file.

### B1 · Add `can()` to the auth context 🔴
`frontend/src/auth/AuthContext.jsx`

`canRead` exists but **nothing in the app uses it**, and there is no write equivalent.
Add:

```js
can(module, action)  // -> 'all' | 'own' | 'none'
```

reading the `permissions` object from the frozen contract. Export it from `useAuth()`.

**You are not blocked:** until Person A ships, hardcode the target matrix table from
task A1 as a local fallback and swap to the server response when it lands.

---

### B2 · Gate every write control 🔴 — the headline bug
`contracts/` · `attendance/` · `timeoff/` · `schedules/` · `payroll/` · `config/`

```
grep -rn "useAuth|canRead|user.role" pages/ components/   →   NONE outside pages/auth/
```

**No page in the app consults the role.** Every page renders `+ New Contract`,
`onRowClick={openEditModal}`, and Approve/Refuse unconditionally.

**Verified:** as Priya (Employee) you can open her contract, see a form **pre-filled
with her ₹95,000 wage**, edit it, and hit Save — the server correctly returns 403 and
nothing changes, but the app looks broken. To a judge clicking around it reads as an
access-control failure.

For every page:

1. Hide `+ New …` when `can(mod,'write') === 'none'`
2. Row click opens a **read-only detail view**, not the edit modal, when write is denied
3. Hide Approve / Refuse unless `can('timeoff_approve','write') !== 'none'`
4. Hide Compute / Validate / Mark Paid / Send unless `can('payruns','write') !== 'none'`
5. Salary Structures & Rules render read-only for Payroll User (they have read, not write)
6. Any 403 that still slips through shows a toast, never a blank screen

Pages to cover: `ContractsPage`, `AttendancePage`, `TimeOffPage`, `SchedulesPage`,
`PayrunDetail`, `PayrunList`, `PayrunWizardModal`, `PayslipDetail`, `PayslipList`,
`SalaryStructures`, `SalaryRules`.

**Done when:** logged in as Employee, no button anywhere can start an action that 403s.

---

### B3 · Build the Employees module 🔴
`frontend/src/pages/employees/*` — currently `<Placeholder>`

The PS calls the Employee record *"the central hub"*; it is the largest missing piece.

- **List view** — name, department, position, manager, type, status; filters for
  department / status / type; search
- **Kanban view** — same data grouped by department, one header toggles List ⇄ Kanban
- **Employee Form** — identity, work email, phone, department, position, manager,
  schedule, employee type, status, bank account, join date
- **Smart buttons** — Contracts / Attendance / Time Off / Allocations / Payslips with
  live counts from `GET /employees/:id/summary`, each linking to that module
  pre-filtered by `?employee_id=`
- **Leave balance panel** from `summary.balances` (reuse `LeaveBalanceWidget`)
- **Employee self-view** — when `can('employees','read') === 'own'`, skip the list and
  land straight on their own record, read-only

> Depends on Person A's task A3 for `GET /employees/:id`. Until it lands, read the
> single record from the list response so you are never blocked.

---

### B4 · Build the Users admin screen 🔴
`frontend/src/pages/users/*` — currently `<Placeholder>`

Admin only. List users with role, linked employee, active flag, last login. Create a
user, assign a role, link to an employee, deactivate, trigger a password reset.
Never render `password_hash`. Uses Person A's task A6 endpoints.

---

### B5 · Polish 🟡

- Every list view ships loading / error / empty / data — `<States>` gives all four
- Check 375 px: no horizontal scroll, tables inside `overflow-x: auto`
- The `Show/Hide` password toggle and strength meter already exist — reuse, don't rebuild
- Nav already hides unreadable modules; confirm it still does after B1

---

### Person B verification

Log in as each of the five seeded accounts and confirm:

- [ ] **Employee** — sees only Attendance, Time Off, Contracts, Schedules, own record;
      no `+ New`, no Edit, no Approve anywhere; contract opens read-only
- [ ] **HR Manager** — full HR CRUD, Approve/Refuse visible; no Payroll or Config in nav
- [ ] **Payroll User** — payruns work; Structures and Rules render **read-only**
- [ ] **Payroll Manager** — can create structures and rules
- [ ] **Admin** — Users screen works: create a user, assign a role, deactivate
- [ ] Employees Kanban ⇄ List toggles; smart-button counts are live
- [ ] No screen 403s from a button the user could see

---

## Shared files — the only conflict risk

| File | Rule |
|---|---|
| `frontend/src/auth/AuthContext.jsx` | **Person B only** |
| `backend/src/auth.js` | **Person A only** |
| `frontend/src/App.jsx` | Person B, and only to swap the two `<Placeholder>` routes |
| `README.md` / this file | Announce in chat before editing |

Everything else is single-owner by directory: A = `backend/`, B = `frontend/`.

Branch per task: `fix/a1-capability-matrix`, `fix/b2-role-gating`, …
Never push to `main`. Merge `main` into your branch at least twice a day.

---

## Suggested order

**Hour 0–0.25** — both: agree the frozen contract above. Nothing else starts first.

| | Person A | Person B |
|---|---|---|
| 1st | **A2 + A3** (one character + one line, unblocks B) | **B1** `can()` with the hardcoded fallback |
| 2nd | **A1** capability matrix | **B2** gate every write control ← *biggest visible win* |
| 3rd | **A4** employee scoping | **B3** Employees list + Kanban |
| 4th | **A6** users API | **B3** Employee Form + smart buttons |
| 5th | **A5** validation | **B4** Users admin screen |
| 6th | **A7** hardening | **B5** polish, four states, 375 px |

A2 and A3 are two characters and one line between them, and they fix four crashing
endpoints plus a core PS requirement — do them before anything else.

**Before the demo:** `npm run reset`, then walk both scenarios end to end as at least
two different roles. Logging out and back in as a different role is the strongest
single proof of RBAC you can show a judge — the nav visibly changes.

# PeoplePay360 — 5-Minute Demo Script

Two end-to-end scenarios in one continuous take:

**A. Leave allocation → request → approval → balance drop**
**B. Employee → contract → payrun → payslip → PDF → email**

Target: **5:00**. The budget below totals 4:55, leaving five seconds of slack.

---

## 0. Before you hit record (do this ~20 minutes ahead)

### Environment

```bash
npm run reset
```

```bash
npm run dev
```

- API → http://localhost:3000/api/health — confirm it returns OK before recording
- App → http://localhost:5173

Docker Desktop must already be running. If `npm run reset` fails, the DB container is down.

### Browser prep

- Chrome, **new profile or incognito**, zoom **100%**, window **1600×900** or larger.
- Close every other tab. Hide the bookmarks bar (`Ctrl+Shift+B`).
- Turn on Windows Focus Assist — a Slack toast mid-take kills the run.

### Pre-warm the demo (the step people skip and regret)

Log in once as each account you'll use, so the **forced password change** is already done.
Seeded accounts start with `Password123!` and `must_change_password = true`. Hitting that
screen on camera costs you twenty seconds and the flow.

| Account | Role | Used for |
|---|---|---|
| `meera.joshi@peoplepay360.com` | HR Manager | Employees, contracts, time off, attendance |
| `arjun.patel@peoplepay360.com` | Payroll Manager | Configuration, payrun, payslips, dashboard |

Set both to the **same** new password so you never fumble the second login.

### Pre-position the tabs

- **Tab 1** — logged in as Meera, parked on `/employees`
- **Tab 2** — logged in as Arjun, parked on `/dashboard`

Two browser profiles (or one normal + one incognito) are needed for two simultaneous
sessions. If that's fiddly, do a single-session take and log out/in once at 2:45 — budget
eight extra seconds for it.

### Know your data before you speak

Write these on a sticky note; you reference all three out loud:

- The **draft payrun for the current month** — the seed creates exactly one, and that's the one you Compute live.
- One employee with a **mid-period contract renewal** — the money shot for "the right contract for the period".
- A leave type that **requires allocation**, so the balance visibly drops.

### Recording

- OBS or Windows Game Bar, 1080p, 30fps.
- Record video and audio in one take if you're confident. Otherwise capture silent screen
  video and lay narration over it — far more forgiving, since you can scrub past a slow
  API call.
- Move the mouse deliberately. Click, **pause half a second**, then talk. Don't narrate
  while clicking.

---

## 1. The script

Timings are cumulative. Narration is written for ~150 wpm — conversational pace.

---

### [0:00 – 0:20] Cold open — the problem

**On screen:** Login page at `/login`. Don't type yet.

> "HR data usually lives in silos. Employees in one system, contracts in a spreadsheet,
> attendance somewhere else, leave in email. So payroll ends up manual, error-prone, and
> blind to the context it depends on.
>
> PeoplePay360 is one system where payroll is computed *from* that context, not typed in
> beside it. Two complete flows."

**Do:** Log in as `meera.joshi@peoplepay360.com`.

---

### [0:20 – 0:45] Identity and access

**On screen:** Land on `/dashboard`, then gesture at the top nav.

> "Real authentication — bcrypt hashing, a short-lived JWT with an httpOnly refresh cookie,
> rate limiting, lockout. Every route is guarded server-side by a permission matrix, not
> just hidden in the UI.
>
> I'm Meera, HR Manager. Watch the nav: Employees, Contracts, Attendance, Time Off. Notice
> what I *can't* see."

**Do:** Click the avatar top-right to show the role badge. Close it.

> "One detail worth calling out: being a manager is a position in the org chart, not a
> permission level. Three of our employees manage teams while holding the plain employee
> role."

---

### [0:45 – 1:25] Scenario A, part 1 — the employee hub

**Do:** Click **Employees**.

> "Employees are the central hub. Same data, two views —"

**Do:** Click the **Kanban** toggle. Let it render. Pause.

> "— Kanban for status at a glance, and List for sorting, filtering, and bulk scanning."

**Do:** Click back to **List**, then into one employee to open the detail view.

> "Each employee carries their department, position, manager, and contract history."

**Do:** Click **Contracts** in the nav. Find the employee with the renewal.

> "Contracts are where payroll gets its terms. This person has an expired contract *and* a
> renewal — and the system won't let two contracts overlap. That matters in about ninety
> seconds, because payroll picks the contract covering the period being paid. Run an older
> month and you get the old wage. Automatically."

---

### [1:25 – 2:20] Scenario A, part 2 — allocation to approval

**Do:** Click **Time Off**, then the **Allocations** tab.

> "Time off starts with leave types — paid or unpaid, whether they need an allocation,
> whether they need approval. Then you allocate balances."

**Do:** Point at a row showing Allocated / Taken / **Remaining**. Say the remaining number out loud.

> "Priya has *[N]* days remaining on annual leave. Remember that number."

**Do:** Switch to the **Requests** tab. Create a request for that employee — type, dates,
reason, submit.

> "Now a request comes in against that allocation."

**Do:** Approve it from the row action.

> "I approve it as HR —"

**Do:** Switch back to **Allocations**.

> "— and the balance drops to *[N minus days]*. Taken goes up, remaining comes down. No
> second system, no reconciliation. That approved leave is now a fact the payroll engine
> reads."

**Do:** Click **Attendance**. Scroll once.

> "Same story for attendance — daily presence, exceptions, and authorized users can verify
> and correct entries. Six months of it seeded here."

---

### [2:20 – 2:45] Payroll configuration

**Do:** Switch to the Arjun tab. Click **Configuration** → Salary Structures, then Salary Rules.

> "Before payroll runs, you define *how* pay is computed. A salary structure is an ordered
> list of rules — fixed amounts, percentages, or formulas.
>
> The ordering is the whole point. Net Salary is 'gross minus total deductions' at sequence
> two hundred, which only produces the right number because PF, professional tax, TDS and
> loss-of-pay ran at one-ten through one-forty first. A formula can reference any rule that
> already ran, or a running category total."

---

### [2:45 – 4:05] Scenario B — payrun to payslip

**Do:** Click **Payroll** → **Payruns** tab → **New Payrun**.

> "Now the payrun. A payroll officer defines the scope first."

**Do:** Step 1 — pick the salary structure, set period start and end for the current month,
optionally scope to a department.

> "Structure, period, and optionally a department or employee type."

**Do:** Continue to Step 2. Let the eligible list load.

> "Step two fetches everyone eligible, with their wage and any blockers. Someone with no
> valid contract for this period surfaces as a warning right here — before you've computed
> anything."

**Do:** Point at a warning row if one is present. Select employees. Create the payrun.

**Do:** On the payrun detail, click **Compute All**. Wait for it.

> "Compute. For each employee the engine pulls three things: the contract that actually
> covers this period, the period statistics — worked days, attended days, overtime, paid and
> unpaid leave — and then the structure's rules, in sequence."

**Do:** Open one payslip.

> "The breakdown, rule by rule, in the order they ran. Basic, allowances, gross, each
> deduction, then net."

**Do:** Scroll to the warnings block and the contract/period panel.

> "It shows which contract it used, and flags anything worth a human look. That's the review
> step before you commit."

**Do:** Back to the payrun. Click **Validate**, confirm.

> "Validate locks the run. No further edits."

**Do:** Click **Mark Paid**, confirm.

> "Mark paid, and it becomes a historical record."

**Do:** Open a payslip → **Download PDF**. Show it. Close it.

> "Individual payslip PDFs —"

**Do:** Back on the payrun, click **Send Payslips**.

> "— and distribution by email. With no SMTP configured it writes to an outbox folder, so
> the demo never depends on a mail server."

---

### [4:05 – 4:30] The dashboard closes the loop

**Do:** Click **Dashboard**. Let the charts render.

> "Everything we just did lands here. This aggregates live across all three modules — total
> net paid, average salary, headcount, approved time off, attendance health, missing
> check-outs, overtime, open alerts. Salary cost by department, the monthly net trend, and
> operational alerts telling you what needs attention."

**Do:** Change one filter — department or period. Let it re-query.

> "Filtered on the fly. This is the view HR and finance actually ask for, and it's real
> data, not a mock."

---

### [4:30 – 4:55] Roadmap and close

**On screen:** Stay on the dashboard, or cut to a single roadmap slide.

> "What we'd build next, in priority order.
>
> **One — SSO and multi-factor auth.** The auth foundation is real, but SSO, MFA, email
> verification and a login audit trail were deliberately out of scope.
>
> **Two — statutory reporting and compliance exports.** The rule engine already produces the
> numbers; the filings are the next layer on top.
>
> **Three — an employee self-service portal.** Payslip history, leave balance, and requests
> from the employee's own login.
>
> **Four — multi-company and multi-currency**, which is the main thing between this and a
> real deployment.
>
> That's PeoplePay360 — one system, from employee record to paid payslip. Thanks."

---

## 2. Shot list (for editing)

| # | Time | Screen | Must be visible |
|---|---|---|---|
| 1 | 0:00 | `/login` | Branding |
| 2 | 0:20 | `/dashboard` + nav | Role badge in the account menu |
| 3 | 0:45 | `/employees` | **Kanban** and **List** toggles, both used |
| 4 | 1:05 | Employee detail | Department, position, manager |
| 5 | 1:10 | `/contracts` | The renewal pair — expired plus active |
| 6 | 1:25 | `/time-off?tab=allocations` | Allocated / Taken / **Remaining** |
| 7 | 1:45 | `/time-off?tab=requests` | Create, then approve |
| 8 | 2:05 | Allocations again | **Remaining has changed** — the key frame of Scenario A |
| 9 | 2:10 | `/attendance` | Records with exceptions |
| 10 | 2:20 | `/config` | Salary rules with the **sequence** column |
| 11 | 2:45 | Payrun wizard, step 1 | Structure and period |
| 12 | 2:55 | Payrun wizard, step 2 | Eligible list **including a blocker or warning** |
| 13 | 3:15 | Payrun detail | **Compute All**, then the computed state |
| 14 | 3:30 | Payslip detail | Rules **in sequence**, contract used, warnings |
| 15 | 3:50 | Payrun detail | Validate → Mark Paid transition |
| 16 | 3:55 | PDF | The actual rendered payslip |
| 17 | 4:00 | Send payslips | Confirmation message |
| 18 | 4:05 | `/dashboard` | KPI row, both charts, alerts |
| 19 | 4:30 | Roadmap | Four bullets |

---

## 3. Cut list — if you run long

Drop in this order. Each is self-contained.

1. **Attendance browse** (2:10) — saves 10s. The payslip already proves attendance feeds payroll.
2. **Employee detail view** (1:05) — saves 12s. Go Kanban → List → straight to Contracts.
3. **Dashboard filter change** (4:20) — saves 10s. A static dashboard still lands the point.
4. **Configuration screen** (2:20) — saves 25s, but costly: you lose the "sequence is the
   whole point" explanation and the payslip breakdown has to carry it alone. Last resort.

**Never cut:** the balance dropping after approval (shot 8), the eligible-list warning
(shot 12), or the payslip line-by-line breakdown (shot 14). Those three are the demo.

---

## 4. Failure drills

| If this happens | Do this |
|---|---|
| Compute is slow | Keep talking through the three inputs — that narration covers ~8s of latency by design |
| A 401 mid-demo | The token refreshes transparently; if it doesn't, the second tab is already logged in |
| Payrun already computed | You reset the DB, right? If not, create a fresh payrun for a *previous* month — that also demonstrates old-contract selection |
| Email send errors | Say "with no SMTP it writes to the outbox" and move on — that's the designed behaviour, not a bug |
| PDF won't open | Skip it. "PDFs download as an authenticated blob," and continue |

---

## 5. One-take checklist

- [ ] `npm run reset`, then `npm run dev`; `/api/health` returns OK
- [ ] Both demo accounts past the forced password change, same password
- [ ] Two tabs pre-positioned — Meera on `/employees`, Arjun on `/dashboard`
- [ ] Sticky note with the draft payrun month, the renewal employee's name, the leave balance number
- [ ] Notifications off, bookmarks hidden, zoom at 100%
- [ ] Mic level tested — record ten seconds and play it back
- [ ] Stopwatch visible on a second monitor or a phone in view

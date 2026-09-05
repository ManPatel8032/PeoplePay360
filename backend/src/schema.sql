-- PeoplePay360 schema (PostgreSQL 16)
-- Idempotent: safe to run on every boot.

-- ============ ORG / MASTER DATA ============
CREATE TABLE IF NOT EXISTS departments (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job_positions (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============ WORKING SCHEDULES (A3) ============
CREATE TABLE IF NOT EXISTS working_schedules (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  type       TEXT NOT NULL DEFAULT 'full_time' CHECK (type IN ('full_time','part_time','flexible')),
  timezone   TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Weekly pattern. hours_per_week is DERIVED from these lines, never stored.
CREATE TABLE IF NOT EXISTS schedule_lines (
  id            SERIAL PRIMARY KEY,
  schedule_id   INTEGER NOT NULL REFERENCES working_schedules(id) ON DELETE CASCADE,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),   -- 0 = Sunday
  start_time    TEXT NOT NULL,                                            -- 'HH:MM'
  end_time      TEXT NOT NULL,
  break_minutes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_schedline_sched ON schedule_lines(schedule_id);

-- ============ EMPLOYEES (A1) ============
CREATE TABLE IF NOT EXISTS employees (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  work_email      TEXT UNIQUE,
  phone           TEXT,
  department_id   INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  job_position_id INTEGER REFERENCES job_positions(id) ON DELETE SET NULL,
  manager_id      INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  schedule_id     INTEGER REFERENCES working_schedules(id) ON DELETE SET NULL,
  employee_type   TEXT NOT NULL DEFAULT 'full_time' CHECK (employee_type IN ('full_time','part_time','contract','intern')),
  status          TEXT NOT NULL DEFAULT 'active'    CHECK (status IN ('active','on_leave','inactive')),
  bank_account    TEXT,                                  -- NULL => payroll warning
  join_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emp_dept   ON employees(department_id);
CREATE INDEX IF NOT EXISTS idx_emp_status ON employees(status);

-- ============ USERS / RBAC (Section 1) ============
CREATE TABLE IF NOT EXISTS users (
  id                   SERIAL PRIMARY KEY,
  name                 TEXT NOT NULL,
  email                TEXT NOT NULL UNIQUE,
  password_hash        TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('employee','hr_manager','payroll_user','payroll_manager','admin')),
  employee_id          INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  failed_attempts      INTEGER NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- ============ REFRESH TOKENS (Section 1) ============
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,   -- store the hash, never the token
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);

-- ============ SALARY CONFIG (A5, A6) ============
CREATE TABLE IF NOT EXISTS salary_structures (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  code       TEXT NOT NULL UNIQUE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS salary_rules (
  id           SERIAL PRIMARY KEY,
  structure_id INTEGER NOT NULL REFERENCES salary_structures(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  code         TEXT NOT NULL,                    -- other rules reference this code
  category     TEXT NOT NULL CHECK (category IN ('BASIC','ALW','GROSS','DED','NET')),
  sequence     INTEGER NOT NULL DEFAULT 100,     -- execution order
  compute_type TEXT NOT NULL CHECK (compute_type IN ('fixed','percent','formula')),
  amount       NUMERIC(14,2) NOT NULL DEFAULT 0, -- fixed: amount; percent: rate (20 = 20%)
  percent_base TEXT,                             -- percent: a rule code or a category (e.g. 'BASIC')
  formula      TEXT,                             -- formula: expression over the payroll context
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (structure_id, code)
);
CREATE INDEX IF NOT EXISTS idx_rule_struct ON salary_rules(structure_id, sequence);

-- ============ CONTRACTS (A2) ============
CREATE TABLE IF NOT EXISTS contracts (
  id              SERIAL PRIMARY KEY,
  employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  start_date      DATE NOT NULL,
  end_date        DATE,                          -- NULL = open ended
  department_id   INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  job_position_id INTEGER REFERENCES job_positions(id) ON DELETE SET NULL,
  schedule_id     INTEGER REFERENCES working_schedules(id) ON DELETE SET NULL,
  wage            NUMERIC(14,2) NOT NULL DEFAULT 0,
  structure_id    INTEGER REFERENCES salary_structures(id) ON DELETE SET NULL,
  state           TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('draft','running','expired','cancelled')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_contract_emp ON contracts(employee_id, start_date DESC);

-- ============ ATTENDANCE (B3) ============
CREATE TABLE IF NOT EXISTS attendance (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  check_in    TIMESTAMPTZ NOT NULL,
  check_out   TIMESTAMPTZ,                       -- NULL => missing-checkout exception
  status      TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present','late','absent','overtime','half_day')),
  manual_edit BOOLEAN NOT NULL DEFAULT FALSE,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (check_out IS NULL OR check_out >= check_in)
);
CREATE INDEX IF NOT EXISTS idx_att_emp ON attendance(employee_id, check_in DESC);
CREATE INDEX IF NOT EXISTS idx_att_in  ON attendance(check_in);

-- ============ TIME OFF (A4, B4) ============
CREATE TABLE IF NOT EXISTS time_off_types (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL UNIQUE,
  code                TEXT NOT NULL UNIQUE,
  unit                TEXT NOT NULL DEFAULT 'day' CHECK (unit IN ('day','hour')),
  requires_allocation BOOLEAN NOT NULL DEFAULT TRUE,
  requires_approval   BOOLEAN NOT NULL DEFAULT TRUE,
  is_paid             BOOLEAN NOT NULL DEFAULT TRUE,   -- unpaid => LOP deduction in payroll
  color               TEXT NOT NULL DEFAULT '#4f46e5',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS allocations (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type_id     INTEGER NOT NULL REFERENCES time_off_types(id) ON DELETE CASCADE,
  amount      NUMERIC(10,2) NOT NULL DEFAULT 0,
  state       TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','approved','refused')),
  valid_from  DATE NOT NULL,
  valid_to    DATE,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alloc_emp ON allocations(employee_id, type_id);

CREATE TABLE IF NOT EXISTS time_off_requests (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  type_id     INTEGER NOT NULL REFERENCES time_off_types(id) ON DELETE RESTRICT,
  date_from   DATE NOT NULL,
  date_to     DATE NOT NULL,
  duration    NUMERIC(10,2) NOT NULL DEFAULT 1,
  state       TEXT NOT NULL DEFAULT 'to_approve' CHECK (state IN ('draft','to_approve','approved','refused','cancelled')),
  reason      TEXT,
  approver_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (date_to >= date_from)
);
CREATE INDEX IF NOT EXISTS idx_tor_emp   ON time_off_requests(employee_id, date_from DESC);
CREATE INDEX IF NOT EXISTS idx_tor_state ON time_off_requests(state);

-- ============ PAYROLL (B5, B6, B7) ============
CREATE TABLE IF NOT EXISTS payruns (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  structure_id  INTEGER NOT NULL REFERENCES salary_structures(id) ON DELETE RESTRICT,
  period_start  DATE NOT NULL,
  period_end    DATE NOT NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  state         TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','computed','validated','paid','cancelled')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_payrun_period ON payruns(period_start);

CREATE TABLE IF NOT EXISTS payslips (
  id           SERIAL PRIMARY KEY,
  payrun_id    INTEGER NOT NULL REFERENCES payruns(id) ON DELETE CASCADE,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  contract_id  INTEGER REFERENCES contracts(id) ON DELETE SET NULL,
  structure_id INTEGER REFERENCES salary_structures(id) ON DELETE SET NULL,
  period_start DATE NOT NULL,
  period_end   DATE NOT NULL,
  worked_days  NUMERIC(8,2) NOT NULL DEFAULT 0,
  leave_days   NUMERIC(8,2) NOT NULL DEFAULT 0,
  gross        NUMERIC(14,2) NOT NULL DEFAULT 0,
  net          NUMERIC(14,2) NOT NULL DEFAULT 0,
  state        TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','computed','validated','paid','cancelled')),
  warnings     JSONB NOT NULL DEFAULT '[]'::jsonb,
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (payrun_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_slip_emp ON payslips(employee_id, period_start DESC);
CREATE INDEX IF NOT EXISTS idx_slip_run ON payslips(payrun_id);

-- A payroll period runs forwards. Added separately from CREATE TABLE so that
-- databases created before this rule pick it up on the next boot.
DO $do$ BEGIN
  ALTER TABLE payruns  ADD CONSTRAINT payruns_period_order  CHECK (period_end >= period_start);
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE payslips ADD CONSTRAINT payslips_period_order CHECK (period_end >= period_start);
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

CREATE TABLE IF NOT EXISTS payslip_lines (
  id         SERIAL PRIMARY KEY,
  payslip_id INTEGER NOT NULL REFERENCES payslips(id) ON DELETE CASCADE,
  rule_id    INTEGER REFERENCES salary_rules(id) ON DELETE SET NULL,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL,
  sequence   INTEGER NOT NULL,
  amount     NUMERIC(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_line_slip ON payslip_lines(payslip_id, sequence);

-- ============ ORG HIERARCHY INTEGRITY ============
-- Every employee reports to exactly one manager. The single exception is the
-- root of the org (the MD), whose manager_id is NULL. Managers themselves have
-- managers, so the chain always terminates at that one root.

-- Nobody may manage themselves. Added defensively so re-running is safe.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employees_no_self_manager'
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT employees_no_self_manager
      CHECK (manager_id IS NULL OR manager_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_emp_manager ON employees(manager_id);

/*
 * Reject reporting cycles (A -> B -> A). Without this, one bad edit in the
 * employee form makes every org-chart query and payroll roll-up loop forever.
 */
CREATE OR REPLACE FUNCTION employees_check_manager_cycle() RETURNS trigger AS $$
DECLARE
  cursor_id INTEGER;
  hops      INTEGER := 0;
BEGIN
  IF NEW.manager_id IS NULL THEN
    RETURN NEW;
  END IF;

  cursor_id := NEW.manager_id;
  WHILE cursor_id IS NOT NULL LOOP
    IF cursor_id = NEW.id THEN
      RAISE EXCEPTION 'Manager assignment creates a reporting cycle for employee %', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;

    hops := hops + 1;
    IF hops > 100 THEN
      RAISE EXCEPTION 'Reporting chain exceeds 100 levels — probable cycle'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT manager_id INTO cursor_id FROM employees WHERE id = cursor_id;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_employees_manager_cycle ON employees;
CREATE TRIGGER trg_employees_manager_cycle
  BEFORE INSERT OR UPDATE OF manager_id ON employees
  FOR EACH ROW EXECUTE FUNCTION employees_check_manager_cycle();

/*
 * Convenience view: who reports to whom, plus how deep in the org each person
 * sits. Used by the org chart and by the "is this person a manager" checks.
 */
CREATE OR REPLACE VIEW employee_hierarchy AS
WITH RECURSIVE chain AS (
  SELECT e.id, e.name, e.manager_id, 1 AS level, e.name::text AS path
    FROM employees e
   WHERE e.manager_id IS NULL
  UNION ALL
  SELECT e.id, e.name, e.manager_id, c.level + 1, c.path || ' > ' || e.name
    FROM employees e
    JOIN chain c ON e.manager_id = c.id
)
SELECT c.id, c.name, c.manager_id, c.level, c.path,
       (SELECT COUNT(*) FROM employees r WHERE r.manager_id = c.id)::int AS direct_reports
  FROM chain c;

-- ============ EMPLOYEE NUMBER ============
-- Human-readable staff code shown on every employee-facing table. Derived from
-- the primary key so it can never drift or need maintaining.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'employees' AND column_name = 'employee_number'
  ) THEN
    ALTER TABLE employees
      ADD COLUMN employee_number TEXT
      GENERATED ALWAYS AS ('EMP-' || LPAD(id::text, 4, '0')) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_emp_number ON employees(employee_number);

/*
 * Everyone at or below a given employee in the reporting chain.
 * A manager sees their whole subtree, not just direct reports, so a department
 * head still sees the people under their team leads.
 */
CREATE OR REPLACE FUNCTION employee_subtree(root_id INTEGER)
RETURNS TABLE (id INTEGER) AS $$
  WITH RECURSIVE tree AS (
    SELECT e.id FROM employees e WHERE e.id = root_id
    UNION ALL
    SELECT e.id FROM employees e JOIN tree t ON e.manager_id = t.id
  )
  SELECT tree.id FROM tree;
$$ LANGUAGE sql STABLE;

-- ============ PAYRUN & PAYSLIP IMMUTABILITY GUARDS ============
-- Prevents updating or deleting validated/paid payruns and payslips directly in SQL.
CREATE OR REPLACE FUNCTION trg_lock_validated_payrun()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state IN ('validated', 'paid') THEN
      RAISE EXCEPTION 'Cannot delete a % payrun — it is a historical record', OLD.state;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.state IN ('validated', 'paid') THEN
      -- Allow transitioning from validated -> paid
      IF OLD.state = 'validated' AND NEW.state = 'paid'
         AND NEW.name = OLD.name
         AND NEW.structure_id = OLD.structure_id
         AND NEW.period_start = OLD.period_start
         AND NEW.period_end = OLD.period_end
         AND (NEW.department_id IS NOT DISTINCT FROM OLD.department_id) THEN
        RETURN NEW;
      END IF;

      RAISE EXCEPTION 'Cannot modify a % payrun — it is a historical record', OLD.state;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payruns_immutable ON payruns;
CREATE TRIGGER trg_payruns_immutable
BEFORE UPDATE OR DELETE ON payruns
FOR EACH ROW EXECUTE FUNCTION trg_lock_validated_payrun();

CREATE OR REPLACE FUNCTION trg_lock_validated_payslip()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.state IN ('validated', 'paid') THEN
      -- Allow transitioning from validated -> paid
      IF OLD.state = 'validated' AND NEW.state = 'paid' THEN
        RETURN NEW;
      END IF;
      -- Allow updating sent_at timestamp when payslip is emailed, or unlinking deleted contract
      IF NEW.state = OLD.state AND (NEW.sent_at IS DISTINCT FROM OLD.sent_at OR NEW.contract_id IS NULL)
         AND NEW.gross = OLD.gross AND NEW.net = OLD.net THEN
        RETURN NEW;
      END IF;

      RAISE EXCEPTION 'Cannot modify a % payslip — it is a historical record', OLD.state;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payslips_immutable ON payslips;
CREATE TRIGGER trg_payslips_immutable
BEFORE UPDATE ON payslips
FOR EACH ROW EXECUTE FUNCTION trg_lock_validated_payslip();


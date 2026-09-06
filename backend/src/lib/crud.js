/**
 * Generic CRUD router factory. Feature routes build on this and add the
 * business logic that actually matters (compute, approve, validate...).
 */
import { Router } from 'express';
import { query, one } from '../db.js';
import { can } from '../auth.js';

/** Wrap an async handler so rejections reach the error middleware. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * @param {string} [idColumn]
 *   Column to match in `GET /:id`. Required whenever `itemSql` aliases the table
 *   (e.g. `FROM employees e` needs `'e.id'`) — Postgres rejects a reference to the
 *   bare table name once an alias is in scope.
 */
/**
 * @param {string} [idColumn]
 *   Column to match in `GET /:id`. Required whenever `itemSql` aliases the table
 *   (e.g. `FROM employees e` needs `'e.id'`) — Postgres rejects a reference to the
 *   bare table name once an alias is in scope.
 * @param {object} [scope]
 *   Row-level visibility, applied on top of the role check.
 *   `scope.filter(req, params)` returns a SQL fragment (or null) narrowing the
 *   list; `scope.canSee(req, row)` decides a single record.
 */
export function crudRouter({ table, module, columns, listSql, itemSql, filters = {}, orderBy = 'id DESC', searchCol, idColumn, scope, hooks = {} }) {
  const r = Router();
  const idCol = idColumn || `${table}.id`;

  r.get('/', can(module, 'read'), ah(async (req, res) => {
    const where = [];
    const params = [];

    if (scope?.filter) {
      const fragment = await scope.filter(req, params);
      if (fragment) where.push(fragment);
    }

    for (const [q, col] of Object.entries(filters)) {
      if (req.query[q] !== undefined && req.query[q] !== '') {
        params.push(req.query[q]);
        where.push(`${col} = $${params.length}`);
      }
    }
    if (req.query.search) {
      params.push(`%${req.query.search}%`);
      where.push(`${searchCol || `${table}.name`} ILIKE $${params.length}`);
    }
    params.push(Math.min(Number(req.query.limit) || 200, 500));
    const sql = `${listSql || `SELECT * FROM ${table}`}${
      where.length ? ' WHERE ' + where.join(' AND ') : ''
    } ORDER BY ${orderBy} LIMIT $${params.length}`;
    const rows = await query(sql, params);
    res.json({ data: rows, meta: { total: rows.length } });
  }));

  r.get('/:id', can(module, 'read'), ah(async (req, res) => {
    const row = await one(`${itemSql || `SELECT * FROM ${table}`} WHERE ${idCol} = $1`, [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (scope?.canSee && !(await scope.canSee(req, row))) {
      return res.status(403).json({ error: 'This record is outside your team' });
    }
    res.json({ data: row });
  }));

  r.post('/', can(module, 'write'), ah(async (req, res) => {
    if (await denied(res, hooks.beforeCreate, req)) return;
    const cols = columns.filter((c) => req.body[c] !== undefined);
    if (!cols.length) return res.status(400).json({ error: 'No fields provided' });
    const row = await one(
      `INSERT INTO ${table} (${cols.join(',')})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
      cols.map((c) => norm(req.body[c]))
    );
    if (hooks.afterCreate) await hooks.afterCreate(req, row);
    res.status(201).json({ data: row });
  }));

  r.patch('/:id', can(module, 'write'), ah(async (req, res) => {
    if (await denied(res, hooks.beforeUpdate, req)) return;
    const cols = columns.filter((c) => req.body[c] !== undefined);
    if (!cols.length) return res.status(400).json({ error: 'No fields provided' });
    const row = await one(
      `UPDATE ${table} SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(',')}
       WHERE id = $${cols.length + 1} RETURNING *`,
      [...cols.map((c) => norm(req.body[c])), req.params.id]
    );
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (hooks.afterUpdate) await hooks.afterUpdate(req, row);
    res.json({ data: row });
  }));

  // `delete` is its own permission — the PS gives Payroll User create/read/update
  // on payruns and payslips but explicitly not delete.
  r.delete('/:id', can(module, 'delete'), ah(async (req, res) => {
    if (await denied(res, hooks.beforeDelete, req)) return;
    await query(`DELETE FROM ${table} WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  }));

  return r;
}

/**
 * Run a write hook. A hook returns `{ status, error }` to block the request, or
 * anything falsy to allow it.
 *
 * Hooks must be passed INTO the factory rather than registered on the returned
 * router: Express matches in registration order, so a handler appended
 * afterwards for a path the factory already owns never executes.
 */
async function denied(res, hook, req) {
  if (!hook) return false;
  const problem = await hook(req);
  if (!problem) return false;
  res.status(problem.status || 400).json({ error: problem.error });
  return true;
}

const norm = (v) => (v === '' ? null : v);

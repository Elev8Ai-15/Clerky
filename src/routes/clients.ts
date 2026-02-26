// ═══════════════════════════════════════════════════════════════
// CLERKY — Clients Routes v5.0
// Fixes: BUG-01 (validation), BUG-02 (XSS), BUG-03 (existence),
//        DATA-01 (FK), DATA-02 (soft delete), DATA-03 (audit),
//        OPS-01 (pagination)
// ═══════════════════════════════════════════════════════════════

import { Hono } from 'hono'
import { validate, sanitize, parsePagination, checkExists, validateFK, auditLog, badRequest, notFound, coalesceInt, logError, buildUpdateFields } from '../utils/shared'

type Bindings = { DB: D1Database }
const clients = new Hono<{ Bindings: Bindings }>()

const VALID_TYPES = ['individual', 'business', 'government', 'non_profit']
const VALID_STATUSES = ['active', 'inactive', 'prospect', 'archived']

// List all clients with pagination + filters
clients.get('/', async (c) => {
  const status = c.req.query('status')
  const search = c.req.query('search')
  const { page, pageSize, offset } = parsePagination(c)

  let query = `SELECT cl.*, u.full_name as attorney_name,
    (SELECT COUNT(*) FROM cases_matters WHERE client_id = cl.id) as case_count
    FROM clients cl LEFT JOIN users_attorneys u ON cl.assigned_attorney_id = u.id WHERE 1=1`
  let countQuery = `SELECT COUNT(*) as total FROM clients WHERE 1=1`
  const params: any[] = []
  const countParams: any[] = []

  if (status) { query += ' AND cl.status = ?'; countQuery += ' AND status = ?'; params.push(status); countParams.push(status) }
  if (search) {
    query += ' AND (cl.first_name LIKE ? OR cl.last_name LIKE ? OR cl.email LIKE ? OR cl.company_name LIKE ?)'
    countQuery += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR company_name LIKE ?)'
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
    countParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`)
  }
  query += ' ORDER BY cl.updated_at DESC LIMIT ? OFFSET ?'
  params.push(pageSize, offset)

  const [result, totalRow] = await Promise.all([
    c.env.DB.prepare(query).bind(...params).all(),
    c.env.DB.prepare(countQuery).bind(...countParams).first()
  ])

  return c.json({ clients: result.results, page, page_size: pageSize, total: coalesceInt((totalRow as any)?.total) })
})

// Get client by ID with related data
clients.get('/:id', async (c) => {
  const id = c.req.param('id')
  const client = await c.env.DB.prepare(`SELECT cl.*, u.full_name as attorney_name FROM clients cl LEFT JOIN users_attorneys u ON cl.assigned_attorney_id = u.id WHERE cl.id = ?`).bind(id).first()
  if (!client) return notFound(c, 'Client')

  const [cases, invoices] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM cases_matters WHERE client_id = ? ORDER BY created_at DESC').bind(id).all(),
    c.env.DB.prepare('SELECT * FROM billing_invoices WHERE client_id = ? ORDER BY created_at DESC').bind(id).all()
  ])
  return c.json({ client, cases: cases.results, invoices: invoices.results })
})

// Create a new client — with validation + sanitization
clients.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const v = validate(body, [
      { field: 'first_name', required: true, type: 'string', minLength: 1, maxLength: 200 },
      { field: 'last_name', required: true, type: 'string', minLength: 1, maxLength: 200 },
      { field: 'email', type: 'email', maxLength: 254 },
      { field: 'phone', type: 'string', maxLength: 30 },
      { field: 'address', type: 'string', maxLength: 500 },
      { field: 'city', type: 'string', maxLength: 100 },
      { field: 'state', type: 'string', maxLength: 50 },
      { field: 'zip_code', type: 'string', maxLength: 20 },
      { field: 'client_type', type: 'string', oneOf: VALID_TYPES },
      { field: 'status', type: 'string', oneOf: VALID_STATUSES },
      { field: 'company_name', type: 'string', maxLength: 300 },
      { field: 'assigned_attorney_id', type: 'number', min: 1 },
      { field: 'notes', type: 'string', maxLength: 5000 },
    ])
    if (!v.valid) return badRequest(c, v.errors)

    // FK validation
    if (body.assigned_attorney_id) {
      const fk = await validateFK(c.env.DB, 'users_attorneys', body.assigned_attorney_id, 'assigned_attorney_id')
      if (fk) return badRequest(c, [fk])
    }

    const safe = sanitize(body)
    const result = await c.env.DB.prepare(`
      INSERT INTO clients (first_name, last_name, email, phone, address, city, state, zip_code, client_type, status, company_name, assigned_attorney_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(safe.first_name, safe.last_name, safe.email || null, safe.phone || null, safe.address || null, safe.city || null, safe.state || null, safe.zip_code || null, safe.client_type || 'individual', safe.status || 'active', safe.company_name || null, safe.assigned_attorney_id || null, safe.notes || null).run()

    await auditLog(c.env.DB, 'create', 'clients', result.meta.last_row_id as number, 1, { first_name: safe.first_name, last_name: safe.last_name })

    return c.json({ id: result.meta.last_row_id }, 201)
  } catch (err: any) {
    await logError(c.env.DB, '/api/clients', 'POST', err.message)
    return c.json({ error: 'Failed to create client', detail: err.message }, 500)
  }
})

// Update a client — with existence check + audit
clients.put('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (!(await checkExists(c.env.DB, 'clients', id))) return notFound(c, 'Client')

    const body = await c.req.json()

    // Validate enum fields if present
    if (body.client_type && !VALID_TYPES.includes(body.client_type)) return badRequest(c, [`Invalid client_type: ${body.client_type}`])
    if (body.status && !VALID_STATUSES.includes(body.status)) return badRequest(c, [`Invalid status: ${body.status}`])

    // FK validation
    if (body.assigned_attorney_id) {
      const fk = await validateFK(c.env.DB, 'users_attorneys', body.assigned_attorney_id, 'assigned_attorney_id')
      if (fk) return badRequest(c, [fk])
    }

    const allowed = ['first_name', 'last_name', 'email', 'phone', 'address', 'city', 'state', 'zip_code', 'client_type', 'status', 'company_name', 'assigned_attorney_id', 'notes', 'date_of_birth', 'ssn_last4']
    const { fields, values } = buildUpdateFields(body, allowed)
    if (!fields.length) return badRequest(c, ['No valid fields to update'])

    fields.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)

    await c.env.DB.prepare(`UPDATE clients SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
    await auditLog(c.env.DB, 'update', 'clients', id, 1, sanitize(body))

    return c.json({ success: true })
  } catch (err: any) {
    await logError(c.env.DB, `/api/clients/${c.req.param('id')}`, 'PUT', err.message)
    return c.json({ error: 'Failed to update client', detail: err.message }, 500)
  }
})

// Soft-delete a client — with existence check + audit (DATA-02)
clients.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!(await checkExists(c.env.DB, 'clients', id))) return notFound(c, 'Client')

  await c.env.DB.prepare('UPDATE clients SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind('inactive', id).run()
  await auditLog(c.env.DB, 'soft_delete', 'clients', id, 1)

  return c.json({ success: true })
})

export default clients

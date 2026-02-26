// ═══════════════════════════════════════════════════════════════
// CLERKY — Cases/Matters Routes v4.0
// Fixes: BUG-01 (validation), BUG-02 (XSS), BUG-03 (existence),
//        BUG-04 (safe IDs), DATA-01 (FK), DATA-02 (soft delete),
//        DATA-03 (audit), OPS-01 (pagination)
// ═══════════════════════════════════════════════════════════════

import { Hono } from 'hono'
import { validate, sanitize, generateSafeId, parsePagination, checkExists, validateFK, auditLog, badRequest, notFound, coalesceInt, logError } from '../utils/shared'

type Bindings = { DB: D1Database }
const cases = new Hono<{ Bindings: Bindings }>()

const VALID_TYPES = ['civil', 'criminal', 'family', 'corporate', 'immigration', 'real_estate', 'ip', 'employment', 'bankruptcy', 'personal_injury', 'medical_malpractice', 'wrongful_death', 'workers_compensation', 'other']
const VALID_STATUSES = ['open', 'in_progress', 'pending_review', 'discovery', 'trial', 'settled', 'closed', 'archived']
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent']

// List all cases with pagination + filters
cases.get('/', async (c) => {
  const status = c.req.query('status')
  const type = c.req.query('type')
  const attorney = c.req.query('attorney_id')
  const search = c.req.query('search')
  const { page, pageSize, offset } = parsePagination(c)

  let query = `
    SELECT cm.*, c.first_name || ' ' || c.last_name as client_name,
           u.full_name as attorney_name
    FROM cases_matters cm
    LEFT JOIN clients c ON cm.client_id = c.id
    LEFT JOIN users_attorneys u ON cm.lead_attorney_id = u.id
    WHERE 1=1
  `
  let countQuery = `SELECT COUNT(*) as total FROM cases_matters cm WHERE 1=1`
  const params: any[] = []
  const countParams: any[] = []

  if (status) { query += ' AND cm.status = ?'; countQuery += ' AND cm.status = ?'; params.push(status); countParams.push(status) }
  if (type) { query += ' AND cm.case_type = ?'; countQuery += ' AND cm.case_type = ?'; params.push(type); countParams.push(type) }
  if (attorney) { query += ' AND cm.lead_attorney_id = ?'; countQuery += ' AND cm.lead_attorney_id = ?'; params.push(attorney); countParams.push(attorney) }
  if (search) {
    query += ' AND (cm.title LIKE ? OR cm.case_number LIKE ?)'; countQuery += ' AND (cm.title LIKE ? OR cm.case_number LIKE ?)'
    params.push(`%${search}%`, `%${search}%`); countParams.push(`%${search}%`, `%${search}%`)
  }

  query += ' ORDER BY cm.updated_at DESC LIMIT ? OFFSET ?'
  params.push(pageSize, offset)

  const [result, totalRow] = await Promise.all([
    c.env.DB.prepare(query).bind(...params).all(),
    c.env.DB.prepare(countQuery).bind(...countParams).first()
  ])

  return c.json({ cases: result.results, page, page_size: pageSize, total: coalesceInt((totalRow as any)?.total) })
})

// Get case by ID with related data
cases.get('/:id', async (c) => {
  const id = c.req.param('id')
  const caseData = await c.env.DB.prepare(`
    SELECT cm.*, c.first_name || ' ' || c.last_name as client_name, c.email as client_email, c.phone as client_phone,
           u.full_name as attorney_name, u.email as attorney_email
    FROM cases_matters cm
    LEFT JOIN clients c ON cm.client_id = c.id
    LEFT JOIN users_attorneys u ON cm.lead_attorney_id = u.id
    WHERE cm.id = ?
  `).bind(id).first()

  if (!caseData) return notFound(c, 'Case')

  const [docs, tasks, notes, timeEntries] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM documents WHERE case_id = ? AND status != ? ORDER BY created_at DESC').bind(id, 'archived').all(),
    c.env.DB.prepare('SELECT t.*, u.full_name as assigned_name FROM tasks_deadlines t LEFT JOIN users_attorneys u ON t.assigned_to = u.id WHERE t.case_id = ? AND t.status != ? ORDER BY t.due_date ASC').bind(id, 'deleted').all(),
    c.env.DB.prepare('SELECT cn.*, u.full_name as author_name FROM case_notes cn LEFT JOIN users_attorneys u ON cn.author_id = u.id WHERE cn.case_id = ? ORDER BY cn.created_at DESC').bind(id).all(),
    c.env.DB.prepare('SELECT te.*, u.full_name as user_name FROM time_entries te LEFT JOIN users_attorneys u ON te.user_id = u.id WHERE te.case_id = ? ORDER BY te.entry_date DESC').bind(id).all()
  ])

  return c.json({
    case: caseData,
    documents: docs.results,
    tasks: tasks.results,
    notes: notes.results,
    time_entries: timeEntries.results
  })
})

// Create a new case — with validation + sanitization
cases.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const v = validate(body, [
      { field: 'title', required: true, type: 'string', minLength: 2, maxLength: 500 },
      { field: 'case_type', required: true, type: 'string', oneOf: VALID_TYPES },
      { field: 'client_id', required: true, type: 'number', min: 1 },
      { field: 'lead_attorney_id', required: true, type: 'number', min: 1 },
      { field: 'description', type: 'string', maxLength: 5000 },
      { field: 'status', type: 'string', oneOf: VALID_STATUSES },
      { field: 'priority', type: 'string', oneOf: VALID_PRIORITIES },
      { field: 'court_name', type: 'string', maxLength: 500 },
      { field: 'opposing_counsel', type: 'string', maxLength: 500 },
      { field: 'opposing_party', type: 'string', maxLength: 500 },
      { field: 'estimated_value', type: 'number', min: 0 },
      { field: 'retainer_amount', type: 'number', min: 0 },
    ])
    if (!v.valid) return badRequest(c, v.errors)

    // FK validation
    const fkErrors: string[] = []
    const fk1 = await validateFK(c.env.DB, 'clients', body.client_id, 'client_id')
    const fk2 = await validateFK(c.env.DB, 'users_attorneys', body.lead_attorney_id, 'lead_attorney_id')
    if (fk1) fkErrors.push(fk1)
    if (fk2) fkErrors.push(fk2)
    if (fkErrors.length) return badRequest(c, fkErrors)

    const safe = sanitize(body)
    const caseNumber = generateSafeId('CM')

    const result = await c.env.DB.prepare(`
      INSERT INTO cases_matters (case_number, title, description, case_type, status, priority, client_id, lead_attorney_id, court_name, opposing_counsel, opposing_party, date_filed, estimated_value, retainer_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      caseNumber, safe.title, safe.description || null, safe.case_type, safe.status || 'open',
      safe.priority || 'medium', safe.client_id, safe.lead_attorney_id,
      safe.court_name || null, safe.opposing_counsel || null, safe.opposing_party || null,
      safe.date_filed || new Date().toISOString().split('T')[0],
      safe.estimated_value || null, safe.retainer_amount || null
    ).run()

    await auditLog(c.env.DB, 'create', 'cases_matters', result.meta.last_row_id as number, 1, { case_number: caseNumber, title: safe.title, case_type: safe.case_type })

    return c.json({ id: result.meta.last_row_id, case_number: caseNumber }, 201)
  } catch (err: any) {
    await logError(c.env.DB, '/api/cases', 'POST', err.message)
    return c.json({ error: 'Failed to create case', detail: err.message }, 500)
  }
})

// Update a case — with existence check + audit
cases.put('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (!(await checkExists(c.env.DB, 'cases_matters', id))) return notFound(c, 'Case')

    const body = await c.req.json()
    const safe = sanitize(body)
    const fields: string[] = []
    const values: any[] = []
    const allowedFields = ['title', 'description', 'case_type', 'status', 'priority', 'client_id', 'lead_attorney_id', 'court_name', 'court_case_number', 'judge_name', 'opposing_counsel', 'opposing_party', 'date_filed', 'date_closed', 'statute_of_limitations', 'estimated_value', 'retainer_amount']

    for (const field of allowedFields) {
      if (safe[field] !== undefined) {
        if (field === 'case_type' && !VALID_TYPES.includes(safe[field])) return badRequest(c, [`Invalid case_type: ${safe[field]}`])
        if (field === 'status' && !VALID_STATUSES.includes(safe[field])) return badRequest(c, [`Invalid status: ${safe[field]}`])
        if (field === 'priority' && !VALID_PRIORITIES.includes(safe[field])) return badRequest(c, [`Invalid priority: ${safe[field]}`])
        fields.push(`${field} = ?`)
        values.push(safe[field])
      }
    }

    if (fields.length === 0) return badRequest(c, ['No valid fields to update'])

    fields.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)

    await c.env.DB.prepare(`UPDATE cases_matters SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
    await auditLog(c.env.DB, 'update', 'cases_matters', id, 1, safe)

    return c.json({ success: true })
  } catch (err: any) {
    await logError(c.env.DB, `/api/cases/${c.req.param('id')}`, 'PUT', err.message)
    return c.json({ error: 'Failed to update case', detail: err.message }, 500)
  }
})

// Soft-delete a case — with existence check + audit
cases.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!(await checkExists(c.env.DB, 'cases_matters', id))) return notFound(c, 'Case')

  await c.env.DB.prepare('UPDATE cases_matters SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind('archived', id).run()
  await auditLog(c.env.DB, 'soft_delete', 'cases_matters', id, 1)

  return c.json({ success: true })
})

export default cases

import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const cases = new Hono<{ Bindings: Bindings }>()

// List all cases with optional filters
cases.get('/', async (c) => {
  const status = c.req.query('status')
  const type = c.req.query('type')
  const attorney = c.req.query('attorney_id')
  const search = c.req.query('search')

  let query = `
    SELECT cm.*, c.first_name || ' ' || c.last_name as client_name, 
           u.full_name as attorney_name
    FROM cases_matters cm
    LEFT JOIN clients c ON cm.client_id = c.id
    LEFT JOIN users_attorneys u ON cm.lead_attorney_id = u.id
    WHERE 1=1
  `
  const params: any[] = []

  if (status) { query += ' AND cm.status = ?'; params.push(status) }
  if (type) { query += ' AND cm.case_type = ?'; params.push(type) }
  if (attorney) { query += ' AND cm.lead_attorney_id = ?'; params.push(attorney) }
  if (search) { query += ' AND (cm.title LIKE ? OR cm.case_number LIKE ?)'; params.push(`%${search}%`, `%${search}%`) }

  query += ' ORDER BY cm.updated_at DESC'

  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ cases: result.results })
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

  if (!caseData) return c.json({ error: 'Case not found' }, 404)

  const [docs, tasks, notes, timeEntries] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM documents WHERE case_id = ? ORDER BY created_at DESC').bind(id).all(),
    c.env.DB.prepare('SELECT t.*, u.full_name as assigned_name FROM tasks_deadlines t LEFT JOIN users_attorneys u ON t.assigned_to = u.id WHERE t.case_id = ? ORDER BY t.due_date ASC').bind(id).all(),
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

// Create a new case
cases.post('/', async (c) => {
  const body = await c.req.json()
  const caseNumber = `CM-${new Date().getFullYear()}-${String(Date.now()).slice(-3).padStart(3, '0')}`
  
  const result = await c.env.DB.prepare(`
    INSERT INTO cases_matters (case_number, title, description, case_type, status, priority, client_id, lead_attorney_id, court_name, opposing_counsel, opposing_party, date_filed, estimated_value, retainer_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    caseNumber, body.title, body.description || null, body.case_type, body.status || 'open',
    body.priority || 'medium', body.client_id, body.lead_attorney_id,
    body.court_name || null, body.opposing_counsel || null, body.opposing_party || null,
    body.date_filed || new Date().toISOString().split('T')[0],
    body.estimated_value || null, body.retainer_amount || null
  ).run()

  return c.json({ id: result.meta.last_row_id, case_number: caseNumber }, 201)
})

// Update a case
cases.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  
  const fields = []
  const values: any[] = []
  const allowedFields = ['title', 'description', 'case_type', 'status', 'priority', 'client_id', 'lead_attorney_id', 'court_name', 'court_case_number', 'judge_name', 'opposing_counsel', 'opposing_party', 'date_filed', 'date_closed', 'estimated_value', 'retainer_amount']
  
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      fields.push(`${field} = ?`)
      values.push(body[field])
    }
  }
  
  if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400)
  
  fields.push('updated_at = CURRENT_TIMESTAMP')
  values.push(id)
  
  await c.env.DB.prepare(`UPDATE cases_matters SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
  return c.json({ success: true })
})

// Delete a case
cases.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE cases_matters SET status = ? WHERE id = ?').bind('archived', id).run()
  return c.json({ success: true })
})

export default cases

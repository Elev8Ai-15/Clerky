import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const tasks = new Hono<{ Bindings: Bindings }>()

tasks.get('/', async (c) => {
  const caseId = c.req.query('case_id')
  const assignedTo = c.req.query('assigned_to')
  const status = c.req.query('status')
  let query = `SELECT t.*, u.full_name as assigned_name, u2.full_name as assigned_by_name, cm.case_number
    FROM tasks_deadlines t
    LEFT JOIN users_attorneys u ON t.assigned_to = u.id
    LEFT JOIN users_attorneys u2 ON t.assigned_by = u2.id
    LEFT JOIN cases_matters cm ON t.case_id = cm.id WHERE 1=1`
  const params: any[] = []
  if (caseId) { query += ' AND t.case_id = ?'; params.push(caseId) }
  if (assignedTo) { query += ' AND t.assigned_to = ?'; params.push(assignedTo) }
  if (status) { query += ' AND t.status = ?'; params.push(status) }
  query += ' ORDER BY t.due_date ASC'
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ tasks: result.results })
})

tasks.post('/', async (c) => {
  const body = await c.req.json()
  const result = await c.env.DB.prepare(`
    INSERT INTO tasks_deadlines (title, description, case_id, assigned_to, assigned_by, priority, status, task_type, due_date, reminder_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(body.title, body.description || null, body.case_id || null, body.assigned_to, body.assigned_by || 1, body.priority || 'medium', body.status || 'pending', body.task_type || 'task', body.due_date || null, body.reminder_date || null).run()
  return c.json({ id: result.meta.last_row_id }, 201)
})

tasks.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const fields: string[] = []; const values: any[] = []
  const allowed = ['title','description','case_id','assigned_to','priority','status','task_type','due_date','completed_date','reminder_date']
  for (const f of allowed) { if (body[f] !== undefined) { fields.push(`${f} = ?`); values.push(body[f]) } }
  if (!fields.length) return c.json({ error: 'No fields' }, 400)
  if (body.status === 'completed') { fields.push('completed_date = ?'); values.push(new Date().toISOString()) }
  fields.push('updated_at = CURRENT_TIMESTAMP'); values.push(id)
  await c.env.DB.prepare(`UPDATE tasks_deadlines SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
  return c.json({ success: true })
})

tasks.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM tasks_deadlines WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

export default tasks

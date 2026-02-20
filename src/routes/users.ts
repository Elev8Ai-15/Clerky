import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const users = new Hono<{ Bindings: Bindings }>()

users.get('/', async (c) => {
  const role = c.req.query('role')
  let query = 'SELECT id, email, full_name, role, bar_number, phone, specialty, is_active, created_at FROM users_attorneys WHERE 1=1'
  const params: any[] = []
  if (role) { query += ' AND role = ?'; params.push(role) }
  query += ' ORDER BY full_name ASC'
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ users: result.results })
})

users.get('/:id', async (c) => {
  const id = c.req.param('id')
  const user = await c.env.DB.prepare('SELECT id, email, full_name, role, bar_number, phone, specialty, is_active, created_at FROM users_attorneys WHERE id = ?').bind(id).first()
  if (!user) return c.json({ error: 'User not found' }, 404)
  const activeCases = await c.env.DB.prepare("SELECT COUNT(*) as count FROM cases_matters WHERE lead_attorney_id = ? AND status NOT IN ('closed','archived')").bind(id).first()
  const recentTasks = await c.env.DB.prepare('SELECT * FROM tasks_deadlines WHERE assigned_to = ? ORDER BY due_date ASC LIMIT 5').bind(id).all()
  return c.json({ user, active_cases: (activeCases as any)?.count || 0, upcoming_tasks: recentTasks.results })
})

users.post('/', async (c) => {
  const body = await c.req.json()
  const result = await c.env.DB.prepare(`
    INSERT INTO users_attorneys (email, full_name, role, bar_number, phone, specialty)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(body.email, body.full_name, body.role || 'attorney', body.bar_number || null, body.phone || null, body.specialty || null).run()
  return c.json({ id: result.meta.last_row_id }, 201)
})

export default users

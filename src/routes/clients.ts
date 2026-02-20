import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const clients = new Hono<{ Bindings: Bindings }>()

clients.get('/', async (c) => {
  const status = c.req.query('status')
  const search = c.req.query('search')
  let query = `SELECT cl.*, u.full_name as attorney_name,
    (SELECT COUNT(*) FROM cases_matters WHERE client_id = cl.id) as case_count
    FROM clients cl LEFT JOIN users_attorneys u ON cl.assigned_attorney_id = u.id WHERE 1=1`
  const params: any[] = []
  if (status) { query += ' AND cl.status = ?'; params.push(status) }
  if (search) { query += ' AND (cl.first_name LIKE ? OR cl.last_name LIKE ? OR cl.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`) }
  query += ' ORDER BY cl.updated_at DESC'
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ clients: result.results })
})

clients.get('/:id', async (c) => {
  const id = c.req.param('id')
  const client = await c.env.DB.prepare(`SELECT cl.*, u.full_name as attorney_name FROM clients cl LEFT JOIN users_attorneys u ON cl.assigned_attorney_id = u.id WHERE cl.id = ?`).bind(id).first()
  if (!client) return c.json({ error: 'Client not found' }, 404)
  const cases = await c.env.DB.prepare('SELECT * FROM cases_matters WHERE client_id = ? ORDER BY created_at DESC').bind(id).all()
  const invoices = await c.env.DB.prepare('SELECT * FROM billing_invoices WHERE client_id = ? ORDER BY created_at DESC').bind(id).all()
  return c.json({ client, cases: cases.results, invoices: invoices.results })
})

clients.post('/', async (c) => {
  const body = await c.req.json()
  const result = await c.env.DB.prepare(`
    INSERT INTO clients (first_name, last_name, email, phone, address, city, state, zip_code, client_type, status, company_name, assigned_attorney_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(body.first_name, body.last_name, body.email || null, body.phone || null, body.address || null, body.city || null, body.state || null, body.zip_code || null, body.client_type || 'individual', body.status || 'active', body.company_name || null, body.assigned_attorney_id || null, body.notes || null).run()
  return c.json({ id: result.meta.last_row_id }, 201)
})

clients.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const fields: string[] = []; const values: any[] = []
  const allowed = ['first_name','last_name','email','phone','address','city','state','zip_code','client_type','status','company_name','assigned_attorney_id','notes']
  for (const f of allowed) { if (body[f] !== undefined) { fields.push(`${f} = ?`); values.push(body[f]) } }
  if (!fields.length) return c.json({ error: 'No fields' }, 400)
  fields.push('updated_at = CURRENT_TIMESTAMP'); values.push(id)
  await c.env.DB.prepare(`UPDATE clients SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
  return c.json({ success: true })
})

clients.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE clients SET status = ? WHERE id = ?').bind('inactive', id).run()
  return c.json({ success: true })
})

export default clients

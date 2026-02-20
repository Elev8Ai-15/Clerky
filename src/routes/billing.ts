import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const billing = new Hono<{ Bindings: Bindings }>()

// Dashboard stats
billing.get('/stats', async (c) => {
  const [totalRev, outstanding, overdue, monthly] = await Promise.all([
    c.env.DB.prepare("SELECT COALESCE(SUM(amount_paid),0) as total FROM billing_invoices WHERE status = 'paid'").first(),
    c.env.DB.prepare("SELECT COALESCE(SUM(total_amount - amount_paid),0) as total FROM billing_invoices WHERE status IN ('sent','viewed','partial')").first(),
    c.env.DB.prepare("SELECT COALESCE(SUM(total_amount - amount_paid),0) as total, COUNT(*) as count FROM billing_invoices WHERE status = 'overdue'").first(),
    c.env.DB.prepare("SELECT COALESCE(SUM(amount),0) as total FROM time_entries WHERE is_billable = 1 AND entry_date >= date('now','-30 days')").first()
  ])
  return c.json({
    total_revenue: (totalRev as any)?.total || 0,
    outstanding: (outstanding as any)?.total || 0,
    overdue_amount: (overdue as any)?.total || 0,
    overdue_count: (overdue as any)?.count || 0,
    monthly_billable: (monthly as any)?.total || 0
  })
})

// List invoices
billing.get('/invoices', async (c) => {
  const status = c.req.query('status')
  const clientId = c.req.query('client_id')
  let query = `SELECT bi.*, c.first_name || ' ' || c.last_name as client_name, cm.case_number, cm.title as case_title
    FROM billing_invoices bi
    LEFT JOIN clients c ON bi.client_id = c.id
    LEFT JOIN cases_matters cm ON bi.case_id = cm.id WHERE 1=1`
  const params: any[] = []
  if (status) { query += ' AND bi.status = ?'; params.push(status) }
  if (clientId) { query += ' AND bi.client_id = ?'; params.push(clientId) }
  query += ' ORDER BY bi.created_at DESC'
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ invoices: result.results })
})

// Get invoice detail
billing.get('/invoices/:id', async (c) => {
  const id = c.req.param('id')
  const invoice = await c.env.DB.prepare(`SELECT bi.*, c.first_name || ' ' || c.last_name as client_name, c.email as client_email, cm.case_number FROM billing_invoices bi LEFT JOIN clients c ON bi.client_id = c.id LEFT JOIN cases_matters cm ON bi.case_id = cm.id WHERE bi.id = ?`).bind(id).first()
  if (!invoice) return c.json({ error: 'Invoice not found' }, 404)
  const lineItems = await c.env.DB.prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ?').bind(id).all()
  const payments = await c.env.DB.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC').bind(id).all()
  return c.json({ invoice, line_items: lineItems.results, payments: payments.results })
})

// Create invoice
billing.post('/invoices', async (c) => {
  const body = await c.req.json()
  const invoiceNum = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-3).padStart(3, '0')}`
  const result = await c.env.DB.prepare(`
    INSERT INTO billing_invoices (invoice_number, case_id, client_id, issued_by, status, subtotal, tax_rate, tax_amount, total_amount, due_date, notes, payment_terms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(invoiceNum, body.case_id, body.client_id, body.issued_by || 1, body.status || 'draft', body.subtotal || 0, body.tax_rate || 0, body.tax_amount || 0, body.total_amount || 0, body.due_date || null, body.notes || null, body.payment_terms || 'net_30').run()
  return c.json({ id: result.meta.last_row_id, invoice_number: invoiceNum }, 201)
})

// Update invoice
billing.put('/invoices/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const fields: string[] = []; const values: any[] = []
  const allowed = ['status','subtotal','tax_rate','tax_amount','total_amount','amount_paid','due_date','sent_date','paid_date','notes','payment_terms']
  for (const f of allowed) { if (body[f] !== undefined) { fields.push(`${f} = ?`); values.push(body[f]) } }
  if (!fields.length) return c.json({ error: 'No fields' }, 400)
  fields.push('updated_at = CURRENT_TIMESTAMP'); values.push(id)
  await c.env.DB.prepare(`UPDATE billing_invoices SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
  return c.json({ success: true })
})

// Time entries
billing.get('/time-entries', async (c) => {
  const caseId = c.req.query('case_id')
  const userId = c.req.query('user_id')
  let query = `SELECT te.*, u.full_name as user_name, cm.case_number FROM time_entries te LEFT JOIN users_attorneys u ON te.user_id = u.id LEFT JOIN cases_matters cm ON te.case_id = cm.id WHERE 1=1`
  const params: any[] = []
  if (caseId) { query += ' AND te.case_id = ?'; params.push(caseId) }
  if (userId) { query += ' AND te.user_id = ?'; params.push(userId) }
  query += ' ORDER BY te.entry_date DESC'
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ time_entries: result.results })
})

billing.post('/time-entries', async (c) => {
  const body = await c.req.json()
  const result = await c.env.DB.prepare(`
    INSERT INTO time_entries (case_id, user_id, description, hours, rate, activity_type, is_billable, entry_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(body.case_id, body.user_id || 1, body.description, body.hours, body.rate || 450, body.activity_type || 'legal_work', body.is_billable !== undefined ? body.is_billable : 1, body.entry_date || new Date().toISOString().split('T')[0]).run()
  return c.json({ id: result.meta.last_row_id }, 201)
})

export default billing

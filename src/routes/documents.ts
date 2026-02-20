import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const documents = new Hono<{ Bindings: Bindings }>()

documents.get('/', async (c) => {
  const caseId = c.req.query('case_id')
  const category = c.req.query('category')
  const status = c.req.query('status')
  const search = c.req.query('search')

  let query = `SELECT d.*, u.full_name as uploaded_by_name, cm.case_number, cm.title as case_title
    FROM documents d
    LEFT JOIN users_attorneys u ON d.uploaded_by = u.id
    LEFT JOIN cases_matters cm ON d.case_id = cm.id WHERE 1=1`
  const params: any[] = []
  if (caseId) { query += ' AND d.case_id = ?'; params.push(caseId) }
  if (category) { query += ' AND d.category = ?'; params.push(category) }
  if (status) { query += ' AND d.status = ?'; params.push(status) }
  if (search) { query += ' AND (d.title LIKE ? OR d.file_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`) }
  query += ' ORDER BY d.updated_at DESC'
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ documents: result.results })
})

documents.get('/:id', async (c) => {
  const id = c.req.param('id')
  const doc = await c.env.DB.prepare(`SELECT d.*, u.full_name as uploaded_by_name FROM documents d LEFT JOIN users_attorneys u ON d.uploaded_by = u.id WHERE d.id = ?`).bind(id).first()
  if (!doc) return c.json({ error: 'Document not found' }, 404)
  const versions = await c.env.DB.prepare('SELECT dv.*, u.full_name as created_by_name FROM document_versions dv LEFT JOIN users_attorneys u ON dv.created_by = u.id WHERE dv.document_id = ? ORDER BY dv.version_number DESC').bind(id).all()
  const sharing = await c.env.DB.prepare('SELECT * FROM document_sharing WHERE document_id = ? AND is_active = 1').bind(id).all()
  return c.json({ document: doc, versions: versions.results, sharing: sharing.results })
})

documents.post('/', async (c) => {
  const body = await c.req.json()
  const result = await c.env.DB.prepare(`
    INSERT INTO documents (title, file_name, file_type, file_size, category, status, case_id, uploaded_by, ai_generated, ai_summary, content_text, tags)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(body.title, body.file_name, body.file_type || null, body.file_size || null, body.category || 'general', body.status || 'draft', body.case_id || null, body.uploaded_by || 1, body.ai_generated || 0, body.ai_summary || null, body.content_text || null, body.tags || null).run()
  return c.json({ id: result.meta.last_row_id }, 201)
})

documents.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const fields: string[] = []; const values: any[] = []
  const allowed = ['title','file_name','file_type','category','status','case_id','ai_summary','content_text','tags']
  for (const f of allowed) { if (body[f] !== undefined) { fields.push(`${f} = ?`); values.push(body[f]) } }
  if (!fields.length) return c.json({ error: 'No fields' }, 400)
  fields.push('updated_at = CURRENT_TIMESTAMP'); values.push(id)
  await c.env.DB.prepare(`UPDATE documents SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
  return c.json({ success: true })
})

documents.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE documents SET status = ? WHERE id = ?').bind('archived', id).run()
  return c.json({ success: true })
})

// Templates
documents.get('/templates/list', async (c) => {
  const result = await c.env.DB.prepare('SELECT * FROM document_templates WHERE is_active = 1 ORDER BY usage_count DESC').all()
  return c.json({ templates: result.results })
})

export default documents

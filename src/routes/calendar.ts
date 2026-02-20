import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const calendar = new Hono<{ Bindings: Bindings }>()

calendar.get('/', async (c) => {
  const start = c.req.query('start')
  const end = c.req.query('end')
  const type = c.req.query('type')

  let query = `SELECT ce.*, cm.case_number, cm.title as case_title, u.full_name as organizer_name
    FROM calendar_events ce
    LEFT JOIN cases_matters cm ON ce.case_id = cm.id
    LEFT JOIN users_attorneys u ON ce.organizer_id = u.id WHERE 1=1`
  const params: any[] = []
  if (start) { query += ' AND ce.start_datetime >= ?'; params.push(start) }
  if (end) { query += ' AND ce.end_datetime <= ?'; params.push(end) }
  if (type) { query += ' AND ce.event_type = ?'; params.push(type) }
  query += ' ORDER BY ce.start_datetime ASC'
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ events: result.results })
})

calendar.get('/:id', async (c) => {
  const id = c.req.param('id')
  const event = await c.env.DB.prepare(`SELECT ce.*, cm.case_number, u.full_name as organizer_name FROM calendar_events ce LEFT JOIN cases_matters cm ON ce.case_id = cm.id LEFT JOIN users_attorneys u ON ce.organizer_id = u.id WHERE ce.id = ?`).bind(id).first()
  if (!event) return c.json({ error: 'Event not found' }, 404)
  return c.json({ event })
})

calendar.post('/', async (c) => {
  const body = await c.req.json()
  const result = await c.env.DB.prepare(`
    INSERT INTO calendar_events (title, description, event_type, case_id, organizer_id, location, virtual_link, start_datetime, end_datetime, all_day, color, reminder_minutes, attendees, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(body.title, body.description || null, body.event_type, body.case_id || null, body.organizer_id || 1, body.location || null, body.virtual_link || null, body.start_datetime, body.end_datetime, body.all_day || 0, body.color || '#3B82F6', body.reminder_minutes || 30, body.attendees || null, body.notes || null).run()
  return c.json({ id: result.meta.last_row_id }, 201)
})

calendar.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const fields: string[] = []; const values: any[] = []
  const allowed = ['title','description','event_type','case_id','organizer_id','location','virtual_link','start_datetime','end_datetime','all_day','color','reminder_minutes','attendees','notes']
  for (const f of allowed) { if (body[f] !== undefined) { fields.push(`${f} = ?`); values.push(body[f]) } }
  if (!fields.length) return c.json({ error: 'No fields' }, 400)
  fields.push('updated_at = CURRENT_TIMESTAMP'); values.push(id)
  await c.env.DB.prepare(`UPDATE calendar_events SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
  return c.json({ success: true })
})

calendar.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM calendar_events WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

export default calendar

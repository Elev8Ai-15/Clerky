// ═══════════════════════════════════════════════════════════════
// CLERKY — Calendar Events Routes v5.0
// Fixes: BUG-01 (validation), BUG-02 (XSS), BUG-03 (existence),
//        DATA-01 (FK), DATA-02 (soft delete), DATA-03 (audit),
//        OPS-01 (pagination)
// ═══════════════════════════════════════════════════════════════

import { Hono } from 'hono'
import { validate, sanitize, parsePagination, checkExists, validateFK, auditLog, badRequest, notFound, coalesceInt, logError, buildUpdateFields } from '../utils/shared'

type Bindings = { DB: D1Database }
const calendar = new Hono<{ Bindings: Bindings }>()

const VALID_EVENT_TYPES = ['hearing', 'deposition', 'meeting', 'deadline', 'trial', 'mediation', 'conference', 'filing', 'consultation', 'personal', 'other']

// List events with pagination + filters
calendar.get('/', async (c) => {
  const start = c.req.query('start')
  const end = c.req.query('end')
  const type = c.req.query('type')
  const { page, pageSize, offset } = parsePagination(c)

  let query = `SELECT ce.*, cm.case_number, cm.title as case_title, u.full_name as organizer_name
    FROM calendar_events ce
    LEFT JOIN cases_matters cm ON ce.case_id = cm.id
    LEFT JOIN users_attorneys u ON ce.organizer_id = u.id WHERE COALESCE(ce.status, 'active') != 'cancelled'`
  let countQuery = `SELECT COUNT(*) as total FROM calendar_events WHERE COALESCE(status, 'active') != 'cancelled'`
  const params: any[] = []
  const countParams: any[] = []

  if (start) { query += ' AND ce.start_datetime >= ?'; countQuery += ' AND start_datetime >= ?'; params.push(start); countParams.push(start) }
  if (end) { query += ' AND ce.end_datetime <= ?'; countQuery += ' AND end_datetime <= ?'; params.push(end); countParams.push(end) }
  if (type) { query += ' AND ce.event_type = ?'; countQuery += ' AND event_type = ?'; params.push(type); countParams.push(type) }
  query += ' ORDER BY ce.start_datetime ASC LIMIT ? OFFSET ?'
  params.push(pageSize, offset)

  const [result, totalRow] = await Promise.all([
    c.env.DB.prepare(query).bind(...params).all(),
    c.env.DB.prepare(countQuery).bind(...countParams).first()
  ])

  return c.json({ events: result.results, page, page_size: pageSize, total: coalesceInt((totalRow as any)?.total) })
})

// Get event by ID — with existence check
calendar.get('/:id', async (c) => {
  const id = c.req.param('id')
  const event = await c.env.DB.prepare(`SELECT ce.*, cm.case_number, u.full_name as organizer_name FROM calendar_events ce LEFT JOIN cases_matters cm ON ce.case_id = cm.id LEFT JOIN users_attorneys u ON ce.organizer_id = u.id WHERE ce.id = ?`).bind(id).first()
  if (!event) return notFound(c, 'Event')
  return c.json({ event })
})

// Create event — with validation + FK checks
calendar.post('/', async (c) => {
  try {
    const body = await c.req.json()
    const v = validate(body, [
      { field: 'title', required: true, type: 'string', minLength: 2, maxLength: 500 },
      { field: 'event_type', required: true, type: 'string', oneOf: VALID_EVENT_TYPES },
      { field: 'start_datetime', required: true, type: 'string', maxLength: 50 },
      { field: 'end_datetime', required: true, type: 'string', maxLength: 50 },
      { field: 'description', type: 'string', maxLength: 5000 },
      { field: 'case_id', type: 'number', min: 1 },
      { field: 'organizer_id', type: 'number', min: 1 },
      { field: 'location', type: 'string', maxLength: 500 },
      { field: 'virtual_link', type: 'string', maxLength: 1000 },
      { field: 'color', type: 'string', maxLength: 20 },
      { field: 'reminder_minutes', type: 'number', min: 0, max: 10080 },
      { field: 'attendees', type: 'string', maxLength: 2000 },
      { field: 'notes', type: 'string', maxLength: 5000 },
    ])
    if (!v.valid) return badRequest(c, v.errors)

    // FK validation
    if (body.case_id) {
      const fk = await validateFK(c.env.DB, 'cases_matters', body.case_id, 'case_id')
      if (fk) return badRequest(c, [fk])
    }

    const safe = sanitize(body)
    const result = await c.env.DB.prepare(`
      INSERT INTO calendar_events (title, description, event_type, case_id, organizer_id, location, virtual_link, start_datetime, end_datetime, all_day, color, reminder_minutes, attendees, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(safe.title, safe.description || null, safe.event_type, safe.case_id || null, safe.organizer_id || 1, safe.location || null, safe.virtual_link || null, safe.start_datetime, safe.end_datetime, safe.all_day || 0, safe.color || '#3B82F6', safe.reminder_minutes || 30, safe.attendees || null, safe.notes || null).run()

    await auditLog(c.env.DB, 'create', 'calendar_events', result.meta.last_row_id as number, 1, { title: safe.title, event_type: safe.event_type })

    return c.json({ id: result.meta.last_row_id }, 201)
  } catch (err: any) {
    await logError(c.env.DB, '/api/calendar', 'POST', err.message)
    return c.json({ error: 'Failed to create event', detail: err.message }, 500)
  }
})

// Update event — with existence check + audit
calendar.put('/:id', async (c) => {
  try {
    const id = c.req.param('id')
    if (!(await checkExists(c.env.DB, 'calendar_events', id))) return notFound(c, 'Event')

    const body = await c.req.json()
    if (body.event_type && !VALID_EVENT_TYPES.includes(body.event_type)) return badRequest(c, [`Invalid event_type: ${body.event_type}`])

    const allowed = ['title', 'description', 'event_type', 'case_id', 'organizer_id', 'location', 'virtual_link', 'start_datetime', 'end_datetime', 'all_day', 'color', 'reminder_minutes', 'attendees', 'notes']
    const { fields, values } = buildUpdateFields(body, allowed)
    if (!fields.length) return badRequest(c, ['No valid fields to update'])

    fields.push('updated_at = CURRENT_TIMESTAMP')
    values.push(id)

    await c.env.DB.prepare(`UPDATE calendar_events SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run()
    await auditLog(c.env.DB, 'update', 'calendar_events', id, 1, sanitize(body))

    return c.json({ success: true })
  } catch (err: any) {
    await logError(c.env.DB, `/api/calendar/${c.req.param('id')}`, 'PUT', err.message)
    return c.json({ error: 'Failed to update event', detail: err.message }, 500)
  }
})

// Delete event — soft-delete via status='cancelled' for consistency (BUG-17 fix)
calendar.delete('/:id', async (c) => {
  const id = c.req.param('id')
  if (!(await checkExists(c.env.DB, 'calendar_events', id))) return notFound(c, 'Event')

  await c.env.DB.prepare("UPDATE calendar_events SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id).run()
  await auditLog(c.env.DB, 'soft_delete', 'calendar_events', id, 1)

  return c.json({ success: true })
})

export default calendar

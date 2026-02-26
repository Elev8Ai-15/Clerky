// ═══════════════════════════════════════════════════════════════
// CLERKY — Notifications Routes v5.0
// Fixes: BUG-03 (existence), OPS-01 (pagination)
// ═══════════════════════════════════════════════════════════════

import { Hono } from 'hono'
import { checkExists, notFound, coalesceInt } from '../utils/shared'

type Bindings = { DB: D1Database }
const notifications = new Hono<{ Bindings: Bindings }>()

// List notifications with unread count
notifications.get('/', async (c) => {
  const userId = c.req.query('user_id') || '1'
  const unreadOnly = c.req.query('unread')
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit')) || 20))

  let query = `SELECT n.*, cm.case_number FROM notifications n LEFT JOIN cases_matters cm ON n.case_id = cm.id WHERE n.user_id = ?`
  const params: any[] = [userId]
  if (unreadOnly === 'true') { query += ' AND n.is_read = 0' }
  query += ` ORDER BY n.created_at DESC LIMIT ?`
  params.push(limit)

  const [result, unread] = await Promise.all([
    c.env.DB.prepare(query).bind(...params).all(),
    c.env.DB.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').bind(userId).first()
  ])

  return c.json({ notifications: result.results, unread_count: coalesceInt((unread as any)?.count) })
})

// Mark single notification as read — with existence check
notifications.put('/:id/read', async (c) => {
  const id = c.req.param('id')
  if (!(await checkExists(c.env.DB, 'notifications', id))) return notFound(c, 'Notification')

  await c.env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// Mark all notifications as read
notifications.put('/read-all', async (c) => {
  const userId = c.req.query('user_id') || '1'
  await c.env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(userId).run()
  return c.json({ success: true })
})

export default notifications

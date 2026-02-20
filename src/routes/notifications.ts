import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const notifications = new Hono<{ Bindings: Bindings }>()

notifications.get('/', async (c) => {
  const userId = c.req.query('user_id') || '1'
  const unreadOnly = c.req.query('unread')
  let query = `SELECT n.*, cm.case_number FROM notifications n LEFT JOIN cases_matters cm ON n.case_id = cm.id WHERE n.user_id = ?`
  const params: any[] = [userId]
  if (unreadOnly === 'true') { query += ' AND n.is_read = 0' }
  query += ' ORDER BY n.created_at DESC LIMIT 20'
  const result = await c.env.DB.prepare(query).bind(...params).all()
  const unread = await c.env.DB.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').bind(userId).first()
  return c.json({ notifications: result.results, unread_count: (unread as any)?.count || 0 })
})

notifications.put('/:id/read', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

notifications.put('/read-all', async (c) => {
  const userId = c.req.query('user_id') || '1'
  await c.env.DB.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').bind(userId).run()
  return c.json({ success: true })
})

export default notifications

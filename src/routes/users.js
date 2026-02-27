// ═══════════════════════════════════════════════════════════════
// CLERKY — Users/Attorneys Routes v5.0
// Fixes: BUG-01 (validation), BUG-02 (XSS), BUG-03 (existence),
//        DATA-03 (audit)
// ═══════════════════════════════════════════════════════════════
import { Hono } from 'hono';
import { validate, sanitize, checkExists, auditLog, badRequest, notFound, coalesceInt, logError } from '../utils/shared';
const users = new Hono();
const VALID_ROLES = ['admin', 'attorney', 'paralegal', 'clerk', 'associate'];
// List users — excludes password_hash for security (SEC-04)
users.get('/', async (c) => {
    const role = c.req.query('role');
    let query = 'SELECT id, email, full_name, role, bar_number, phone, specialty, is_active, created_at FROM users_attorneys WHERE 1=1';
    const params = [];
    if (role) {
        query += ' AND role = ?';
        params.push(role);
    }
    query += ' ORDER BY full_name ASC';
    const result = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ users: result.results });
});
// Get user by ID — with existence check + security
users.get('/:id', async (c) => {
    const id = c.req.param('id');
    const user = await c.env.DB.prepare('SELECT id, email, full_name, role, bar_number, phone, specialty, is_active, created_at FROM users_attorneys WHERE id = ?').bind(id).first();
    if (!user)
        return notFound(c, 'User');
    const [activeCases, recentTasks] = await Promise.all([
        c.env.DB.prepare("SELECT COALESCE(COUNT(*),0) as count FROM cases_matters WHERE lead_attorney_id = ? AND status NOT IN ('closed','archived')").bind(id).first(),
        c.env.DB.prepare('SELECT * FROM tasks_deadlines WHERE assigned_to = ? AND status != ? ORDER BY due_date ASC LIMIT 5').bind(id, 'deleted').all()
    ]);
    return c.json({ user, active_cases: coalesceInt(activeCases?.count), upcoming_tasks: recentTasks.results });
});
// Create user — with validation + sanitization
users.post('/', async (c) => {
    try {
        const body = await c.req.json();
        const v = validate(body, [
            { field: 'email', required: true, type: 'email', maxLength: 254 },
            { field: 'full_name', required: true, type: 'string', minLength: 2, maxLength: 200 },
            { field: 'role', type: 'string', oneOf: VALID_ROLES },
            { field: 'bar_number', type: 'string', maxLength: 50 },
            { field: 'phone', type: 'string', maxLength: 30 },
            { field: 'specialty', type: 'string', maxLength: 200 },
        ]);
        if (!v.valid)
            return badRequest(c, v.errors);
        const safe = sanitize(body);
        const result = await c.env.DB.prepare(`
      INSERT INTO users_attorneys (email, full_name, role, bar_number, phone, specialty)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(safe.email, safe.full_name, safe.role || 'attorney', safe.bar_number || null, safe.phone || null, safe.specialty || null).run();
        await auditLog(c.env.DB, 'create', 'users_attorneys', result.meta.last_row_id, 1, { email: safe.email, full_name: safe.full_name });
        return c.json({ id: result.meta.last_row_id }, 201);
    }
    catch (err) {
        await logError(c.env.DB, '/api/users', 'POST', err.message);
        return c.json({ error: 'Failed to create user', detail: err.message }, 500);
    }
});
// Update user — with existence check
users.put('/:id', async (c) => {
    try {
        const id = c.req.param('id');
        if (!(await checkExists(c.env.DB, 'users_attorneys', id)))
            return notFound(c, 'User');
        const body = await c.req.json();
        if (body.role && !VALID_ROLES.includes(body.role))
            return badRequest(c, [`Invalid role: ${body.role}`]);
        const safe = sanitize(body);
        const fields = [];
        const values = [];
        const allowed = ['full_name', 'email', 'role', 'bar_number', 'phone', 'specialty', 'is_active'];
        for (const f of allowed) {
            if (safe[f] !== undefined) {
                fields.push(`${f} = ?`);
                values.push(safe[f]);
            }
        }
        if (!fields.length)
            return badRequest(c, ['No valid fields to update']);
        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);
        await c.env.DB.prepare(`UPDATE users_attorneys SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
        await auditLog(c.env.DB, 'update', 'users_attorneys', id, 1, safe);
        return c.json({ success: true });
    }
    catch (err) {
        await logError(c.env.DB, `/api/users/${c.req.param('id')}`, 'PUT', err.message);
        return c.json({ error: 'Failed to update user', detail: err.message }, 500);
    }
});
export default users;

// ═══════════════════════════════════════════════════════════════
// CLERKY — Tasks/Deadlines Routes v5.0
// Fixes: BUG-01 (validation), BUG-02 (XSS), BUG-03 (existence),
//        DATA-01 (FK), DATA-02 (soft delete), DATA-03 (audit),
//        OPS-01 (pagination)
// ═══════════════════════════════════════════════════════════════
import { Hono } from 'hono';
import { validate, sanitize, parsePagination, checkExists, validateFK, auditLog, badRequest, notFound, coalesceInt, logError, buildUpdateFields } from '../utils/shared';
const tasks = new Hono();
const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const VALID_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled', 'deleted'];
const VALID_TYPES = ['task', 'deadline', 'reminder', 'filing', 'hearing', 'review', 'follow_up'];
// List tasks with pagination + filters
tasks.get('/', async (c) => {
    const caseId = c.req.query('case_id');
    const assignedTo = c.req.query('assigned_to');
    const status = c.req.query('status');
    const { page, pageSize, offset } = parsePagination(c);
    let query = `SELECT t.*, u.full_name as assigned_name, u2.full_name as assigned_by_name, cm.case_number
    FROM tasks_deadlines t
    LEFT JOIN users_attorneys u ON t.assigned_to = u.id
    LEFT JOIN users_attorneys u2 ON t.assigned_by = u2.id
    LEFT JOIN cases_matters cm ON t.case_id = cm.id WHERE t.status != 'deleted'`;
    let countQuery = `SELECT COUNT(*) as total FROM tasks_deadlines WHERE status != 'deleted'`;
    const params = [];
    const countParams = [];
    if (caseId) {
        query += ' AND t.case_id = ?';
        countQuery += ' AND case_id = ?';
        params.push(caseId);
        countParams.push(caseId);
    }
    if (assignedTo) {
        query += ' AND t.assigned_to = ?';
        countQuery += ' AND assigned_to = ?';
        params.push(assignedTo);
        countParams.push(assignedTo);
    }
    if (status) {
        query += ' AND t.status = ?';
        countQuery += ' AND status = ?';
        params.push(status);
        countParams.push(status);
    }
    query += ' ORDER BY t.due_date ASC LIMIT ? OFFSET ?';
    params.push(pageSize, offset);
    const [result, totalRow] = await Promise.all([
        c.env.DB.prepare(query).bind(...params).all(),
        c.env.DB.prepare(countQuery).bind(...countParams).first()
    ]);
    return c.json({ tasks: result.results, page, page_size: pageSize, total: coalesceInt(totalRow?.total) });
});
// Create task — with validation + FK checks
tasks.post('/', async (c) => {
    try {
        const body = await c.req.json();
        const v = validate(body, [
            { field: 'title', required: true, type: 'string', minLength: 2, maxLength: 500 },
            { field: 'assigned_to', required: true, type: 'number', min: 1 },
            { field: 'description', type: 'string', maxLength: 5000 },
            { field: 'case_id', type: 'number', min: 1 },
            { field: 'priority', type: 'string', oneOf: VALID_PRIORITIES },
            { field: 'status', type: 'string', oneOf: VALID_STATUSES },
            { field: 'task_type', type: 'string', oneOf: VALID_TYPES },
            { field: 'due_date', type: 'string', maxLength: 30 },
            { field: 'reminder_date', type: 'string', maxLength: 30 },
        ]);
        if (!v.valid)
            return badRequest(c, v.errors);
        // FK validation
        const fkErrors = [];
        const fk1 = await validateFK(c.env.DB, 'users_attorneys', body.assigned_to, 'assigned_to');
        if (fk1)
            fkErrors.push(fk1);
        if (body.case_id) {
            const fk2 = await validateFK(c.env.DB, 'cases_matters', body.case_id, 'case_id');
            if (fk2)
                fkErrors.push(fk2);
        }
        if (fkErrors.length)
            return badRequest(c, fkErrors);
        const safe = sanitize(body);
        const result = await c.env.DB.prepare(`
      INSERT INTO tasks_deadlines (title, description, case_id, assigned_to, assigned_by, priority, status, task_type, due_date, reminder_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(safe.title, safe.description || null, safe.case_id || null, safe.assigned_to, safe.assigned_by || 1, safe.priority || 'medium', safe.status || 'pending', safe.task_type || 'task', safe.due_date || null, safe.reminder_date || null).run();
        await auditLog(c.env.DB, 'create', 'tasks_deadlines', result.meta.last_row_id, 1, { title: safe.title, assigned_to: safe.assigned_to });
        return c.json({ id: result.meta.last_row_id }, 201);
    }
    catch (err) {
        await logError(c.env.DB, '/api/tasks', 'POST', err.message);
        return c.json({ error: 'Failed to create task', detail: err.message }, 500);
    }
});
// Update task — with existence check + audit
tasks.put('/:id', async (c) => {
    try {
        const id = c.req.param('id');
        if (!(await checkExists(c.env.DB, 'tasks_deadlines', id)))
            return notFound(c, 'Task');
        const body = await c.req.json();
        if (body.priority && !VALID_PRIORITIES.includes(body.priority))
            return badRequest(c, [`Invalid priority: ${body.priority}`]);
        if (body.status && !VALID_STATUSES.includes(body.status))
            return badRequest(c, [`Invalid status: ${body.status}`]);
        if (body.task_type && !VALID_TYPES.includes(body.task_type))
            return badRequest(c, [`Invalid task_type: ${body.task_type}`]);
        const allowed = ['title', 'description', 'case_id', 'assigned_to', 'priority', 'status', 'task_type', 'due_date', 'completed_date', 'reminder_date'];
        const { fields, values } = buildUpdateFields(body, allowed);
        if (!fields.length)
            return badRequest(c, ['No valid fields to update']);
        // Auto-set completed_date when completing
        if (body.status === 'completed' && !body.completed_date) {
            fields.push('completed_date = ?');
            values.push(new Date().toISOString());
        }
        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);
        await c.env.DB.prepare(`UPDATE tasks_deadlines SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
        await auditLog(c.env.DB, 'update', 'tasks_deadlines', id, 1, sanitize(body));
        return c.json({ success: true });
    }
    catch (err) {
        await logError(c.env.DB, `/api/tasks/${c.req.param('id')}`, 'PUT', err.message);
        return c.json({ error: 'Failed to update task', detail: err.message }, 500);
    }
});
// Soft-delete a task — with existence check + audit (DATA-02)
tasks.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (!(await checkExists(c.env.DB, 'tasks_deadlines', id)))
        return notFound(c, 'Task');
    await c.env.DB.prepare('UPDATE tasks_deadlines SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind('deleted', id).run();
    await auditLog(c.env.DB, 'soft_delete', 'tasks_deadlines', id, 1);
    return c.json({ success: true });
});
export default tasks;

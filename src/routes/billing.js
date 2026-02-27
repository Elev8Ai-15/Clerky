// ═══════════════════════════════════════════════════════════════
// CLERKY — Billing Routes v5.0
// Fixes: BUG-01 (validation), BUG-02 (XSS), BUG-03 (existence),
//        BUG-04 (safe IDs), DATA-01 (FK), DATA-03 (audit),
//        OPS-01 (pagination)
// ═══════════════════════════════════════════════════════════════
import { Hono } from 'hono';
import { validate, sanitize, parsePagination, checkExists, validateFK, auditLog, generateSafeId, badRequest, notFound, coalesceInt, logError, buildUpdateFields } from '../utils/shared';
const billing = new Hono();
const VALID_INVOICE_STATUSES = ['draft', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'cancelled', 'written_off'];
const VALID_ACTIVITY_TYPES = ['legal_work', 'consultation', 'research', 'drafting', 'court_appearance', 'travel', 'communication', 'review', 'administrative', 'other'];
// Dashboard stats — with COALESCE (BUG-05)
billing.get('/stats', async (c) => {
    const [totalRev, outstanding, overdue, monthly] = await Promise.all([
        c.env.DB.prepare("SELECT COALESCE(SUM(amount_paid),0) as total FROM billing_invoices WHERE status = 'paid'").first(),
        c.env.DB.prepare("SELECT COALESCE(SUM(total_amount - amount_paid),0) as total FROM billing_invoices WHERE status IN ('sent','viewed','partial')").first(),
        c.env.DB.prepare("SELECT COALESCE(SUM(total_amount - amount_paid),0) as total, COALESCE(COUNT(*),0) as count FROM billing_invoices WHERE status = 'overdue'").first(),
        c.env.DB.prepare("SELECT COALESCE(SUM(hours * rate),0) as total FROM time_entries WHERE is_billable = 1 AND entry_date >= date('now','-30 days')").first()
    ]);
    return c.json({
        total_revenue: coalesceInt(totalRev?.total),
        outstanding: coalesceInt(outstanding?.total),
        overdue_amount: coalesceInt(overdue?.total),
        overdue_count: coalesceInt(overdue?.count),
        monthly_billable: coalesceInt(monthly?.total)
    });
});
// List invoices — with pagination
billing.get('/invoices', async (c) => {
    const status = c.req.query('status');
    const clientId = c.req.query('client_id');
    const { page, pageSize, offset } = parsePagination(c);
    let query = `SELECT bi.*, c.first_name || ' ' || c.last_name as client_name, cm.case_number, cm.title as case_title
    FROM billing_invoices bi
    LEFT JOIN clients c ON bi.client_id = c.id
    LEFT JOIN cases_matters cm ON bi.case_id = cm.id WHERE 1=1`;
    let countQuery = `SELECT COUNT(*) as total FROM billing_invoices WHERE 1=1`;
    const params = [];
    const countParams = [];
    if (status) {
        query += ' AND bi.status = ?';
        countQuery += ' AND status = ?';
        params.push(status);
        countParams.push(status);
    }
    if (clientId) {
        query += ' AND bi.client_id = ?';
        countQuery += ' AND client_id = ?';
        params.push(clientId);
        countParams.push(clientId);
    }
    query += ' ORDER BY bi.created_at DESC LIMIT ? OFFSET ?';
    params.push(pageSize, offset);
    const [result, totalRow] = await Promise.all([
        c.env.DB.prepare(query).bind(...params).all(),
        c.env.DB.prepare(countQuery).bind(...countParams).first()
    ]);
    return c.json({ invoices: result.results, page, page_size: pageSize, total: coalesceInt(totalRow?.total) });
});
// Get invoice detail — with existence check
billing.get('/invoices/:id', async (c) => {
    const id = c.req.param('id');
    const invoice = await c.env.DB.prepare(`SELECT bi.*, c.first_name || ' ' || c.last_name as client_name, c.email as client_email, cm.case_number FROM billing_invoices bi LEFT JOIN clients c ON bi.client_id = c.id LEFT JOIN cases_matters cm ON bi.case_id = cm.id WHERE bi.id = ?`).bind(id).first();
    if (!invoice)
        return notFound(c, 'Invoice');
    const [lineItems, payments] = await Promise.all([
        c.env.DB.prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ?').bind(id).all(),
        c.env.DB.prepare('SELECT * FROM payments WHERE invoice_id = ? ORDER BY payment_date DESC').bind(id).all()
    ]);
    return c.json({ invoice, line_items: lineItems.results, payments: payments.results });
});
// Create invoice — with validation + FK checks + safe ID (BUG-04)
billing.post('/invoices', async (c) => {
    try {
        const body = await c.req.json();
        const v = validate(body, [
            { field: 'case_id', required: true, type: 'number', min: 1 },
            { field: 'client_id', required: true, type: 'number', min: 1 },
            { field: 'issued_by', type: 'number', min: 1 },
            { field: 'status', type: 'string', oneOf: VALID_INVOICE_STATUSES },
            { field: 'subtotal', type: 'number', min: 0 },
            { field: 'tax_rate', type: 'number', min: 0, max: 100 },
            { field: 'tax_amount', type: 'number', min: 0 },
            { field: 'total_amount', type: 'number', min: 0 },
            { field: 'due_date', type: 'string', maxLength: 30 },
            { field: 'notes', type: 'string', maxLength: 5000 },
            { field: 'payment_terms', type: 'string', maxLength: 100 },
        ]);
        if (!v.valid)
            return badRequest(c, v.errors);
        // FK validation
        const fkErrors = [];
        const fk1 = await validateFK(c.env.DB, 'cases_matters', body.case_id, 'case_id');
        const fk2 = await validateFK(c.env.DB, 'clients', body.client_id, 'client_id');
        if (fk1)
            fkErrors.push(fk1);
        if (fk2)
            fkErrors.push(fk2);
        if (fkErrors.length)
            return badRequest(c, fkErrors);
        const safe = sanitize(body);
        const invoiceNum = generateSafeId('INV');
        const result = await c.env.DB.prepare(`
      INSERT INTO billing_invoices (invoice_number, case_id, client_id, issued_by, status, subtotal, tax_rate, tax_amount, total_amount, due_date, notes, payment_terms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(invoiceNum, safe.case_id, safe.client_id, safe.issued_by || 1, safe.status || 'draft', safe.subtotal || 0, safe.tax_rate || 0, safe.tax_amount || 0, safe.total_amount || 0, safe.due_date || null, safe.notes || null, safe.payment_terms || 'net_30').run();
        await auditLog(c.env.DB, 'create', 'billing_invoices', result.meta.last_row_id, 1, { invoice_number: invoiceNum, client_id: safe.client_id, total_amount: safe.total_amount });
        return c.json({ id: result.meta.last_row_id, invoice_number: invoiceNum }, 201);
    }
    catch (err) {
        await logError(c.env.DB, '/api/billing/invoices', 'POST', err.message);
        return c.json({ error: 'Failed to create invoice', detail: err.message }, 500);
    }
});
// Update invoice — with existence check + audit
billing.put('/invoices/:id', async (c) => {
    try {
        const id = c.req.param('id');
        if (!(await checkExists(c.env.DB, 'billing_invoices', id)))
            return notFound(c, 'Invoice');
        const body = await c.req.json();
        if (body.status && !VALID_INVOICE_STATUSES.includes(body.status))
            return badRequest(c, [`Invalid status: ${body.status}`]);
        const allowed = ['status', 'subtotal', 'tax_rate', 'tax_amount', 'total_amount', 'amount_paid', 'due_date', 'sent_date', 'paid_date', 'notes', 'payment_terms'];
        const { fields, values } = buildUpdateFields(body, allowed);
        if (!fields.length)
            return badRequest(c, ['No valid fields to update']);
        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);
        await c.env.DB.prepare(`UPDATE billing_invoices SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
        await auditLog(c.env.DB, 'update', 'billing_invoices', id, 1, sanitize(body));
        return c.json({ success: true });
    }
    catch (err) {
        await logError(c.env.DB, `/api/billing/invoices/${c.req.param('id')}`, 'PUT', err.message);
        return c.json({ error: 'Failed to update invoice', detail: err.message }, 500);
    }
});
// Time entries — with pagination
billing.get('/time-entries', async (c) => {
    const caseId = c.req.query('case_id');
    const userId = c.req.query('user_id');
    const { page, pageSize, offset } = parsePagination(c);
    let query = `SELECT te.*, u.full_name as user_name, cm.case_number FROM time_entries te LEFT JOIN users_attorneys u ON te.user_id = u.id LEFT JOIN cases_matters cm ON te.case_id = cm.id WHERE 1=1`;
    let countQuery = `SELECT COUNT(*) as total FROM time_entries WHERE 1=1`;
    const params = [];
    const countParams = [];
    if (caseId) {
        query += ' AND te.case_id = ?';
        countQuery += ' AND case_id = ?';
        params.push(caseId);
        countParams.push(caseId);
    }
    if (userId) {
        query += ' AND te.user_id = ?';
        countQuery += ' AND user_id = ?';
        params.push(userId);
        countParams.push(userId);
    }
    query += ' ORDER BY te.entry_date DESC LIMIT ? OFFSET ?';
    params.push(pageSize, offset);
    const [result, totalRow] = await Promise.all([
        c.env.DB.prepare(query).bind(...params).all(),
        c.env.DB.prepare(countQuery).bind(...countParams).first()
    ]);
    return c.json({ time_entries: result.results, page, page_size: pageSize, total: coalesceInt(totalRow?.total) });
});
// Create time entry — with validation + FK checks
billing.post('/time-entries', async (c) => {
    try {
        const body = await c.req.json();
        const v = validate(body, [
            { field: 'case_id', required: true, type: 'number', min: 1 },
            { field: 'description', required: true, type: 'string', minLength: 2, maxLength: 2000 },
            { field: 'hours', required: true, type: 'number', min: 0.01, max: 24 },
            { field: 'rate', type: 'number', min: 0 },
            { field: 'activity_type', type: 'string', oneOf: VALID_ACTIVITY_TYPES },
            { field: 'entry_date', type: 'string', maxLength: 30 },
        ]);
        if (!v.valid)
            return badRequest(c, v.errors);
        // FK validation
        const fk = await validateFK(c.env.DB, 'cases_matters', body.case_id, 'case_id');
        if (fk)
            return badRequest(c, [fk]);
        const safe = sanitize(body);
        const result = await c.env.DB.prepare(`
      INSERT INTO time_entries (case_id, user_id, description, hours, rate, activity_type, is_billable, entry_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(safe.case_id, safe.user_id || 1, safe.description, safe.hours, safe.rate || 450, safe.activity_type || 'legal_work', safe.is_billable !== undefined ? safe.is_billable : 1, safe.entry_date || new Date().toISOString().split('T')[0]).run();
        await auditLog(c.env.DB, 'create', 'time_entries', result.meta.last_row_id, 1, { case_id: safe.case_id, hours: safe.hours });
        return c.json({ id: result.meta.last_row_id }, 201);
    }
    catch (err) {
        await logError(c.env.DB, '/api/billing/time-entries', 'POST', err.message);
        return c.json({ error: 'Failed to create time entry', detail: err.message }, 500);
    }
});
export default billing;

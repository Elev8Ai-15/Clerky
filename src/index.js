import { Hono } from 'hono';
import { cors } from 'hono/cors';
import cases from './routes/cases';
import clients from './routes/clients';
import documents from './routes/documents';
import billing from './routes/billing';
import calendar from './routes/calendar';
import tasks from './routes/tasks';
import ai from './routes/ai';
import users from './routes/users';
import notifications from './routes/notifications';
import legalResearch from './routes/legal-research';
import { globalErrorHandler, safeJsonParse, coalesceInt } from './utils/shared';
const app = new Hono();
// Global error handler — catches all uncaught exceptions (OPS-03)
app.use('*', globalErrorHandler);
// Safe JSON body parser — returns 400 for malformed JSON (BUG-01)
app.use('/api/*', safeJsonParse);
// CORS for API routes
app.use('/api/*', cors());
// API Routes
app.route('/api/cases', cases);
app.route('/api/clients', clients);
app.route('/api/documents', documents);
app.route('/api/billing', billing);
app.route('/api/calendar', calendar);
app.route('/api/tasks', tasks);
app.route('/api/ai', ai);
app.route('/api/users', users);
app.route('/api/notifications', notifications);
app.route('/api/legal-research', legalResearch);
// ── HEALTH CHECK (OPS-02) ───────────────────────────────────
app.get('/api/health', async (c) => {
    try {
        const dbCheck = await c.env.DB.prepare('SELECT 1 as ok').first();
        return c.json({
            status: 'healthy',
            version: '5.2.0',
            timestamp: new Date().toISOString(),
            database: dbCheck ? 'connected' : 'error',
            services: {
                ai_agents: 'active',
                legal_research: 'active',
                billing: 'active'
            }
        });
    }
    catch (err) {
        return c.json({ status: 'unhealthy', error: err.message }, 503);
    }
});
// Dashboard stats endpoint — with COALESCE fix (BUG-05)
app.get('/api/dashboard', async (c) => {
    const [casesCount, clientsCount, docsCount, tasksCount, upcomingEvents, recentActivity, unreadNotifs] = await Promise.all([
        c.env.DB.prepare("SELECT COALESCE(COUNT(*),0) as total, COALESCE(SUM(CASE WHEN status NOT IN ('closed','archived') THEN 1 ELSE 0 END),0) as active FROM cases_matters").first(),
        c.env.DB.prepare("SELECT COALESCE(COUNT(*),0) as total FROM clients WHERE status = 'active'").first(),
        c.env.DB.prepare("SELECT COALESCE(COUNT(*),0) as total FROM documents WHERE status != 'archived'").first(),
        c.env.DB.prepare("SELECT COALESCE(COUNT(*),0) as total, COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END),0) as pending, COALESCE(SUM(CASE WHEN status = 'overdue' OR (status = 'pending' AND due_date < date('now')) THEN 1 ELSE 0 END),0) as overdue FROM tasks_deadlines").first(),
        c.env.DB.prepare("SELECT ce.*, cm.case_number FROM calendar_events ce LEFT JOIN cases_matters cm ON ce.case_id = cm.id WHERE ce.start_datetime >= datetime('now') ORDER BY ce.start_datetime ASC LIMIT 5").all(),
        c.env.DB.prepare("SELECT al.*, cm.case_number FROM ai_logs al LEFT JOIN cases_matters cm ON al.case_id = cm.id ORDER BY al.created_at DESC LIMIT 5").all(),
        c.env.DB.prepare("SELECT COALESCE(COUNT(*),0) as count FROM notifications WHERE user_id = 1 AND is_read = 0").first()
    ]);
    return c.json({
        cases: { total: coalesceInt(casesCount?.total), active: coalesceInt(casesCount?.active) },
        clients: { total: coalesceInt(clientsCount?.total) },
        documents: { total: coalesceInt(docsCount?.total) },
        tasks: { total: coalesceInt(tasksCount?.total), pending: coalesceInt(tasksCount?.pending), overdue: coalesceInt(tasksCount?.overdue) },
        upcoming_events: upcomingEvents.results,
        recent_ai_activity: recentActivity.results,
        unread_notifications: coalesceInt(unreadNotifs?.count)
    });
});
// ── ADMIN AUTH HELPER (BUG-3 fix) ──────────────────────────
const DEFAULT_ADMIN_KEY = 'clerky-admin-2026';
function requireAdmin(c) {
    const adminKey = c.env.ADMIN_KEY || DEFAULT_ADMIN_KEY;
    const provided = c.req.header('X-Admin-Key') || c.req.query('admin_key');
    return provided === adminKey;
}
// Database init endpoint — PROTECTED (BUG-3)
app.get('/api/init-db', async (c) => {
    if (!requireAdmin(c))
        return c.json({ error: 'Unauthorized. Provide X-Admin-Key header or admin_key query param.' }, 403);
    const migrations = [
        // Migration 1: Core tables
        `CREATE TABLE IF NOT EXISTS users_attorneys (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, full_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'attorney', bar_number TEXT, phone TEXT, specialty TEXT, avatar_url TEXT, is_active INTEGER DEFAULT 1, password_hash TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT NOT NULL, last_name TEXT NOT NULL, email TEXT UNIQUE, phone TEXT, address TEXT, city TEXT, state TEXT, zip_code TEXT, date_of_birth TEXT, ssn_last4 TEXT, company_name TEXT, client_type TEXT DEFAULT 'individual', status TEXT DEFAULT 'active', notes TEXT, assigned_attorney_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS cases_matters (id INTEGER PRIMARY KEY AUTOINCREMENT, case_number TEXT UNIQUE NOT NULL, title TEXT NOT NULL, description TEXT, case_type TEXT NOT NULL, status TEXT DEFAULT 'open', priority TEXT DEFAULT 'medium', client_id INTEGER NOT NULL, lead_attorney_id INTEGER NOT NULL, court_name TEXT, court_case_number TEXT, judge_name TEXT, opposing_counsel TEXT, opposing_party TEXT, date_filed TEXT, date_closed TEXT, statute_of_limitations TEXT, estimated_value REAL, contingency_fee_pct REAL, retainer_amount REAL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, file_name TEXT NOT NULL, file_type TEXT, file_size INTEGER, file_url TEXT, category TEXT DEFAULT 'general', status TEXT DEFAULT 'draft', case_id INTEGER, uploaded_by INTEGER, ai_generated INTEGER DEFAULT 0, ai_summary TEXT, content_text TEXT, tags TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS ai_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, agent_type TEXT NOT NULL, action TEXT NOT NULL, input_data TEXT, output_data TEXT, tokens_used INTEGER DEFAULT 0, cost REAL DEFAULT 0, duration_ms INTEGER, status TEXT DEFAULT 'success', case_id INTEGER, user_id INTEGER, error_message TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, type TEXT DEFAULT 'info', is_read INTEGER DEFAULT 0, link TEXT, case_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        // Migration 2: Document processing
        `CREATE TABLE IF NOT EXISTS document_versions (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, version_number INTEGER NOT NULL DEFAULT 1, file_url TEXT, file_size INTEGER, change_summary TEXT, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS document_sharing (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, shared_with_user_id INTEGER, shared_with_email TEXT, permission TEXT DEFAULT 'view', access_token TEXT UNIQUE, expires_at DATETIME, is_active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS document_templates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, description TEXT, category TEXT NOT NULL, content_template TEXT NOT NULL, variables TEXT, case_type TEXT, is_active INTEGER DEFAULT 1, usage_count INTEGER DEFAULT 0, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        // Migration 3: Client portal
        `CREATE TABLE IF NOT EXISTS client_portal_access (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL, email TEXT NOT NULL, password_hash TEXT, access_token TEXT UNIQUE, is_active INTEGER DEFAULT 1, last_login DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS intake_forms (id INTEGER PRIMARY KEY AUTOINCREMENT, form_name TEXT NOT NULL, form_type TEXT NOT NULL, schema_json TEXT NOT NULL, is_active INTEGER DEFAULT 1, is_public INTEGER DEFAULT 0, access_url TEXT UNIQUE, submissions_count INTEGER DEFAULT 0, created_by INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS intake_submissions (id INTEGER PRIMARY KEY AUTOINCREMENT, form_id INTEGER NOT NULL, client_id INTEGER, submission_data TEXT NOT NULL, status TEXT DEFAULT 'pending', reviewed_by INTEGER, review_notes TEXT, converted_case_id INTEGER, submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP, reviewed_at DATETIME)`,
        `CREATE TABLE IF NOT EXISTS client_communications (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL, case_id INTEGER, user_id INTEGER NOT NULL, type TEXT NOT NULL, direction TEXT NOT NULL, subject TEXT, body TEXT NOT NULL, is_privileged INTEGER DEFAULT 0, attachments TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        // Migration 4: Case management
        `CREATE TABLE IF NOT EXISTS tasks_deadlines (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, case_id INTEGER, assigned_to INTEGER NOT NULL, assigned_by INTEGER, priority TEXT DEFAULT 'medium', status TEXT DEFAULT 'pending', task_type TEXT DEFAULT 'task', due_date TEXT, completed_date TEXT, reminder_date TEXT, is_recurring INTEGER DEFAULT 0, recurrence_pattern TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS calendar_events (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT, event_type TEXT NOT NULL, case_id INTEGER, organizer_id INTEGER NOT NULL, location TEXT, virtual_link TEXT, start_datetime TEXT NOT NULL, end_datetime TEXT NOT NULL, all_day INTEGER DEFAULT 0, color TEXT DEFAULT '#3B82F6', is_private INTEGER DEFAULT 0, reminder_minutes INTEGER DEFAULT 30, attendees TEXT, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS case_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, author_id INTEGER NOT NULL, title TEXT, content TEXT NOT NULL, note_type TEXT DEFAULT 'general', is_privileged INTEGER DEFAULT 0, is_pinned INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS time_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, user_id INTEGER NOT NULL, description TEXT NOT NULL, hours REAL NOT NULL, rate REAL NOT NULL, activity_type TEXT DEFAULT 'legal_work', is_billable INTEGER DEFAULT 1, is_billed INTEGER DEFAULT 0, invoice_id INTEGER, entry_date TEXT NOT NULL, timer_start TEXT, timer_end TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        // Migration 5: Billing
        `CREATE TABLE IF NOT EXISTS esignature_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, case_id INTEGER, requested_by INTEGER NOT NULL, signer_name TEXT NOT NULL, signer_email TEXT NOT NULL, status TEXT DEFAULT 'pending', provider TEXT DEFAULT 'internal', external_id TEXT, signing_url TEXT, signed_at DATETIME, expires_at DATETIME, reminder_sent INTEGER DEFAULT 0, ip_address TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS billing_invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_number TEXT UNIQUE NOT NULL, case_id INTEGER NOT NULL, client_id INTEGER NOT NULL, issued_by INTEGER NOT NULL, status TEXT DEFAULT 'draft', subtotal REAL NOT NULL DEFAULT 0, tax_rate REAL DEFAULT 0, tax_amount REAL DEFAULT 0, discount_amount REAL DEFAULT 0, total_amount REAL NOT NULL DEFAULT 0, amount_paid REAL DEFAULT 0, currency TEXT DEFAULT 'USD', due_date TEXT, sent_date TEXT, paid_date TEXT, notes TEXT, payment_terms TEXT DEFAULT 'net_30', stripe_invoice_id TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS invoice_line_items (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL, time_entry_id INTEGER, description TEXT NOT NULL, quantity REAL DEFAULT 1, rate REAL NOT NULL, item_type TEXT DEFAULT 'service', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS payment_methods (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL, type TEXT NOT NULL, provider TEXT DEFAULT 'stripe', external_id TEXT, last_four TEXT, brand TEXT, is_default INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL, payment_method_id INTEGER, amount REAL NOT NULL, currency TEXT DEFAULT 'USD', status TEXT DEFAULT 'completed', stripe_payment_id TEXT, transaction_ref TEXT, notes TEXT, payment_date TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        // Migration 6: Trust accounting
        `CREATE TABLE IF NOT EXISTS trust_accounts (id INTEGER PRIMARY KEY AUTOINCREMENT, client_id INTEGER NOT NULL, case_id INTEGER, account_name TEXT NOT NULL, balance REAL DEFAULT 0, currency TEXT DEFAULT 'USD', status TEXT DEFAULT 'active', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS trust_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, trust_account_id INTEGER NOT NULL, type TEXT NOT NULL, amount REAL NOT NULL, description TEXT NOT NULL, reference_number TEXT, balance_after REAL NOT NULL, authorized_by INTEGER NOT NULL, invoice_id INTEGER, transaction_date TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS case_expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, case_id INTEGER NOT NULL, description TEXT NOT NULL, amount REAL NOT NULL, category TEXT NOT NULL, is_billable INTEGER DEFAULT 1, is_reimbursed INTEGER DEFAULT 0, receipt_url TEXT, vendor TEXT, expense_date TEXT NOT NULL, submitted_by INTEGER NOT NULL, approved_by INTEGER, invoice_id INTEGER, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS conflict_checks (id INTEGER PRIMARY KEY AUTOINCREMENT, checked_name TEXT NOT NULL, checked_entity TEXT, case_id INTEGER, checked_by INTEGER NOT NULL, result TEXT NOT NULL, details TEXT, related_case_ids TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        // Document analysis table
        `CREATE TABLE IF NOT EXISTS document_analysis (id INTEGER PRIMARY KEY AUTOINCREMENT, document_id INTEGER NOT NULL, analysis_type TEXT DEFAULT 'full', summary TEXT, doc_classification TEXT, entities_json TEXT, key_dates_json TEXT, monetary_values_json TEXT, parties_json TEXT, citations_json TEXT, clauses_json TEXT, risk_flags_json TEXT, obligations_json TEXT, deadlines_json TEXT, jurisdiction_detected TEXT, confidence REAL DEFAULT 0, tokens_used INTEGER DEFAULT 0, analyzed_by TEXT DEFAULT 'ai', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (document_id) REFERENCES documents(id))`,
        // Audit log table (DATA-03)
        `CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, user_id INTEGER NOT NULL, changes_json TEXT, old_values_json TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        // Error logs table (OPS-04)
        `CREATE TABLE IF NOT EXISTS error_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, route TEXT NOT NULL, method TEXT NOT NULL, error_message TEXT NOT NULL, details TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        // Performance indexes (PERF-01)
        `CREATE INDEX IF NOT EXISTS idx_cases_client ON cases_matters(client_id)`,
        // BUG-17 fix: Add status column to calendar_events for soft-delete support
        `ALTER TABLE calendar_events ADD COLUMN status TEXT DEFAULT 'active'`,
        `CREATE INDEX IF NOT EXISTS idx_cases_attorney ON cases_matters(lead_attorney_id)`,
        `CREATE INDEX IF NOT EXISTS idx_cases_status ON cases_matters(status)`,
        `CREATE INDEX IF NOT EXISTS idx_docs_case ON documents(case_id)`,
        `CREATE INDEX IF NOT EXISTS idx_tasks_case ON tasks_deadlines(case_id)`,
        `CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks_deadlines(assigned_to)`,
        `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks_deadlines(status)`,
        `CREATE INDEX IF NOT EXISTS idx_invoices_client ON billing_invoices(client_id)`,
        `CREATE INDEX IF NOT EXISTS idx_invoices_case ON billing_invoices(case_id)`,
        `CREATE INDEX IF NOT EXISTS idx_time_entries_case ON time_entries(case_id)`,
        `CREATE INDEX IF NOT EXISTS idx_notifs_user ON notifications(user_id, is_read)`,
        `CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id)`,
        `CREATE INDEX IF NOT EXISTS idx_calendar_start ON calendar_events(start_datetime)`
    ];
    for (const sql of migrations) {
        try {
            await c.env.DB.prepare(sql).run();
        }
        catch (e) { /* ALTER TABLE may fail if column exists */ }
    }
    // Seed data — only the admin user
    const seedStatements = [
        `INSERT OR IGNORE INTO users_attorneys (id, email, full_name, role, bar_number, phone, specialty) VALUES (1, 'brad@clerky.com', 'Brad', 'admin', 'KS-MO-2019-001', '(816) 555-0101', 'General Practice')`
    ];
    for (const sql of seedStatements) {
        try {
            await c.env.DB.prepare(sql).run();
        }
        catch (e) { /* ignore duplicates */ }
    }
    return c.json({ success: true, message: 'Database initialized with 26 tables' });
});
// Reset DB: wipe all data and re-seed with only Brad — PROTECTED (BUG-3)
app.get('/api/reset-db', async (c) => {
    if (!requireAdmin(c))
        return c.json({ error: 'Unauthorized. Provide X-Admin-Key header or admin_key query param.' }, 403);
    const tables = [
        'notifications', 'ai_logs', 'payments', 'invoice_line_items', 'billing_invoices',
        'time_entries', 'case_notes', 'calendar_events', 'tasks_deadlines', 'esignature_requests',
        'trust_transactions', 'trust_accounts', 'case_expenses', 'conflict_checks',
        'client_communications', 'intake_submissions', 'intake_forms', 'client_portal_access',
        'document_analysis', 'document_sharing', 'document_versions', 'document_templates', 'documents',
        'cases_matters', 'clients', 'ai_chat_messages', 'users_attorneys', 'audit_log', 'error_logs'
    ];
    for (const t of tables) {
        try {
            await c.env.DB.prepare(`DELETE FROM ${t}`).run();
        }
        catch (e) { /* table may not exist */ }
    }
    // Re-seed admin user
    await c.env.DB.prepare(`INSERT OR IGNORE INTO users_attorneys (id, email, full_name, role, bar_number, phone, specialty) VALUES (1, 'brad@clerky.com', 'Brad', 'admin', 'KS-MO-2019-001', '(816) 555-0101', 'General Practice')`).run();
    return c.json({ success: true, message: 'All data cleared. Fresh start with admin user Brad.' });
});
// Serve the SPA for all non-API routes
app.get('*', (c) => {
    return c.html(getAppHTML());
});
function getAppHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Clerky - Legal Practice Management</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'sans-serif'] },
          colors: {
            border: 'hsl(var(--border))',
            input: 'hsl(var(--input))',
            ring: 'hsl(var(--ring))',
            background: 'hsl(var(--background))',
            foreground: 'hsl(var(--foreground))',
            brand: { 50:'#fef2f2', 100:'#fde8e8', 200:'#f8c4c4', 300:'#f09898', 400:'#e65c5c', 500:'#cc2229', 600:'#b81e24', 700:'#9b1a20', 800:'#7f151a', 900:'#5c1015' },
            dark: { 50:'#edf1f7', 100:'#dde4ee', 200:'#c5d0e0', 300:'#8899b3', 400:'#6b7ea0', 500:'#4e6180', 600:'#3d5a80', 700:'#2a4068', 800:'#1e3354', 900:'#142440', 950:'#0d1a2e' },
            primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
            secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
            destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
            muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
            accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
            popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
            card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
          },
          borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
          keyframes: {
            'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
            'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
          },
          animation: { 'accordion-down': 'accordion-down 0.2s ease-out', 'accordion-up': 'accordion-up 0.2s ease-out' }
        }
      }
    }
  </script>
  <style>
    /* ═══ shadcn/ui Design Tokens ═══ */
    :root {
      --background: 0 0% 100%;
      --foreground: 222.2 84% 4.9%;
      --card: 0 0% 100%;
      --card-foreground: 222.2 84% 4.9%;
      --popover: 0 0% 100%;
      --popover-foreground: 222.2 84% 4.9%;
      --primary: 353 73% 47%;
      --primary-foreground: 0 0% 100%;
      --secondary: 210 40% 96.1%;
      --secondary-foreground: 222.2 47.4% 11.2%;
      --muted: 210 40% 96.1%;
      --muted-foreground: 215.4 16.3% 46.9%;
      --accent: 210 40% 96.1%;
      --accent-foreground: 222.2 47.4% 11.2%;
      --destructive: 0 84.2% 60.2%;
      --destructive-foreground: 210 40% 98%;
      --border: 214.3 31.8% 91.4%;
      --input: 214.3 31.8% 91.4%;
      --ring: 353 73% 47%;
      --radius: 0.625rem;
      --chart-1: 12 76% 61%;
      --chart-2: 173 58% 39%;
      --chart-3: 197 37% 24%;
      --chart-4: 43 74% 66%;
      --chart-5: 27 87% 67%;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; border-color: hsl(var(--border)); }
    body { font-family: 'Inter', sans-serif; background: hsl(var(--background)); color: hsl(var(--foreground)); }

    /* ═══ shadcn/ui Button Components ═══ */
    .btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; white-space: nowrap; border-radius: var(--radius); font-weight: 500; font-size: 0.875rem; line-height: 1.25rem; cursor: pointer; transition: all 0.15s ease; border: none; outline: none; padding: 0.5rem 1rem; height: 2.5rem; }
    .btn:focus-visible { outline: 2px solid hsl(var(--ring)); outline-offset: 2px; }
    .btn:disabled { pointer-events: none; opacity: 0.5; }
    .btn-primary { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
    .btn-primary:hover { background: hsl(var(--primary) / 0.9); }
    .btn-secondary { background: hsl(var(--secondary)); color: hsl(var(--secondary-foreground)); border: 1px solid hsl(var(--border)); }
    .btn-secondary:hover { background: hsl(var(--accent)); }
    .btn-destructive, .btn-danger { background: hsl(var(--destructive)); color: hsl(var(--destructive-foreground)); }
    .btn-destructive:hover, .btn-danger:hover { background: hsl(var(--destructive) / 0.9); }
    .btn-outline { border: 1px solid hsl(var(--input)); background: hsl(var(--background)); color: hsl(var(--foreground)); }
    .btn-outline:hover { background: hsl(var(--accent)); color: hsl(var(--accent-foreground)); }
    .btn-ghost { background: transparent; color: hsl(var(--foreground)); }
    .btn-ghost:hover { background: hsl(var(--accent)); color: hsl(var(--accent-foreground)); }
    .btn-link { background: transparent; color: hsl(var(--primary)); text-decoration-line: underline; text-underline-offset: 4px; padding: 0; height: auto; }
    .btn-link:hover { text-decoration-line: underline; }
    .btn-success { background: hsl(142.1 76.2% 36.3%); color: white; }
    .btn-success:hover { background: hsl(142.1 76.2% 30%); }
    .btn-sm { height: 2.25rem; padding: 0.25rem 0.75rem; font-size: 0.8rem; border-radius: calc(var(--radius) - 2px); }
    .btn-lg { height: 2.75rem; padding: 0.5rem 2rem; font-size: 0.9375rem; border-radius: var(--radius); }
    .btn-icon { height: 2.5rem; width: 2.5rem; padding: 0; }

    /* ═══ shadcn/ui Card Component ═══ */
    .card { background: hsl(var(--card)); color: hsl(var(--card-foreground)); border-radius: var(--radius); border: 1px solid hsl(var(--border)); box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05); transition: box-shadow 0.2s ease; }
    .card:hover { box-shadow: 0 4px 12px rgb(0 0 0 / 0.08); }
    .card-header { display: flex; flex-direction: column; gap: 0.375rem; padding: 1.5rem; }
    .card-title { font-size: 1.5rem; font-weight: 600; line-height: 1; letter-spacing: -0.025em; }
    .card-description { font-size: 0.875rem; color: hsl(var(--muted-foreground)); }
    .card-content { padding: 1.5rem; padding-top: 0; }
    .card-footer { display: flex; align-items: center; padding: 1.5rem; padding-top: 0; }

    /* ═══ shadcn/ui Badge Component ═══ */
    .badge { display: inline-flex; align-items: center; border-radius: 9999px; padding: 0.125rem 0.625rem; font-size: 0.75rem; font-weight: 600; line-height: 1.25; transition: colors 0.15s; border: 1px solid transparent; }
    .badge-default { background: hsl(var(--primary)); color: hsl(var(--primary-foreground)); }
    .badge-secondary { background: hsl(var(--secondary)); color: hsl(var(--secondary-foreground)); border-color: hsl(var(--border)); }
    .badge-destructive { background: hsl(var(--destructive)); color: hsl(var(--destructive-foreground)); }
    .badge-outline { background: transparent; color: hsl(var(--foreground)); border-color: hsl(var(--border)); }
    .badge-success { background: hsl(142.1 76.2% 36.3% / 0.1); color: hsl(142.1 76.2% 36.3%); border-color: hsl(142.1 76.2% 36.3% / 0.2); }
    .badge-warning { background: hsl(38 92% 50% / 0.1); color: hsl(38 92% 40%); border-color: hsl(38 92% 50% / 0.2); }

    /* ═══ shadcn/ui Input / Textarea ═══ */
    input, select, textarea { display: flex; width: 100%; border-radius: calc(var(--radius) - 2px); border: 1px solid hsl(var(--input)); background: hsl(var(--background)); padding: 0.5rem 0.75rem; font-size: 0.875rem; line-height: 1.25rem; color: hsl(var(--foreground)); outline: none; transition: all 0.15s ease; }
    input::placeholder, textarea::placeholder { color: hsl(var(--muted-foreground)); }
    input:focus, select:focus, textarea:focus { border-color: hsl(var(--ring)); box-shadow: 0 0 0 2px hsl(var(--ring) / 0.2); }
    input:disabled, select:disabled, textarea:disabled { cursor: not-allowed; opacity: 0.5; }
    textarea { min-height: 5rem; resize: vertical; }

    /* ═══ shadcn/ui Separator ═══ */
    .separator { shrink: 0; background: hsl(var(--border)); height: 1px; width: 100%; }
    .separator-vertical { height: auto; width: 1px; }

    /* ═══ shadcn/ui Tabs ═══ */
    .tabs-list { display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius); background: hsl(var(--muted)); padding: 0.25rem; gap: 0.125rem; }
    .tabs-trigger { display: inline-flex; align-items: center; justify-content: center; white-space: nowrap; border-radius: calc(var(--radius) - 2px); padding: 0.375rem 0.75rem; font-size: 0.875rem; font-weight: 500; transition: all 0.15s; cursor: pointer; border: none; background: transparent; color: hsl(var(--muted-foreground)); }
    .tabs-trigger:hover { color: hsl(var(--foreground)); }
    .tabs-trigger.active { background: hsl(var(--background)); color: hsl(var(--foreground)); box-shadow: 0 1px 2px rgb(0 0 0 / 0.05); }
    .tabs-content { margin-top: 0.5rem; }

    /* ═══ shadcn/ui Avatar ═══ */
    .avatar { position: relative; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 9999px; flex-shrink: 0; }
    .avatar-sm { width: 2rem; height: 2rem; font-size: 0.75rem; }
    .avatar-md { width: 2.5rem; height: 2.5rem; font-size: 0.875rem; }
    .avatar-lg { width: 3rem; height: 3rem; font-size: 1rem; }
    .avatar img { aspect-ratio: 1/1; height: 100%; width: 100%; object-fit: cover; }
    .avatar-fallback { display: flex; height: 100%; width: 100%; align-items: center; justify-content: center; border-radius: 9999px; background: hsl(var(--muted)); color: hsl(var(--muted-foreground)); font-weight: 600; }

    /* ═══ shadcn/ui Tooltip ═══ */
    .tooltip { position: relative; display: inline-flex; }
    .tooltip-content { position: absolute; z-index: 50; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); overflow: hidden; border-radius: calc(var(--radius) - 2px); background: hsl(var(--foreground)); padding: 0.375rem 0.75rem; font-size: 0.75rem; color: hsl(var(--background)); box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1); pointer-events: none; opacity: 0; transition: opacity 0.15s; white-space: nowrap; }
    .tooltip:hover .tooltip-content { opacity: 1; }

    /* ═══ shadcn/ui Scroll Area ═══ */
    .scroll-area { position: relative; overflow: hidden; }
    .scroll-area > .scroll-viewport { height: 100%; width: 100%; overflow-y: auto; overflow-x: hidden; }
    .scroll-area > .scroll-viewport::-webkit-scrollbar { width: 6px; }
    .scroll-area > .scroll-viewport::-webkit-scrollbar-track { background: transparent; }
    .scroll-area > .scroll-viewport::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 3px; }
    .scroll-area > .scroll-viewport::-webkit-scrollbar-thumb:hover { background: hsl(var(--muted-foreground) / 0.4); }

    /* ═══ shadcn/ui Toast / Sonner ═══ */
    .toast-container { position: fixed; bottom: 1rem; right: 1rem; z-index: 9999; display: flex; flex-direction: column; gap: 0.5rem; max-width: 420px; }
    .toast { display: flex; align-items: center; gap: 0.75rem; padding: 1rem 1.25rem; border-radius: var(--radius); border: 1px solid hsl(var(--border)); background: hsl(var(--card)); color: hsl(var(--card-foreground)); box-shadow: 0 4px 12px rgb(0 0 0 / 0.12); animation: slideInRight 0.3s ease, fadeOut 0.3s ease 4.7s forwards; }
    .toast-success { border-color: hsl(142.1 76.2% 36.3% / 0.3); }
    .toast-error { border-color: hsl(var(--destructive) / 0.3); }
    .toast-title { font-weight: 600; font-size: 0.875rem; }
    .toast-description { font-size: 0.8125rem; color: hsl(var(--muted-foreground)); }
    .toast-close { margin-left: auto; cursor: pointer; opacity: 0.5; background: none; border: none; color: inherit; font-size: 1rem; }
    .toast-close:hover { opacity: 1; }
    @keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes fadeOut { to { opacity: 0; transform: translateX(30%); } }

    /* ═══ shadcn/ui Table ═══ */
    .ui-table { width: 100%; caption-side: bottom; font-size: 0.875rem; }
    .ui-table thead { border-bottom: 1px solid hsl(var(--border)); }
    .ui-table th { height: 3rem; padding: 0 1rem; text-align: left; font-weight: 500; color: hsl(var(--muted-foreground)); vertical-align: middle; }
    .ui-table td { padding: 1rem; vertical-align: middle; }
    .ui-table tbody tr { border-bottom: 1px solid hsl(var(--border)); transition: background 0.1s; }
    .ui-table tbody tr:hover { background: hsl(var(--muted) / 0.5); }

    /* ═══ Existing Custom Styles (preserved) ═══ */
    .sidebar-link { transition: all 0.15s ease; }
    .sidebar-link:hover, .sidebar-link.active { background: rgba(255,255,255,0.1); }
    .sidebar-link.active { border-right: 3px solid #cc2229; background: rgba(204,34,41,0.15); }
    .table-row { transition: background 0.1s; }
    .table-row:hover { background: hsl(var(--muted) / 0.5); }
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 50; backdrop-filter: blur(4px); }
    .modal { background: hsl(var(--card)); border-radius: var(--radius); max-width: 600px; width: 90%; max-height: 85vh; overflow-y: auto; border: 1px solid hsl(var(--border)); box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25); }
    .stat-card { background: linear-gradient(135deg, var(--from), var(--to)); border-radius: var(--radius); color: white; padding: 1.5rem; }
    .fade-in { animation: fadeIn 0.3s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .pulse { animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .scrollbar-thin::-webkit-scrollbar { width: 6px; }
    .scrollbar-thin::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 3px; }
    .ai-glow { box-shadow: 0 0 20px hsl(var(--primary) / 0.3); }
    .chip { padding: 0.25rem 0.75rem; border-radius: 9999px; font-size: 0.7rem; font-weight: 500; cursor: pointer; transition: all 0.15s; border: 1px solid hsl(var(--border)); background: hsl(var(--secondary)); color: hsl(var(--secondary-foreground)); white-space: nowrap; flex-shrink: 0; }
    .chip:hover { background: hsl(142.1 76.2% 36.3% / 0.1); border-color: hsl(142.1 76.2% 36.3% / 0.5); color: hsl(142.1 76.2% 36.3%); transform: translateY(-1px); }
    .chip-glow { background: hsl(142.1 76.2% 36.3% / 0.1); border-color: hsl(142.1 76.2% 36.3% / 0.5); color: hsl(142.1 76.2% 36.3%); font-weight: 600; }
    .chip-glow:hover { background: hsl(142.1 76.2% 36.3% / 0.15); box-shadow: 0 0 12px hsl(142.1 76.2% 36.3% / 0.3); }

    /* ═══ Mobile Responsive ═══ */
    /* Sidebar overlay on mobile */
    #sidebarOverlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 40; backdrop-filter: blur(2px); }
    #sidebarOverlay.active { display: block; }

    /* ── Bottom Navigation Bar (mobile) ── */
    #mobileBottomNav { display: none; }
    @media (max-width: 1023px) {
      #mobileBottomNav {
        display: flex;
        position: fixed;
        bottom: 0; left: 0; right: 0;
        z-index: 45;
        background: #1e3354;
        border-top: 1px solid #2a4068;
        padding: 0;
        padding-bottom: env(safe-area-inset-bottom, 0px);
        justify-content: space-around;
        align-items: stretch;
        box-shadow: 0 -2px 12px rgba(0,0,0,0.3);
      }
      #mobileBottomNav button {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        padding: 8px 4px;
        background: transparent;
        border: none;
        color: #6b7ea0;
        font-size: 10px;
        cursor: pointer;
        transition: color 0.15s, background 0.15s;
        position: relative;
      }
      #mobileBottomNav button i { font-size: 16px; }
      #mobileBottomNav button.active { color: #cc2229; }
      #mobileBottomNav button.active::after {
        content: '';
        position: absolute;
        top: 0; left: 25%; right: 25%;
        height: 2px;
        background: #cc2229;
        border-radius: 0 0 2px 2px;
      }
      #mobileBottomNav button:active { background: rgba(255,255,255,0.05); }
      /* Push page content above bottom nav */
      #pageContent { padding-bottom: 70px !important; }
      /* Reduce page-level padding on mobile */
      #pageContent { padding: 12px !important; padding-bottom: 70px !important; }
    }

    @media (max-width: 1023px) {
      #sidebar {
        position: fixed;
        top: 0; left: 0; bottom: 0;
        z-index: 50;
        transform: translateX(-100%);
        width: 272px;
      }
      #sidebar.sidebar-open {
        transform: translateX(0);
      }
      /* Mobile header adjustments */
      .mobile-search { width: 100% !important; max-width: 180px; }
      /* Page headers stack on mobile */
      .mobile-header-stack { flex-direction: column !important; align-items: flex-start !important; gap: 0.75rem !important; }
      .mobile-header-stack .flex { flex-wrap: wrap; gap: 0.5rem; }
      /* Title text smaller on mobile */
      .mobile-title-sm { font-size: 1.25rem !important; }
      /* Chat header stacks vertically on small screens */
      .chat-header-row { flex-wrap: wrap; gap: 0.5rem; }
      .chat-controls { flex-wrap: wrap; gap: 0.375rem; }
      .chat-controls select { max-width: 140px !important; font-size: 0.65rem; }
      /* Prompt chips scroll horizontally */
      .chips-row { overflow-x: auto; flex-wrap: nowrap !important; -webkit-overflow-scrolling: touch; padding-bottom: 0.25rem; }
      .chips-row::-webkit-scrollbar { display: none; }
      /* Stat cards 2-col on mobile */
      .stat-grid-mobile { grid-template-columns: repeat(2, 1fr) !important; }
      /* Table horizontal scroll */
      .table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .table-scroll table { min-width: 640px; }
      /* Chat messages full width */
      .chat-msg-max { max-width: 95% !important; }
      /* AI Chat header — stack controls */
      .chat-head-mobile { flex-direction: column !important; align-items: stretch !important; gap: 0.5rem !important; }
      .chat-head-mobile .flex { flex-wrap: wrap; }
      .chat-head-controls { flex-wrap: wrap !important; gap: 0.375rem !important; }
      .chat-head-controls select { flex: 1; min-width: 0; max-width: none !important; font-size: 0.7rem !important; }
      /* Matter bar scroll on mobile */
      .matter-bar-mobile { overflow-x: auto; white-space: nowrap; -webkit-overflow-scrolling: touch; }
      .matter-bar-mobile::-webkit-scrollbar { display: none; }
      /* Task card badges wrap */
      .task-card-mobile { flex-wrap: wrap !important; gap: 0.5rem !important; }
      .task-badges-mobile { display: flex; gap: 0.25rem; flex-wrap: wrap; margin-top: 0.25rem; }
      /* Memory search bar stacks */
      .memory-search-bar { flex-direction: column !important; }
      .memory-search-bar select { width: 100% !important; }
      /* AI Workflow architecture scrolls */
      .workflow-arch-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .workflow-arch-scroll::-webkit-scrollbar { display: none; }
      .workflow-arch-scroll > div { min-width: 600px; }
      /* AI Workflow stats grid */
      .workflow-stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
      /* Filter buttons scroll on mobile */
      .filter-scroll { overflow-x: auto; flex-wrap: nowrap !important; -webkit-overflow-scrolling: touch; padding-bottom: 4px; }
      .filter-scroll::-webkit-scrollbar { display: none; }
      .filter-scroll button { flex-shrink: 0; }
      /* Intake pipeline diagram scroll */
      .intake-pipeline-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .intake-pipeline-scroll::-webkit-scrollbar { display: none; }
      .intake-pipeline-scroll > div { min-width: 520px; }
      /* Compact card padding */
      .card { padding: 0.75rem; }
      .card.p-5 { padding: 0.875rem !important; }
      .card.p-6 { padding: 1rem !important; }
    }

    @media (max-width: 480px) {
      .stat-grid-mobile { grid-template-columns: 1fr !important; }
      .chat-controls select { max-width: 110px !important; }
      .mobile-search { max-width: 120px; }
      .mobile-title-sm { font-size: 1.1rem !important; }
      /* Even more compact */
      .workflow-stats-grid { grid-template-columns: 1fr !important; }
    }

    .chat-content h3 { margin-top: 12px; }
    .chat-content h4 { margin-top: 8px; }
    .chat-content hr { margin: 12px 0; border-color: hsl(var(--border)); }
    .prose-sm { line-height: 1.65; }
    #splash { position: fixed; inset: 0; z-index: 9999; transition: opacity 0.8s ease, visibility 0.8s ease; }
    #splash.hide { opacity: 0; visibility: hidden; pointer-events: none; }
    .hero-bg { background: linear-gradient(135deg, #0d1a2e 0%, #1e3354 50%, #2a4068 100%); }
    #splash .splash-dot { animation: splashDot 1.4s ease-in-out infinite; }
    @keyframes splashDot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.8); } }

    /* ═══ Toast JS helper — global function ═══ */
    /* ═══ Accessibility: Screen Reader Only ═══ */
    .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    .focus\\:not-sr-only:focus { position: static; width: auto; height: auto; padding: initial; margin: initial; overflow: visible; clip: auto; white-space: normal; }
  </style>
</head>
<body class="bg-dark-50">
  <!-- Skip to main content — accessibility -->
  <a href="#pageContent" class="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:text-brand-600 focus:p-3 focus:rounded-lg focus:shadow-lg" style="top:4px;left:4px">Skip to main content</a>
  <!-- Splash Screen -->
  <div id="splash" class="hero-bg min-h-screen flex items-center justify-center">
    <div class="max-w-2xl mx-auto text-center px-6">
      <div class="flex items-center justify-center gap-4 mb-8">
        <img src="/static/clerky-logo.png" alt="Clerky" class="h-20 w-auto drop-shadow-lg">
      </div>
      <p class="text-xl mb-2" style="color:#cc2229; font-weight:600">AI-Powered Legal Practice Management</p>
      <p class="text-2xl text-slate-300 mb-12">Your always-on senior partner, researcher, analyst &amp; drafter.</p>
      <div class="backdrop-blur-xl rounded-3xl p-10 border" style="background:rgba(13,26,46,0.8); border-color:#2a4068">
        <div id="splashStatus" class="flex items-center justify-center gap-3 mb-6">
          <div class="w-3 h-3 rounded-full splash-dot" style="background:#cc2229"></div>
          <span class="font-medium" style="color:#8899b3">Loading secure AI platform...</span>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left text-sm text-white">
          <div class="rounded-2xl p-4" style="background:rgba(42,64,104,0.5)">
            <i class="fa-solid fa-magnifying-glass mb-2" style="color:#cc2229"></i>
            <div class="font-semibold">Instant Research</div>
            <div style="color:#6b7ea0">Case law \u2022 Statutes \u2022 Precedents</div>
          </div>
          <div class="rounded-2xl p-4" style="background:rgba(42,64,104,0.5)">
            <i class="fa-solid fa-file-lines mb-2" style="color:#cc2229"></i>
            <div class="font-semibold">Smart Drafting</div>
            <div style="color:#6b7ea0">Motions \u2022 Contracts \u2022 Demands</div>
          </div>
          <div class="rounded-2xl p-4" style="background:rgba(42,64,104,0.5)">
            <i class="fa-solid fa-brain mb-2" style="color:#cc2229"></i>
            <div class="font-semibold">Deep Analysis</div>
            <div style="color:#6b7ea0">Risk \u2022 Strategy \u2022 Outcomes</div>
          </div>
        </div>
      </div>
      <button id="splashContinueBtn" onclick="dismissSplash()" class="mt-8 px-8 py-3 text-white font-semibold rounded-xl transition-all text-lg hidden" style="cursor:pointer; border:none; background:#cc2229" onmouseover="this.style.background='#e02e35'" onmouseout="this.style.background='#cc2229'">
        Enter Platform <i class="fas fa-arrow-right ml-2"></i>
      </button>
      <div class="mt-6 text-xs flex items-center justify-center gap-6 flex-wrap" style="color:#6b7ea0">
        <div>\uD83D\uDD12 SOC-2 Ready \u2022 End-to-End Encrypted</div>
        <div>\uD83C\uDDFA\uD83C\uDDF8 Kansas & Missouri \u2022 Dual-Jurisdiction</div>
      </div>
    </div>
  </div>

  <!-- Sidebar Overlay (mobile) -->
  <div id="sidebarOverlay" onclick="closeSidebar()"></div>

  <div id="app" class="flex h-screen overflow-hidden" role="application">
    <!-- Sidebar -->
    <aside id="sidebar" class="w-64 text-white flex flex-col flex-shrink-0 transition-transform duration-300 ease-in-out" style="background:#1e3354" role="navigation" aria-label="Main navigation">
      <div class="p-6 border-b" style="border-color:#2a4068">
        <div class="flex items-center gap-3">
          <img src="/static/clerky-logo.png" alt="Clerky" class="h-9 w-auto">
          <div>
            <h1 class="text-xl font-bold tracking-tight">Clerky</h1>
            <p class="text-xs" style="color:#6b7ea0">Legal Practice Platform</p>
          </div>
        </div>
      </div>
      <nav class="flex-1 py-4 overflow-y-auto scrollbar-thin">
        <div class="px-4 mb-2 text-xs font-semibold uppercase tracking-wider" style="color:#6b7ea0">Main</div>
        <a onclick="navigate('dashboard')" class="sidebar-link active flex items-center gap-3 px-6 py-3 cursor-pointer text-sm" data-page="dashboard">
          <i class="fas fa-chart-line w-5 text-center"></i> Dashboard
        </a>
        <a onclick="navigate('cases')" class="sidebar-link flex items-center gap-3 px-6 py-3 cursor-pointer text-sm" data-page="cases">
          <i class="fas fa-briefcase w-5 text-center"></i> Cases
        </a>
        <a onclick="navigate('clients')" class="sidebar-link flex items-center gap-3 px-6 py-3 cursor-pointer text-sm" data-page="clients">
          <i class="fas fa-users w-5 text-center"></i> Clients
        </a>
        <a onclick="navigate('documents')" class="sidebar-link flex items-center gap-3 px-6 py-3 cursor-pointer text-sm" data-page="documents">
          <i class="fas fa-file-alt w-5 text-center"></i> Documents
        </a>
        <div class="px-4 mt-6 mb-2 text-xs font-semibold uppercase tracking-wider" style="color:#6b7ea0">Management</div>
        <a onclick="navigate('calendar')" class="sidebar-link flex items-center gap-3 px-6 py-3 cursor-pointer text-sm" data-page="calendar">
          <i class="fas fa-calendar-days w-5 text-center"></i> Calendar
        </a>
        <a onclick="navigate('tasks')" class="sidebar-link flex items-center gap-3 px-6 py-3 cursor-pointer text-sm" data-page="tasks">
          <i class="fas fa-check-circle w-5 text-center"></i> Tasks
        </a>
        <a onclick="navigate('billing')" class="sidebar-link flex items-center gap-3 px-6 py-3 cursor-pointer text-sm" data-page="billing">
          <i class="fas fa-receipt w-5 text-center"></i> Billing
        </a>
        <div class="px-4 mt-6 mb-2 text-xs font-semibold uppercase tracking-wider" style="color:#6b7ea0">Research & AI</div>
        <a onclick="navigate('legal-research')" class="sidebar-link flex items-center gap-3 px-6 py-3 cursor-pointer text-sm" data-page="legal-research">
          <i class="fas fa-search w-5 text-center" style="color:#10b981"></i> <span style="color:#6ee7b7">Legal Research</span>
          <span class="ml-auto text-white text-xs px-2 py-0.5 rounded-full" style="background:#059669">Live</span>
        </a>
        <a onclick="navigate('ai-chat')" class="sidebar-link flex items-center gap-3 px-6 py-3 cursor-pointer text-sm" data-page="ai-chat">
          <i class="fas fa-scale-balanced w-5 text-center" style="color:#cc2229"></i> <span style="color:#f09898">AI Co-Counsel</span>
          <span class="ml-auto text-white text-xs px-2 py-0.5 rounded-full" style="background:#cc2229">Live</span>
        </a>
        <a onclick="navigate('ai-workflow')" class="sidebar-link flex items-center gap-3 px-6 py-3 cursor-pointer text-sm" data-page="ai-workflow">
          <i class="fas fa-robot w-5 text-center" style="color:#8899b3"></i> <span style="color:#c5d0e0">AI Workflow</span>
          <span class="ml-auto text-white text-xs px-2 py-0.5 rounded-full" style="background:#3d5a80">5 Agents</span>
        </a>
        <a onclick="navigate('memory')" class="sidebar-link flex items-center gap-3 px-6 py-3 cursor-pointer text-sm" data-page="memory">
          <i class="fas fa-brain w-5 text-center" style="color:#8899b3"></i> <span style="color:#c5d0e0">Agent Memory</span>
          <span class="ml-auto text-white text-xs px-2 py-0.5 rounded-full" style="background:#3d5a80">Mem0</span>
        </a>
        <a onclick="navigate('intake')" class="sidebar-link flex items-center gap-3 px-6 py-3 cursor-pointer text-sm" data-page="intake">
          <i class="fas fa-clipboard-list w-5 text-center"></i> Client Intake
        </a>
      </nav>
      <div class="p-4 border-t" style="border-color:#2a4068">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold" style="background:#cc2229">BP</div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate">Brad</p>
            <p class="text-xs" style="color:#6b7ea0">Admin</p>
          </div>
          <button style="color:#6b7ea0" class="hover:text-white"><i class="fas fa-cog"></i></button>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 flex flex-col overflow-hidden" role="main" aria-label="Page content">
      <!-- Top Bar -->
      <header class="bg-white border-b border-dark-200 px-3 sm:px-6 py-3 flex items-center justify-between flex-shrink-0 gap-2" role="banner">
        <div class="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
          <button onclick="toggleSidebar()" class="text-dark-400 hover:text-dark-600 lg:hidden flex-shrink-0 p-1" aria-label="Toggle sidebar menu"><i class="fas fa-bars text-lg"></i></button>
          <div class="relative flex-1 max-w-xs sm:max-w-sm lg:max-w-md">
            <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-dark-400 text-sm" aria-hidden="true"></i>
            <input type="text" placeholder="Search..." class="pl-9 pr-4 py-2 w-full bg-dark-50 border-dark-200 rounded-lg text-sm mobile-search" id="globalSearch" onkeyup="handleGlobalSearch(event)" aria-label="Global search">
          </div>
        </div>
        <div class="flex items-center gap-2 sm:gap-4 flex-shrink-0">
          <button onclick="navigate('ai-chat')" class="btn flex items-center gap-2 text-xs sm:text-sm" style="background:#fef2f2; color:#cc2229" onmouseover="this.style.background='#fde8e8'" onmouseout="this.style.background='#fef2f2'">
            <i class="fas fa-scale-balanced"></i> <span class="hidden sm:inline">AI Co-Counsel</span>
          </button>
          <button onclick="loadNotifications()" class="relative text-dark-400 hover:text-dark-600 p-2">
            <i class="fas fa-bell text-lg"></i>
            <span id="notifBadge" class="hidden absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">0</span>
          </button>
        </div>
      </header>

      <!-- Page Content -->
      <div id="pageContent" class="flex-1 overflow-y-auto p-3 sm:p-6 fade-in">
        <div class="flex items-center justify-center h-full">
          <div class="text-center">
            <div class="w-16 h-16 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <i class="fas fa-spinner fa-spin text-brand-600 text-2xl"></i>
            </div>
            <p class="text-dark-500">Loading Clerky Platform...</p>
          </div>
        </div>
      </div>
    </main>
  </div>

  <!-- Mobile Bottom Navigation -->
  <nav id="mobileBottomNav" aria-label="Mobile navigation">
    <button onclick="navigate('dashboard')" data-mob="dashboard" class="active">
      <i class="fas fa-chart-line"></i><span>Home</span>
    </button>
    <button onclick="navigate('cases')" data-mob="cases">
      <i class="fas fa-briefcase"></i><span>Cases</span>
    </button>
    <button onclick="navigate('clients')" data-mob="clients">
      <i class="fas fa-users"></i><span>Clients</span>
    </button>
    <button onclick="navigate('ai-chat')" data-mob="ai-chat">
      <i class="fas fa-scale-balanced"></i><span>AI</span>
    </button>
    <button onclick="toggleMobileMore()" data-mob="more" id="mobileMoreBtn">
      <i class="fas fa-ellipsis-h"></i><span>More</span>
    </button>
  </nav>

  <!-- Mobile "More" Menu -->
  <div id="mobileMoreMenu" style="display:none; position:fixed; bottom:60px; right:8px; z-index:46; background:#1e3354; border:1px solid #2a4068; border-radius:12px; padding:8px 0; min-width:180px; box-shadow:0 -4px 20px rgba(0,0,0,0.4);">
    <button onclick="navigate('documents');closeMobileMore()" class="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-white/10 flex items-center gap-3"><i class="fas fa-file-alt w-5 text-center" style="color:#6b7ea0"></i> Documents</button>
    <button onclick="navigate('calendar');closeMobileMore()" class="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-white/10 flex items-center gap-3"><i class="fas fa-calendar-days w-5 text-center" style="color:#6b7ea0"></i> Calendar</button>
    <button onclick="navigate('tasks');closeMobileMore()" class="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-white/10 flex items-center gap-3"><i class="fas fa-check-circle w-5 text-center" style="color:#6b7ea0"></i> Tasks</button>
    <button onclick="navigate('billing');closeMobileMore()" class="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-white/10 flex items-center gap-3"><i class="fas fa-receipt w-5 text-center" style="color:#6b7ea0"></i> Billing</button>
    <div style="border-top:1px solid #2a4068; margin:4px 0;"></div>
    <button onclick="navigate('legal-research');closeMobileMore()" class="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3" style="color:#6ee7b7"><i class="fas fa-search w-5 text-center"></i> Legal Research <span class="ml-auto text-xs px-1.5 py-0.5 rounded" style="background:#059669;color:white">Live</span></button>
    <button onclick="navigate('ai-workflow');closeMobileMore()" class="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3" style="color:#f09898"><i class="fas fa-robot w-5 text-center"></i> AI Workflow</button>
    <button onclick="navigate('memory');closeMobileMore()" class="w-full text-left px-4 py-2.5 text-sm flex items-center gap-3" style="color:#f09898"><i class="fas fa-brain w-5 text-center"></i> Agent Memory</button>
    <button onclick="navigate('intake');closeMobileMore()" class="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-white/10 flex items-center gap-3"><i class="fas fa-clipboard-list w-5 text-center" style="color:#6b7ea0"></i> Client Intake</button>
  </div>

  <!-- Modal Container -->
  <div id="modalContainer"></div>

  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <script>
const API = '/api';
let currentPage = 'dashboard';
let dbInitialized = false;

// ═══ HTML Escape Utility (BUG-4 security fix) ═══
function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ═══ Pagination Controls Builder (BUG-14 frontend pagination) ═══
function buildPaginationControls(currentPage, totalPages, callbackFn) {
  if (totalPages <= 1) return '';
  var html = '';
  if (currentPage > 1) html += '<button onclick="'+callbackFn+'('+(currentPage-1)+')" class="btn btn-secondary text-xs"><i class="fas fa-chevron-left mr-1"></i>Prev</button>';
  html += '<span class="text-sm text-dark-500 px-3 py-1">Page ' + currentPage + ' of ' + totalPages + '</span>';
  if (currentPage < totalPages) html += '<button onclick="'+callbackFn+'('+(currentPage+1)+')" class="btn btn-secondary text-xs">Next<i class="fas fa-chevron-right ml-1"></i></button>';
  return html;
}

// ═══ Sonner-style Toast System ═══
function toast(title, description, type = 'default') {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: 'fa-check-circle text-green-500', error: 'fa-times-circle text-red-500', warning: 'fa-exclamation-triangle text-yellow-500', default: 'fa-info-circle text-blue-500' };
  const el = document.createElement('div');
  el.className = 'toast' + (type === 'success' ? ' toast-success' : type === 'error' ? ' toast-error' : '');
  el.innerHTML = '<i class="fas ' + (icons[type] || icons.default) + '"></i><div><div class="toast-title">' + title + '</div>' + (description ? '<div class="toast-description">' + description + '</div>' : '') + '</div><button class="toast-close" onclick="this.parentElement.remove()">&times;</button>';
  container.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

// Initialize
async function init() {
  const splash = document.getElementById('splash');
  try {
    // Init DB — uses default admin key for development; in production set ADMIN_KEY env var
    await axios.get(API + '/init-db', { headers: { 'X-Admin-Key': 'clerky-admin-2026' } }).catch(function() {});
    dbInitialized = true;
  } catch(e) { console.error('DB init error:', e); }
  navigate('dashboard');
  // Show "Enter Platform" button once loaded
  const statusEl = document.getElementById('splashStatus');
  const btnEl = document.getElementById('splashContinueBtn');
  if (statusEl) statusEl.innerHTML = '<div class="w-3 h-3 rounded-full" style="background:#cc2229"></div><span class="font-medium" style="color:#cc2229">Platform ready</span>';
  if (btnEl) btnEl.classList.remove('hidden');
}

function dismissSplash() {
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('hide');
    setTimeout(() => splash.remove(), 800);
  }
}

function navigate(page) {
  currentPage = page;
  // Close sidebar on mobile when navigating
  closeSidebar();
  closeMobileMore();
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  const link = document.querySelector('[data-page="'+page+'"]');
  if (link) link.classList.add('active');
  // Update mobile bottom nav active state
  document.querySelectorAll('#mobileBottomNav button').forEach(b => b.classList.remove('active'));
  const mobBtn = document.querySelector('#mobileBottomNav [data-mob="'+page+'"]');
  if (mobBtn) { mobBtn.classList.add('active'); }
  else { const moreBtn = document.getElementById('mobileMoreBtn'); if (moreBtn) moreBtn.classList.add('active'); }
  document.getElementById('pageContent').innerHTML = '<div class="flex items-center justify-center h-32"><i class="fas fa-spinner fa-spin text-brand-500 text-xl mr-3"></i> Loading...</div>';
  
  const pages = { dashboard: loadDashboard, cases: loadCases, clients: loadClients, documents: loadDocuments, calendar: loadCalendar, tasks: loadTasks, billing: loadBilling, 'legal-research': loadLegalResearch, 'ai-chat': loadAIChat, 'ai-workflow': loadAIWorkflow, memory: loadMemory, intake: loadIntake };
  if (pages[page]) pages[page]();
}

function toggleMobileMore() {
  const menu = document.getElementById('mobileMoreMenu');
  menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}
function closeMobileMore() {
  const menu = document.getElementById('mobileMoreMenu');
  if (menu) menu.style.display = 'none';
}
// Close more menu when tapping outside
document.addEventListener('click', function(e) {
  const menu = document.getElementById('mobileMoreMenu');
  const btn = document.getElementById('mobileMoreBtn');
  if (menu && menu.style.display !== 'none' && !menu.contains(e.target) && !btn.contains(e.target)) {
    menu.style.display = 'none';
  }
});

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const isOpen = sidebar.classList.contains('sidebar-open');
  if (isOpen) {
    closeSidebar();
  } else {
    sidebar.classList.add('sidebar-open');
    overlay.classList.add('active');
  }
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  sidebar.classList.remove('sidebar-open');
  overlay.classList.remove('active');
}

// === DASHBOARD ===
async function loadDashboard() {
  try {
    const { data } = await axios.get(API + '/dashboard');
    const d = data;
    // Cache live dashboard state for /api/crew requests
    liveDashboardState = {
      active_cases: d.cases?.active || 0,
      active_clients: d.clients?.total || 0,
      pending_tasks: d.tasks?.pending || 0,
      overdue_tasks: d.tasks?.overdue || 0,
      total_documents: d.documents?.total || 0,
      total_events: (d.upcoming_events || []).length
    };
    document.getElementById('pageContent').innerHTML = \`
      <div class="fade-in">
        <div class="flex items-center justify-between mb-6 mobile-header-stack">
          <div>
            <h2 class="text-2xl font-bold text-dark-900 mobile-title-sm">Dashboard</h2>
            <p class="text-dark-500 text-sm mt-1">Welcome back, Brad. Here's your practice overview.</p>
          </div>
          <div class="flex gap-2">
            <button onclick="navigate('cases')" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>New Case</button>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 stat-grid-mobile">
          <div class="stat-card" style="--from:#1e3354;--to:#2a4068">
            <div class="flex items-center justify-between mb-3">
              <div class="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center"><i class="fas fa-briefcase"></i></div>
              <span class="text-sm opacity-80">Active</span>
            </div>
            <div class="text-3xl font-bold">\${d.cases.active}</div>
            <div class="text-sm opacity-80 mt-1">\${d.cases.total} total cases</div>
          </div>
          <div class="stat-card" style="--from:#9b1a20;--to:#cc2229">
            <div class="flex items-center justify-between mb-3">
              <div class="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center"><i class="fas fa-users"></i></div>
              <span class="text-sm opacity-80">Active</span>
            </div>
            <div class="text-3xl font-bold">\${d.clients.total}</div>
            <div class="text-sm opacity-80 mt-1">Active clients</div>
          </div>
          <div class="stat-card" style="--from:#3d5a80;--to:#6b7ea0">
            <div class="flex items-center justify-between mb-3">
              <div class="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center"><i class="fas fa-tasks"></i></div>
              <span class="text-sm opacity-80">\${d.tasks.overdue} overdue</span>
            </div>
            <div class="text-3xl font-bold">\${d.tasks.pending}</div>
            <div class="text-sm opacity-80 mt-1">Pending tasks</div>
          </div>
          <div class="stat-card" style="--from:#142440;--to:#1e3354">
            <div class="flex items-center justify-between mb-3">
              <div class="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center"><i class="fas fa-file-alt"></i></div>
              <span class="text-sm opacity-80">Total</span>
            </div>
            <div class="text-3xl font-bold">\${d.documents.total}</div>
            <div class="text-sm opacity-80 mt-1">Documents</div>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <div class="card p-4 sm:p-6">
            <h3 class="font-semibold text-dark-800 mb-4 flex items-center gap-2"><i class="fas fa-calendar text-brand-500"></i> Upcoming Events</h3>
            <div class="space-y-3">
              \${d.upcoming_events.length ? d.upcoming_events.map(e => \`
                <div class="flex items-center gap-3 p-3 bg-dark-50 rounded-lg">
                  <div class="w-2 h-10 rounded-full" style="background:\${e.color || '#3b82f6'}"></div>
                  <div class="flex-1">
                    <p class="text-sm font-medium text-dark-800">\${e.title}</p>
                    <p class="text-xs text-dark-500">\${formatDateTime(e.start_datetime)} \${e.case_number ? '| ' + e.case_number : ''}</p>
                  </div>
                  <span class="badge bg-dark-100 text-dark-600">\${e.event_type}</span>
                </div>
              \`).join('') : '<p class="text-dark-400 text-sm text-center py-4">No upcoming events</p>'}
            </div>
          </div>

          <div class="card p-4 sm:p-6">
            <h3 class="font-semibold text-dark-800 mb-4 flex items-center gap-2"><i class="fas fa-robot text-purple-500"></i> Recent AI Activity</h3>
            <div class="space-y-3">
              \${d.recent_ai_activity.length ? d.recent_ai_activity.map(a => \`
                <div class="flex items-center gap-3 p-3 bg-purple-50 rounded-lg">
                  <div class="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center"><i class="fas fa-\${getAgentIcon(a.agent_type)} text-purple-600 text-sm"></i></div>
                  <div class="flex-1">
                    <p class="text-sm font-medium text-dark-800">\${a.agent_type.charAt(0).toUpperCase() + a.agent_type.slice(1)} Agent</p>
                    <p class="text-xs text-dark-500">\${a.action} \${a.case_number ? '| ' + a.case_number : ''}</p>
                  </div>
                  <span class="badge bg-green-100 text-green-700">\${a.status}</span>
                </div>
              \`).join('') : '<p class="text-dark-400 text-sm text-center py-4">No recent AI activity</p>'}
            </div>
          </div>
        </div>
      </div>
    \`;
  } catch(e) {
    document.getElementById('pageContent').innerHTML = '<div class="text-center py-12"><p class="text-red-500">Error loading dashboard. <button onclick="loadDashboard()" class="text-brand-600 underline">Retry</button></p></div>';
  }
}

// === CASES ===
async function loadCases() {
  try {
    const { data } = await axios.get(API + '/cases');
    document.getElementById('pageContent').innerHTML = \`
      <div class="fade-in">
        <div class="flex items-center justify-between mb-6 mobile-header-stack">
          <div>
            <h2 class="text-2xl font-bold text-dark-900 mobile-title-sm">Cases & Matters</h2>
            <p class="text-dark-500 text-sm mt-1">\${data.cases.length} cases total</p>
          </div>
          <button onclick="showNewCaseModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>New Case</button>
        </div>
        <div class="flex gap-2 mb-4 filter-scroll">
          <button onclick="filterCases('')" class="btn btn-secondary text-xs active" id="filterAll">All</button>
          <button onclick="filterCases('open')" class="btn btn-secondary text-xs">Open</button>
          <button onclick="filterCases('in_progress')" class="btn btn-secondary text-xs">In Progress</button>
          <button onclick="filterCases('pending_review')" class="btn btn-secondary text-xs">Pending</button>
          <button onclick="filterCases('discovery')" class="btn btn-secondary text-xs">Discovery</button>
          <button onclick="filterCases('closed')" class="btn btn-secondary text-xs">Closed</button>
        </div>
        \${data.cases.length === 0 ? \`
          <div class="card p-12 text-center">
            <div class="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <i class="fas fa-briefcase text-blue-400 text-2xl"></i>
            </div>
            <h3 class="text-lg font-semibold text-dark-800 mb-2">No cases yet</h3>
            <p class="text-dark-400 text-sm mb-4">Create your first case to get started with case management.</p>
            <button onclick="showNewCaseModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Create First Case</button>
          </div>
        \` : \`
        <div id="caseTableArea">
        <div class="card overflow-hidden table-scroll">
          <table class="w-full">
            <thead class="bg-dark-50 border-b border-dark-200">
              <tr>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Case</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Client</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Type</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Status</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Priority</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Attorney</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Value</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3"></th>
              </tr>
            </thead>
            <tbody>
              \${data.cases.map(c => \`
                <tr class="table-row border-b border-dark-100 cursor-pointer" onclick="viewCase(\${c.id})">
                  <td class="px-6 py-4">
                    <div class="font-medium text-sm text-dark-800">\${c.title}</div>
                    <div class="text-xs text-dark-400">\${c.case_number}</div>
                  </td>
                  <td class="px-6 py-4 text-sm text-dark-600">\${c.client_name || '-'}</td>
                  <td class="px-6 py-4"><span class="badge bg-blue-50 text-blue-700">\${formatType(c.case_type)}</span></td>
                  <td class="px-6 py-4"><span class="badge \${getStatusColor(c.status)}">\${formatStatus(c.status)}</span></td>
                  <td class="px-6 py-4"><span class="badge \${getPriorityColor(c.priority)}">\${c.priority}</span></td>
                  <td class="px-6 py-4 text-sm text-dark-600">\${c.attorney_name || '-'}</td>
                  <td class="px-6 py-4 text-sm font-medium text-dark-800">\${c.estimated_value ? '$' + Number(c.estimated_value).toLocaleString() : '-'}</td>
                  <td class="px-6 py-4"><button class="text-dark-400 hover:text-brand-600"><i class="fas fa-chevron-right"></i></button></td>
                </tr>
              \`).join('')}
            </tbody>
          </table>
        </div>
        \${data.total > data.cases.length ? '<div class="flex justify-center mt-4 gap-2">' + buildPaginationControls(1, Math.ceil(data.total / (data.page_size || 50)), 'loadCasesPage') + '</div>' : ''}
        </div>
        \`}
      </div>
    \`;
  } catch(e) { showError('cases'); }
}

async function loadCasesPage(page) {
  try {
    const { data } = await axios.get(API + '/cases?page=' + page + '&page_size=50');
    renderCaseTable(data);
  } catch(e) { showError('cases'); }
}

async function viewCase(id) {
  try {
    const { data } = await axios.get(API + '/cases/' + id);
    const c = data.case;
    document.getElementById('pageContent').innerHTML = \`
      <div class="fade-in">
        <div class="flex items-center gap-3 mb-6">
          <button onclick="loadCases()" class="btn btn-secondary"><i class="fas fa-arrow-left"></i></button>
          <div class="flex-1">
            <h2 class="text-xl font-bold text-dark-900">\${c.title}</h2>
            <p class="text-dark-500 text-sm">\${c.case_number} | \${formatType(c.case_type)}</p>
          </div>
          <span class="badge \${getStatusColor(c.status)} text-sm px-4 py-1">\${formatStatus(c.status)}</span>
          <span class="badge \${getPriorityColor(c.priority)} text-sm px-4 py-1">\${c.priority}</span>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div class="card p-5">
            <h4 class="text-xs font-semibold text-dark-400 uppercase mb-3">Case Details</h4>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between"><span class="text-dark-500">Client</span><span class="font-medium">\${c.client_name || '-'}</span></div>
              <div class="flex justify-between"><span class="text-dark-500">Attorney</span><span class="font-medium">\${c.attorney_name || '-'}</span></div>
              <div class="flex justify-between"><span class="text-dark-500">Court</span><span class="font-medium">\${c.court_name || '-'}</span></div>
              <div class="flex justify-between"><span class="text-dark-500">Opposing</span><span class="font-medium">\${c.opposing_counsel || '-'}</span></div>
              <div class="flex justify-between"><span class="text-dark-500">Filed</span><span class="font-medium">\${c.date_filed || '-'}</span></div>
              <div class="flex justify-between"><span class="text-dark-500">Value</span><span class="font-medium text-green-600">\${c.estimated_value ? '$' + Number(c.estimated_value).toLocaleString() : '-'}</span></div>
            </div>
          </div>
          <div class="card p-5">
            <h4 class="text-xs font-semibold text-dark-400 uppercase mb-3">Documents (\${data.documents.length})</h4>
            <div class="space-y-2">
              \${data.documents.slice(0,5).map(d => \`
                <div class="flex items-center gap-2 p-2 bg-dark-50 rounded-lg">
                  <i class="fas fa-file-\${d.file_type?.includes('pdf')?'pdf':'alt'} text-\${d.file_type?.includes('pdf')?'red':'blue'}-500"></i>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">\${d.title}</p>
                    <p class="text-xs text-dark-400">\${d.category} | \${formatFileSize(d.file_size)}</p>
                  </div>
                  \${d.ai_generated ? '<span class="badge bg-purple-100 text-purple-700 text-xs">AI</span>' : ''}
                </div>
              \`).join('') || '<p class="text-dark-400 text-sm">No documents</p>'}
            </div>
          </div>
          <div class="card p-5">
            <h4 class="text-xs font-semibold text-dark-400 uppercase mb-3">Tasks (\${data.tasks.length})</h4>
            <div class="space-y-2">
              \${data.tasks.slice(0,5).map(t => \`
                <div class="flex items-center gap-2 p-2 bg-dark-50 rounded-lg">
                  <i class="fas fa-\${t.status==='completed'?'check-circle text-green-500':'circle text-dark-300'}"></i>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium truncate">\${t.title}</p>
                    <p class="text-xs text-dark-400">\${t.assigned_name} | Due: \${t.due_date || 'N/A'}</p>
                  </div>
                  <span class="badge \${getPriorityColor(t.priority)} text-xs">\${t.priority}</span>
                </div>
              \`).join('') || '<p class="text-dark-400 text-sm">No tasks</p>'}
            </div>
          </div>
        </div>

        <div class="card p-5">
          <h4 class="text-xs font-semibold text-dark-400 uppercase mb-3">Time Entries</h4>
          <table class="w-full">
            <thead><tr class="border-b border-dark-200">
              <th class="text-left text-xs font-semibold text-dark-500 pb-2">Date</th>
              <th class="text-left text-xs font-semibold text-dark-500 pb-2">Attorney</th>
              <th class="text-left text-xs font-semibold text-dark-500 pb-2">Description</th>
              <th class="text-left text-xs font-semibold text-dark-500 pb-2">Hours</th>
              <th class="text-left text-xs font-semibold text-dark-500 pb-2">Rate</th>
              <th class="text-left text-xs font-semibold text-dark-500 pb-2">Amount</th>
            </tr></thead>
            <tbody>
              \${data.time_entries.map(te => \`
                <tr class="border-b border-dark-100">
                  <td class="py-2 text-sm">\${te.entry_date}</td>
                  <td class="py-2 text-sm">\${te.user_name || '-'}</td>
                  <td class="py-2 text-sm">\${te.description}</td>
                  <td class="py-2 text-sm font-medium">\${te.hours}h</td>
                  <td class="py-2 text-sm">$\${te.rate}/hr</td>
                  <td class="py-2 text-sm font-medium text-green-600">$\${(te.hours * te.rate).toLocaleString()}</td>
                </tr>
              \`).join('') || '<tr><td colspan="6" class="py-4 text-center text-dark-400 text-sm">No time entries</td></tr>'}
            </tbody>
          </table>
        </div>

        <div class="mt-4 flex gap-2">
          <button onclick="runAIAgent('research', \${c.id})" class="btn bg-purple-50 text-purple-700 hover:bg-purple-100"><i class="fas fa-robot mr-2"></i>AI Research</button>
          <button onclick="runAIAgent('drafting', \${c.id})" class="btn bg-purple-50 text-purple-700 hover:bg-purple-100"><i class="fas fa-file-pen mr-2"></i>AI Draft</button>
          <button onclick="runAIAgent('compliance', \${c.id})" class="btn bg-purple-50 text-purple-700 hover:bg-purple-100"><i class="fas fa-shield-check mr-2"></i>Compliance Check</button>
        </div>

        <!-- Case Notes (BUG-9 fix: was fetched but never rendered) -->
        <div class="card p-5 mt-6">
          <h4 class="text-xs font-semibold text-dark-400 uppercase mb-3"><i class="fas fa-sticky-note mr-2"></i>Case Notes (\${(data.notes || []).length})</h4>
          \${(data.notes && data.notes.length > 0) ? data.notes.map(n => \`
            <div class="p-3 bg-dark-50 rounded-lg mb-2">
              <div class="flex items-center justify-between mb-1">
                <span class="text-sm font-medium text-dark-800">\${n.title || 'Untitled Note'}</span>
                <span class="text-xs text-dark-400">\${n.created_at ? new Date(n.created_at).toLocaleDateString() : ''}</span>
              </div>
              <p class="text-sm text-dark-600">\${n.content || ''}</p>
              \${n.is_privileged ? '<span class="badge bg-red-50 text-red-600 text-xs mt-1">Privileged</span>' : ''}
            </div>
          \`).join('') : '<p class="text-sm text-dark-400">No case notes yet.</p>'}
        </div>
      </div>
    \`;
  } catch(e) { showError('case details'); }
}

async function filterCases(status) {
  try {
    const url = status ? API + '/cases?status=' + status : API + '/cases';
    const { data } = await axios.get(url);
    // Update filter button active states
    document.querySelectorAll('.filter-scroll .btn').forEach(b => b.classList.remove('active'));
    if (!status) { var allBtn = document.getElementById('filterAll'); if (allBtn) allBtn.classList.add('active'); }
    // Render the filtered cases directly (BUG-1 fix: was discarding data and reloading all)
    renderCaseTable(data);
  } catch(e) { showError('filtered cases'); }
}

function renderCaseTable(data) {
  var tableArea = document.getElementById('caseTableArea');
  if (!tableArea) return;
  if (data.cases.length === 0) {
    tableArea.innerHTML = '<div class="card p-8 text-center"><i class="fas fa-search text-dark-300 text-2xl mb-3"></i><p class="text-dark-400 text-sm">No cases match this filter.</p></div>';
    return;
  }
  tableArea.innerHTML = '<div class="card overflow-hidden table-scroll"><table class="w-full"><thead class="bg-dark-50 border-b border-dark-200"><tr>' +
    '<th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Case</th>' +
    '<th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Client</th>' +
    '<th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Type</th>' +
    '<th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Status</th>' +
    '<th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Priority</th>' +
    '<th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Attorney</th>' +
    '<th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Value</th>' +
    '<th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3"></th></tr></thead><tbody>' +
    data.cases.map(function(c) { return '<tr class="table-row border-b border-dark-100 cursor-pointer" onclick="viewCase('+c.id+')">' +
      '<td class="px-6 py-4"><div class="font-medium text-sm text-dark-800">'+escapeHtml(c.title)+'</div><div class="text-xs text-dark-400">'+escapeHtml(c.case_number)+'</div></td>' +
      '<td class="px-6 py-4 text-sm text-dark-600">'+(c.client_name || '-')+'</td>' +
      '<td class="px-6 py-4"><span class="badge bg-blue-50 text-blue-700">'+formatType(c.case_type)+'</span></td>' +
      '<td class="px-6 py-4"><span class="badge '+getStatusColor(c.status)+'">'+formatStatus(c.status)+'</span></td>' +
      '<td class="px-6 py-4"><span class="badge '+getPriorityColor(c.priority)+'">'+c.priority+'</span></td>' +
      '<td class="px-6 py-4 text-sm text-dark-600">'+(c.attorney_name || '-')+'</td>' +
      '<td class="px-6 py-4 text-sm font-medium text-dark-800">'+(c.estimated_value ? '$'+Number(c.estimated_value).toLocaleString() : '-')+'</td>' +
      '<td class="px-6 py-4"><button class="text-dark-400 hover:text-brand-600"><i class="fas fa-chevron-right"></i></button></td></tr>'; }).join('') +
    '</tbody></table></div>' +
    (data.total > data.cases.length ? '<div class="flex justify-center mt-4 gap-2">' + buildPaginationControls(data.page || 1, Math.ceil(data.total / (data.page_size || 50)), 'loadCasesPage') + '</div>' : '');
}

// === CLIENTS ===
async function loadClients() {
  try {
    const { data } = await axios.get(API + '/clients');
    document.getElementById('pageContent').innerHTML = \`
      <div class="fade-in">
        <div class="flex items-center justify-between mb-6 mobile-header-stack">
          <div>
            <h2 class="text-2xl font-bold text-dark-900 mobile-title-sm">Clients</h2>
            <p class="text-dark-500 text-sm mt-1">\${data.clients.length} clients</p>
          </div>
          <button onclick="showNewClientModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>New Client</button>
        </div>
        \${data.clients.length === 0 ? \`
          <div class="card p-12 text-center">
            <div class="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <i class="fas fa-users text-green-400 text-2xl"></i>
            </div>
            <h3 class="text-lg font-semibold text-dark-800 mb-2">No clients yet</h3>
            <p class="text-dark-400 text-sm mb-4">Add your first client or use the AI Intake pipeline to onboard new clients.</p>
            <div class="flex gap-2 justify-center">
              <button onclick="showNewClientModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Add Client</button>
              <button onclick="navigate('intake')" class="btn btn-secondary"><i class="fas fa-clipboard-list mr-2"></i>AI Intake</button>
            </div>
          </div>
        \` : \`
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          \${data.clients.map(cl => \`
            <div class="card p-5 cursor-pointer" onclick="viewClient(\${cl.id})">
              <div class="flex items-center gap-3 mb-3">
                <div class="w-11 h-11 bg-brand-100 rounded-full flex items-center justify-center text-brand-700 font-bold text-sm">
                  \${(cl.first_name[0] + cl.last_name[0]).toUpperCase()}
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="font-semibold text-dark-800 truncate">\${cl.first_name} \${cl.last_name}</h3>
                  <p class="text-xs text-dark-400">\${cl.client_type === 'business' ? '<i class="fas fa-building mr-1"></i>' : '<i class="fas fa-user mr-1"></i>'}\${cl.client_type}</p>
                </div>
                <span class="badge \${cl.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-dark-100 text-dark-500'}">\${cl.status}</span>
              </div>
              <div class="space-y-1 text-sm text-dark-500">
                \${cl.email ? '<div><i class="fas fa-envelope w-5 text-center text-dark-400 mr-1"></i>' + cl.email + '</div>' : ''}
                \${cl.phone ? '<div><i class="fas fa-phone w-5 text-center text-dark-400 mr-1"></i>' + cl.phone + '</div>' : ''}
                \${cl.attorney_name ? '<div><i class="fas fa-user-tie w-5 text-center text-dark-400 mr-1"></i>' + cl.attorney_name + '</div>' : ''}
              </div>
              <div class="mt-3 pt-3 border-t border-dark-100 flex justify-between text-xs text-dark-400">
                <span><i class="fas fa-briefcase mr-1"></i>\${cl.case_count || 0} cases</span>
                <span>\${cl.city || ''}, \${cl.state || ''}</span>
              </div>
            </div>
          \`).join('')}
        </div>
        \`}
      </div>
    \`;
  } catch(e) { showError('clients'); }
}

async function viewClient(id) {
  try {
    const { data } = await axios.get(API + '/clients/' + id);
    const cl = data.client;
    document.getElementById('pageContent').innerHTML = \`
      <div class="fade-in">
        <div class="flex items-center gap-3 mb-6">
          <button onclick="loadClients()" class="btn btn-secondary"><i class="fas fa-arrow-left"></i></button>
          <div class="w-12 h-12 bg-brand-100 rounded-full flex items-center justify-center text-brand-700 font-bold">\${(cl.first_name[0] + cl.last_name[0]).toUpperCase()}</div>
          <div>
            <h2 class="text-xl font-bold text-dark-900">\${cl.first_name} \${cl.last_name}</h2>
            <p class="text-dark-500 text-sm">\${cl.email || ''} | \${cl.phone || ''}</p>
          </div>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="card p-5">
            <h4 class="font-semibold text-dark-800 mb-3">Client Information</h4>
            <div class="grid grid-cols-2 gap-3 text-sm">
              <div><span class="text-dark-400">Type:</span> <span class="font-medium">\${cl.client_type}</span></div>
              <div><span class="text-dark-400">Status:</span> <span class="font-medium">\${cl.status}</span></div>
              <div><span class="text-dark-400">Address:</span> <span class="font-medium">\${cl.address || '-'}</span></div>
              <div><span class="text-dark-400">City:</span> <span class="font-medium">\${cl.city || '-'}, \${cl.state || ''} \${cl.zip_code || ''}</span></div>
              <div><span class="text-dark-400">Attorney:</span> <span class="font-medium">\${cl.attorney_name || '-'}</span></div>
            </div>
          </div>
          <div class="card p-5">
            <h4 class="font-semibold text-dark-800 mb-3">Cases (\${data.cases.length})</h4>
            <div class="space-y-2">
              \${data.cases.map(c => \`
                <div class="p-3 bg-dark-50 rounded-lg cursor-pointer hover:bg-dark-100" onclick="viewCase(\${c.id})">
                  <p class="text-sm font-medium">\${c.title}</p>
                  <p class="text-xs text-dark-400">\${c.case_number} | <span class="badge \${getStatusColor(c.status)} text-xs">\${formatStatus(c.status)}</span></p>
                </div>
              \`).join('') || '<p class="text-dark-400 text-sm">No cases</p>'}
            </div>
          </div>
        </div>
      </div>
    \`;
  } catch(e) { showError('client'); }
}

// === DOCUMENTS ===
async function loadDocuments() {
  try {
    const { data } = await axios.get(API + '/documents');
    document.getElementById('pageContent').innerHTML = \`
      <div class="fade-in">
        <div class="flex items-center justify-between mb-6 mobile-header-stack">
          <div>
            <h2 class="text-2xl font-bold text-dark-900 mobile-title-sm">Documents</h2>
            <p class="text-dark-500 text-sm mt-1">\${data.documents.length} documents</p>
          </div>
          <button onclick="showNewDocModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Upload Document</button>
        </div>
        \${data.documents.length === 0 ? \`
          <div class="card p-12 text-center">
            <div class="w-16 h-16 bg-purple-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <i class="fas fa-file-alt text-purple-400 text-2xl"></i>
            </div>
            <h3 class="text-lg font-semibold text-dark-800 mb-2">No documents yet</h3>
            <p class="text-dark-400 text-sm mb-4">Upload documents or let AI generate them through the Co-Counsel chat.</p>
            <button onclick="showNewDocModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Upload Document</button>
          </div>
        \` : \`
        <div class="card overflow-hidden table-scroll">
          <table class="w-full">
            <thead class="bg-dark-50 border-b border-dark-200">
              <tr>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Document</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Case</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Category</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Status</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Size</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">By</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Date</th>
              </tr>
            </thead>
            <tbody>
              \${data.documents.map(d => \`
                <tr class="table-row border-b border-dark-100 cursor-pointer" onclick="viewDocument(\${d.id})">
                  <td class="px-6 py-4">
                    <div class="flex items-center gap-3">
                      <div class="w-9 h-9 bg-\${d.file_type?.includes('pdf')?'red':'blue'}-50 rounded-lg flex items-center justify-center">
                        <i class="fas fa-file-\${d.file_type?.includes('pdf')?'pdf':'alt'} text-\${d.file_type?.includes('pdf')?'red':'blue'}-500"></i>
                      </div>
                      <div>
                        <p class="text-sm font-medium text-dark-800">\${d.title}</p>
                        <p class="text-xs text-dark-400">\${d.file_name}</p>
                      </div>
                      \${d.ai_generated ? '<span class="badge bg-purple-100 text-purple-700 text-xs ml-2"><i class="fas fa-robot mr-1"></i>AI</span>' : ''}
                      \${d.ai_summary ? '<span class="badge bg-green-100 text-green-700 text-xs ml-1"><i class="fas fa-brain mr-1"></i>Analyzed</span>' : ''}
                    </div>
                  </td>
                  <td class="px-6 py-4 text-sm text-dark-600">\${d.case_number || '-'}</td>
                  <td class="px-6 py-4"><span class="badge bg-dark-100 text-dark-600">\${d.category}</span></td>
                  <td class="px-6 py-4"><span class="badge \${getStatusColor(d.status)}">\${d.status}</span></td>
                  <td class="px-6 py-4 text-sm text-dark-500">\${formatFileSize(d.file_size)}</td>
                  <td class="px-6 py-4 text-sm text-dark-600">\${d.uploaded_by_name || '-'}</td>
                  <td class="px-6 py-4 text-xs text-dark-400">\${formatDate(d.created_at)}</td>
                </tr>
              \`).join('')}
            </tbody>
          </table>
        </div>
        \`}
      </div>
    \`;
  } catch(e) { showError('documents'); }
}

// === CALENDAR ===
async function loadCalendar() {
  try {
    const { data } = await axios.get(API + '/calendar');
    document.getElementById('pageContent').innerHTML = \`
      <div class="fade-in">
        <div class="flex items-center justify-between mb-6 mobile-header-stack">
          <div>
            <h2 class="text-2xl font-bold text-dark-900 mobile-title-sm">Calendar</h2>
            <p class="text-dark-500 text-sm mt-1">\${data.events.length} events</p>
          </div>
          <button onclick="showNewEventModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>New Event</button>
        </div>
        \${data.events.length === 0 ? \`
          <div class="card p-12 text-center">
            <div class="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <i class="fas fa-calendar-days text-indigo-400 text-2xl"></i>
            </div>
            <h3 class="text-lg font-semibold text-dark-800 mb-2">No events scheduled</h3>
            <p class="text-dark-400 text-sm mb-4">Add hearings, meetings, depositions, and deadlines to your calendar.</p>
            <button onclick="showNewEventModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Schedule Event</button>
          </div>
        \` : \`
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          \${data.events.map(e => \`
            <div class="card p-5">
              <div class="flex items-start gap-4">
                <div class="w-14 h-14 rounded-xl flex flex-col items-center justify-center text-white flex-shrink-0" style="background:\${e.color || '#3b82f6'}">
                  <span class="text-xs font-medium">\${new Date(e.start_datetime).toLocaleDateString('en',{month:'short'})}</span>
                  <span class="text-lg font-bold leading-none">\${new Date(e.start_datetime).getDate()}</span>
                </div>
                <div class="flex-1 min-w-0">
                  <h3 class="font-semibold text-dark-800">\${e.title}</h3>
                  <div class="flex flex-wrap gap-2 mt-1">
                    <span class="text-xs text-dark-500"><i class="fas fa-clock mr-1"></i>\${formatTime(e.start_datetime)} - \${formatTime(e.end_datetime)}</span>
                    \${e.location ? '<span class="text-xs text-dark-500"><i class="fas fa-map-marker-alt mr-1"></i>' + e.location + '</span>' : ''}
                  </div>
                  <div class="flex items-center gap-2 mt-2">
                    <span class="badge bg-dark-100 text-dark-600">\${e.event_type}</span>
                    \${e.case_number ? '<span class="badge bg-blue-50 text-blue-700">' + e.case_number + '</span>' : ''}
                    <span class="text-xs text-dark-400">\${e.organizer_name || ''}</span>
                  </div>
                </div>
              </div>
            </div>
          \`).join('')}
        </div>
        \`}
      </div>
    \`;
  } catch(e) { showError('calendar'); }
}

// === TASKS ===
async function loadTasks() {
  try {
    const { data } = await axios.get(API + '/tasks');
    document.getElementById('pageContent').innerHTML = \`
      <div class="fade-in">
        <div class="flex items-center justify-between mb-6 mobile-header-stack">
          <div>
            <h2 class="text-2xl font-bold text-dark-900 mobile-title-sm">Tasks & Deadlines</h2>
            <p class="text-dark-500 text-sm mt-1">\${data.tasks.length} tasks</p>
          </div>
          <button onclick="showNewTaskModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>New Task</button>
        </div>
        \${data.tasks.length === 0 ? \`
          <div class="card p-12 text-center">
            <div class="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <i class="fas fa-check-circle text-amber-400 text-2xl"></i>
            </div>
            <h3 class="text-lg font-semibold text-dark-800 mb-2">No tasks yet</h3>
            <p class="text-dark-400 text-sm mb-4">Add tasks, deadlines, and follow-ups to stay on top of your practice.</p>
            <button onclick="showNewTaskModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Create Task</button>
          </div>
        \` : \`
        <div class="space-y-3">
          \${data.tasks.map(t => \`
            <div class="card p-4 flex items-center gap-4 task-card-mobile">
              <button onclick="toggleTask(\${t.id}, '\${t.status}')" class="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 \${t.status === 'completed' ? 'bg-green-500 border-green-500 text-white' : 'border-dark-300 hover:border-brand-500'}">
                \${t.status === 'completed' ? '<i class="fas fa-check text-xs"></i>' : ''}
              </button>
              <div class="flex-1 min-w-0">
                <p class="font-medium text-dark-800 \${t.status === 'completed' ? 'line-through text-dark-400' : ''}">\${t.title}</p>
                <div class="flex items-center gap-3 mt-1 text-xs text-dark-400 flex-wrap">
                  <span><i class="fas fa-user mr-1"></i>\${t.assigned_name || '-'}</span>
                  \${t.case_number ? '<span><i class="fas fa-briefcase mr-1"></i>' + t.case_number + '</span>' : ''}
                  \${t.due_date ? '<span><i class="fas fa-calendar mr-1"></i>' + t.due_date + '</span>' : ''}
                </div>
                <div class="task-badges-mobile mt-1.5 sm:hidden">
                  <span class="badge \${getPriorityColor(t.priority)} text-xs">\${t.priority}</span>
                  <span class="badge \${getStatusColor(t.status)} text-xs">\${formatStatus(t.status)}</span>
                  <span class="badge bg-dark-100 text-dark-600 text-xs">\${t.task_type}</span>
                </div>
              </div>
              <span class="badge \${getPriorityColor(t.priority)} hidden sm:inline-flex">\${t.priority}</span>
              <span class="badge \${getStatusColor(t.status)} text-xs hidden sm:inline-flex">\${formatStatus(t.status)}</span>
              <span class="badge bg-dark-100 text-dark-600 text-xs hidden sm:inline-flex">\${t.task_type}</span>
            </div>
          \`).join('')}
        </div>
        \`}
      </div>
    \`;
  } catch(e) { showError('tasks'); }
}

async function toggleTask(id, currentStatus) {
  const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
  await axios.put(API + '/tasks/' + id, { status: newStatus });
  loadTasks();
}

// === BILLING ===
async function loadBilling() {
  try {
    const [statsRes, invoicesRes] = await Promise.all([
      axios.get(API + '/billing/stats'),
      axios.get(API + '/billing/invoices')
    ]);
    const s = statsRes.data;
    const invs = invoicesRes.data.invoices;
    document.getElementById('pageContent').innerHTML = \`
      <div class="fade-in">
        <div class="flex items-center justify-between mb-6 mobile-header-stack">
          <div>
            <h2 class="text-2xl font-bold text-dark-900 mobile-title-sm">Billing & Invoices</h2>
            <p class="text-dark-500 text-sm mt-1">Financial overview</p>
          </div>
          <button onclick="showNewInvoiceModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>New Invoice</button>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <div class="card p-5 text-center">
            <p class="text-xs text-dark-400 uppercase font-semibold">Revenue</p>
            <p class="text-2xl font-bold text-green-600 mt-1">$\${Number(s.total_revenue).toLocaleString()}</p>
          </div>
          <div class="card p-5 text-center">
            <p class="text-xs text-dark-400 uppercase font-semibold">Outstanding</p>
            <p class="text-2xl font-bold text-blue-600 mt-1">$\${Number(s.outstanding).toLocaleString()}</p>
          </div>
          <div class="card p-5 text-center">
            <p class="text-xs text-dark-400 uppercase font-semibold">Overdue</p>
            <p class="text-2xl font-bold text-red-600 mt-1">$\${Number(s.overdue_amount).toLocaleString()}</p>
            <p class="text-xs text-dark-400">\${s.overdue_count} invoices</p>
          </div>
          <div class="card p-5 text-center">
            <p class="text-xs text-dark-400 uppercase font-semibold">Monthly Billable</p>
            <p class="text-2xl font-bold text-purple-600 mt-1">$\${Number(s.monthly_billable).toLocaleString()}</p>
          </div>
        </div>
        \${invs.length === 0 ? \`
          <div class="card p-12 text-center">
            <div class="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <i class="fas fa-receipt text-emerald-400 text-2xl"></i>
            </div>
            <h3 class="text-lg font-semibold text-dark-800 mb-2">No invoices yet</h3>
            <p class="text-dark-400 text-sm mb-4">Create invoices from time entries and send them to clients.</p>
            <button onclick="showNewInvoiceModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Create Invoice</button>
          </div>
        \` : \`
        <div class="card overflow-hidden table-scroll">
          <table class="w-full">
            <thead class="bg-dark-50 border-b border-dark-200">
              <tr>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Invoice</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Client</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Case</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Amount</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Paid</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Status</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Due</th>
              </tr>
            </thead>
            <tbody>
              \${invs.map(inv => \`
                <tr class="table-row border-b border-dark-100">
                  <td class="px-6 py-4 font-medium text-sm">\${inv.invoice_number}</td>
                  <td class="px-6 py-4 text-sm">\${inv.client_name || '-'}</td>
                  <td class="px-6 py-4 text-sm text-dark-500">\${inv.case_number || '-'}</td>
                  <td class="px-6 py-4 text-sm font-bold">$\${Number(inv.total_amount).toLocaleString()}</td>
                  <td class="px-6 py-4 text-sm text-green-600">$\${Number(inv.amount_paid).toLocaleString()}</td>
                  <td class="px-6 py-4"><span class="badge \${getInvoiceStatusColor(inv.status)}">\${inv.status}</span></td>
                  <td class="px-6 py-4 text-sm text-dark-500">\${inv.due_date || '-'}</td>
                </tr>
              \`).join('')}
            </tbody>
          </table>
        </div>
        \`}
      </div>
    \`;
  } catch(e) { showError('billing'); }
}

// === LEGAL RESEARCH (CourtListener + Harvard Caselaw + Lex Machina) ===
async function loadLegalResearch() {
  // Check API health
  let healthData = null;
  try {
    const h = await axios.get(API + '/legal-research/health');
    healthData = h.data;
  } catch(e) {}

  const clStatus = healthData?.courtlistener?.status || 'unknown';
  const clBadge = clStatus === 'ok' ? '<span class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">🟢 Live</span>'
    : clStatus === 'degraded' ? '<span class="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">🟡 Degraded</span>'
    : '<span class="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">🔴 Down</span>';

  document.getElementById('pageContent').innerHTML = \`
  <div class="space-y-4 sm:space-y-6 animate-fadeIn">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        <h2 class="text-xl sm:text-2xl font-bold text-dark-900">Legal Research</h2>
        <p class="text-sm text-dark-500 mt-1">Search case law, dockets, verify citations — powered by CourtListener & Harvard Caselaw</p>
      </div>
      <div class="flex items-center gap-2 flex-wrap">
        \${clBadge}
        <span class="text-xs text-dark-400">\${healthData?.courtlistener_token === 'configured' ? '🔑 Authenticated' : '🔓 Anonymous'}</span>
      </div>
    </div>

    <!-- Search Bar -->
    <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 sm:p-6">
      <div class="flex flex-col gap-3">
        <div class="flex flex-col sm:flex-row gap-3">
          <input id="lrQuery" type="text" placeholder="Search case law, statutes, or legal issues..." class="flex-1 px-4 py-3 border rounded-lg text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" onkeydown="if(event.key==='Enter')runLegalSearch()">
          <button onclick="runLegalSearch()" class="px-6 py-3 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition flex items-center justify-center gap-2">
            <i class="fas fa-search"></i> Search
          </button>
        </div>
        <div class="flex flex-wrap gap-2 items-center">
          <select id="lrJurisdiction" class="px-3 py-1.5 border rounded-lg text-xs bg-gray-50">
            <option value="kansas">Kansas / 10th Cir.</option>
            <option value="missouri">Missouri / 8th Cir.</option>
            <option value="multi-state" selected>All KS/MO</option>
            <option value="federal">Federal</option>
          </select>
          <select id="lrSearchType" class="px-3 py-1.5 border rounded-lg text-xs bg-gray-50">
            <option value="keyword">Keyword Search</option>
            <option value="semantic">Semantic Search (AI)</option>
          </select>
          <select id="lrOrderBy" class="px-3 py-1.5 border rounded-lg text-xs bg-gray-50">
            <option value="score desc">Relevance</option>
            <option value="dateFiled desc">Date (Newest)</option>
            <option value="dateFiled asc">Date (Oldest)</option>
            <option value="citeCount desc">Most Cited</option>
          </select>
          <input id="lrDateAfter" type="date" class="px-3 py-1.5 border rounded-lg text-xs bg-gray-50" placeholder="After date">
          <label class="flex items-center gap-1.5 text-xs text-dark-500">
            <input id="lrCitedGt" type="number" min="0" class="w-16 px-2 py-1.5 border rounded-lg text-xs bg-gray-50" placeholder="0"> min citations
          </label>
        </div>
      </div>
    </div>

    <!-- Quick Actions -->
    <div class="flex flex-wrap gap-2 overflow-x-auto" style="-webkit-overflow-scrolling:touch">
      <button onclick="lrQuickSearch('personal injury negligence Kansas')" class="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-xs whitespace-nowrap hover:bg-gray-200">KS Personal Injury</button>
      <button onclick="lrQuickSearch('comparative fault 50 percent bar Kansas')" class="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-xs whitespace-nowrap hover:bg-gray-200">KS Comparative Fault</button>
      <button onclick="lrQuickSearch('pure comparative fault Missouri')" class="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-xs whitespace-nowrap hover:bg-gray-200">MO Pure Comparative</button>
      <button onclick="lrQuickSearch('employment discrimination wrongful termination')" class="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-xs whitespace-nowrap hover:bg-gray-200">Employment Discrimination</button>
      <button onclick="lrQuickSearch('medical malpractice statute of limitations')" class="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-xs whitespace-nowrap hover:bg-gray-200">Med Mal SOL</button>
      <button onclick="lrQuickSearch('products liability strict liability defective')" class="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-xs whitespace-nowrap hover:bg-gray-200">Product Liability</button>
      <button onclick="lrQuickSearch('qualified immunity section 1983')" class="px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full text-xs whitespace-nowrap hover:bg-gray-200">§ 1983 / Qualified Immunity</button>
    </div>

    <!-- Citation Verification -->
    <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <h3 class="text-sm font-semibold text-dark-800 mb-2"><i class="fas fa-check-double mr-1 text-green-600"></i> Citation Verification (Anti-Hallucination)</h3>
      <div class="flex flex-col sm:flex-row gap-2">
        <input id="lrCitation" type="text" placeholder='Enter citation (e.g., "237 Kan. 629" or "661 S.W.2d 11")' class="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:border-green-500" onkeydown="if(event.key==='Enter')verifyCitationUI()">
        <button onclick="verifyCitationUI()" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition flex items-center gap-2">
          <i class="fas fa-check-circle"></i> Verify
        </button>
      </div>
      <div id="citationResult" class="mt-2"></div>
    </div>

    <!-- Litigation Analytics -->
    <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
      <h3 class="text-sm font-semibold text-dark-800 mb-3"><i class="fas fa-chart-bar mr-1 text-purple-600"></i> Litigation Analytics</h3>
      <div class="flex flex-wrap gap-2 mb-3">
        <button onclick="loadAnalytics('personal_injury')" class="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-full text-xs hover:bg-purple-100">Personal Injury</button>
        <button onclick="loadAnalytics('employment')" class="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-full text-xs hover:bg-purple-100">Employment</button>
        <button onclick="loadAnalytics('medical_malpractice')" class="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-full text-xs hover:bg-purple-100">Med Mal</button>
        <button onclick="loadAnalytics('family')" class="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-full text-xs hover:bg-purple-100">Family</button>
        <button onclick="loadAnalytics('corporate')" class="px-3 py-1.5 bg-purple-50 text-purple-700 rounded-full text-xs hover:bg-purple-100">Corporate</button>
      </div>
      <div id="analyticsResult"></div>
    </div>

    <!-- Results -->
    <div id="lrResults"></div>

    <!-- Data Sources -->
    <div class="bg-gray-50 rounded-xl border border-gray-200 p-4 text-xs text-dark-500">
      <p class="font-semibold mb-2">Data Sources & Coverage:</p>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <p class="font-medium text-dark-700"><i class="fas fa-landmark mr-1 text-blue-600"></i> CourtListener</p>
          <p>Case law, PACER dockets, oral arguments, citation networks. Maintained by <a href="https://free.law" target="_blank" class="text-blue-600 hover:underline">Free Law Project</a>.</p>
        </div>
        <div>
          <p class="font-medium text-dark-700"><i class="fas fa-university mr-1 text-red-600"></i> Harvard Caselaw Access</p>
          <p>Full-text US case law from all jurisdictions. 6.7M+ cases. Public domain.</p>
        </div>
        <div>
          <p class="font-medium text-dark-700"><i class="fas fa-chart-line mr-1 text-purple-600"></i> Litigation Analytics</p>
          <p>\${healthData?.lex_machina?.status === 'configured' ? 'Lex Machina (LexisNexis)' : 'Built-in KS/MO statistical estimates from judicial reports'}.</p>
        </div>
      </div>
    </div>
  </div>
  \`;
}

async function runLegalSearch() {
  const q = document.getElementById('lrQuery').value.trim();
  if (!q) return;

  const jurisdiction = document.getElementById('lrJurisdiction').value;
  const searchType = document.getElementById('lrSearchType').value;
  const orderBy = document.getElementById('lrOrderBy').value;
  const dateAfter = document.getElementById('lrDateAfter').value;
  const citedGt = document.getElementById('lrCitedGt').value;

  const resultsDiv = document.getElementById('lrResults');
  resultsDiv.innerHTML = '<div class="flex items-center justify-center py-8"><i class="fas fa-spinner fa-spin text-green-500 text-xl mr-3"></i> Searching case law databases...</div>';

  try {
    const params = new URLSearchParams({ q, jurisdiction, order_by: orderBy });
    if (searchType === 'semantic') params.set('semantic', 'true');
    if (dateAfter) params.set('date_after', dateAfter);
    if (citedGt) params.set('cited_gt', citedGt);

    const { data } = await axios.get(API + '/legal-research/search?' + params.toString());

    if (data.results.length === 0) {
      resultsDiv.innerHTML = '<div class="bg-yellow-50 rounded-xl border border-yellow-200 p-6 text-center"><i class="fas fa-exclamation-triangle text-yellow-500 text-2xl mb-2"></i><p class="text-dark-700 font-medium">No results found</p><p class="text-sm text-dark-500 mt-1">Try broadening your search terms or changing the jurisdiction filter.</p></div>';
      return;
    }

    resultsDiv.innerHTML = \`
      <div class="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div class="px-4 py-3 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h3 class="text-sm font-semibold text-dark-800">
            <i class="fas fa-gavel text-green-600 mr-1"></i>
            \${data.total_results.toLocaleString()} result(s) — \${data.search_type === 'semantic' ? 'Semantic' : 'Keyword'} search
          </h3>
          <span class="text-xs text-dark-400">Source: \${data.source} | API: \${data.api_status}</span>
        </div>
        <div class="divide-y divide-gray-100">
          \${data.results.map((r, i) => \`
            <div class="p-4 hover:bg-gray-50 transition">
              <div class="flex items-start gap-3">
                <span class="text-xs font-mono text-dark-400 mt-1">\${i+1}</span>
                <div class="flex-1 min-w-0">
                  <a href="\${r.absolute_url}" target="_blank" class="text-sm font-semibold text-blue-700 hover:underline">\${r.case_name}</a>
                  <p class="text-xs text-dark-500 mt-0.5">
                    \${r.citations.length > 0 ? r.citations.join(', ') : 'No official citation'} •
                    \${r.court} • \${r.date_filed || 'Unknown date'} •
                    \${r.status}
                    \${r.cite_count > 0 ? ' • <span class="text-green-600 font-medium">Cited ' + r.cite_count + '×</span>' : ''}
                    \${r.judge ? ' • Judge: ' + r.judge : ''}
                  </p>
                  \${r.snippet ? '<p class="text-xs text-dark-600 mt-1 line-clamp-3">' + r.snippet + '</p>' : ''}
                </div>
              </div>
            </div>
          \`).join('')}
        </div>
      </div>
    \`;
  } catch(e) {
    resultsDiv.innerHTML = '<div class="bg-red-50 rounded-xl border border-red-200 p-4 text-center text-red-700 text-sm"><i class="fas fa-exclamation-circle mr-1"></i> Search failed. CourtListener may be temporarily unavailable. Try again in a moment.</div>';
  }
}

function lrQuickSearch(query) {
  document.getElementById('lrQuery').value = query;
  runLegalSearch();
}

async function verifyCitationUI() {
  const cite = document.getElementById('lrCitation').value.trim();
  if (!cite) return;

  const resultDiv = document.getElementById('citationResult');
  resultDiv.innerHTML = '<span class="text-xs text-dark-400"><i class="fas fa-spinner fa-spin mr-1"></i> Verifying...</span>';

  try {
    const { data } = await axios.get(API + '/legal-research/citation?cite=' + encodeURIComponent(cite));
    if (data.found) {
      resultDiv.innerHTML = \`
        <div class="flex items-center gap-2 bg-green-50 rounded-lg px-3 py-2 mt-1">
          <i class="fas fa-check-circle text-green-600"></i>
          <div class="text-xs">
            <span class="font-medium text-green-800">✅ Citation Verified:</span>
            <a href="\${data.url}" target="_blank" class="text-blue-600 hover:underline ml-1">\${data.case_name}</a>
            <span class="text-dark-500"> — \${data.court || ''}, \${data.date_filed || ''}</span>
          </div>
        </div>
      \`;
    } else {
      resultDiv.innerHTML = \`
        <div class="flex items-center gap-2 bg-red-50 rounded-lg px-3 py-2 mt-1">
          <i class="fas fa-times-circle text-red-600"></i>
          <span class="text-xs text-red-700">❌ Citation NOT found — may be hallucinated, incorrectly formatted, or from an unpublished opinion. Verify manually on Westlaw/Lexis.</span>
        </div>
      \`;
    }
  } catch(e) {
    resultDiv.innerHTML = '<span class="text-xs text-red-500"><i class="fas fa-exclamation-circle mr-1"></i> Verification failed — try again.</span>';
  }
}

async function loadAnalytics(caseType) {
  const jurisdiction = document.getElementById('lrJurisdiction')?.value || 'kansas';
  const div = document.getElementById('analyticsResult');
  div.innerHTML = '<span class="text-xs text-dark-400"><i class="fas fa-spinner fa-spin mr-1"></i> Loading analytics...</span>';

  try {
    const { data } = await axios.get(API + '/legal-research/analytics?jurisdiction=' + jurisdiction + '&case_type=' + caseType);
    const pct = (n) => (n * 100).toFixed(1) + '%';
    const usd = (n) => '$' + n.toLocaleString();

    div.innerHTML = \`
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div class="bg-purple-50 rounded-lg p-3 text-center">
          <p class="text-lg font-bold text-purple-700">\${data.total_cases_analyzed.toLocaleString()}</p>
          <p class="text-xs text-purple-600">Cases Analyzed</p>
        </div>
        <div class="bg-blue-50 rounded-lg p-3 text-center">
          <p class="text-lg font-bold text-blue-700">\${data.avg_duration_days}d</p>
          <p class="text-xs text-blue-600">Avg Duration</p>
        </div>
        <div class="bg-green-50 rounded-lg p-3 text-center">
          <p class="text-lg font-bold text-green-700">\${pct(data.resolution_rates.settlement)}</p>
          <p class="text-xs text-green-600">Settlement Rate</p>
        </div>
        <div class="bg-amber-50 rounded-lg p-3 text-center">
          <p class="text-lg font-bold text-amber-700">\${data.damages_stats.median > 0 ? usd(data.damages_stats.median) : 'N/A'}</p>
          <p class="text-xs text-amber-600">Median Damages</p>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-xs">
          <thead><tr class="text-left text-dark-500 border-b"><th class="pb-1">Resolution</th><th class="pb-1">Rate</th><th class="pb-1 hidden sm:table-cell">Visual</th></tr></thead>
          <tbody>
            <tr><td class="py-1">Settlement</td><td>\${pct(data.resolution_rates.settlement)}</td><td class="hidden sm:table-cell"><div class="w-full bg-gray-100 rounded-full h-2"><div class="bg-green-500 rounded-full h-2" style="width:\${data.resolution_rates.settlement*100}%"></div></div></td></tr>
            <tr><td class="py-1">Plaintiff Verdict</td><td>\${pct(data.resolution_rates.plaintiff_verdict)}</td><td class="hidden sm:table-cell"><div class="w-full bg-gray-100 rounded-full h-2"><div class="bg-blue-500 rounded-full h-2" style="width:\${data.resolution_rates.plaintiff_verdict*100}%"></div></div></td></tr>
            <tr><td class="py-1">Defendant Verdict</td><td>\${pct(data.resolution_rates.defendant_verdict)}</td><td class="hidden sm:table-cell"><div class="w-full bg-gray-100 rounded-full h-2"><div class="bg-red-500 rounded-full h-2" style="width:\${data.resolution_rates.defendant_verdict*100}%"></div></div></td></tr>
            <tr><td class="py-1">Dismissal</td><td>\${pct(data.resolution_rates.dismissal)}</td><td class="hidden sm:table-cell"><div class="w-full bg-gray-100 rounded-full h-2"><div class="bg-amber-500 rounded-full h-2" style="width:\${data.resolution_rates.dismissal*100}%"></div></div></td></tr>
          </tbody>
        </table>
      </div>
      \${data.damages_stats.median > 0 ? \`
        <div class="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          <div class="bg-gray-50 rounded p-2"><span class="text-dark-400">25th Pctile</span><br><span class="font-medium">\${usd(data.damages_stats.p25)}</span></div>
          <div class="bg-gray-50 rounded p-2"><span class="text-dark-400">Median</span><br><span class="font-medium">\${usd(data.damages_stats.median)}</span></div>
          <div class="bg-gray-50 rounded p-2"><span class="text-dark-400">Mean</span><br><span class="font-medium">\${usd(data.damages_stats.mean)}</span></div>
          <div class="bg-gray-50 rounded p-2"><span class="text-dark-400">75th Pctile</span><br><span class="font-medium">\${usd(data.damages_stats.p75)}</span></div>
          <div class="bg-gray-50 rounded p-2"><span class="text-dark-400">Maximum</span><br><span class="font-medium">\${usd(data.damages_stats.max)}</span></div>
        </div>
      \` : ''}
      <p class="text-xs text-dark-400 mt-2">Source: \${data.source === 'lex_machina' ? 'Lex Machina (LexisNexis)' : 'Estimated from judicial statistics'} | Jurisdiction: \${data.jurisdiction}</p>
    \`;
  } catch(e) {
    div.innerHTML = '<span class="text-xs text-red-500"><i class="fas fa-exclamation-circle mr-1"></i> Failed to load analytics.</span>';
  }
}

// === AI CO-COUNSEL CHAT (Dark Mode — ported from React patch) ===
var chatSessionId = 'session_' + Date.now();
var chatCaseId = null;
var chatJurisdiction = 'missouri';
var chatMessages = [];
var currentMatterContext = null;
var liveDashboardState = { active_cases: 0, active_clients: 0, pending_tasks: 0, overdue_tasks: 0, total_documents: 0, total_events: 0 };

async function loadAIChat() {
  try {
    const casesRes = await axios.get(API + '/cases');
    const cases = casesRes.data.cases || [];
    let historyRes;
    try { historyRes = await axios.get(API + '/ai/chat/history?session_id=' + chatSessionId); } catch(e) { historyRes = { data: { messages: [] } }; }
    chatMessages = historyRes.data.messages || [];

    // Resolve current matter context for the context bar
    if (chatCaseId) {
      const match = cases.find(c => c.id == chatCaseId);
      if (match) currentMatterContext = match;
    }
    const ctx = currentMatterContext;

    document.getElementById('pageContent').innerHTML = \`
      <div class="fade-in flex flex-col h-full rounded-xl overflow-hidden border" style="max-height:calc(100vh - 73px - env(safe-area-inset-bottom, 0px)); background: #0d1a2e; border-color:#2a4068">
        <!-- Header -->
        <div class="p-3 sm:p-4 border-b chat-head-mobile" style="background:#1e3354; border-color:#2a4068">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <div class="w-9 h-9 rounded-2xl flex items-center justify-center text-white flex-shrink-0" style="background:#cc2229">
                <i class="fas fa-robot text-sm"></i>
              </div>
              <div class="min-w-0">
                <div class="font-semibold text-white flex items-center gap-2 text-sm">Clerky AI <span class="w-2 h-2 rounded-full inline-block flex-shrink-0" style="background:#cc2229"></span></div>
                <div class="text-xs flex items-center gap-1 truncate" style="color:#cc2229">
                  <i class="fas fa-diagram-project text-[10px]"></i> 4 agents \u2022 \${chatJurisdiction === 'kansas' ? 'KS' : chatJurisdiction === 'missouri' ? 'MO' : chatJurisdiction === 'federal' ? 'Fed' : 'Multi'}
                </div>
              </div>
            </div>
            <div class="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
              <button onclick="showCrewAISettings()" class="btn btn-ghost btn-sm text-slate-400 hover:text-white p-1.5" title="CrewAI Settings"><i class="fas fa-cog"></i></button>
              <button onclick="clearChat()" class="btn btn-ghost btn-sm text-slate-400 hover:text-white p-1.5" title="Clear chat"><i class="fas fa-trash-alt"></i></button>
            </div>
          </div>
          <div class="flex items-center gap-2 mt-2 chat-head-controls">
            <select id="chatCaseSelect" onchange="chatCaseId=this.value||null;updateMatterBar()" class="text-xs py-1.5 px-2 rounded-lg text-slate-300 flex-1 min-w-0" style="background:#2a4068; border:1px solid #3d5a80">
              <option value="">No matter</option>
              \${cases.map(c => '<option value="'+c.id+'" '+(chatCaseId==c.id?'selected':'')+'>'+c.case_number+' \u2014 '+c.title.substring(0,25)+'</option>').join('')}
            </select>
            <select id="chatJurisdiction" onchange="chatJurisdiction=this.value" class="text-xs py-1.5 px-2 rounded-lg text-slate-300" style="background:#2a4068; border:1px solid #3d5a80; min-width:80px">
              <option value="kansas" \${chatJurisdiction==='kansas'?'selected':''}>Kansas</option>
              <option value="missouri" \${chatJurisdiction==='missouri'?'selected':''}>Missouri</option>
              <option value="federal" \${chatJurisdiction==='federal'?'selected':''}>Federal</option>
              <option value="multistate" \${chatJurisdiction==='multistate'?'selected':''}>Multi-state</option>
            </select>
          </div>
        </div>

        <!-- CrewAI Status Bar -->
        <div id="crewaiStatusBar" class="px-4 py-1.5 border-b flex items-center gap-3 text-[10px]" style="background:#1e3354; border-color:#2a4068; display:none">
          <span id="crewaiIndicator" class="flex items-center gap-1.5 text-slate-500">
            <span class="w-1.5 h-1.5 rounded-full bg-slate-600"></span> CrewAI: checking...
          </span>
        </div>

        <!-- Matter Context Bar -->
        <div id="matterBar" class="px-4 py-2 border-b flex items-center gap-4 text-xs matter-bar-mobile" style="background:#1e3354; border-color:#2a4068; color:#6b7ea0; \${ctx ? '' : 'display:none'}">
          \${ctx ? \`
            <div>Matter: <span class="text-white font-medium">\${ctx.case_number}</span></div>
            <div class="separator-vertical" style="height:12px; width:1px; background:#3d5a80"></div>
            <div>Client: <span class="text-white">\${ctx.client_name || ctx.title?.split(' v.')[0] || '-'}</span></div>
            <div class="separator-vertical" style="height:12px; width:1px; background:#3d5a80"></div>
            <div>Type: <span class="text-white">\${ctx.case_type || '-'}</span></div>
            <div class="separator-vertical" style="height:12px; width:1px; background:#3d5a80"></div>
            <div class="flex items-center gap-1"><i class="fas fa-clock text-[10px]"></i> Filed: \${ctx.date_filed || 'N/A'}</div>
            \${ctx.status ? '<span class="badge badge-outline text-[10px] border" style="color:#cc2229; border-color:#7f151a">'+ctx.status+'</span>' : ''}
          \` : ''}
        </div>

        <!-- Prompt Chips -->
        <div class="px-4 py-3 border-b" style="background:#1e3354; border-color:#2a4068">
          <div class="text-[10px] uppercase tracking-widest text-slate-600 mb-2 font-semibold">Quick legal actions</div>
          <div class="flex flex-wrap gap-1.5 chips-row">
            <button onclick="injectChip(chatJurisdiction==='missouri' ? 'Research Missouri case law on pure comparative fault under RSMo § 537.765 and joint & several liability under RSMo § 537.067 — cite 8th Circuit and MO Supreme Court holdings' : 'Research Kansas case law on comparative negligence under K.S.A. 60-258a — cite 10th Circuit and KS Supreme Court holdings')" class="text-xs py-1 px-3 rounded-full border text-slate-300 hover:text-red-400 hover:border-red-700 transition-all flex-shrink-0" style="background:#2a4068; border-color:#3d5a80">\u2696\uFE0F Research case law</button>
            <button onclick="injectChip(chatJurisdiction==='missouri' ? 'Draft a demand letter under Missouri law — include RSMo § 537.765 pure comparative fault and RSMo § 516.120 5-year SOL deadline' : 'Draft a demand letter under Kansas law — include K.S.A. 60-258a proportional fault analysis and K.S.A. 60-513 SOL deadline')" class="text-xs py-1 px-3 rounded-full border text-slate-300 hover:text-red-400 hover:border-red-700 transition-all flex-shrink-0" style="background:#2a4068; border-color:#3d5a80">\uD83D\uDCDD Draft demand letter</button>
            <button onclick="injectChip(chatJurisdiction==='missouri' ? 'Confirm the 5-year statute of limitations under RSMo § 516.120 for this claim — flag 2-year med-mal SOL and affidavit of merit requirements' : 'Confirm the 2-year statute of limitations under K.S.A. 60-513 for this claim — flag discovery rule exceptions and presuit requirements')" class="text-xs py-1 px-3 rounded-full border text-slate-300 hover:text-red-400 hover:border-red-700 transition-all flex-shrink-0" style="background:#2a4068; border-color:#3d5a80">\u23F0 SOL check</button>
            <button onclick="injectChip(chatJurisdiction==='missouri' ? 'Analyze RSMo § 537.765 pure comparative fault and RSMo § 537.067 joint & several liability threshold (≥51%) — assess multi-defendant strategy' : 'Analyze K.S.A. 60-258a: 50% comparative fault bar, proportional-only fault allocation (no joint and several), and empty-chair defense implications')" class="text-xs py-1 px-3 rounded-full border text-slate-300 hover:text-red-400 hover:border-red-700 transition-all flex-shrink-0" style="background:#2a4068; border-color:#3d5a80">\u2696\uFE0F Fault & liability</button>
            <button onclick="injectChip('Provide full risk assessment and 3 settlement strategy options with expected value calculations')" class="text-xs py-1 px-3 rounded-full border text-slate-300 hover:text-red-400 hover:border-red-700 transition-all flex-shrink-0" style="background:#2a4068; border-color:#3d5a80">\uD83D\uDCCA Risk & settlement</button>
            <button onclick="injectChip('Generate complete matter timeline with all Kansas or Missouri Rules of Civil Procedure deadlines')" class="text-xs py-1 px-3 rounded-full border text-slate-300 hover:text-red-400 hover:border-red-700 transition-all flex-shrink-0" style="background:#2a4068; border-color:#3d5a80">\uD83D\uDCC5 Build timeline</button>
            <button onclick="injectChip('Create motion to dismiss with supporting KS/MO authorities')" class="text-xs py-1 px-3 rounded-full border text-slate-300 hover:text-red-400 hover:border-red-700 transition-all flex-shrink-0" style="background:#2a4068; border-color:#3d5a80">\uD83D\uDCDD Motion to Dismiss</button>
            <button onclick="injectChip('What am I missing? Give proactive recommendations for this matter')" class="text-xs py-1 px-3 rounded-full border font-semibold text-red-400 hover:bg-red-950 transition-all flex-shrink-0" style="background:#2a4068; border-color:#cc2229">\uD83C\uDFAF What am I missing?</button>
          </div>
        </div>

        <!-- Chat Messages (scroll area) -->
        <div id="chatMessages" class="flex-1 overflow-y-auto p-4 space-y-5" style="scrollbar-width:thin; scrollbar-color:#2a4068 transparent">
          \${chatMessages.length === 0 ? \`
            <div class="flex flex-col items-center justify-center h-full text-center">
              <div class="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 border" style="background:#3d1015; border-color:#7f151a">
                <i class="fas fa-scale-balanced text-xl" style="color:#cc2229"></i>
              </div>
              <h3 class="text-lg font-bold text-white mb-1">Clerky AI Co-Counsel</h3>
              <p class="text-slate-400 text-sm max-w-md mb-3">Your always-on senior partner. I have full context on your matters \u2014 research, draft, analyze, or strategize.</p>
              <div class="flex items-center gap-4 text-xs text-slate-500">
                <span>\uD83D\uDD12 Privileged & Confidential</span>
                <span>\u2696\uFE0F KS & MO Licensed</span>
                <span>\uD83E\uDDE0 4 AI Agents</span>
              </div>
            </div>
          \` : chatMessages.map(m => renderChatMessage(m)).join('')}
        </div>

        <!-- Input Area -->
        <div class="p-3 sm:p-4 border-t" style="border-color:#2a4068; background:#1e3354">
          <div class="relative">
            <textarea id="chatInput" rows="2" placeholder="Ask anything..." class="w-full pr-14 resize-none text-slate-200 placeholder-slate-500 text-sm" style="background:#0d1a2e; border:1px solid #3d5a80; min-height:48px" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat()}"></textarea>
            <button onclick="sendChat()" id="chatSendBtn" class="btn btn-sm absolute right-2 bottom-2 text-white" style="background:#cc2229; width:36px;height:36px;padding:0" onmouseover="this.style.background='#e02e35'" onmouseout="this.style.background='#cc2229'">
              <i class="fas fa-paper-plane text-sm"></i>
            </button>
          </div>
          <div class="flex items-center justify-between mt-2 text-[10px] text-slate-500 gap-2">
            <span class="hidden sm:inline">All responses are logged \u2022 Human review recommended \u2022 Not legal advice</span>
            <span class="sm:hidden">Human review required</span>
            <span id="chatStatus"></span>
          </div>
        </div>
      </div>
    \`;
    scrollChatToBottom();
    checkCrewAIStatus();
  } catch(e) { showError('AI Co-Counsel'); }
}

function updateMatterBar() {
  // Re-fetch matter context when case selection changes
  if (chatCaseId) {
    axios.get(API + '/cases/' + chatCaseId).then(res => {
      currentMatterContext = res.data;
      const bar = document.getElementById('matterBar');
      if (bar) {
        bar.style.display = 'flex';
        const c = res.data;
        bar.innerHTML = \`
          <div>Matter: <span class="text-white font-medium">\${c.case_number || '-'}</span></div>
          <div style="height:12px; width:1px; background:#3d5a80"></div>
          <div>Client: <span class="text-white">\${c.client_name || '-'}</span></div>
          <div style="height:12px; width:1px; background:#3d5a80"></div>
          <div>Type: <span class="text-white">\${c.case_type || '-'}</span></div>
          <div style="height:12px; width:1px; background:#3d5a80"></div>
          <div class="flex items-center gap-1"><i class="fas fa-clock text-[10px]"></i> Filed: \${c.date_filed || 'N/A'}</div>
          \${c.status ? '<span class="badge badge-outline text-[10px] border" style="color:#cc2229; border-color:#7f151a">'+c.status+'</span>' : ''}
        \`;
      }
    }).catch(() => {});
  } else {
    currentMatterContext = null;
    const bar = document.getElementById('matterBar');
    if (bar) bar.style.display = 'none';
  }
}

function renderChatMessage(m) {
  if (m.role === 'user') {
    return \`<div class="flex justify-end">
      <div class="max-w-[80%] sm:max-w-[80%] chat-msg-max rounded-2xl rounded-br-sm px-4 sm:px-5 py-3 shadow-md" style="background:#cc2229">
        <div class="flex items-center gap-2 mb-1">
          <i class="fas fa-user text-xs" style="color:#f8c4c4"></i>
          <span class="text-xs " style="color:#f8c4c4">You</span>
        </div>
        <p class="text-sm text-white leading-relaxed whitespace-pre-wrap">\${escapeHtml(m.content)}</p>
        <p class="text-[10px] mt-1.5 text-right opacity-70" style="color:#f8c4c4">\${formatTime(m.created_at)}</p>
      </div>
    </div>\`;
  }

  // Assistant message — dark card style
  // Use full static class strings to ensure Tailwind CDN generates them
  const agentStyles = {
    researcher:   { bg: 'bg-purple-950', text: 'text-purple-400', border: 'border-purple-800', icon: 'magnifying-glass', emoji: '\uD83D\uDD0D', hex: '#7c3aed' },
    drafter:      { bg: 'bg-pink-950', text: 'text-pink-400', border: 'border-pink-800', icon: 'file-pen', emoji: '\uD83D\uDCDD', hex: '#ec4899' },
    analyst:      { bg: 'bg-emerald-950', text: 'text-emerald-400', border: 'border-emerald-800', icon: 'chart-line', emoji: '\uD83E\uDDE0', hex: '#10b981' },
    strategist:   { bg: 'bg-amber-950', text: 'text-amber-400', border: 'border-amber-800', icon: 'chess', emoji: '\uD83C\uDFAF', hex: '#f59e0b' },
    orchestrator: { bg: 'bg-indigo-950', text: 'text-indigo-400', border: 'border-indigo-800', icon: 'diagram-project', emoji: '\u2696\uFE0F', hex: '#6366f1' }
  };
  const confStyles = {
    high:   { bg: 'bg-emerald-950', text: 'text-emerald-400', border: 'border-emerald-800' },
    medium: { bg: 'bg-amber-950', text: 'text-amber-400', border: 'border-amber-800' },
    low:    { bg: 'bg-red-950', text: 'text-red-400', border: 'border-red-800' }
  };
  const as = agentStyles[m.agent_type] || agentStyles.analyst;
  const confPct = m.confidence ? Math.round(m.confidence * 100) : 0;
  const cs = confPct >= 80 ? confStyles.high : confPct >= 60 ? confStyles.medium : confStyles.low;

  // Build agent badges with full static class names
  let badges = '';
  if (m.agent_type) {
    badges += '<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold '+as.bg+' '+as.text+' border '+as.border+'"><i class="fas fa-'+as.icon+' mr-1"></i>'+m.agent_type+'</span>';
    if (confPct > 0) badges += '<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold '+cs.bg+' '+cs.text+' border '+cs.border+'">'+confPct+'%</span>';
  }
  if (m.sub_agents) {
    try { const subs = typeof m.sub_agents === 'string' ? JSON.parse(m.sub_agents) : m.sub_agents; if (subs && subs.length > 0) badges += '<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-indigo-950 text-indigo-400 border border-indigo-800">\u2192 '+subs.join(', ')+'</span>'; } catch(e){}
  }
  if (m.mem0_loaded) badges += '<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-pink-950 text-pink-400 border border-pink-800">\uD83D\uDCBE Memory</span>';
  if (m.crewai_powered) badges += '<span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-blue-950 text-blue-400 border border-blue-800">\uD83E\uDD16 CrewAI</span>';

  // Risk section
  let riskSection = '';
  if (m.risks_flagged) {
    try {
      const risks = typeof m.risks_flagged === 'string' ? JSON.parse(m.risks_flagged) : m.risks_flagged;
      if (risks && ((typeof risks === 'number' && risks > 0) || (Array.isArray(risks) && risks.length > 0))) {
        const count = typeof risks === 'number' ? risks : risks.length;
        riskSection = '<div class="mt-2 flex items-center gap-1"><span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-red-950 text-red-400 border border-red-800"><i class="fas fa-triangle-exclamation mr-1"></i>'+count+' risk(s) flagged</span></div>';
      }
    } catch(e){}
  }

  // Citation section (from patch)
  let citationSection = '';
  if (m.citations_count && m.citations_count > 0) {
    citationSection = '<div class="mt-2 pt-2 border-t text-[10px]" style="border-color:#2a4068; color:#cc2229"><i class="fas fa-book mr-1"></i>'+m.citations_count+' citation(s) included in response</div>';
  }

  return \`<div class="flex gap-3">
    <div class="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm flex-shrink-0 mt-1" style="background:\${as.hex}">\${as.emoji}</div>
    <div class="max-w-[85%] chat-msg-max rounded-2xl rounded-bl-sm px-4 sm:px-5 py-3 sm:py-4 shadow-md border" style="border-color:#2a4068; background:#1e3354">
      <div class="flex items-center gap-2 mb-2">
        <i class="fas fa-robot text-xs" style="color:#cc2229"></i>
        <span class="text-xs text-slate-400">Clerky AI \u2022 \${m.agent_type ? m.agent_type.charAt(0).toUpperCase() + m.agent_type.slice(1) + ' Agent' : 'Senior Partner'}</span>
      </div>
      \${badges ? '<div class="flex items-center gap-1.5 mb-3 flex-wrap">'+badges+'</div>' : ''}
      <div class="text-sm text-slate-200 leading-relaxed prose-sm chat-content">\${renderMarkdown(m.content)}</div>
      \${riskSection}
      \${citationSection}
      <p class="text-[10px] text-slate-500 mt-3">\${formatTime(m.created_at)}\${m.tokens_used ? ' \u2022 ~'+Number(m.tokens_used).toLocaleString()+' tokens' : ''}\${m.duration_ms ? ' \u2022 '+m.duration_ms+'ms' : ''}</p>
    </div>
  </div>\`;
}

function renderMarkdown(text) {
  if (!text) return '';

  // ── HTML-escape helper for untrusted content (BUG-4 fix) ──
  function mdEscape(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── 1. Extract code blocks to protect from replacements ──
  const codeBlocks = [];
  let processed = text.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, function(_, code) {
    codeBlocks.push(code);
    return '%%CODEBLOCK_' + (codeBlocks.length - 1) + '%%';
  });
  // Extract inline code
  const inlineCodes = [];
  processed = processed.replace(/\`(.+?)\`/g, function(_, code) {
    inlineCodes.push(code);
    return '%%INLINE_' + (inlineCodes.length - 1) + '%%';
  });

  // ── 2. Render markdown tables ───────────────────────────
  // Detect table blocks: header row | separator row | data rows
  processed = processed.replace(/(^\\|.+\\|\\n)(\\|[-:|\\s]+\\|\\n)((?:\\|.+\\|\\n?)+)/gm, function(match, headerRow, sepRow, bodyRows) {
    // Parse header
    var headers = headerRow.trim().split('|').filter(function(c) { return c.trim() !== ''; });
    // Parse alignment from separator
    var aligns = sepRow.trim().split('|').filter(function(c) { return c.trim() !== ''; }).map(function(c) {
      c = c.trim();
      if (c.startsWith(':') && c.endsWith(':')) return 'center';
      if (c.endsWith(':')) return 'right';
      return 'left';
    });
    // Parse body
    var rows = bodyRows.trim().split('\\n').filter(function(r) { return r.trim().startsWith('|'); });

    var table = '<div class="overflow-x-auto my-3"><table class="w-full text-xs border-collapse">';
    // Header
    table += '<thead><tr>';
    headers.forEach(function(h, i) {
      table += '<th class="px-3 py-2 text-left font-semibold text-slate-200 border-b border-slate-600 bg-slate-800/50" style="text-align:' + (aligns[i]||'left') + '">' + mdEscape(h.trim()) + '</th>';
    });
    table += '</tr></thead>';
    // Body
    table += '<tbody>';
    rows.forEach(function(row, ri) {
      var cells = row.trim().split('|').filter(function(c) { return c.trim() !== ''; });
      var rowBg = ri % 2 === 0 ? '' : ' bg-slate-800/20';
      table += '<tr class="border-b border-slate-700/50' + rowBg + '">';
      cells.forEach(function(cell, ci) {
        table += '<td class="px-3 py-1.5 text-slate-300" style="text-align:' + (aligns[ci]||'left') + '">' + mdEscape(cell.trim()) + '</td>';
      });
      table += '</tr>';
    });
    table += '</tbody></table></div>';
    return table;
  });

  // ── 3. Render blockquotes (> lines — routing header, mem0 note) ──
  processed = processed.replace(/^> (.+)$/gm, '<div class="border-l-3 border-red-700 pl-3 py-1 my-2 text-sm text-slate-300 bg-slate-800/30 rounded-r-lg">$1</div>');

  // ── 4. Render links [text](url) ───────────────────────────
  processed = processed.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener" class="underline underline-offset-2" style="color:#cc2229">$1</a>');

  // ── 5. Render <small> metadata tags ───────────────────────
  processed = processed.replace(/&lt;small&gt;(.+?)&lt;\\/small&gt;/g, '<div class="text-[10px] text-slate-500 mt-2">$1</div>');
  // Also handle raw <small> (not escaped)
  processed = processed.replace(/<small>(.+?)<\\/small>/g, '<div class="text-[10px] text-slate-500 mt-2">$1</div>');

  // ── 6. Standard markdown processing ───────────────────────
  processed = processed
    .replace(/^## (.+)$/gm, '<h3 class="text-base font-bold text-white mt-3 mb-2">$1</h3>')
    .replace(/^### (.+)$/gm, '<h4 class="text-sm font-bold text-slate-200 mt-2 mb-1">$1</h4>')
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong class="text-white">$1</strong>')
    .replace(/^- \\[ \\] (.+)$/gm, '<div class="flex items-center gap-2 text-slate-300 ml-2"><i class="far fa-square text-slate-500 text-xs"></i> $1</div>')
    .replace(/^- (.+)$/gm, '<div class="flex items-start gap-2 ml-2"><span class="text-slate-500 mt-0.5">\u2022</span> $1</div>')
    .replace(/^\\d+\\. (.+)$/gm, '<div class="ml-2 text-slate-300">$1</div>')
    .replace(/\\n---\\n/g, '<hr class="my-3 border-slate-700">')
    .replace(/\\n\\n/g, '<div class="mb-2"></div>')
    .replace(/\\n/g, '<br>')
    .replace(/\\*(.+?)\\*/g, '<em class="text-slate-300">$1</em>');

  // ── 7. Restore code blocks and inline code ────────────────
  codeBlocks.forEach(function(code, i) {
    // JSON code blocks get special syntax highlighting
    var isJson = code.trim().startsWith('{') || code.trim().startsWith('[');
    var cls = isJson
      ? 'bg-slate-800 p-3 rounded-lg text-xs overflow-x-auto my-2 font-mono border border-slate-700 text-amber-300'
      : 'bg-slate-800 p-3 rounded-lg text-xs text-slate-300 overflow-x-auto my-2 font-mono border border-slate-700';
    processed = processed.replace('%%CODEBLOCK_' + i + '%%', '<pre class="' + cls + '">' + mdEscape(code) + '</pre>');
  });
  inlineCodes.forEach(function(code, i) {
    processed = processed.replace('%%INLINE_' + i + '%%', '<code class="bg-slate-800 px-1.5 py-0.5 rounded text-xs font-mono border" style="color:#cc2229; border-color:#2a4068">' + mdEscape(code) + '</code>');
  });
  return processed;
}

function escapeHtml(t) {
  const d = document.createElement('div'); d.textContent = t; return d.innerHTML;
}

function injectChip(text) {
  const input = document.getElementById('chatInput');
  const caseSelect = document.getElementById('chatCaseSelect');
  const caseName = caseSelect?.selectedOptions?.[0]?.text;
  let enriched = text;
  if (chatCaseId && caseName && caseName !== 'No matter selected') {
    enriched = text
      .replace('[issue]', 'the issues in ' + caseName)
      .replace('[claim type]', 'the claims in ' + caseName)
      .replace('the current matter facts', 'the facts of ' + caseName);
  }
  input.value = enriched;
  input.focus();
}

async function sendChat() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  const sendBtn = document.getElementById('chatSendBtn');
  sendBtn.disabled = true;
  sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin text-sm"></i>';

  const msgContainer = document.getElementById('chatMessages');
  const emptyState = msgContainer.querySelector('.flex.flex-col.items-center');
  if (emptyState) emptyState.remove();

  // Show user message
  msgContainer.innerHTML += renderChatMessage({ role: 'user', content: message, created_at: new Date().toISOString() });

  // Show thinking indicator (from patch — step-by-step)
  msgContainer.innerHTML += \`<div id="typingIndicator" class="flex items-center gap-3 text-slate-400">
    <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style="background:#064e3b">
      <i class="fas fa-robot text-sm" style="color:#cc2229"></i>
    </div>
    <div class="rounded-2xl px-4 py-3 border" style="border-color:#2a4068; background:#1e3354">
      <div class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full animate-pulse" style="background:#cc2229"></span>
        <span class="text-xs text-slate-400" id="typingText">Thinking step-by-step with full case context...</span>
      </div>
    </div>
  </div>\`;
  scrollChatToBottom();

  // Animate orchestration steps — CrewAI hierarchy: Researcher → Analyst → Drafter/Strategist
  const typingSteps = [
    'Initializing CrewAI pipeline...',
    'Loading matter context & agent memory...',
    'Routing: Researcher \\u2192 Analyst \\u2192 Specialist...',
    'Running ' + chatJurisdiction.charAt(0).toUpperCase() + chatJurisdiction.slice(1) + ' jurisdiction analysis...',
    'Generating response & detecting side-effects...',
    'Syncing dashboard (docs, tasks, events)...'
  ];
  let stepIdx = 0;
  const stepInterval = setInterval(() => { stepIdx++; const el = document.getElementById('typingText'); if (el && stepIdx < typingSteps.length) el.textContent = typingSteps[stepIdx]; }, 800);

  document.getElementById('chatStatus').textContent = '\u{1F9E0} Processing...';

  // Refresh dashboard state if stale (all zeros = never loaded outside dashboard page)
  if (liveDashboardState.active_cases === 0 && liveDashboardState.active_clients === 0) {
    try {
      const dashRes = await axios.get(API + '/dashboard');
      const dd = dashRes.data;
      liveDashboardState = {
        active_cases: dd.cases?.active || 0,
        active_clients: dd.clients?.total || 0,
        pending_tasks: dd.tasks?.pending || 0,
        overdue_tasks: dd.tasks?.overdue || 0,
        total_documents: dd.documents?.total || 0,
        total_events: (dd.upcoming_events || []).length
      };
    } catch(e) { /* proceed with stale state */ }
  }

  try {
    const { data } = await axios.post(API + '/ai/crew', {
      query: message,
      matter_context: currentMatterContext || (chatCaseId ? { case_id: chatCaseId, case_number: document.querySelector('#chatCaseSelect option:checked')?.textContent?.split(' \\u2014')[0] || null } : null),
      dashboard_state: liveDashboardState,
      session_id: chatSessionId,
      jurisdiction: chatJurisdiction
    });

    clearInterval(stepInterval);
    const ti = document.getElementById('typingIndicator');
    if (ti) ti.remove();

    // Add AI response
    msgContainer.innerHTML += renderChatMessage({
      role: 'assistant',
      content: data.content,
      agent_type: data.agent_used,
      jurisdiction: data.jurisdiction,
      tokens_used: data.tokens_used,
      duration_ms: data.duration_ms,
      confidence: data.confidence,
      sub_agents: data.sub_agents,
      risks_flagged: data.risks_flagged,
      citations_count: data.citations,
      mem0_loaded: data.mem0_context_loaded,
      crewai_powered: data.crewai_powered,
      created_at: new Date().toISOString()
    });

    const confPct = data.confidence ? Math.round(data.confidence * 100) + '%' : '';
    const subInfo = data.sub_agents && data.sub_agents.length > 0 ? ' \u2192 ' + data.sub_agents.join(', ') : '';
    const risksInfo = data.risks_flagged > 0 ? ' \u2022 \u26A0\uFE0F' + data.risks_flagged + ' risk(s)' : '';
    const citesInfo = data.citations > 0 ? ' \u2022 \uD83D\uDCDA' + data.citations + ' cite(s)' : '';
    const crewFlag = data.crewai_powered ? ' \u2022 \uD83E\uDD16 CrewAI' : '';
    document.getElementById('chatStatus').textContent = '\u2705 ' + data.agent_used + ' (' + confPct + ')' + subInfo + ' \u2022 ~' + Number(data.tokens_used).toLocaleString() + ' tokens' + risksInfo + citesInfo + crewFlag + ' \u2022 ' + data.duration_ms + 'ms';

    toast('Agent Response', data.agent_used + ' agent responded with ' + (data.citations || 0) + ' citations', 'success');

    // ═══ DASHBOARD AUTO-WIRING from /api/crew response ═══
    if (data.dashboard_update) {
      const du = data.dashboard_update;

      // ── 1. Pipeline Steps visualization ────────────────────
      if (du.pipeline_steps && du.pipeline_steps.length > 0) {
        const stepsHtml = du.pipeline_steps.map(function(step, i) {
          const isLast = i === du.pipeline_steps.length - 1;
          const icon = step.includes('Error') ? 'fa-times-circle text-red-400' :
                       step.includes('complete') || step.includes('Complete') ? 'fa-check-circle text-red-500' :
                       step.includes('Document') || step.includes('doc') ? 'fa-file-alt text-blue-400' :
                       step.includes('task') || step.includes('Task') ? 'fa-tasks text-amber-400' :
                       step.includes('event') || step.includes('Event') || step.includes('Calendar') ? 'fa-calendar text-purple-400' :
                       step.includes('CrewAI') ? 'fa-robot text-cyan-400' :
                       step.includes('Researcher') || step.includes('researcher') ? 'fa-search text-sky-400' :
                       step.includes('Analyst') || step.includes('analyst') ? 'fa-chart-bar text-orange-400' :
                       step.includes('Drafter') || step.includes('drafter') ? 'fa-pen-fancy text-indigo-400' :
                       step.includes('Strategist') || step.includes('strategist') ? 'fa-chess text-rose-400' :
                       'fa-circle text-slate-500';
          return '<div class="flex items-start gap-2 ' + (isLast ? '' : 'mb-1') + '">' +
            '<i class="fas ' + icon + ' text-[10px] mt-1 flex-shrink-0"></i>' +
            '<span class="text-[11px] text-slate-400">' + step + '</span></div>';
        }).join('');

        msgContainer.innerHTML += '<div class="flex justify-center my-2"><div class="rounded-xl px-4 py-3 border max-w-md w-full" style="background:#142440; border-color:#2a4068">' +
          '<div class="flex items-center gap-2 mb-2"><i class="fas fa-stream text-xs" style="color:#cc2229"></i><span class="text-xs font-semibold" style="color:#cc2229">Pipeline Trace</span>' +
          '<span class="text-[10px] text-slate-500 ml-auto">' + du.pipeline_steps.length + ' steps</span></div>' +
          stepsHtml + '</div></div>';
      }

      // ── 2. Agents Used badges ──────────────────────────────
      if (du.agents_used && du.agents_used.length > 0) {
        const agentBadges = du.agents_used.map(function(a) {
          const colors = { researcher: 'bg-sky-900 text-sky-300 border-sky-700', drafter: 'bg-indigo-900 text-indigo-300 border-indigo-700', analyst: 'bg-orange-900 text-orange-300 border-orange-700', strategist: 'bg-rose-900 text-rose-300 border-rose-700' };
          const aLower = a.toLowerCase();
          const colorClass = Object.keys(colors).find(function(k) { return aLower.includes(k); });
          const cls = colorClass ? colors[colorClass] : 'bg-slate-800 text-slate-300 border-slate-600';
          return '<span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium border ' + cls + '">' +
            '<i class="fas fa-robot text-[8px]"></i> ' + a + '</span>';
        }).join(' ');

        msgContainer.innerHTML += '<div class="flex justify-center gap-1.5 my-1 flex-wrap">' + agentBadges + '</div>';
      }

      // ── 3. Dashboard sync banner with clickable actions ────
      const updates = [];
      const actions = [];
      if (du.new_documents > 0) {
        updates.push('<i class="fas fa-file-alt text-blue-400"></i> ' + du.new_documents + ' doc(s)');
        actions.push('<button onclick="navigate(\\x27documents\\x27)" class="text-[10px] underline text-blue-400 hover:text-blue-300">View Docs</button>');
      }
      if (du.new_tasks > 0) {
        updates.push('<i class="fas fa-tasks text-amber-400"></i> ' + du.new_tasks + ' task(s)');
        actions.push('<button onclick="navigate(\\x27tasks\\x27)" class="text-[10px] underline text-amber-400 hover:text-amber-300">View Tasks</button>');
      }
      if (du.event_added) {
        updates.push('<i class="fas fa-calendar text-purple-400"></i> ' + du.event_added);
        actions.push('<button onclick="navigate(\\x27calendar\\x27)" class="text-[10px] underline text-purple-400 hover:text-purple-300">View Calendar</button>');
      }

      if (updates.length > 0) {
        // Rich toast with navigation
        toast('Dashboard Synced', updates.join(' \\u2022 ').replace(/<[^>]*>/g, '') + ' \\u2014 Click to view', 'success');

        // In-chat sync banner with action buttons
        msgContainer.innerHTML += '<div class="flex justify-center my-2"><div class="inline-flex flex-col items-center gap-1.5 rounded-xl px-5 py-2.5 border" style="background:#064e3b; border-color:#cc2229">' +
          '<div class="flex items-center gap-2"><i class="fas fa-bolt text-xs" style="color:#cc2229"></i><span class="text-xs font-semibold" style="color:#f09898">Dashboard Synced</span></div>' +
          '<div class="flex items-center gap-3 text-xs" style="color:#f8c4c4">' + updates.join(' <span style="color:#7f151a">|</span> ') + '</div>' +
          (actions.length > 0 ? '<div class="flex items-center gap-3 mt-0.5">' + actions.join('') + '</div>' : '') +
          '</div></div>';

        // ── 4. Auto-refresh current page if relevant ─────────
        // Update cached dashboard state immediately with side-effect counts
        liveDashboardState.total_documents += du.new_documents;
        liveDashboardState.pending_tasks += du.new_tasks;
        if (du.event_added) liveDashboardState.total_events++;

        if (currentPage === 'dashboard') {
          // Silently reload dashboard stats after a brief delay
          setTimeout(function() { loadDashboard(); }, 1200);
        } else if (currentPage === 'documents' && du.new_documents > 0) {
          setTimeout(function() { loadDocuments(); }, 1200);
        } else if (currentPage === 'tasks' && du.new_tasks > 0) {
          setTimeout(function() { loadTasks(); }, 1200);
        } else if (currentPage === 'calendar' && du.event_added) {
          setTimeout(function() { loadCalendar(); }, 1200);
        }
      }

      // ── 5. Matter ID linking ───────────────────────────────
      if (du.matter_id) {
        msgContainer.innerHTML += '<div class="flex justify-center my-1"><span class="text-[10px] text-slate-500"><i class="fas fa-link mr-1"></i>Linked to matter: <strong class="text-slate-400">' + du.matter_id + '</strong></span></div>';
      }

      console.log('[CrewAI Pipeline]', du.pipeline_steps);
      console.log('[Dashboard Update]', du);
    }
  } catch(e) {
    clearInterval(stepInterval);
    const ti = document.getElementById('typingIndicator');
    if (ti) ti.remove();
    msgContainer.innerHTML += '<div class="text-center py-2"><span class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-red-950 text-red-400 border border-red-800"><i class="fas fa-times-circle mr-1"></i>Error: ' + (e.message || 'Network error') + '</span></div>';
    document.getElementById('chatStatus').textContent = '\u274C Error';
    toast('Error', 'Failed to get AI response', 'error');
  }

  sendBtn.disabled = false;
  sendBtn.innerHTML = '<i class="fas fa-paper-plane text-sm"></i>';
  scrollChatToBottom();
}

async function clearChat() {
  if (!confirm('Clear this chat session?')) return;
  try { await axios.delete(API + '/ai/chat/' + chatSessionId); } catch(e) {}
  chatSessionId = 'session_' + Date.now();
  chatMessages = [];
  loadAIChat();
}

function scrollChatToBottom() {
  const c = document.getElementById('chatMessages');
  if (c) setTimeout(() => c.scrollTop = c.scrollHeight, 100);
}

// === CREWAI STATUS & SETTINGS ===
async function checkCrewAIStatus() {
  const bar = document.getElementById('crewaiStatusBar');
  const indicator = document.getElementById('crewaiIndicator');
  if (!bar || !indicator) return;
  bar.style.display = 'flex';
  try {
    const res = await axios.get(API + '/ai/crewai/status', { timeout: 5000 });
    const d = res.data;
    if (d.available && d.llm_reachable) {
      indicator.innerHTML = '<span class="w-1.5 h-1.5 rounded-full animate-pulse" style="background:#cc2229"></span> <span style="color:#cc2229">CrewAI: ' + d.model + ' ✓ LLM active</span>';
    } else if (d.available) {
      indicator.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-400"></span> <span class="text-amber-400">AI Agents ready — connect an LLM for full AI research</span> <button onclick="showCrewAISettings()" class="text-amber-300 underline ml-1">Connect LLM</button>';
    } else {
      indicator.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-slate-600"></span> <span class="text-slate-500">Research agents ready — connect an LLM for enhanced AI</span>';
    }
  } catch(e) {
    indicator.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-slate-600"></span> <span class="text-slate-500">Research agents ready — connect an LLM for enhanced AI</span>';
  }
}

const LLM_PRESETS = {
  openai:    { name: 'OpenAI',           base_url: '',                                  model: 'gpt-5-mini',                     placeholder: 'sk-...',        help: 'Get key at platform.openai.com/api-keys' },
  openrouter:{ name: 'OpenRouter',       base_url: 'https://openrouter.ai/api/v1',      model: 'anthropic/claude-sonnet-4',  placeholder: 'sk-or-...',     help: 'Supports Claude, GPT, Gemini & more — openrouter.ai/keys' },
  novita:    { name: 'Novita AI',        base_url: 'https://api.novita.ai/v3/openai',   model: 'claude-3-5-sonnet-20241022',      placeholder: 'nvt-...',       help: 'novita.ai — Claude & open models' },
  genspark:  { name: 'GenSpark',         base_url: 'https://www.genspark.ai/api/llm_proxy/v1', model: 'gpt-5-mini',            placeholder: 'gsk-...',       help: 'GenSpark LLM proxy — go to API Keys tab to get your key' },
  anthropic: { name: 'Anthropic (direct)', base_url: 'https://api.anthropic.com/v1',    model: 'claude-sonnet-4-20250514',   placeholder: 'sk-ant-...',    help: 'console.anthropic.com — requires OpenAI-compat proxy' },
  custom:    { name: 'Custom Endpoint',  base_url: '',                                  model: '',                                placeholder: 'your-api-key', help: 'Any OpenAI-compatible API endpoint' },
};

function showCrewAISettings() {
  const modal = document.createElement('div');
  modal.id = 'crewaiModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);padding:1rem';
  modal.innerHTML = \`
    <div class="rounded-xl border p-5 sm:p-6 w-full shadow-2xl" style="background:#1e3354; border-color:#2a4068; max-width:480px; max-height:90vh; overflow-y:auto">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-white flex items-center gap-2"><i class="fas fa-robot" style="color:#cc2229"></i> CrewAI LLM Settings</h3>
        <button onclick="document.getElementById('crewaiModal').remove()" class="text-slate-400 hover:text-white"><i class="fas fa-times"></i></button>
      </div>

      <!-- Current Status -->
      <div id="crewaiCurrentCfg" class="rounded-lg p-3 mb-4 text-xs" style="background:#162a48; border:1px solid #2a4068">
        <div class="flex items-center gap-2 mb-1"><i class="fas fa-info-circle text-slate-500"></i> <span class="text-slate-400 font-medium">Current Config</span></div>
        <div id="crewaiCfgDetail" class="text-slate-500">Loading...</div>
      </div>

      <!-- Provider Presets -->
      <label class="text-xs text-slate-400 block mb-2">Quick Setup — Choose Provider</label>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4" id="crewaiPresetBtns">
        <button onclick="applyPreset('openai')" class="preset-btn text-[11px] py-2 px-2 rounded-lg border text-center transition-all hover:border-red-400" style="background:#2a4068; border-color:#3d5a80; color:#8899b3">
          <i class="fas fa-bolt block text-base mb-1" style="color:#10a37f"></i>OpenAI
        </button>
        <button onclick="applyPreset('openrouter')" class="preset-btn text-[11px] py-2 px-2 rounded-lg border text-center transition-all hover:border-red-400" style="background:#2a4068; border-color:#3d5a80; color:#8899b3">
          <i class="fas fa-route block text-base mb-1" style="color:#b48eff"></i>OpenRouter
        </button>
        <button onclick="applyPreset('genspark')" class="preset-btn text-[11px] py-2 px-2 rounded-lg border text-center transition-all hover:border-red-400" style="background:#2a4068; border-color:#3d5a80; color:#8899b3">
          <i class="fas fa-wand-magic-sparkles block text-base mb-1" style="color:#cc2229"></i>GenSpark
        </button>
        <button onclick="applyPreset('novita')" class="preset-btn text-[11px] py-2 px-2 rounded-lg border text-center transition-all hover:border-red-400" style="background:#2a4068; border-color:#3d5a80; color:#8899b3">
          <i class="fas fa-star block text-base mb-1" style="color:#f59e0b"></i>Novita AI
        </button>
      </div>

      <div class="space-y-3">
        <div>
          <label class="text-xs text-slate-400 block mb-1">API Key <span class="text-red-400">*</span></label>
          <div class="relative">
            <input id="crewaiApiKey" type="password" placeholder="sk-... or your API key" class="w-full text-sm py-2 px-3 pr-10 rounded-lg text-white" style="background:#2a4068; border:1px solid #3d5a80">
            <button onclick="toggleKeyVis()" class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs"><i id="keyVisIcon" class="fas fa-eye"></i></button>
          </div>
          <p id="crewaiKeyHelp" class="text-[10px] text-slate-600 mt-1"></p>
        </div>
        <div>
          <label class="text-xs text-slate-400 block mb-1">Base URL</label>
          <input id="crewaiBaseUrl" type="text" placeholder="https://api.openai.com/v1 (leave blank for OpenAI)" class="w-full text-sm py-2 px-3 rounded-lg text-white" style="background:#2a4068; border:1px solid #3d5a80">
        </div>
        <div>
          <label class="text-xs text-slate-400 block mb-1">Model</label>
          <input id="crewaiModel" type="text" placeholder="gpt-5-mini" class="w-full text-sm py-2 px-3 rounded-lg text-white" style="background:#2a4068; border:1px solid #3d5a80">
        </div>
      </div>
      <div id="crewaiConfigResult" class="mt-3 text-xs hidden"></div>
      <div class="flex gap-2 mt-4">
        <button onclick="configureCrewAI()" id="crewaiSaveBtn" class="btn text-white text-sm flex-1" style="background:#cc2229">
          <i class="fas fa-check mr-1"></i> Save & Test
        </button>
        <button onclick="document.getElementById('crewaiModal').remove()" class="btn btn-ghost text-slate-400 text-sm">Cancel</button>
      </div>
    </div>
  \`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  // Load current config
  axios.get(API + '/ai/crewai/status', { timeout: 5000 }).then(r => {
    const d = r.data;
    const det = document.getElementById('crewaiCfgDetail');
    if (!det) return;
    if (d.available && d.llm_reachable) {
      det.innerHTML = '<span style="color:#22c55e"><i class="fas fa-circle text-[8px] mr-1"></i>Connected</span> — Model: <span class="text-white">' + (d.model||'unknown') + '</span>';
    } else if (d.available && d.llm_configured) {
      det.innerHTML = '<span class="text-amber-400"><i class="fas fa-circle text-[8px] mr-1"></i>Configured but not reachable</span> — Model: <span class="text-white">' + (d.model||'unknown') + '</span>';
    } else if (d.available) {
      det.innerHTML = '<span class="text-amber-400"><i class="fas fa-circle text-[8px] mr-1"></i>CrewAI ready — enter API key for full AI</span>';
    } else {
      det.innerHTML = '<span class="text-slate-500"><i class="fas fa-circle text-[8px] mr-1"></i>CrewAI backend offline</span> — embedded research agents active';
    }
  }).catch(() => {
    const det = document.getElementById('crewaiCfgDetail');
    if (det) det.innerHTML = '<span class="text-slate-500">Could not reach CrewAI backend</span>';
  });
}

function applyPreset(provider) {
  const p = LLM_PRESETS[provider];
  if (!p) return;
  document.getElementById('crewaiBaseUrl').value = p.base_url;
  document.getElementById('crewaiModel').value = p.model;
  document.getElementById('crewaiApiKey').placeholder = p.placeholder;
  document.getElementById('crewaiKeyHelp').textContent = p.help;
  // Highlight selected preset
  document.querySelectorAll('#crewaiPresetBtns .preset-btn').forEach(b => { b.style.borderColor = '#3d5a80'; });
  event.currentTarget.style.borderColor = '#cc2229';
  document.getElementById('crewaiApiKey').focus();
}

function toggleKeyVis() {
  const inp = document.getElementById('crewaiApiKey');
  const ico = document.getElementById('keyVisIcon');
  if (inp.type === 'password') { inp.type = 'text'; ico.className = 'fas fa-eye-slash'; }
  else { inp.type = 'password'; ico.className = 'fas fa-eye'; }
}

async function configureCrewAI() {
  const key = document.getElementById('crewaiApiKey').value.trim();
  const base = document.getElementById('crewaiBaseUrl').value.trim();
  const model = document.getElementById('crewaiModel').value.trim();
  const resultDiv = document.getElementById('crewaiConfigResult');
  const btn = document.getElementById('crewaiSaveBtn');
  
  if (!key) { resultDiv.className = 'mt-3 text-xs text-red-400'; resultDiv.textContent = 'API key is required'; resultDiv.classList.remove('hidden'); return; }
  
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Testing connection...';
  resultDiv.className = 'mt-3 text-xs text-slate-400';
  resultDiv.textContent = 'Configuring and testing LLM connection...';
  resultDiv.classList.remove('hidden');
  
  try {
    const res = await axios.post(API + '/ai/crewai/configure', {
      api_key: key,
      base_url: base || undefined,
      model: model || undefined,
    }, { timeout: 30000, headers: { 'X-Admin-Key': 'clerky-admin-2026' } });
    
    if (res.data.llm_reachable) {
      resultDiv.className = 'mt-3 text-xs'; resultDiv.style.color = '#22c55e';
      resultDiv.innerHTML = '<i class="fas fa-check-circle mr-1"></i> Connected! Model: <strong>' + res.data.model + '</strong>. CrewAI agents are now fully active.';
      checkCrewAIStatus();
      setTimeout(() => { const m = document.getElementById('crewaiModal'); if (m) m.remove(); }, 2500);
    } else {
      resultDiv.className = 'mt-3 text-xs text-amber-400';
      resultDiv.innerHTML = '<i class="fas fa-exclamation-triangle mr-1"></i> ' + (res.data.message || 'LLM not reachable — double-check your API key and base URL.');
    }
  } catch(e) {
    resultDiv.className = 'mt-3 text-xs text-red-400';
    resultDiv.textContent = 'Error: ' + (e.response?.data?.error || e.message || 'Failed to connect to CrewAI backend');
  }
  
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-check mr-1"></i> Save & Test';
}
async function loadMemory() {
  try {
    const [memStatsRes, casesRes, allMemRes] = await Promise.all([
      axios.get(API + '/ai/memory/stats').catch(() => ({ data: { mem0: { enabled: false, total: 0, by_agent: {}, recent: [] }, d1: { total: 0, by_agent: [] } } })),
      axios.get(API + '/cases'),
      axios.get(API + '/ai/memory/all').catch(() => ({ data: { source: 'd1', memories: [], total: 0 } }))
    ]);
    const ms = memStatsRes.data;
    const cases = casesRes.data.cases;
    const allMem = allMemRes.data;
    const mem0On = ms.mem0?.enabled || false;
    const totalMem = mem0On ? (ms.mem0?.total || 0) : (ms.d1?.total || 0);
    const memories = allMem.memories || [];
    
    const agentTypes = ['researcher', 'drafter', 'analyst', 'strategist'];
    const agentColors = { researcher: 'purple', drafter: 'pink', analyst: 'emerald', strategist: 'amber' };
    const agentIcons = { researcher: 'magnifying-glass', drafter: 'file-pen', analyst: 'chart-line', strategist: 'chess' };

    document.getElementById('pageContent').innerHTML = \`
      <div class="fade-in">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold text-dark-900 flex items-center gap-2"><i class="fas fa-brain text-pink-500"></i> Agent Memory</h2>
            <p class="text-dark-500 text-sm mt-1">Persistent cross-session memory powered by \${mem0On ? '<span class="text-pink-600 font-semibold">Mem0 Cloud</span>' : '<span class="text-dark-500">D1 Local</span>'}</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="badge \${mem0On ? 'bg-pink-100 text-pink-700' : 'bg-dark-100 text-dark-500'}">\${mem0On ? '\u2601\uFE0F Mem0 Cloud' : '\uD83D\uDCBE D1 Local'}</span>
            <span class="badge" style="background:#fef2f2; color:#cc2229">\${totalMem} memories</span>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div class="card p-4 text-center border-pink-200 bg-pink-50">
            <p class="text-xs text-pink-600 font-semibold">Total Memories</p>
            <p class="text-2xl font-bold text-pink-700">\${totalMem}</p>
          </div>
          \${agentTypes.map(a => {
            const count = mem0On ? (ms.mem0?.by_agent?.[a] || 0) : ((ms.d1?.by_agent || []).find(b => b.agent_type === a)?.count || 0);
            return '<div class="card p-4 text-center"><p class="text-xs text-'+agentColors[a]+'-600 font-semibold"><i class="fas fa-'+agentIcons[a]+' mr-1"></i>'+a+'</p><p class="text-2xl font-bold text-dark-800">'+count+'</p></div>';
          }).join('')}
        </div>

        <div class="card p-4 mb-6">
          <div class="flex gap-3 memory-search-bar">
            <div class="flex-1">
              <input type="text" id="memorySearch" placeholder="Search memories..." class="w-full" onkeydown="if(event.key==='Enter')searchMemories()">
            </div>
            <select id="memoryCaseFilter" class="w-48">
              <option value="">All cases</option>
              \${cases.map(c => '<option value="'+c.id+'">'+c.case_number+'</option>').join('')}
            </select>
            <button onclick="searchMemories()" class="btn btn-primary"><i class="fas fa-search mr-1"></i> Search</button>
          </div>
          <div id="memorySearchResults" class="mt-4 hidden"></div>
        </div>

        <h3 class="font-semibold text-dark-800 mb-4"><i class="fas fa-clock-rotate-left text-dark-400 mr-2"></i>Memory Timeline</h3>
        <div class="space-y-3" id="memoryTimeline">
          \${memories.length === 0 ? '<div class="card p-8 text-center"><i class="fas fa-brain text-dark-300 text-3xl mb-3"></i><p class="text-dark-400">No memories yet. Chat with AI Co-Counsel to start building memory.</p></div>' :
            memories.slice(0, 30).map(m => {
              const agent = m.metadata?.agent_type || m.agent_type || 'general';
              const ac = agentColors[agent] || 'dark';
              const aIcon = agentIcons[agent] || 'brain';
              const memText = m.memory || m.memory_value || '';
              const caseRef = m.metadata?.case_id || m.case_id || '';
              const created = m.created_at || m.updated_at || '';
              const memId = m.id || '';
              return '<div class="card p-4 hover:shadow-md transition-shadow"><div class="flex items-start justify-between"><div class="flex items-start gap-3 flex-1"><div class="w-8 h-8 bg-'+ac+'-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"><i class="fas fa-'+aIcon+' text-'+ac+'-600 text-sm"></i></div><div class="flex-1 min-w-0"><div class="flex items-center gap-2 mb-1"><span class="badge bg-'+ac+'-100 text-'+ac+'-700 text-xs">'+agent+'</span>'+(caseRef ? '<span class="badge bg-dark-100 text-dark-500 text-xs">Case #'+caseRef+'</span>' : '')+'</div><p class="text-sm text-dark-700">'+escapeHtml(memText.substring(0, 300))+(memText.length > 300 ? '...' : '')+'</p>'+(created ? '<p class="text-xs text-dark-400 mt-1">'+formatDate(created)+'</p>' : '')+'</div></div><button onclick="deleteMemory(\\''+memId+'\\')" class="text-dark-300 hover:text-red-500 ml-2 flex-shrink-0" title="Delete memory"><i class="fas fa-trash-alt text-xs"></i></button></div></div>';
            }).join('')
          }
        </div>
      </div>
    \`;
  } catch(e) { showError('Agent Memory'); }
}

async function searchMemories() {
  const query = document.getElementById('memorySearch')?.value?.trim();
  const caseId = document.getElementById('memoryCaseFilter')?.value;
  if (!query) return;
  const resultsDiv = document.getElementById('memorySearchResults');
  resultsDiv.classList.remove('hidden');
  resultsDiv.innerHTML = '<div class="flex items-center gap-2"><i class="fas fa-spinner fa-spin text-pink-500"></i><span class="text-sm text-dark-400">Searching...</span></div>';
  try {
    const { data } = await axios.get(API + '/ai/memory/search?q=' + encodeURIComponent(query) + (caseId ? '&case_id=' + caseId : ''));
    const results = data.results || [];
    if (results.length === 0) { resultsDiv.innerHTML = '<p class="text-sm text-dark-400">No matching memories found.</p>'; return; }
    resultsDiv.innerHTML = '<p class="text-xs text-dark-400 mb-2 font-semibold">' + results.length + ' result(s) via ' + data.source + '</p>' +
      results.map(r => '<div class="bg-dark-50 rounded-lg p-3 mb-2"><p class="text-sm text-dark-700">' + escapeHtml((r.memory || r.memory_value || '').substring(0, 400)) + '</p></div>').join('');
  } catch(e) { resultsDiv.innerHTML = '<p class="text-sm text-red-500">Search failed.</p>'; }
}

async function deleteMemory(memId) {
  if (!memId || !confirm('Delete this memory?')) return;
  try { await axios.delete(API + '/ai/memory/' + memId); loadMemory(); } catch(e) { alert('Delete failed'); }
}

// === AI WORKFLOW (ENHANCED) ===
async function loadAIWorkflow() {
  try {
    const [statsRes, logsRes, casesRes, agentsRes] = await Promise.all([
      axios.get(API + '/ai/stats'),
      axios.get(API + '/ai/logs'),
      axios.get(API + '/cases'),
      axios.get(API + '/ai/agents').catch(() => ({ data: { agents: [], version: '3.0.0', mem0_enabled: false, llm_enabled: false } }))
    ]);
    const s = statsRes.data;
    const logs = logsRes.data.logs;
    const cases = casesRes.data.cases;
    const agentInfo = agentsRes.data;
    
    const agents = agentInfo.agents && agentInfo.agents.length > 0 ? agentInfo.agents : [
      { id:'orchestrator', name:'Orchestrator', icon:'diagram-project', description:'Routes to specialist agents, manages Mem0 memory', color:'#6366f1', capabilities:['Intent classification','Multi-agent co-routing','Mem0 context injection'] },
      { id:'researcher', name:'Researcher', icon:'magnifying-glass', description:'Case law, statutes, citation verification, KS/MO/Federal RAG', color:'#8b5cf6', capabilities:['KS & MO Statutes RAG','Case law DB','Citation verification'] },
      { id:'drafter', name:'Drafter', icon:'file-pen', description:'Motions, demand letters, KS/MO-specific clauses, 7 templates', color:'#ec4899', capabilities:['7 templates','KS/MO rule compliance','Caption generation'] },
      { id:'analyst', name:'Analyst', icon:'chart-line', description:'Risk scoring (6-factor), SWOT, damages calc, evidence audit', color:'#10b981', capabilities:['6-factor risk model','SWOT','Damages modeling'] },
      { id:'strategist', name:'Strategist', icon:'chess', description:'Settlement modeling (3 options), timelines, budgets, ADR', color:'#f59e0b', capabilities:['Settlement modeling','Timeline gen','Budget projection'] }
    ];

    document.getElementById('pageContent').innerHTML = \`
      <div class="fade-in">
        <div class="flex items-center justify-between mb-6 mobile-header-stack">
          <div>
            <h2 class="text-2xl font-bold text-dark-900 flex items-center gap-2 mobile-title-sm"><i class="fas fa-diagram-project text-purple-500"></i> Multi-Agent Workflow</h2>
            <p class="text-dark-500 text-sm mt-1">Orchestrated pipeline: Main Agent \u2192 Researcher | Drafter | Analyst | Strategist \u2014 shared Mem0 memory</p>
          </div>
          <div class="flex items-center gap-2">
            <span class="badge bg-purple-100 text-purple-700">\${agentInfo.version || 'v3.0'}</span>
            \${agentInfo.mem0_enabled ? '<span class="badge bg-pink-100 text-pink-700">\u2601\uFE0F Mem0</span>' : '<span class="badge bg-dark-100 text-dark-500">\uD83D\uDCBE D1 Local</span>'}
            \${agentInfo.llm_enabled ? '<span class="badge" style="background:#fef2f2; color:#cc2229">\uD83E\uDDE0 LLM Active</span>' : '<span class="badge bg-amber-100 text-amber-700">\uD83D\uDCE6 Templates</span>'}
          </div>
        </div>

        <!-- Architecture Diagram -->
        <div class="card p-5 mb-6 border-purple-200 bg-gradient-to-r from-purple-50 to-indigo-50 workflow-arch-scroll">
          <div class="flex items-center gap-2 mb-4">
            <i class="fas fa-sitemap text-purple-600"></i>
            <h3 class="font-semibold text-dark-800">Agent Architecture v3.0</h3>
          </div>
          <div class="flex items-center justify-center gap-2 flex-wrap">
            <div class="bg-white rounded-xl px-4 py-2 border-2 border-purple-400 shadow-sm text-center">
              <div class="text-xs text-purple-600 font-bold">USER QUERY</div>
            </div>
            <i class="fas fa-arrow-right text-purple-400"></i>
            <div class="bg-white rounded-xl px-4 py-2 border-2 border-indigo-400 shadow-sm text-center">
              <div class="text-xs text-indigo-600 font-bold">ORCHESTRATOR</div>
              <div class="text-xs text-dark-400">Intent \u2192 Route \u2192 Merge</div>
            </div>
            <i class="fas fa-arrow-right text-purple-400"></i>
            <div class="flex gap-2">
              <div class="bg-white rounded-lg px-3 py-1.5 border border-purple-200 text-center">
                <div class="text-xs font-semibold" style="color:#8b5cf6">\uD83D\uDD0D Researcher</div>
              </div>
              <div class="bg-white rounded-lg px-3 py-1.5 border border-pink-200 text-center">
                <div class="text-xs font-semibold" style="color:#ec4899">\uD83D\uDCDD Drafter</div>
              </div>
              <div class="bg-white rounded-lg px-3 py-1.5 border text-center" style="border-color:#cc2229; background:#fef2f2">
                <div class="text-xs font-semibold" style="color:#10b981">\uD83E\uDDE0 Analyst</div>
              </div>
              <div class="bg-white rounded-lg px-3 py-1.5 border border-amber-200 text-center">
                <div class="text-xs font-semibold" style="color:#f59e0b">\uD83C\uDFAF Strategist</div>
              </div>
            </div>
            <i class="fas fa-arrow-right text-purple-400"></i>
            <div class="bg-white rounded-lg px-3 py-1.5 border border-pink-200 text-center">
              <div class="text-xs font-semibold text-pink-600">\uD83E\uDDE0 Mem0 Cloud</div>
              <div class="text-xs text-dark-400">\${s.mem0?.total || 0} memories</div>
            </div>
          </div>
        </div>

        <!-- Stats -->
        <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3 mb-6 workflow-stats-grid">
          <div class="card p-4 text-center border-purple-200 bg-purple-50">
            <p class="text-xs text-purple-600 font-semibold">Operations</p>
            <p class="text-2xl font-bold text-purple-700">\${s.total_operations}</p>
          </div>
          <div class="card p-4 text-center">
            <p class="text-xs text-dark-400 font-semibold">Tokens</p>
            <p class="text-2xl font-bold text-dark-800">\${Number(s.total_tokens || 0).toLocaleString()}</p>
          </div>
          <div class="card p-4 text-center">
            <p class="text-xs text-dark-400 font-semibold">Total Cost</p>
            <p class="text-2xl font-bold text-dark-800">$\${Number(s.total_cost || 0).toFixed(2)}</p>
          </div>
          <div class="card p-4 text-center">
            <p class="text-xs text-dark-400 font-semibold">Monthly</p>
            <p class="text-2xl font-bold text-dark-800">$\${Number(s.monthly_cost || 0).toFixed(2)}</p>
          </div>
          <div class="card p-4 text-center border-pink-200 bg-pink-50">
            <p class="text-xs text-pink-600 font-semibold">Mem0 Memories</p>
            <p class="text-2xl font-bold text-pink-700">\${s.mem0?.total || 0}</p>
          </div>
          <div class="card p-4 text-center" style="border-color:#cc2229; background:#fef2f2">
            <p class="text-xs font-semibold" style="color:#cc2229">D1 Memories</p>
            <p class="text-2xl font-bold" style="color:#9b1a20">\${s.memory_entries || 0}</p>
          </div>
          <div class="card p-4 text-center">
            <p class="text-xs text-dark-400 font-semibold">Sessions</p>
            <p class="text-2xl font-bold text-dark-800">\${s.active_sessions || 0}</p>
          </div>
        </div>

        <!-- Agent Cards -->
        <h3 class="font-semibold text-dark-800 mb-4">Specialist Agents</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
          \${agents.map(a => {
            const agentStats = (s.by_agent || []).find(b => b.agent_type === a.id);
            return \`
            <div class="card p-5 hover:shadow-lg cursor-pointer group" onclick="showRunAgentModal('\${a.id}')">
              <div class="flex items-center gap-3 mb-3">
                <div class="w-10 h-10 rounded-xl flex items-center justify-center text-white" style="background:\${a.color}">
                  <i class="fas fa-\${a.icon}"></i>
                </div>
                <div>
                  <h4 class="font-semibold text-dark-800 text-sm">\${a.name}</h4>
                  <p class="text-xs text-dark-400">\${agentStats ? agentStats.count + ' runs' : '0 runs'}\${agentStats ? ' \u2022 ' + Number(agentStats.tokens || 0).toLocaleString() + ' tok' : ''}</p>
                </div>
              </div>
              <p class="text-xs text-dark-500 mb-2">\${a.description || ''}</p>
              \${a.capabilities ? '<div class="flex flex-wrap gap-1 mb-2">' + a.capabilities.slice(0,3).map(c => '<span class="text-xs bg-dark-50 text-dark-500 px-1.5 py-0.5 rounded">' + c + '</span>').join('') + '</div>' : ''}
              <button class="mt-1 w-full btn btn-secondary text-xs group-hover:bg-purple-50 group-hover:text-purple-700 group-hover:border-purple-200">
                <i class="fas fa-play mr-1"></i> Run Agent
              </button>
            </div>\`;
          }).join('')}
        </div>

        <!-- Recent Activity -->
        <h3 class="font-semibold text-dark-800 mb-4">Recent Activity</h3>
        <div class="card overflow-hidden table-scroll">
          <table class="w-full">
            <thead class="bg-dark-50 border-b border-dark-200">
              <tr>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Agent</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Action</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Case</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Tokens</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Cost</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Status</th>
                <th class="text-left text-xs font-semibold text-dark-500 uppercase px-6 py-3">Time</th>
              </tr>
            </thead>
            <tbody>
              \${logs.map(l => {
                const acMap = { researcher: 'purple', drafter: 'pink', analyst: 'emerald', strategist: 'amber', orchestrator: 'indigo' };
                const ac = acMap[l.agent_type] || 'dark';
                return \`<tr class="table-row border-b border-dark-100">
                  <td class="px-6 py-3"><span class="badge bg-\${ac}-100 text-\${ac}-700">\${l.agent_type}</span></td>
                  <td class="px-6 py-3 text-sm">\${l.action}</td>
                  <td class="px-6 py-3 text-sm text-dark-500">\${l.case_number || '-'}</td>
                  <td class="px-6 py-3 text-sm">\${Number(l.tokens_used || 0).toLocaleString()}</td>
                  <td class="px-6 py-3 text-sm">$\${Number(l.cost || 0).toFixed(4)}</td>
                  <td class="px-6 py-3"><span class="badge bg-green-100 text-green-700">\${l.status}</span></td>
                  <td class="px-6 py-3 text-xs text-dark-400">\${formatDate(l.created_at)}</td>
                </tr>\`;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    \`;
  } catch(e) { showError('AI workflow'); }
}

async function runAIAgent(agentType, caseId) {
  try {
    const { data } = await axios.post(API + '/ai/run', { agent_type: agentType, action: 'auto_process', case_id: caseId, user_id: 1 });
    alert('AI Agent ' + agentType + ' completed!\\nTokens: ' + data.tokens_used + '\\nStatus: ' + data.status);
    if (caseId) viewCase(caseId); else loadAIWorkflow();
  } catch(e) { alert('AI Agent error: ' + e.message); }
}

function showRunAgentModal(agentType) {
  document.getElementById('modalContainer').innerHTML = \`
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal p-6" onclick="event.stopPropagation()">
        <h3 class="text-lg font-bold mb-4"><i class="fas fa-robot text-purple-500 mr-2"></i>Run \${agentType.charAt(0).toUpperCase() + agentType.slice(1)} Agent</h3>
        <div class="space-y-4">
          <div><label class="text-sm font-medium text-dark-700 block mb-1">Select Case (optional)</label>
            <select id="agentCaseId" class="w-full"><option value="">No case selected</option></select>
          </div>
          <div><label class="text-sm font-medium text-dark-700 block mb-1">Action</label>
            <input id="agentAction" value="auto_process" class="w-full"></div>
          <div class="flex gap-2 justify-end">
            <button onclick="closeModal()" class="btn btn-secondary">Cancel</button>
            <button onclick="executeAgent('\${agentType}')" class="btn bg-purple-600 text-white hover:bg-purple-700"><i class="fas fa-play mr-2"></i>Run</button>
          </div>
        </div>
      </div>
    </div>
  \`;
  axios.get(API + '/cases').then(({ data }) => {
    const sel = document.getElementById('agentCaseId');
    data.cases.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.text = c.case_number + ' - ' + c.title; sel.add(o); });
  });
}

async function executeAgent(agentType) {
  const caseId = document.getElementById('agentCaseId').value || null;
  const action = document.getElementById('agentAction').value;
  closeModal();
  await runAIAgent(agentType, caseId);
}

// === CLIENT INTAKE ===
async function loadIntake() {
  try {
    const [casesRes, clientsRes] = await Promise.all([
      axios.get(API + '/cases'),
      axios.get(API + '/clients')
    ]);
    const cases = casesRes.data.cases || [];
    const clients = clientsRes.data.clients || [];

    document.getElementById('pageContent').innerHTML = \`
    <div class="fade-in">
      <div class="flex items-center justify-between mb-6 mobile-header-stack">
        <div>
          <h2 class="text-2xl font-bold text-dark-900 mobile-title-sm"><i class="fas fa-clipboard-list text-brand-500 mr-2"></i>AI Client Intake</h2>
          <p class="text-dark-500 text-sm mt-1">Orchestrator \u2192 Intake Agent \u2192 Conflict Check \u2192 Case Assessment \u2192 Auto-Routing</p>
        </div>
        <div class="flex items-center gap-2">
          <span class="badge bg-purple-100 text-purple-700"><i class="fas fa-robot mr-1"></i>AI Intake Pipeline</span>
          <span class="badge" style="background:#fef2f2; color:#cc2229">\${clients.length} clients</span>
        </div>
      </div>

      <!-- Intake Pipeline Diagram -->
      <div class="card p-4 mb-6 bg-gradient-to-r from-blue-50 to-purple-50 border-purple-200 intake-pipeline-scroll">
        <div class="flex items-center justify-center gap-2 flex-wrap text-xs">
          <span class="bg-white rounded-lg px-3 py-1.5 border border-blue-200 font-semibold text-blue-700"><i class="fas fa-clipboard-list mr-1"></i>Form Submission</span>
          <i class="fas fa-arrow-right text-purple-400"></i>
          <span class="bg-white rounded-lg px-3 py-1.5 border border-purple-200 font-semibold text-purple-700"><i class="fas fa-search mr-1"></i>Conflict Check</span>
          <i class="fas fa-arrow-right text-purple-400"></i>
          <span class="bg-white rounded-lg px-3 py-1.5 border font-semibold" style="background:#fef2f2; border-color:#cc2229; color:#cc2229"><i class="fas fa-robot mr-1"></i>AI Assessment</span>
          <i class="fas fa-arrow-right text-purple-400"></i>
          <span class="bg-white rounded-lg px-3 py-1.5 border border-amber-200 font-semibold text-amber-700"><i class="fas fa-route mr-1"></i>Auto-Route</span>
          <i class="fas fa-arrow-right text-purple-400"></i>
          <span class="bg-white rounded-lg px-3 py-1.5 border font-semibold" style="background:#fef2f2; border-color:#cc2229; color:#cc2229"><i class="fas fa-check-circle mr-1"></i>Case Created</span>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Intake Form -->
        <div class="card p-6">
          <h3 class="font-semibold text-dark-800 mb-4"><i class="fas fa-user-plus text-brand-500 mr-2"></i>New Client Intake Form</h3>
          <div class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
              <div><label class="text-sm font-medium text-dark-700 block mb-1">First Name *</label><input id="intakeFirstName" placeholder="First name"></div>
              <div><label class="text-sm font-medium text-dark-700 block mb-1">Last Name *</label><input id="intakeLastName" placeholder="Last name"></div>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div><label class="text-sm font-medium text-dark-700 block mb-1">Email</label><input id="intakeEmail" type="email" placeholder="email@example.com"></div>
              <div><label class="text-sm font-medium text-dark-700 block mb-1">Phone</label><input id="intakePhone" placeholder="(555) 555-0000"></div>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div><label class="text-sm font-medium text-dark-700 block mb-1">Case Type *</label>
                <select id="intakeCaseType">
                  <option value="personal_injury">Personal Injury</option>
                  <option value="family">Family Law</option>
                  <option value="criminal">Criminal Defense</option>
                  <option value="corporate">Corporate</option>
                  <option value="immigration">Immigration</option>
                  <option value="employment">Employment</option>
                  <option value="real_estate">Real Estate</option>
                  <option value="ip">Intellectual Property</option>
                  <option value="bankruptcy">Bankruptcy</option>
                </select>
              </div>
              <div><label class="text-sm font-medium text-dark-700 block mb-1">Urgency</label>
                <select id="intakeUrgency">
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            <div><label class="text-sm font-medium text-dark-700 block mb-1">Opposing Party (if known)</label>
              <input id="intakeOpposing" placeholder="Name of opposing party"></div>
            <div><label class="text-sm font-medium text-dark-700 block mb-1">Case Description *</label>
              <textarea id="intakeDescription" rows="4" placeholder="Describe the legal matter in detail..."></textarea></div>
            <div><label class="text-sm font-medium text-dark-700 block mb-1">How did you hear about us?</label>
              <select id="intakeReferral"><option value="">Select...</option><option value="referral">Attorney Referral</option><option value="web">Website</option><option value="social">Social Media</option><option value="existing">Existing Client</option><option value="other">Other</option></select></div>
            <div class="flex gap-2">
              <button onclick="submitIntake()" class="btn btn-primary flex-1"><i class="fas fa-paper-plane mr-2"></i>Submit & Run AI Intake Pipeline</button>
            </div>
          </div>
        </div>

        <!-- AI Processing Results -->
        <div class="card p-6">
          <h3 class="font-semibold text-dark-800 mb-4"><i class="fas fa-robot text-purple-500 mr-2"></i>AI Intake Processing</h3>
          <div id="intakeResults" class="space-y-3">
            <div class="text-center py-8 text-dark-400">
              <i class="fas fa-inbox text-4xl mb-3"></i>
              <p class="mb-2">Submit the intake form to see AI processing results</p>
              <p class="text-xs">The AI pipeline will: check conflicts, assess the case, recommend attorney assignment, and flag risks</p>
            </div>
          </div>
        </div>
      </div>
    </div>
    \`;
  } catch(e) { showError('Client Intake'); }
}

async function submitIntake() {
  const firstName = document.getElementById('intakeFirstName').value;
  const lastName = document.getElementById('intakeLastName').value;
  const desc = document.getElementById('intakeDescription').value;
  if (!firstName || !lastName) { alert('First and last name are required'); return; }
  if (!desc) { alert('Case description is required'); return; }

  const resultsEl = document.getElementById('intakeResults');
  resultsEl.innerHTML = \`
    <div class="space-y-3">
      <div class="flex items-center gap-3 p-3 bg-blue-50 rounded-lg border border-blue-200">
        <i class="fas fa-spinner fa-spin text-blue-500"></i>
        <div><p class="text-sm font-medium text-blue-700">Step 1/4: Creating client record...</p></div>
      </div>
    </div>\`;

  try {
    // Step 1: Create client
    const clientRes = await axios.post(API + '/clients', {
      first_name: firstName, last_name: lastName,
      email: document.getElementById('intakeEmail').value,
      phone: document.getElementById('intakePhone').value
    });
    const clientId = clientRes.data.id;

    resultsEl.innerHTML += \`<div class="flex items-center gap-3 p-3 bg-purple-50 rounded-lg border border-purple-200">
      <i class="fas fa-spinner fa-spin text-purple-500"></i>
      <div><p class="text-sm font-medium text-purple-700">Step 2/4: Running conflict check...</p></div>
    </div>\`;

    // Step 2: Conflict check
    const opposingParty = document.getElementById('intakeOpposing')?.value || '';
    let conflictFound = false;
    let conflictDetails = 'No conflicts detected';
    try {
      const casesCheck = await axios.get(API + '/cases');
      const clientsCheck = await axios.get(API + '/clients');
      const fullName = firstName + ' ' + lastName;
      const nameCheck = [...(casesCheck.data.cases || [])].filter(c => 
        (c.opposing_party && c.opposing_party.toLowerCase().includes(fullName.toLowerCase())) ||
        (c.opposing_counsel && c.opposing_counsel.toLowerCase().includes(fullName.toLowerCase()))
      );
      if (nameCheck.length > 0) { conflictFound = true; conflictDetails = 'Potential conflict: ' + fullName + ' appears as opposing party in ' + nameCheck.map(c=>c.case_number).join(', '); }
      if (opposingParty) {
        const opCheck = [...(clientsCheck.data.clients || [])].filter(c => (c.first_name + ' ' + c.last_name).toLowerCase().includes(opposingParty.toLowerCase()));
        if (opCheck.length > 0) { conflictFound = true; conflictDetails += (conflictFound ? '; ' : '') + 'Opposing party "' + opposingParty + '" is an existing client'; }
      }
    } catch(e) {}

    resultsEl.innerHTML += \`<div class="flex items-center gap-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
      <i class="fas fa-spinner fa-spin text-amber-500"></i>
      <div><p class="text-sm font-medium text-amber-700">Step 3/4: Creating case & running AI assessment...</p></div>
    </div>\`;

    // Step 3: Create case
    const caseType = document.getElementById('intakeCaseType').value;
    const urgency = document.getElementById('intakeUrgency')?.value || 'medium';
    const caseRes = await axios.post(API + '/cases', {
      title: firstName + ' ' + lastName + ' - ' + formatType(caseType),
      description: desc, case_type: caseType, priority: urgency,
      client_id: clientId, lead_attorney_id: 1,
      opposing_party: opposingParty || null
    });

    // Step 4: Run AI Intake Agent
    resultsEl.innerHTML += \`<div class="flex items-center gap-3 p-3 rounded-lg border" style="background:#fef2f2; border-color:#f8c4c4">
      <i class="fas fa-spinner fa-spin" style="color:#cc2229"></i>
      <div><p class="text-sm font-medium" style="color:#9b1a20">Step 4/4: AI agent analyzing case...</p></div>
    </div>\`;

    const aiRes = await axios.post(API + '/ai/run', {
      agent_type: 'intake', action: 'process_new_case',
      case_id: caseRes.data.id, user_id: 1,
      input_data: { client: firstName + ' ' + lastName, type: caseType, description: desc, urgency, opposing_party: opposingParty }
    });

    // Show results
    resultsEl.innerHTML = \`
      <div class="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
        <h4 class="font-semibold text-green-800"><i class="fas fa-check-circle mr-2"></i>Intake Pipeline Complete!</h4>
        <p class="text-sm text-green-600 mt-1">Client registered, case created, AI assessment generated</p>
      </div>

      <div class="space-y-3">
        <div class="p-3 bg-dark-50 rounded-lg flex items-center justify-between">
          <div><span class="text-xs text-dark-400">Client</span><p class="font-medium">#\${clientId} \u2014 \${firstName} \${lastName}</p></div>
          <span class="badge bg-blue-100 text-blue-700">New</span>
        </div>
        <div class="p-3 bg-dark-50 rounded-lg flex items-center justify-between">
          <div><span class="text-xs text-dark-400">Case</span><p class="font-medium">\${caseRes.data.case_number} \u2014 \${formatType(caseType)}</p></div>
          <span class="badge \${getPriorityColor(urgency)}">\${urgency}</span>
        </div>

        <div class="p-3 \${conflictFound ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'} rounded-lg">
          <div class="flex items-center gap-2 mb-1">
            <i class="fas fa-\${conflictFound ? 'exclamation-triangle text-red-500' : 'check-circle text-green-500'}"></i>
            <span class="text-sm font-medium \${conflictFound ? 'text-red-700' : 'text-green-700'}">Conflict Check: \${conflictFound ? 'POTENTIAL CONFLICT' : 'CLEAR'}</span>
          </div>
          <p class="text-xs \${conflictFound ? 'text-red-600' : 'text-green-600'}">\${conflictDetails}</p>
        </div>

        <div class="p-3 bg-purple-50 rounded-lg border border-purple-200">
          <div class="flex items-center gap-2 mb-2">
            <i class="fas fa-robot text-purple-500"></i>
            <span class="text-sm font-medium text-purple-700">AI Assessment (\${aiRes.data.agent_type} agent)</span>
            <span class="badge bg-purple-100 text-purple-700 text-xs">\${aiRes.data.tokens_used} tokens</span>
          </div>
          <div class="text-sm text-dark-700 prose-sm">\${renderMarkdown(aiRes.data.output?.content_preview || JSON.stringify(aiRes.data.output, null, 2))}</div>
        </div>
      </div>

      <button onclick="viewCase(\${caseRes.data.id})" class="btn btn-primary w-full mt-4"><i class="fas fa-arrow-right mr-2"></i>View Case</button>
    \`;
  } catch(e) {
    resultsEl.innerHTML = '<div class="bg-red-50 p-4 rounded-lg border border-red-200"><p class="text-red-600"><i class="fas fa-exclamation-circle mr-2"></i>Error: ' + (e.response?.data?.error || e.message) + '</p></div>';
  }
}

// === MODALS ===
function showNewCaseModal() {
  // Pre-fetch clients and attorneys for FK dropdown
  Promise.all([axios.get(API + '/clients'), axios.get(API + '/users')]).then(([cRes, uRes]) => {
    const clientOpts = (cRes.data.clients || []).map(cl => '<option value="'+cl.id+'">'+escapeHtml(cl.first_name+' '+cl.last_name)+'</option>').join('');
    const attyOpts = (uRes.data.users || []).map(u => '<option value="'+u.id+'" '+(u.id===1?'selected':'')+'>'+escapeHtml(u.full_name)+'</option>').join('');
    const cSel = document.getElementById('ncClientId');
    const aSel = document.getElementById('ncAttorneyId');
    if (cSel) cSel.innerHTML = '<option value="">Select client *</option>' + clientOpts;
    if (aSel) aSel.innerHTML = attyOpts;
  }).catch(() => {});

  document.getElementById('modalContainer').innerHTML = \`
    <div class="modal-overlay" onclick="closeModal(event)" role="dialog" aria-modal="true" aria-labelledby="ncModalTitle">
      <div class="modal p-6" onclick="event.stopPropagation()">
        <h3 class="text-lg font-bold mb-4" id="ncModalTitle">New Case</h3>
        <div class="space-y-4">
          <div><label class="text-sm font-medium text-dark-700 block mb-1" for="ncTitle">Title *</label><input id="ncTitle" placeholder="Case title" aria-required="true"></div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="text-sm font-medium text-dark-700 block mb-1" for="ncType">Type *</label>
              <select id="ncType" aria-required="true"><option value="personal_injury">Personal Injury</option><option value="family">Family</option><option value="corporate">Corporate</option><option value="employment">Employment</option><option value="criminal">Criminal Defense</option><option value="immigration">Immigration</option><option value="real_estate">Real Estate</option><option value="ip">Intellectual Property</option><option value="medical_malpractice">Medical Malpractice</option><option value="wrongful_death">Wrongful Death</option><option value="workers_compensation">Workers Comp</option></select></div>
            <div><label class="text-sm font-medium text-dark-700 block mb-1" for="ncPriority">Priority</label>
              <select id="ncPriority"><option value="medium">Medium</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="text-sm font-medium text-dark-700 block mb-1" for="ncClientId">Client *</label>
              <select id="ncClientId" aria-required="true"><option value="">Loading clients...</option></select></div>
            <div><label class="text-sm font-medium text-dark-700 block mb-1" for="ncAttorneyId">Lead Attorney *</label>
              <select id="ncAttorneyId" aria-required="true"><option value="1">Brad</option></select></div>
          </div>
          <div><label class="text-sm font-medium text-dark-700 block mb-1" for="ncDesc">Description</label><textarea id="ncDesc" rows="3" placeholder="Case description..."></textarea></div>
          <div id="ncError" class="text-sm text-red-600 hidden"></div>
          <div class="flex gap-2 justify-end">
            <button onclick="closeModal()" class="btn btn-secondary">Cancel</button>
            <button onclick="createCase()" class="btn btn-primary" id="ncSubmitBtn">Create Case</button>
          </div>
        </div>
      </div>
    </div>
  \`;
}

async function createCase() {
  const title = document.getElementById('ncTitle').value.trim();
  const clientId = document.getElementById('ncClientId').value;
  const attorneyId = document.getElementById('ncAttorneyId').value;
  const errEl = document.getElementById('ncError');
  if (!title) { errEl.textContent = 'Title is required'; errEl.classList.remove('hidden'); return; }
  if (!clientId) { errEl.textContent = 'Client is required. Add a client first.'; errEl.classList.remove('hidden'); return; }
  const btn = document.getElementById('ncSubmitBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Creating...';
  try {
    await axios.post(API + '/cases', {
      title,
      case_type: document.getElementById('ncType').value,
      priority: document.getElementById('ncPriority').value,
      description: document.getElementById('ncDesc').value,
      client_id: Number(clientId),
      lead_attorney_id: Number(attorneyId) || 1
    });
    toast('Case Created', title, 'success');
    closeModal(); loadCases();
  } catch(e) {
    const msg = e.response?.data?.errors?.join(', ') || e.response?.data?.error || 'Error creating case';
    errEl.textContent = msg; errEl.classList.remove('hidden');
    btn.disabled = false; btn.innerHTML = 'Create Case';
  }
}

function showNewClientModal() {
  document.getElementById('modalContainer').innerHTML = \`
    <div class="modal-overlay" onclick="closeModal(event)" role="dialog" aria-modal="true" aria-labelledby="nclModalTitle">
      <div class="modal p-6" onclick="event.stopPropagation()">
        <h3 class="text-lg font-bold mb-4" id="nclModalTitle">New Client</h3>
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div><label class="text-sm font-medium block mb-1">First Name *</label><input id="nclFirst" placeholder="First name"></div>
            <div><label class="text-sm font-medium block mb-1">Last Name *</label><input id="nclLast" placeholder="Last name"></div>
          </div>
          <div><label class="text-sm font-medium block mb-1">Email</label><input id="nclEmail" type="email" placeholder="email@example.com"></div>
          <div><label class="text-sm font-medium block mb-1">Phone</label><input id="nclPhone" placeholder="(555) 555-0000"></div>
          <div><label class="text-sm font-medium block mb-1">Type</label><select id="nclType"><option value="individual">Individual</option><option value="business">Business</option></select></div>
          <div class="flex gap-2 justify-end">
            <button onclick="closeModal()" class="btn btn-secondary">Cancel</button>
            <button onclick="createClient()" class="btn btn-primary">Add Client</button>
          </div>
        </div>
      </div>
    </div>
  \`;
}

async function createClient() {
  try {
    const res = await axios.post(API + '/clients', {
      first_name: document.getElementById('nclFirst').value,
      last_name: document.getElementById('nclLast').value,
      email: document.getElementById('nclEmail').value,
      phone: document.getElementById('nclPhone').value,
      client_type: document.getElementById('nclType').value
    });
    toast('Client Added', document.getElementById('nclFirst').value + ' ' + document.getElementById('nclLast').value, 'success');
    closeModal(); loadClients();
  } catch(e) {
    const msg = e.response?.data?.errors?.join(', ') || e.response?.data?.error || 'Error creating client';
    toast('Error', msg, 'error');
  }
}

function showNewEventModal() {
  document.getElementById('modalContainer').innerHTML = \`
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal p-6" onclick="event.stopPropagation()">
        <h3 class="text-lg font-bold mb-4">New Event</h3>
        <div class="space-y-4">
          <div><label class="text-sm font-medium block mb-1">Title *</label><input id="neTitle" placeholder="Event title"></div>
          <div><label class="text-sm font-medium block mb-1">Type</label><select id="neType"><option value="meeting">Meeting</option><option value="hearing">Hearing</option><option value="deposition">Deposition</option><option value="deadline">Deadline</option><option value="consultation">Consultation</option><option value="internal">Internal</option></select></div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="text-sm font-medium block mb-1">Start *</label><input id="neStart" type="datetime-local"></div>
            <div><label class="text-sm font-medium block mb-1">End *</label><input id="neEnd" type="datetime-local"></div>
          </div>
          <div><label class="text-sm font-medium block mb-1">Location</label><input id="neLocation" placeholder="Location"></div>
          <div class="flex gap-2 justify-end">
            <button onclick="closeModal()" class="btn btn-secondary">Cancel</button>
            <button onclick="createEvent()" class="btn btn-primary">Create</button>
          </div>
        </div>
      </div>
    </div>
  \`;
}

async function createEvent() {
  try {
    await axios.post(API + '/calendar', {
      title: document.getElementById('neTitle').value,
      event_type: document.getElementById('neType').value,
      start_datetime: document.getElementById('neStart').value,
      end_datetime: document.getElementById('neEnd').value,
      location: document.getElementById('neLocation').value,
      organizer_id: 1
    });
    toast('Event Created', document.getElementById('neTitle').value, 'success');
    closeModal(); loadCalendar();
  } catch(e) {
    const msg = e.response?.data?.errors?.join(', ') || e.response?.data?.error || 'Error creating event';
    toast('Error', msg, 'error');
  }
}

function showNewTaskModal() {
  document.getElementById('modalContainer').innerHTML = \`
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal p-6" onclick="event.stopPropagation()">
        <h3 class="text-lg font-bold mb-4">New Task</h3>
        <div class="space-y-4">
          <div><label class="text-sm font-medium block mb-1">Title *</label><input id="ntTitle" placeholder="Task title"></div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="text-sm font-medium block mb-1">Priority</label><select id="ntPriority"><option value="medium">Medium</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
            <div><label class="text-sm font-medium block mb-1">Type</label><select id="ntType"><option value="task">Task</option><option value="deadline">Deadline</option><option value="filing">Filing</option><option value="hearing">Hearing</option><option value="review">Review</option><option value="follow_up">Follow Up</option></select></div>
          </div>
          <div><label class="text-sm font-medium block mb-1">Due Date</label><input id="ntDue" type="date"></div>
          <div><label class="text-sm font-medium block mb-1">Description</label><textarea id="ntDesc" rows="2" placeholder="Task description..."></textarea></div>
          <div class="flex gap-2 justify-end">
            <button onclick="closeModal()" class="btn btn-secondary">Cancel</button>
            <button onclick="createTask()" class="btn btn-primary">Create</button>
          </div>
        </div>
      </div>
    </div>
  \`;
}

async function createTask() {
  try {
    await axios.post(API + '/tasks', {
      title: document.getElementById('ntTitle').value,
      priority: document.getElementById('ntPriority').value,
      task_type: document.getElementById('ntType').value,
      due_date: document.getElementById('ntDue').value,
      description: document.getElementById('ntDesc').value,
      assigned_to: 1
    });
    toast('Task Created', document.getElementById('ntTitle').value, 'success');
    closeModal(); loadTasks();
  } catch(e) {
    const msg = e.response?.data?.errors?.join(', ') || e.response?.data?.error || 'Error creating task';
    toast('Error', msg, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════
// DOCUMENT UPLOAD MODAL — Drag & Drop + File Picker + AI Analysis
// ═══════════════════════════════════════════════════════════════
var pendingUploadFile = null;
var pendingUploadText = '';

function showNewDocModal() {
  pendingUploadFile = null;
  pendingUploadText = '';
  // Pre-fetch cases for association dropdown
  axios.get(API + '/cases').then(({ data }) => {
    const caseOpts = (data.cases || []).map(c => '<option value="'+c.id+'">'+c.case_number+' — '+c.title.substring(0,35)+'</option>').join('');
    document.getElementById('uploadCaseSelect').innerHTML = '<option value="">No case</option>' + caseOpts;
  }).catch(() => {});

  document.getElementById('modalContainer').innerHTML = \`
    <div class="modal-overlay" onclick="closeModal(event)" style="z-index:60">
      <div class="modal p-0" onclick="event.stopPropagation()" style="max-width:680px; max-height:90vh; overflow-y:auto">
        <!-- Header -->
        <div class="px-6 py-4 border-b border-dark-200 flex items-center justify-between sticky top-0 bg-white z-10" style="border-radius:var(--radius) var(--radius) 0 0">
          <div>
            <h3 class="text-lg font-bold text-dark-900 flex items-center gap-2"><i class="fas fa-cloud-upload-alt text-brand-500"></i> Upload & Analyze Document</h3>
            <p class="text-xs text-dark-400 mt-0.5">Upload a file for deep AI-powered analysis — entities, dates, citations, risks, obligations</p>
          </div>
          <button onclick="closeModal()" class="text-dark-400 hover:text-dark-600"><i class="fas fa-times text-lg"></i></button>
        </div>

        <div class="p-6 space-y-5">
          <!-- Drop Zone -->
          <div id="uploadDropZone"
               ondragover="event.preventDefault();this.classList.add('border-brand-500','bg-brand-50')"
               ondragleave="this.classList.remove('border-brand-500','bg-brand-50')"
               ondrop="handleFileDrop(event)"
               onclick="document.getElementById('uploadFileInput').click()"
               class="border-2 border-dashed border-dark-200 rounded-xl p-8 text-center cursor-pointer hover:border-brand-400 hover:bg-brand-50/50 transition-all">
            <input type="file" id="uploadFileInput" class="hidden"
                   accept=".pdf,.doc,.docx,.txt,.rtf,.md,.csv,.json,.html,.xml,.xls,.xlsx"
                   onchange="handleFileSelect(this)">
            <div id="uploadDropContent">
              <div class="w-14 h-14 bg-brand-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <i class="fas fa-file-arrow-up text-brand-500 text-2xl"></i>
              </div>
              <p class="text-dark-700 font-medium">Drag & drop files here or click to browse</p>
              <p class="text-xs text-dark-400 mt-1">Supports PDF, DOC/DOCX, TXT, RTF, CSV, JSON, HTML, XML (max 10 MB)</p>
            </div>
            <div id="uploadFilePreview" class="hidden">
              <div class="flex items-center justify-center gap-3">
                <div class="w-12 h-12 rounded-xl flex items-center justify-center" id="uploadFileIconWrap">
                  <i id="uploadFileIcon" class="fas fa-file text-2xl"></i>
                </div>
                <div class="text-left">
                  <p class="font-semibold text-dark-800" id="uploadFileName">-</p>
                  <p class="text-xs text-dark-400" id="uploadFileMeta">-</p>
                </div>
                <button onclick="event.stopPropagation();clearUploadFile()" class="ml-3 text-dark-400 hover:text-red-500"><i class="fas fa-times-circle text-lg"></i></button>
              </div>
            </div>
          </div>

          <!-- Extraction progress -->
          <div id="uploadExtractProgress" class="hidden">
            <div class="flex items-center gap-2 p-3 bg-blue-50 rounded-lg border border-blue-200">
              <i class="fas fa-spinner fa-spin text-blue-500"></i>
              <span class="text-sm text-blue-700" id="uploadExtractText">Extracting text from file...</span>
            </div>
          </div>

          <!-- Text preview -->
          <div id="uploadTextPreviewWrap" class="hidden">
            <label class="text-sm font-medium text-dark-700 block mb-1">Extracted Text <span class="text-dark-400 font-normal" id="uploadWordCount"></span></label>
            <textarea id="uploadTextPreview" rows="5" readonly class="w-full text-xs font-mono bg-dark-50 text-dark-600" style="max-height:160px; overflow-y:auto"></textarea>
          </div>

          <!-- OR paste text directly -->
          <details class="group">
            <summary class="text-sm font-medium text-dark-500 cursor-pointer flex items-center gap-1 hover:text-dark-700">
              <i class="fas fa-chevron-right text-xs transition-transform group-open:rotate-90"></i> Or paste document text directly
            </summary>
            <textarea id="uploadPasteText" rows="4" placeholder="Paste your document text here..." class="w-full mt-2 text-sm" oninput="handlePasteText(this)"></textarea>
          </details>

          <!-- Metadata Fields -->
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="text-sm font-medium text-dark-700 block mb-1">Document Title *</label>
              <input id="uploadTitle" placeholder="e.g. Motion to Dismiss, Lease Agreement..." class="w-full">
            </div>
            <div>
              <label class="text-sm font-medium text-dark-700 block mb-1">Category</label>
              <select id="uploadCategory" class="w-full">
                <option value="general">General</option>
                <option value="pleading">Pleading / Motion</option>
                <option value="contract">Contract / Agreement</option>
                <option value="correspondence">Correspondence / Letter</option>
                <option value="discovery">Discovery</option>
                <option value="court_order">Court Order</option>
                <option value="evidence">Evidence</option>
                <option value="memo">Memorandum</option>
                <option value="billing">Billing</option>
                <option value="intake">Intake / Client Info</option>
              </select>
            </div>
          </div>
          <div>
            <label class="text-sm font-medium text-dark-700 block mb-1">Associate with Case</label>
            <select id="uploadCaseSelect" class="w-full">
              <option value="">No case (stand-alone document)</option>
            </select>
          </div>

          <!-- Analysis preview badges -->
          <div id="uploadAnalysisHint" class="hidden p-3 rounded-lg border" style="background:#fef2f2; border-color:#f8c4c4">
            <div class="flex items-center gap-2 mb-1">
              <i class="fas fa-brain" style="color:#cc2229"></i>
              <span class="text-sm font-semibold" style="color:#9b1a20">AI Analysis will include:</span>
            </div>
            <div class="flex flex-wrap gap-1.5 mt-1.5">
              <span class="badge bg-purple-100 text-purple-700"><i class="fas fa-users mr-1"></i>Parties & Entities</span>
              <span class="badge bg-blue-100 text-blue-700"><i class="fas fa-calendar mr-1"></i>Key Dates & Deadlines</span>
              <span class="badge bg-green-100 text-green-700"><i class="fas fa-dollar-sign mr-1"></i>Monetary Values</span>
              <span class="badge bg-amber-100 text-amber-700"><i class="fas fa-book mr-1"></i>Legal Citations</span>
              <span class="badge bg-red-100 text-red-700"><i class="fas fa-shield-alt mr-1"></i>Risk Flags</span>
              <span class="badge bg-indigo-100 text-indigo-700"><i class="fas fa-file-contract mr-1"></i>Clauses & Obligations</span>
              <span class="badge bg-dark-100 text-dark-600"><i class="fas fa-map-marker-alt mr-1"></i>Jurisdiction Detection</span>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="px-6 py-4 border-t border-dark-200 flex items-center justify-between sticky bottom-0 bg-white" style="border-radius:0 0 var(--radius) var(--radius)">
          <div id="uploadStatus" class="text-xs text-dark-400"></div>
          <div class="flex gap-2">
            <button onclick="closeModal()" class="btn btn-secondary">Cancel</button>
            <button onclick="submitDocUpload()" id="uploadSubmitBtn" class="btn btn-primary" disabled>
              <i class="fas fa-cloud-upload-alt mr-2"></i>Upload & Analyze
            </button>
          </div>
        </div>
      </div>
    </div>
  \`;
}

function handleFileDrop(e) {
  e.preventDefault();
  const zone = document.getElementById('uploadDropZone');
  zone.classList.remove('border-brand-500','bg-brand-50');
  const file = e.dataTransfer?.files?.[0];
  if (file) processUploadFile(file);
}

function handleFileSelect(input) {
  const file = input.files?.[0];
  if (file) processUploadFile(file);
}

function clearUploadFile() {
  pendingUploadFile = null;
  pendingUploadText = '';
  document.getElementById('uploadDropContent').classList.remove('hidden');
  document.getElementById('uploadFilePreview').classList.add('hidden');
  document.getElementById('uploadTextPreviewWrap').classList.add('hidden');
  document.getElementById('uploadAnalysisHint').classList.add('hidden');
  document.getElementById('uploadSubmitBtn').disabled = true;
  document.getElementById('uploadFileInput').value = '';
}

function processUploadFile(file) {
  if (file.size > 10 * 1024 * 1024) { toast('File too large', 'Max file size is 10 MB', 'error'); return; }
  pendingUploadFile = file;

  // Update UI
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const iconMap = { pdf:'fa-file-pdf text-red-500', doc:'fa-file-word text-blue-500', docx:'fa-file-word text-blue-500', txt:'fa-file-lines text-dark-500', csv:'fa-file-csv text-green-500', json:'fa-file-code text-amber-500', html:'fa-file-code text-orange-500', xml:'fa-file-code text-purple-500' };
  const bgMap = { pdf:'bg-red-50', doc:'bg-blue-50', docx:'bg-blue-50', txt:'bg-dark-50', csv:'bg-green-50', json:'bg-amber-50', html:'bg-orange-50' };

  document.getElementById('uploadFileIcon').className = 'fas ' + (iconMap[ext] || 'fa-file text-dark-400') + ' text-2xl';
  document.getElementById('uploadFileIconWrap').className = 'w-12 h-12 rounded-xl flex items-center justify-center ' + (bgMap[ext] || 'bg-dark-50');
  document.getElementById('uploadFileName').textContent = file.name;
  document.getElementById('uploadFileMeta').textContent = formatFileSize(file.size) + ' • ' + file.type;
  document.getElementById('uploadDropContent').classList.add('hidden');
  document.getElementById('uploadFilePreview').classList.remove('hidden');

  // Auto-fill title from filename
  const titleInput = document.getElementById('uploadTitle');
  if (!titleInput.value) {
    titleInput.value = file.name.replace(/\\.[^.]+$/, '').replace(/[-_]/g, ' ').replace(/\\b\\w/g, l => l.toUpperCase());
  }

  // Extract text from file
  extractTextFromFile(file);
}

async function extractTextFromFile(file) {
  const prog = document.getElementById('uploadExtractProgress');
  const progText = document.getElementById('uploadExtractText');
  prog.classList.remove('hidden');
  progText.textContent = 'Reading file...';

  try {
    let text = '';
    const ext = file.name.split('.').pop()?.toLowerCase() || '';

    if (['txt','md','rtf','csv','html','xml','json'].includes(ext)) {
      text = await file.text();
      progText.textContent = 'Text extracted successfully';
    } else if (ext === 'pdf') {
      // For PDFs we read as text (basic extraction)
      try {
        text = await file.text();
        // If it's binary PDF, we'll get garbled text — strip non-printable
        text = text.replace(/[^\\x20-\\x7E\\n\\r\\t]/g, ' ').replace(/\\s{3,}/g, '\\n').trim();
        if (text.length < 100) {
          text = '[PDF content — text extraction limited in browser. For full analysis, paste the document text below or use a PDF-to-text tool.]';
          progText.textContent = 'PDF detected — paste text for better results';
        } else {
          progText.textContent = 'PDF text extracted (basic extraction)';
        }
      } catch(e) {
        text = '[PDF could not be read. Please paste the document text manually.]';
        progText.textContent = 'Paste text manually for PDF files';
      }
    } else {
      text = await file.text();
      progText.textContent = 'File read as text';
    }

    pendingUploadText = text;
    // Show preview
    const previewWrap = document.getElementById('uploadTextPreviewWrap');
    const preview = document.getElementById('uploadTextPreview');
    const wordCount = document.getElementById('uploadWordCount');
    previewWrap.classList.remove('hidden');
    preview.value = text.substring(0, 5000) + (text.length > 5000 ? '\\n\\n... [truncated preview — full text will be analyzed]' : '');
    const wc = text.split(/\\s+/).filter(Boolean).length;
    wordCount.textContent = '(' + wc.toLocaleString() + ' words, ~' + Math.max(1, Math.ceil(wc / 300)) + ' pages)';

    // Show analysis hint & enable submit
    document.getElementById('uploadAnalysisHint').classList.remove('hidden');
    document.getElementById('uploadSubmitBtn').disabled = false;

    setTimeout(() => prog.classList.add('hidden'), 2000);
  } catch(e) {
    progText.textContent = 'Error reading file — try pasting text instead';
    prog.querySelector('i').className = 'fas fa-exclamation-triangle text-amber-500';
  }
}

function handlePasteText(textarea) {
  const text = textarea.value.trim();
  if (text.length > 10) {
    pendingUploadText = text;
    document.getElementById('uploadAnalysisHint').classList.remove('hidden');
    document.getElementById('uploadSubmitBtn').disabled = false;
    const wc = text.split(/\\s+/).filter(Boolean).length;
    document.getElementById('uploadStatus').textContent = wc.toLocaleString() + ' words ready for analysis';
  }
}

async function submitDocUpload() {
  const title = document.getElementById('uploadTitle').value.trim();
  if (!title) { toast('Title required', 'Please provide a document title', 'error'); return; }
  if (!pendingUploadText || pendingUploadText.length < 10) { toast('No text content', 'Upload a file or paste document text', 'error'); return; }

  const btn = document.getElementById('uploadSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Uploading & Analyzing...';
  document.getElementById('uploadStatus').textContent = 'Uploading document...';

  try {
    const { data } = await axios.post(API + '/documents/upload', {
      title,
      file_name: pendingUploadFile?.name || (title.replace(/\\s+/g, '_') + '.txt'),
      file_type: pendingUploadFile?.type || 'text/plain',
      file_size: pendingUploadFile?.size || pendingUploadText.length,
      category: document.getElementById('uploadCategory').value,
      case_id: document.getElementById('uploadCaseSelect').value || null,
      content_text: pendingUploadText
    });

    toast('Document Uploaded', title + ' — analysis complete with ' + (data.analysis?.riskFlags?.length || 0) + ' risk flags', 'success');
    closeModal();
    // Navigate to document detail view
    viewDocument(data.id);
  } catch(e) {
    toast('Upload Failed', e.response?.data?.error || e.message, 'error');
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-cloud-upload-alt mr-2"></i>Upload & Analyze';
  }
}

// ═══════════════════════════════════════════════════════════════
// DOCUMENT DETAIL VIEW — Full analysis visualization
// ═══════════════════════════════════════════════════════════════
async function viewDocument(id) {
  try {
    document.getElementById('pageContent').innerHTML = '<div class="flex items-center justify-center h-32"><i class="fas fa-spinner fa-spin text-brand-500 text-xl mr-3"></i> Loading document...</div>';
    const { data } = await axios.get(API + '/documents/' + id);
    const doc = data.document;
    const analysis = data.analysis;

    // Parse analysis JSON fields
    let entities = [], keyDates = [], monetaryValues = [], parties = [], citations = [], clauses = [], riskFlags = [], obligations = [], deadlines = [];
    if (analysis) {
      try { entities = JSON.parse(analysis.entities_json || '[]'); } catch(e) {}
      try { keyDates = JSON.parse(analysis.key_dates_json || '[]'); } catch(e) {}
      try { monetaryValues = JSON.parse(analysis.monetary_values_json || '[]'); } catch(e) {}
      try { parties = JSON.parse(analysis.parties_json || '[]'); } catch(e) {}
      try { citations = JSON.parse(analysis.citations_json || '[]'); } catch(e) {}
      try { clauses = JSON.parse(analysis.clauses_json || '[]'); } catch(e) {}
      try { riskFlags = JSON.parse(analysis.risk_flags_json || '[]'); } catch(e) {}
      try { obligations = JSON.parse(analysis.obligations_json || '[]'); } catch(e) {}
      try { deadlines = JSON.parse(analysis.deadlines_json || '[]'); } catch(e) {}
    }

    const confPct = analysis ? Math.round((analysis.confidence || 0) * 100) : 0;
    const confColor = confPct >= 80 ? 'green' : confPct >= 60 ? 'amber' : 'red';

    document.getElementById('pageContent').innerHTML = \`
      <div class="fade-in">
        <!-- Back + Header -->
        <div class="flex items-center gap-3 mb-6 mobile-header-stack">
          <button onclick="loadDocuments()" class="btn btn-secondary flex-shrink-0"><i class="fas fa-arrow-left"></i></button>
          <div class="flex-1 min-w-0">
            <h2 class="text-xl font-bold text-dark-900 truncate">\${doc.title}</h2>
            <div class="flex flex-wrap items-center gap-2 mt-1">
              <span class="text-xs text-dark-400"><i class="fas fa-file mr-1"></i>\${doc.file_name}</span>
              <span class="text-xs text-dark-400">\${formatFileSize(doc.file_size)}</span>
              <span class="badge \${getStatusColor(doc.status)}">\${doc.status}</span>
              \${doc.case_number ? '<span class="badge bg-blue-100 text-blue-700"><i class="fas fa-briefcase mr-1"></i>'+doc.case_number+'</span>' : ''}
              <span class="text-xs text-dark-400">Uploaded \${formatDate(doc.created_at)} by \${doc.uploaded_by_name || 'Brad'}</span>
            </div>
          </div>
          <div class="flex gap-2 flex-shrink-0">
            <button onclick="reAnalyzeDoc(\${doc.id})" class="btn btn-secondary btn-sm"><i class="fas fa-sync-alt mr-1"></i>Re-analyze</button>
            <button onclick="deleteDoc(\${doc.id})" class="btn btn-outline btn-sm text-red-500 border-red-200 hover:bg-red-50"><i class="fas fa-trash mr-1"></i>Archive</button>
          </div>
        </div>

        \${analysis ? \`
        <!-- Analysis Summary Banner -->
        <div class="card p-5 mb-6 border-l-4" style="border-left-color:#cc2229">
          <div class="flex items-start justify-between gap-3 mobile-header-stack">
            <div class="flex-1">
              <div class="flex items-center gap-2 mb-2">
                <i class="fas fa-brain" style="color:#cc2229"></i>
                <h3 class="font-semibold text-dark-800">AI Analysis Summary</h3>
                <span class="badge bg-\${confColor}-100 text-\${confColor}-700">\${confPct}% confidence</span>
                <span class="badge bg-dark-100 text-dark-500">\${analysis.doc_classification || 'general'}</span>
                \${analysis.jurisdiction_detected && analysis.jurisdiction_detected !== 'unknown' ? '<span class="badge bg-indigo-100 text-indigo-700"><i class="fas fa-map-marker-alt mr-1"></i>'+analysis.jurisdiction_detected+'</span>' : ''}
              </div>
              <p class="text-sm text-dark-600">\${analysis.summary || 'No summary available'}</p>
            </div>
          </div>
        </div>

        <!-- Stats Row -->
        <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-7 gap-2 sm:gap-3 mb-6">
          <div class="card p-3 text-center"><p class="text-xs text-purple-600 font-semibold">Entities</p><p class="text-xl font-bold text-purple-700">\${entities.length}</p></div>
          <div class="card p-3 text-center"><p class="text-xs text-blue-600 font-semibold">Dates</p><p class="text-xl font-bold text-blue-700">\${keyDates.length}</p></div>
          <div class="card p-3 text-center"><p class="text-xs text-green-600 font-semibold">Money</p><p class="text-xl font-bold text-green-700">\${monetaryValues.length}</p></div>
          <div class="card p-3 text-center"><p class="text-xs text-amber-600 font-semibold">Citations</p><p class="text-xl font-bold text-amber-700">\${citations.length}</p></div>
          <div class="card p-3 text-center"><p class="text-xs text-red-600 font-semibold">Risks</p><p class="text-xl font-bold text-red-700">\${riskFlags.length}</p></div>
          <div class="card p-3 text-center"><p class="text-xs text-indigo-600 font-semibold">Clauses</p><p class="text-xl font-bold text-indigo-700">\${clauses.length}</p></div>
          <div class="card p-3 text-center"><p class="text-xs text-dark-500 font-semibold">Obligations</p><p class="text-xl font-bold text-dark-700">\${obligations.length}</p></div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
          <!-- Risk Flags -->
          \${riskFlags.length > 0 ? \`
          <div class="card p-5 border-red-200">
            <h4 class="font-semibold text-dark-800 mb-3 flex items-center gap-2"><i class="fas fa-shield-alt text-red-500"></i> Risk Flags (\${riskFlags.length})</h4>
            <div class="space-y-2">
              \${riskFlags.map(r => \`
                <div class="p-3 rounded-lg flex items-start gap-3 \${r.severity === 'high' ? 'bg-red-50 border border-red-200' : r.severity === 'medium' ? 'bg-amber-50 border border-amber-200' : 'bg-blue-50 border border-blue-200'}">
                  <i class="fas fa-\${r.severity === 'high' ? 'exclamation-triangle text-red-500' : r.severity === 'medium' ? 'exclamation-circle text-amber-500' : 'info-circle text-blue-500'} mt-0.5 flex-shrink-0"></i>
                  <div>
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-semibold \${r.severity === 'high' ? 'text-red-700' : r.severity === 'medium' ? 'text-amber-700' : 'text-blue-700'}">\${r.flag}</span>
                      <span class="badge \${r.severity === 'high' ? 'bg-red-100 text-red-700' : r.severity === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'} text-xs">\${r.severity}</span>
                    </div>
                    <p class="text-xs text-dark-500 mt-1">\${escapeHtml(r.detail || '')}</p>
                  </div>
                </div>
              \`).join('')}
            </div>
          </div>\` : ''}

          <!-- Parties -->
          \${parties.length > 0 ? \`
          <div class="card p-5">
            <h4 class="font-semibold text-dark-800 mb-3 flex items-center gap-2"><i class="fas fa-users text-purple-500"></i> Parties (\${parties.length})</h4>
            <div class="space-y-2">
              \${parties.map(p => \`
                <div class="flex items-center justify-between p-2 bg-dark-50 rounded-lg">
                  <span class="text-sm font-medium text-dark-700">\${escapeHtml(p.name)}</span>
                  <span class="badge bg-purple-100 text-purple-700 text-xs">\${p.role}</span>
                </div>
              \`).join('')}
            </div>
          </div>\` : ''}

          <!-- Key Dates -->
          \${keyDates.length > 0 ? \`
          <div class="card p-5">
            <h4 class="font-semibold text-dark-800 mb-3 flex items-center gap-2"><i class="fas fa-calendar-alt text-blue-500"></i> Key Dates (\${keyDates.length})</h4>
            <div class="space-y-2">
              \${keyDates.map(d => \`
                <div class="flex items-center gap-3 p-2 bg-dark-50 rounded-lg">
                  <div class="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                    <i class="fas fa-calendar text-blue-600 text-sm"></i>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-dark-700">\${d.date}</p>
                    <p class="text-xs text-dark-400 truncate">\${escapeHtml((d.context || '').substring(0, 80))}</p>
                  </div>
                  <span class="badge \${d.type === 'deadline' ? 'bg-red-100 text-red-700' : d.type === 'hearing_date' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'} text-xs flex-shrink-0">\${d.type.replace(/_/g, ' ')}</span>
                </div>
              \`).join('')}
            </div>
          </div>\` : ''}

          <!-- Monetary Values -->
          \${monetaryValues.length > 0 ? \`
          <div class="card p-5">
            <h4 class="font-semibold text-dark-800 mb-3 flex items-center gap-2"><i class="fas fa-dollar-sign text-green-500"></i> Monetary Values (\${monetaryValues.length})</h4>
            <div class="space-y-2">
              \${monetaryValues.map(m => \`
                <div class="flex items-center gap-3 p-2 bg-green-50 rounded-lg">
                  <span class="text-lg font-bold text-green-700">\${m.amount}</span>
                  <span class="text-xs text-dark-400 flex-1 truncate">\${escapeHtml((m.context || '').substring(0, 80))}</span>
                </div>
              \`).join('')}
            </div>
          </div>\` : ''}

          <!-- Legal Citations -->
          \${citations.length > 0 ? \`
          <div class="card p-5">
            <h4 class="font-semibold text-dark-800 mb-3 flex items-center gap-2"><i class="fas fa-book text-amber-500"></i> Legal Citations (\${citations.length}) <span class="text-xs text-dark-400 font-normal ml-auto">Hover for deep links</span></h4>
            <div class="flex flex-wrap gap-2">
              \${citations.map(c => renderCitationWithLinks(c.citation, c.type)).join('')}
            </div>
          </div>\` : ''}

          <!-- Entities -->
          \${entities.length > 0 ? \`
          <div class="card p-5">
            <h4 class="font-semibold text-dark-800 mb-3 flex items-center gap-2"><i class="fas fa-tags text-indigo-500"></i> Entities (\${entities.length})</h4>
            <div class="space-y-2">
              \${entities.slice(0, 15).map(e => {
                const typeIcon = { person:'fa-user text-purple-500', organization:'fa-building text-blue-500', address:'fa-map-marker-alt text-green-500', phone:'fa-phone text-amber-500', email:'fa-envelope text-red-500', case_number:'fa-hashtag text-indigo-500' };
                return '<div class="flex items-center gap-2 p-2 bg-dark-50 rounded-lg"><i class="fas '+(typeIcon[e.type]||'fa-tag text-dark-400')+' text-sm w-5 text-center"></i><span class="text-sm text-dark-700 flex-1">'+escapeHtml(e.value)+'</span><span class="badge bg-dark-100 text-dark-500 text-xs">'+e.type+'</span></div>';
              }).join('')}
            </div>
          </div>\` : ''}

          <!-- Clauses -->
          \${clauses.length > 0 ? \`
          <div class="card p-5">
            <h4 class="font-semibold text-dark-800 mb-3 flex items-center gap-2"><i class="fas fa-file-contract text-indigo-500"></i> Clauses & Sections (\${clauses.length})</h4>
            <div class="space-y-2">
              \${clauses.map(cl => \`
                <div class="p-3 bg-dark-50 rounded-lg">
                  <div class="flex items-center gap-2 mb-1">
                    <span class="text-sm font-semibold text-dark-800">\${escapeHtml(cl.title)}</span>
                    <span class="badge bg-indigo-100 text-indigo-700 text-xs">\${cl.type.replace(/_/g,' ')}</span>
                  </div>
                  <p class="text-xs text-dark-500">\${escapeHtml((cl.content || '').substring(0, 150))}...</p>
                </div>
              \`).join('')}
            </div>
          </div>\` : ''}

          <!-- Obligations -->
          \${obligations.length > 0 ? \`
          <div class="card p-5">
            <h4 class="font-semibold text-dark-800 mb-3 flex items-center gap-2"><i class="fas fa-tasks text-dark-500"></i> Obligations (\${obligations.length})</h4>
            <div class="space-y-2">
              \${obligations.map(o => \`
                <div class="p-2 bg-dark-50 rounded-lg text-sm">
                  <span class="text-dark-600">\${escapeHtml(o.obligation.substring(0, 150))}</span>
                  \${o.deadline ? '<span class="badge bg-red-100 text-red-700 text-xs ml-2">Due: '+o.deadline+'</span>' : ''}
                </div>
              \`).join('')}
            </div>
          </div>\` : ''}

          <!-- Deadlines -->
          \${deadlines.length > 0 ? \`
          <div class="card p-5">
            <h4 class="font-semibold text-dark-800 mb-3 flex items-center gap-2"><i class="fas fa-clock text-red-500"></i> Deadlines (\${deadlines.length})</h4>
            <div class="space-y-2">
              \${deadlines.map(dl => \`
                <div class="flex items-center gap-3 p-2 rounded-lg \${dl.urgency === 'overdue' ? 'bg-red-50' : dl.urgency === 'urgent' ? 'bg-amber-50' : 'bg-blue-50'}">
                  <span class="font-medium text-sm">\${dl.date}</span>
                  <span class="text-xs text-dark-500 flex-1">\${escapeHtml((dl.description || '').substring(0, 80))}</span>
                  <span class="badge \${dl.urgency === 'overdue' ? 'bg-red-100 text-red-700' : dl.urgency === 'urgent' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'} text-xs">\${dl.urgency}</span>
                </div>
              \`).join('')}
            </div>
          </div>\` : ''}
        </div>

        <!-- Document Text Preview -->
        \${doc.content_text ? \`
        <div class="card p-5 mt-6">
          <h4 class="font-semibold text-dark-800 mb-3 flex items-center gap-2"><i class="fas fa-file-lines text-dark-400"></i> Document Text</h4>
          <div class="bg-dark-50 rounded-lg p-4 max-h-64 overflow-y-auto">
            <pre class="text-xs text-dark-600 whitespace-pre-wrap font-mono">\${escapeHtml(doc.content_text.substring(0, 10000))}\${doc.content_text.length > 10000 ? '\\n\\n... [truncated]' : ''}</pre>
          </div>
        </div>\` : ''}

        \` : \`
        <!-- No Analysis Available -->
        <div class="card p-12 text-center">
          <div class="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <i class="fas fa-search text-amber-400 text-2xl"></i>
          </div>
          <h3 class="text-lg font-semibold text-dark-800 mb-2">No Analysis Available</h3>
          <p class="text-dark-400 text-sm mb-4">This document hasn't been analyzed yet. Run analysis to extract entities, dates, citations, and risk flags.</p>
          <button onclick="reAnalyzeDoc(\${doc.id})" class="btn btn-primary"><i class="fas fa-brain mr-2"></i>Analyze Document</button>
        </div>
        \`}
      </div>
    \`;
  } catch(e) { showError('document details'); }
}

async function reAnalyzeDoc(id) {
  toast('Re-analyzing...', 'Running deep analysis on document', 'default');
  try {
    await axios.post(API + '/documents/' + id + '/analyze');
    toast('Analysis Complete', 'Document re-analyzed successfully', 'success');
    viewDocument(id);
  } catch(e) {
    toast('Analysis Failed', e.response?.data?.error || e.message, 'error');
  }
}

async function deleteDoc(id) {
  if (!confirm('Archive this document?')) return;
  try {
    await axios.delete(API + '/documents/' + id);
    toast('Document Archived', '', 'success');
    loadDocuments();
  } catch(e) { toast('Error', e.message, 'error'); }
}

function showNewInvoiceModal() {
  Promise.all([axios.get(API + '/clients'), axios.get(API + '/cases')]).then(([cRes, csRes]) => {
    const clientOpts = (cRes.data.clients || []).map(cl => '<option value="'+cl.id+'">'+escapeHtml(cl.first_name+' '+cl.last_name)+'</option>').join('');
    const caseOpts = (csRes.data.cases || []).map(cs => '<option value="'+cs.id+'">'+escapeHtml(cs.case_number+' — '+cs.title.substring(0,30))+'</option>').join('');
    const cSel = document.getElementById('niClientId');
    const csSel = document.getElementById('niCaseId');
    if (cSel) cSel.innerHTML = '<option value="">Select client *</option>' + clientOpts;
    if (csSel) csSel.innerHTML = '<option value="">Select case *</option>' + caseOpts;
  }).catch(() => {});

  document.getElementById('modalContainer').innerHTML = \`
    <div class="modal-overlay" onclick="closeModal(event)" role="dialog" aria-modal="true" aria-labelledby="niModalTitle">
      <div class="modal p-6" onclick="event.stopPropagation()">
        <h3 class="text-lg font-bold mb-4" id="niModalTitle"><i class="fas fa-receipt text-green-600 mr-2"></i>New Invoice</h3>
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div><label class="text-sm font-medium text-dark-700 block mb-1" for="niClientId">Client *</label>
              <select id="niClientId" aria-required="true"><option value="">Loading...</option></select></div>
            <div><label class="text-sm font-medium text-dark-700 block mb-1" for="niCaseId">Case *</label>
              <select id="niCaseId" aria-required="true"><option value="">Loading...</option></select></div>
          </div>
          <div class="grid grid-cols-3 gap-4">
            <div><label class="text-sm font-medium text-dark-700 block mb-1" for="niSubtotal">Subtotal ($)</label>
              <input id="niSubtotal" type="number" step="0.01" min="0" placeholder="0.00"></div>
            <div><label class="text-sm font-medium text-dark-700 block mb-1" for="niTax">Tax ($)</label>
              <input id="niTax" type="number" step="0.01" min="0" placeholder="0.00" value="0"></div>
            <div><label class="text-sm font-medium text-dark-700 block mb-1" for="niTotal">Total ($)</label>
              <input id="niTotal" type="number" step="0.01" min="0" placeholder="0.00"></div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="text-sm font-medium text-dark-700 block mb-1" for="niDue">Due Date</label>
              <input id="niDue" type="date"></div>
            <div><label class="text-sm font-medium text-dark-700 block mb-1" for="niTerms">Payment Terms</label>
              <select id="niTerms"><option value="net_30">Net 30</option><option value="net_15">Net 15</option><option value="net_60">Net 60</option><option value="due_on_receipt">Due on Receipt</option></select></div>
          </div>
          <div><label class="text-sm font-medium text-dark-700 block mb-1" for="niNotes">Notes</label>
            <textarea id="niNotes" rows="2" placeholder="Invoice notes..."></textarea></div>
          <div id="niError" class="text-sm text-red-600 hidden"></div>
          <div class="flex gap-2 justify-end">
            <button onclick="closeModal()" class="btn btn-secondary">Cancel</button>
            <button onclick="createInvoice()" class="btn btn-success" id="niSubmitBtn"><i class="fas fa-check mr-1"></i>Create Invoice</button>
          </div>
        </div>
      </div>
    </div>
  \`;
}

async function createInvoice() {
  const clientId = document.getElementById('niClientId').value;
  const caseId = document.getElementById('niCaseId').value;
  const errEl = document.getElementById('niError');
  if (!clientId || !caseId) { errEl.textContent = 'Client and Case are required'; errEl.classList.remove('hidden'); return; }
  const btn = document.getElementById('niSubmitBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Creating...';
  try {
    const subtotal = parseFloat(document.getElementById('niSubtotal').value) || 0;
    const tax = parseFloat(document.getElementById('niTax').value) || 0;
    const total = parseFloat(document.getElementById('niTotal').value) || (subtotal + tax);
    await axios.post(API + '/billing/invoices', {
      client_id: Number(clientId), case_id: Number(caseId),
      subtotal, tax_amount: tax, total_amount: total,
      due_date: document.getElementById('niDue').value || null,
      payment_terms: document.getElementById('niTerms').value,
      notes: document.getElementById('niNotes').value
    });
    toast('Invoice Created', 'New invoice for $' + total.toLocaleString(), 'success');
    closeModal(); loadBilling();
  } catch(e) {
    const msg = e.response?.data?.errors?.join(', ') || e.response?.data?.error || 'Error creating invoice';
    errEl.textContent = msg; errEl.classList.remove('hidden');
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-check mr-1"></i>Create Invoice';
  }
}

function closeModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modalContainer').innerHTML = '';
}

// === NOTIFICATIONS ===
async function loadNotifications() {
  try {
    const { data } = await axios.get(API + '/notifications');
    const badge = document.getElementById('notifBadge');
    if (data.unread_count > 0) { badge.textContent = data.unread_count; badge.classList.remove('hidden'); }
    else { badge.classList.add('hidden'); }
  } catch(e) {}
}

// === HELPERS ===
function formatType(t) { return t ? t.replace(/_/g, ' ').replace(/\\b\\w/g, l => l.toUpperCase()) : '-'; }
function formatStatus(s) { return s ? s.replace(/_/g, ' ').replace(/\\b\\w/g, l => l.toUpperCase()) : '-'; }
function formatDate(d) { if (!d) return '-'; try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return d; } }
function formatDateTime(d) { if (!d) return '-'; try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return d; } }
function formatTime(d) { if (!d) return '-'; try { return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); } catch { return d; } }
function formatFileSize(b) { if (!b) return '-'; if (b > 1048576) return (b/1048576).toFixed(1) + ' MB'; if (b > 1024) return (b/1024).toFixed(0) + ' KB'; return b + ' B'; }

function getStatusColor(s) {
  const m = { open:'bg-blue-100 text-blue-700', in_progress:'bg-yellow-100 text-yellow-700', pending_review:'bg-orange-100 text-orange-700', discovery:'bg-purple-100 text-purple-700', trial:'bg-red-100 text-red-700', settled:'bg-green-100 text-green-700', closed:'bg-dark-100 text-dark-500', archived:'bg-dark-100 text-dark-400', draft:'bg-dark-100 text-dark-500', review:'bg-yellow-100 text-yellow-700', final:'bg-green-100 text-green-700', filed:'bg-blue-100 text-blue-700', pending:'bg-yellow-100 text-yellow-700', completed:'bg-green-100 text-green-700', cancelled:'bg-dark-100 text-dark-400', overdue:'bg-red-100 text-red-700' };
  return m[s] || 'bg-dark-100 text-dark-600';
}

function getPriorityColor(p) {
  const m = { low:'bg-green-100 text-green-700', medium:'bg-blue-100 text-blue-700', high:'bg-orange-100 text-orange-700', urgent:'bg-red-100 text-red-700' };
  return m[p] || 'bg-dark-100 text-dark-600';
}

function getInvoiceStatusColor(s) {
  const m = { draft:'bg-dark-100 text-dark-500', sent:'bg-blue-100 text-blue-700', viewed:'bg-blue-100 text-blue-700', partial:'bg-yellow-100 text-yellow-700', paid:'bg-green-100 text-green-700', overdue:'bg-red-100 text-red-700', cancelled:'bg-dark-100 text-dark-400' };
  return m[s] || 'bg-dark-100 text-dark-600';
}

function getAgentIcon(t) {
  const m = { orchestrator:'diagram-project', intake:'clipboard-list', research:'magnifying-glass', drafting:'file-pen', verification:'shield-check', compliance:'scale-balanced', esignature:'signature', billing:'receipt' };
  return m[t] || 'robot';
}

// ═══ Deep Link Generation for Legal Citations ═══
function generateCitationLinks(cite) {
  const encoded = encodeURIComponent(cite);
  return {
    westlaw: 'https://1.next.westlaw.com/Search/Results.html?query=' + encoded,
    lexis: 'https://advance.lexis.com/search/?q=' + encoded,
    scholar: 'https://scholar.google.com/scholar?q=%22' + encoded + '%22',
    courtlistener: '/api/legal-research/citation?cite=' + encoded
  };
}

function renderCitationWithLinks(cite, type) {
  const links = generateCitationLinks(cite);
  const typeColor = type === 'kansas_statute' ? 'bg-blue-100 text-blue-700' : type === 'missouri_statute' ? 'bg-red-100 text-red-700' : type === 'federal_statute' ? 'bg-indigo-100 text-indigo-700' : type === 'case_law' ? 'bg-purple-100 text-purple-700' : 'bg-dark-100 text-dark-600';
  const iconType = type && type.includes('statute') ? 'gavel' : type === 'case_law' ? 'scale-balanced' : 'book';
  return '<div class="flex items-center gap-1 group">' +
    '<span class="badge '+typeColor+' text-xs py-1 px-2"><i class="fas fa-'+iconType+' mr-1"></i>'+escapeHtml(cite)+'</span>' +
    '<span class="hidden group-hover:inline-flex items-center gap-1 text-[10px]">' +
    '<a href="'+links.westlaw+'" target="_blank" rel="noopener" class="text-blue-500 hover:underline" title="Search on Westlaw">WL</a>' +
    '<a href="'+links.lexis+'" target="_blank" rel="noopener" class="text-purple-500 hover:underline" title="Search on Lexis">LX</a>' +
    '<a href="'+links.scholar+'" target="_blank" rel="noopener" class="text-green-500 hover:underline" title="Google Scholar">GS</a>' +
    '</span></div>';
}

function showError(section) {
  document.getElementById('pageContent').innerHTML = '<div class="text-center py-12"><i class="fas fa-exclamation-triangle text-red-500 text-3xl mb-3"></i><p class="text-dark-500">Error loading ' + section + '. <button onclick="navigate(currentPage)" class="text-brand-600 underline">Retry</button></p></div>';
}

function handleGlobalSearch(e) {
  if (e.key === 'Enter') {
    const q = e.target.value.trim();
    if (q.length > 0) {
      navigate('cases');
      // BUG-2 fix: Actually perform the search by loading cases with the query
      setTimeout(function() {
        axios.get(API + '/cases?search=' + encodeURIComponent(q)).then(function(res) {
          renderCaseTable(res.data);
          // Update the heading to show search context
          var heading = document.querySelector('#pageContent .mobile-title-sm');
          if (heading) heading.textContent = 'Search: "' + q + '"';
          var subtitle = document.querySelector('#pageContent .text-dark-500.text-sm');
          if (subtitle) subtitle.textContent = res.data.cases.length + ' result(s) found';
        }).catch(function() {});
      }, 300);
    }
  }
}

// Start the app
init();
  </script>
</body>
</html>`;
}
export default app;

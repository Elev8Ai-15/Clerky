import { Hono } from 'hono'
import { cors } from 'hono/cors'
import cases from './routes/cases'
import clients from './routes/clients'
import documents from './routes/documents'
import billing from './routes/billing'
import calendar from './routes/calendar'
import tasks from './routes/tasks'
import ai from './routes/ai'
import users from './routes/users'
import notifications from './routes/notifications'

type Bindings = { DB: D1Database }

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())

// API Routes
app.route('/api/cases', cases)
app.route('/api/clients', clients)
app.route('/api/documents', documents)
app.route('/api/billing', billing)
app.route('/api/calendar', calendar)
app.route('/api/tasks', tasks)
app.route('/api/ai', ai)
app.route('/api/users', users)
app.route('/api/notifications', notifications)

// Dashboard stats endpoint
app.get('/api/dashboard', async (c) => {
  const [casesCount, clientsCount, docsCount, tasksCount, upcomingEvents, recentActivity, unreadNotifs] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status NOT IN ('closed','archived') THEN 1 ELSE 0 END) as active FROM cases_matters").first(),
    c.env.DB.prepare("SELECT COUNT(*) as total FROM clients WHERE status = 'active'").first(),
    c.env.DB.prepare("SELECT COUNT(*) as total FROM documents").first(),
    c.env.DB.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending, SUM(CASE WHEN status = 'overdue' OR (status = 'pending' AND due_date < date('now')) THEN 1 ELSE 0 END) as overdue FROM tasks_deadlines").first(),
    c.env.DB.prepare("SELECT ce.*, cm.case_number FROM calendar_events ce LEFT JOIN cases_matters cm ON ce.case_id = cm.id WHERE ce.start_datetime >= datetime('now') ORDER BY ce.start_datetime ASC LIMIT 5").all(),
    c.env.DB.prepare("SELECT al.*, cm.case_number FROM ai_logs al LEFT JOIN cases_matters cm ON al.case_id = cm.id ORDER BY al.created_at DESC LIMIT 5").all(),
    c.env.DB.prepare("SELECT COUNT(*) as count FROM notifications WHERE user_id = 1 AND is_read = 0").first()
  ])

  return c.json({
    cases: { total: (casesCount as any)?.total || 0, active: (casesCount as any)?.active || 0 },
    clients: { total: (clientsCount as any)?.total || 0 },
    documents: { total: (docsCount as any)?.total || 0 },
    tasks: { total: (tasksCount as any)?.total || 0, pending: (tasksCount as any)?.pending || 0, overdue: (tasksCount as any)?.overdue || 0 },
    upcoming_events: upcomingEvents.results,
    recent_ai_activity: recentActivity.results,
    unread_notifications: (unreadNotifs as any)?.count || 0
  })
})

// Database init endpoint
app.get('/api/init-db', async (c) => {
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
    `CREATE TABLE IF NOT EXISTS conflict_checks (id INTEGER PRIMARY KEY AUTOINCREMENT, checked_name TEXT NOT NULL, checked_entity TEXT, case_id INTEGER, checked_by INTEGER NOT NULL, result TEXT NOT NULL, details TEXT, related_case_ids TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`
  ]

  for (const sql of migrations) {
    await c.env.DB.prepare(sql).run()
  }

  // Seed data
  const seedStatements = [
    `INSERT OR IGNORE INTO users_attorneys (id, email, full_name, role, bar_number, phone, specialty) VALUES (1, 'sarah.chen@lawyrs.com', 'Sarah Chen', 'admin', 'CA-2019-45678', '(415) 555-0101', 'Corporate Law'), (2, 'james.wilson@lawyrs.com', 'James Wilson', 'attorney', 'CA-2015-23456', '(415) 555-0102', 'Personal Injury'), (3, 'maria.garcia@lawyrs.com', 'Maria Garcia', 'attorney', 'CA-2018-67890', '(415) 555-0103', 'Family Law'), (4, 'david.thompson@lawyrs.com', 'David Thompson', 'paralegal', NULL, '(415) 555-0104', 'Litigation Support'), (5, 'emily.patel@lawyrs.com', 'Emily Patel', 'attorney', 'CA-2020-89012', '(415) 555-0105', 'Immigration')`,
    `INSERT OR IGNORE INTO clients (id, first_name, last_name, email, phone, address, city, state, zip_code, client_type, status, assigned_attorney_id) VALUES (1, 'Robert', 'Johnson', 'r.johnson@email.com', '(415) 555-1001', '123 Market St', 'San Francisco', 'CA', '94105', 'individual', 'active', 2), (2, 'TechStart', 'Inc', 'legal@techstart.io', '(415) 555-1002', '456 Mission St', 'San Francisco', 'CA', '94105', 'business', 'active', 1), (3, 'Angela', 'Martinez', 'angela.m@email.com', '(415) 555-1003', '789 Valencia St', 'San Francisco', 'CA', '94110', 'individual', 'active', 3), (4, 'Li', 'Wei', 'li.wei@email.com', '(415) 555-1004', '321 Geary St', 'San Francisco', 'CA', '94102', 'individual', 'active', 5), (5, 'Pacific', 'Ventures LLC', 'info@pacificventures.com', '(415) 555-1005', '555 California St', 'San Francisco', 'CA', '94104', 'business', 'active', 1)`,
    `INSERT OR IGNORE INTO cases_matters (id, case_number, title, description, case_type, status, priority, client_id, lead_attorney_id, court_name, opposing_counsel, date_filed, estimated_value) VALUES (1, 'CM-2026-001', 'Johnson v. ABC Corp - Personal Injury', 'Workplace injury claim', 'personal_injury', 'in_progress', 'high', 1, 2, 'SF Superior Court', 'Smith & Associates', '2026-01-15', 250000), (2, 'CM-2026-002', 'TechStart Series A Funding', 'Corporate restructuring and Series A', 'corporate', 'open', 'high', 2, 1, NULL, NULL, '2026-02-01', 5000000), (3, 'CM-2026-003', 'Martinez Custody Agreement', 'Child custody modification', 'family', 'pending_review', 'urgent', 3, 3, 'SF Family Court', 'Rivera Law Group', '2026-01-20', NULL), (4, 'CM-2026-004', 'Wei Immigration - H1B to Green Card', 'EB-2 green card application', 'immigration', 'in_progress', 'medium', 4, 5, 'USCIS', NULL, '2026-02-10', NULL), (5, 'CM-2026-005', 'Pacific Ventures - IP Portfolio', 'Patent portfolio review', 'ip', 'open', 'medium', 5, 1, 'USPTO', NULL, '2026-02-15', 1500000), (6, 'CM-2026-006', 'Johnson Employment Dispute', 'Wrongful termination claim', 'employment', 'discovery', 'high', 1, 2, 'SF Superior Court', 'Corporate Defense LLP', '2025-11-01', 175000)`,
    `INSERT OR IGNORE INTO documents (id, title, file_name, file_type, file_size, category, status, case_id, uploaded_by, ai_generated, ai_summary) VALUES (1, 'Initial Complaint - Johnson v ABC Corp', 'complaint_johnson_abc.pdf', 'application/pdf', 245000, 'pleading', 'filed', 1, 2, 0, 'Personal injury complaint'), (2, 'Medical Records Summary', 'medical_records_johnson.pdf', 'application/pdf', 1200000, 'evidence', 'final', 1, 4, 0, 'Complete medical records'), (3, 'Series A Term Sheet', 'techstart_termsheet_v3.pdf', 'application/pdf', 89000, 'contract', 'review', 2, 1, 0, '$5M investment term sheet'), (4, 'Custody Modification Motion', 'martinez_custody_motion.docx', 'application/vnd.openxmlformats', 156000, 'motion', 'draft', 3, 3, 1, 'AI-drafted custody modification'), (5, 'I-140 Petition', 'wei_i140_petition.pdf', 'application/pdf', 340000, 'pleading', 'review', 4, 5, 0, 'EB-2 petition'), (6, 'Patent Portfolio Analysis', 'pacific_patent_analysis.pdf', 'application/pdf', 567000, 'general', 'draft', 5, 1, 1, 'AI patent analysis'), (7, 'Engagement Letter Template', 'engagement_letter_template.docx', 'application/vnd.openxmlformats', 45000, 'template', 'final', NULL, 1, 0, NULL), (8, 'Discovery Responses', 'discovery_responses_johnson.pdf', 'application/pdf', 890000, 'discovery', 'review', 6, 2, 0, 'Discovery responses')`,
    `INSERT OR IGNORE INTO tasks_deadlines (id, title, description, case_id, assigned_to, assigned_by, priority, status, task_type, due_date) VALUES (1, 'File Motion for Summary Judgment', 'Prepare MSJ for Johnson PI case', 1, 2, 1, 'high', 'in_progress', 'filing', '2026-03-01'), (2, 'Review Expert Witness Report', 'Review Dr. Smiths report', 1, 4, 2, 'high', 'pending', 'review', '2026-02-25'), (3, 'Draft Share Purchase Agreement', 'Complete SPA for Series A', 2, 1, 1, 'high', 'in_progress', 'task', '2026-03-10'), (4, 'Prepare Custody Hearing Binder', 'Compile exhibits', 3, 3, 3, 'urgent', 'pending', 'hearing', '2026-02-22'), (5, 'Submit I-140 Supporting Docs', 'Gather EB-2 docs', 4, 5, 5, 'medium', 'pending', 'filing', '2026-03-15'), (6, 'Trademark Search Report', 'Complete trademark search', 5, 4, 1, 'medium', 'pending', 'task', '2026-03-05'), (7, 'Respond to Discovery Requests', 'Draft interrogatory responses', 6, 2, 2, 'high', 'in_progress', 'deadline', '2026-02-28'), (8, 'Client Meeting - Case Strategy', 'Quarterly strategy review', 1, 2, 2, 'medium', 'pending', 'follow_up', '2026-03-01')`,
    `INSERT OR IGNORE INTO calendar_events (id, title, description, event_type, case_id, organizer_id, location, start_datetime, end_datetime, color) VALUES (1, 'Johnson PI - Summary Judgment Hearing', 'MSJ hearing', 'hearing', 1, 2, 'SF Superior Court, Dept 302', '2026-03-15 09:00:00', '2026-03-15 11:00:00', '#EF4444'), (2, 'TechStart Board Meeting', 'Series A review', 'meeting', 2, 1, 'TechStart HQ', '2026-02-25 14:00:00', '2026-02-25 16:00:00', '#3B82F6'), (3, 'Martinez Custody Hearing', 'Custody modification', 'hearing', 3, 3, 'SF Family Court', '2026-03-01 10:00:00', '2026-03-01 12:00:00', '#EF4444'), (4, 'Wei - USCIS Interview', 'Green card interview', 'meeting', 4, 5, 'USCIS SF', '2026-04-10 13:00:00', '2026-04-10 14:00:00', '#F59E0B'), (5, 'Firm Strategy Meeting', 'Monthly all-hands', 'internal', NULL, 1, 'Main Conference Room', '2026-02-20 09:00:00', '2026-02-20 10:30:00', '#8B5CF6'), (6, 'Johnson Employment - Deposition', 'Former supervisor deposition', 'deposition', 6, 2, 'Office Conf Room A', '2026-03-08 09:00:00', '2026-03-08 17:00:00', '#F97316')`,
    `INSERT OR IGNORE INTO time_entries (id, case_id, user_id, description, hours, rate, activity_type, is_billable, entry_date) VALUES (1, 1, 2, 'Drafted initial complaint', 3.5, 450, 'drafting', 1, '2026-01-15'), (2, 1, 2, 'Client meeting - case intake', 1.5, 450, 'client_communication', 1, '2026-01-10'), (3, 1, 4, 'Medical records review', 4.0, 200, 'review', 1, '2026-01-20'), (4, 2, 1, 'Term sheet negotiation', 2.5, 550, 'legal_work', 1, '2026-02-05'), (5, 2, 1, 'Due diligence review', 6.0, 550, 'review', 1, '2026-02-08'), (6, 3, 3, 'Custody motion drafting', 3.0, 400, 'drafting', 1, '2026-02-01'), (7, 4, 5, 'I-140 petition prep', 5.0, 400, 'legal_work', 1, '2026-02-12'), (8, 5, 1, 'Patent portfolio analysis', 4.5, 550, 'research', 1, '2026-02-15'), (9, 6, 2, 'Discovery responses', 3.0, 450, 'drafting', 1, '2026-02-10'), (10, 6, 4, 'Document production review', 6.0, 200, 'review', 1, '2026-02-11')`,
    `INSERT OR IGNORE INTO billing_invoices (id, invoice_number, case_id, client_id, issued_by, status, subtotal, total_amount, amount_paid, due_date, sent_date) VALUES (1, 'INV-2026-001', 1, 1, 2, 'sent', 2975.00, 2975.00, 0, '2026-03-15', '2026-02-15'), (2, 'INV-2026-002', 2, 2, 1, 'paid', 4675.00, 4675.00, 4675.00, '2026-03-08', '2026-02-08'), (3, 'INV-2026-003', 3, 3, 3, 'draft', 1200.00, 1200.00, 0, '2026-03-01', NULL), (4, 'INV-2026-004', 6, 1, 2, 'overdue', 2550.00, 2550.00, 0, '2026-02-10', '2026-01-10')`,
    `INSERT OR IGNORE INTO ai_logs (id, agent_type, action, tokens_used, cost, duration_ms, status, case_id, user_id) VALUES (1, 'intake', 'process_new_case', 2500, 0.05, 3200, 'success', 1, 2), (2, 'research', 'legal_research', 8500, 0.17, 12000, 'success', 1, 2), (3, 'drafting', 'generate_motion', 6000, 0.12, 8500, 'success', 3, 3), (4, 'compliance', 'check_filing', 1500, 0.03, 2100, 'success', 4, 5), (5, 'drafting', 'generate_analysis', 12000, 0.24, 15000, 'success', 5, 1)`,
    `INSERT OR IGNORE INTO notifications (id, user_id, title, message, type, is_read, case_id) VALUES (1, 2, 'Deadline Approaching', 'MSJ due in 10 days - Johnson v ABC Corp', 'deadline', 0, 1), (2, 3, 'Urgent: Hearing Tomorrow', 'Custody hearing for Martinez case', 'warning', 0, 3), (3, 1, 'Invoice Paid', 'TechStart paid INV-2026-002 ($4,675.00)', 'billing', 1, 2), (4, 2, 'New Document Uploaded', 'Discovery responses uploaded', 'info', 0, 6), (5, 5, 'AI Research Complete', 'Immigration research for Wei case', 'success', 1, 4), (6, 1, 'Overdue Invoice', 'INV-2026-004 is overdue - Johnson Employment', 'warning', 0, 6)`
  ]

  for (const sql of seedStatements) {
    try { await c.env.DB.prepare(sql).run() } catch (e) { /* ignore duplicates */ }
  }

  return c.json({ success: true, message: 'Database initialized with 26 tables and seed data' })
})

// Serve the SPA for all non-API routes
app.get('*', (c) => {
  return c.html(getAppHTML())
})

function getAppHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lawyrs - Legal Practice Management</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.5.0/css/all.min.css" rel="stylesheet">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'sans-serif'] },
          colors: {
            brand: { 50:'#eff6ff', 100:'#dbeafe', 200:'#bfdbfe', 300:'#93c5fd', 400:'#60a5fa', 500:'#3b82f6', 600:'#2563eb', 700:'#1d4ed8', 800:'#1e40af', 900:'#1e3a5f' },
            dark: { 50:'#f8fafc', 100:'#f1f5f9', 200:'#e2e8f0', 300:'#cbd5e1', 400:'#94a3b8', 500:'#64748b', 600:'#475569', 700:'#334155', 800:'#1e293b', 900:'#0f172a', 950:'#020617' }
          }
        }
      }
    }
  </script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Inter', sans-serif; background: #f8fafc; }
    .sidebar-link { transition: all 0.15s ease; }
    .sidebar-link:hover, .sidebar-link.active { background: rgba(255,255,255,0.1); }
    .sidebar-link.active { border-right: 3px solid #60a5fa; background: rgba(59,130,246,0.15); }
    .card { background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; transition: all 0.2s; }
    .card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .badge { padding: 2px 10px; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
    .btn { padding: 8px 16px; border-radius: 8px; font-weight: 500; font-size: 0.875rem; cursor: pointer; transition: all 0.15s; border: none; }
    .btn-primary { background: #2563eb; color: white; }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-secondary { background: #f1f5f9; color: #334155; border: 1px solid #e2e8f0; }
    .btn-secondary:hover { background: #e2e8f0; }
    .btn-danger { background: #fee2e2; color: #dc2626; }
    .btn-danger:hover { background: #fecaca; }
    .btn-success { background: #dcfce7; color: #16a34a; }
    .btn-success:hover { background: #bbf7d0; }
    .table-row { transition: background 0.1s; }
    .table-row:hover { background: #f8fafc; }
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 50; }
    .modal { background: white; border-radius: 16px; max-width: 600px; width: 90%; max-height: 85vh; overflow-y: auto; }
    .stat-card { background: linear-gradient(135deg, var(--from), var(--to)); border-radius: 16px; color: white; padding: 24px; }
    .fade-in { animation: fadeIn 0.3s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .pulse { animation: pulse 2s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    input, select, textarea { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; font-size: 0.875rem; width: 100%; outline: none; transition: border 0.15s; }
    input:focus, select:focus, textarea:focus { border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
    .scrollbar-thin::-webkit-scrollbar { width: 6px; }
    .scrollbar-thin::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
    .ai-glow { box-shadow: 0 0 20px rgba(139, 92, 246, 0.3); }
    #splash { position: fixed; inset: 0; z-index: 9999; transition: opacity 0.8s ease, visibility 0.8s ease; }
    #splash.hide { opacity: 0; visibility: hidden; pointer-events: none; }
    .hero-bg { background: linear-gradient(135deg, #0a2540 0%, #1e3a8a 100%); }
    #splash .splash-dot { animation: splashDot 1.4s ease-in-out infinite; }
    @keyframes splashDot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.8); } }
  </style>
</head>
<body class="bg-dark-50">
  <!-- Splash Screen -->
  <div id="splash" class="hero-bg min-h-screen flex items-center justify-center">
    <div class="max-w-2xl mx-auto text-center px-6">
      <div class="flex items-center justify-center gap-3 mb-8">
        <div class="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center text-2xl font-bold text-white">\u2696\uFE0F</div>
        <h1 class="text-5xl font-bold tracking-tight text-white">Lawyrs</h1>
      </div>
      <p class="text-emerald-400 text-xl mb-2">AI-Powered Legal Practice Management</p>
      <p class="text-2xl text-slate-300 mb-12">Your always-on senior partner, researcher, analyst &amp; drafter.</p>
      <div class="bg-slate-900/70 backdrop-blur-xl rounded-3xl p-10 border border-slate-700">
        <div class="flex items-center justify-center gap-3 mb-6">
          <div class="w-3 h-3 bg-emerald-500 rounded-full splash-dot"></div>
          <span class="text-slate-400 font-medium">Loading secure AI platform...</span>
        </div>
        <div class="grid grid-cols-3 gap-4 text-left text-sm text-white">
          <div class="bg-slate-800/50 rounded-2xl p-4">
            <i class="fa-solid fa-magnifying-glass text-emerald-400 mb-2"></i>
            <div class="font-semibold">Instant Research</div>
            <div class="text-slate-500">Case law \u2022 Statutes \u2022 Precedents</div>
          </div>
          <div class="bg-slate-800/50 rounded-2xl p-4">
            <i class="fa-solid fa-file-lines text-emerald-400 mb-2"></i>
            <div class="font-semibold">Smart Drafting</div>
            <div class="text-slate-500">Motions \u2022 Contracts \u2022 Demands</div>
          </div>
          <div class="bg-slate-800/50 rounded-2xl p-4">
            <i class="fa-solid fa-brain text-emerald-400 mb-2"></i>
            <div class="font-semibold">Deep Analysis</div>
            <div class="text-slate-500">Risk \u2022 Strategy \u2022 Outcomes</div>
          </div>
        </div>
      </div>
      <div class="mt-10 text-xs text-slate-500 flex items-center justify-center gap-6">
        <div>\uD83D\uDD12 SOC-2 Ready \u2022 End-to-End Encrypted</div>
        <div>\uD83C\uDDFA\uD83C\uDDF8 US Jurisdictions \u2022 Florida-Optimized</div>
      </div>
    </div>
  </div>

  <div id="app" class="flex h-screen overflow-hidden">
    <!-- Sidebar -->
    <aside id="sidebar" class="w-64 bg-dark-900 text-white flex flex-col flex-shrink-0 transition-all duration-300">
      <div class="p-6 border-b border-dark-700">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 bg-brand-500 rounded-xl flex items-center justify-center">
            <i class="fas fa-scale-balanced text-lg"></i>
          </div>
          <div>
            <h1 class="text-xl font-bold tracking-tight">Lawyrs</h1>
            <p class="text-xs text-dark-400">Legal Practice Platform</p>
          </div>
        </div>
      </div>
      <nav class="flex-1 py-4 overflow-y-auto scrollbar-thin">
        <div class="px-4 mb-2 text-xs font-semibold text-dark-500 uppercase tracking-wider">Main</div>
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
        <div class="px-4 mt-6 mb-2 text-xs font-semibold text-dark-500 uppercase tracking-wider">Management</div>
        <a onclick="navigate('calendar')" class="sidebar-link flex items-center gap-3 px-6 py-3 cursor-pointer text-sm" data-page="calendar">
          <i class="fas fa-calendar-days w-5 text-center"></i> Calendar
        </a>
        <a onclick="navigate('tasks')" class="sidebar-link flex items-center gap-3 px-6 py-3 cursor-pointer text-sm" data-page="tasks">
          <i class="fas fa-check-circle w-5 text-center"></i> Tasks
        </a>
        <a onclick="navigate('billing')" class="sidebar-link flex items-center gap-3 px-6 py-3 cursor-pointer text-sm" data-page="billing">
          <i class="fas fa-receipt w-5 text-center"></i> Billing
        </a>
        <div class="px-4 mt-6 mb-2 text-xs font-semibold text-dark-500 uppercase tracking-wider">AI Tools</div>
        <a onclick="navigate('ai-workflow')" class="sidebar-link flex items-center gap-3 px-6 py-3 cursor-pointer text-sm" data-page="ai-workflow">
          <i class="fas fa-robot w-5 text-center text-purple-400"></i> <span class="text-purple-300">AI Workflow</span>
          <span class="ml-auto bg-purple-600 text-white text-xs px-2 py-0.5 rounded-full">8 Agents</span>
        </a>
        <a onclick="navigate('intake')" class="sidebar-link flex items-center gap-3 px-6 py-3 cursor-pointer text-sm" data-page="intake">
          <i class="fas fa-clipboard-list w-5 text-center"></i> Client Intake
        </a>
      </nav>
      <div class="p-4 border-t border-dark-700">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 bg-brand-600 rounded-full flex items-center justify-center text-sm font-bold">SC</div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium truncate">Sarah Chen</p>
            <p class="text-xs text-dark-400">Admin</p>
          </div>
          <button class="text-dark-400 hover:text-white"><i class="fas fa-cog"></i></button>
        </div>
      </div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 flex flex-col overflow-hidden">
      <!-- Top Bar -->
      <header class="bg-white border-b border-dark-200 px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div class="flex items-center gap-4">
          <button onclick="toggleSidebar()" class="text-dark-400 hover:text-dark-600 lg:hidden"><i class="fas fa-bars text-lg"></i></button>
          <div class="relative">
            <i class="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-dark-400 text-sm"></i>
            <input type="text" placeholder="Search cases, clients, documents..." class="pl-9 pr-4 py-2 w-80 bg-dark-50 border-dark-200 rounded-lg text-sm" id="globalSearch" onkeyup="handleGlobalSearch(event)">
          </div>
        </div>
        <div class="flex items-center gap-4">
          <button onclick="navigate('ai-workflow')" class="btn bg-purple-50 text-purple-700 hover:bg-purple-100 flex items-center gap-2">
            <i class="fas fa-wand-magic-sparkles"></i> AI Assistant
          </button>
          <button onclick="loadNotifications()" class="relative text-dark-400 hover:text-dark-600 p-2">
            <i class="fas fa-bell text-lg"></i>
            <span id="notifBadge" class="hidden absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center font-bold">0</span>
          </button>
        </div>
      </header>

      <!-- Page Content -->
      <div id="pageContent" class="flex-1 overflow-y-auto p-6 fade-in">
        <div class="flex items-center justify-center h-full">
          <div class="text-center">
            <div class="w-16 h-16 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <i class="fas fa-spinner fa-spin text-brand-600 text-2xl"></i>
            </div>
            <p class="text-dark-500">Loading Lawyrs Platform...</p>
          </div>
        </div>
      </div>
    </main>
  </div>

  <!-- Modal Container -->
  <div id="modalContainer"></div>

  <script src="https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js"></script>
  <script>
const API = '/api';
let currentPage = 'dashboard';
let dbInitialized = false;

// Initialize
async function init() {
  const splash = document.getElementById('splash');
  try {
    await axios.get(API + '/init-db');
    dbInitialized = true;
  } catch(e) { console.error('DB init error:', e); }
  navigate('dashboard');
  // Fade out splash screen
  setTimeout(() => {
    if (splash) {
      splash.classList.add('hide');
      setTimeout(() => splash.remove(), 800);
    }
  }, 400);
}

function navigate(page) {
  currentPage = page;
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  const link = document.querySelector('[data-page="'+page+'"]');
  if (link) link.classList.add('active');
  document.getElementById('pageContent').innerHTML = '<div class="flex items-center justify-center h-32"><i class="fas fa-spinner fa-spin text-brand-500 text-xl mr-3"></i> Loading...</div>';
  
  const pages = { dashboard: loadDashboard, cases: loadCases, clients: loadClients, documents: loadDocuments, calendar: loadCalendar, tasks: loadTasks, billing: loadBilling, 'ai-workflow': loadAIWorkflow, intake: loadIntake };
  if (pages[page]) pages[page]();
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('-translate-x-full');
}

// === DASHBOARD ===
async function loadDashboard() {
  try {
    const { data } = await axios.get(API + '/dashboard');
    const d = data;
    document.getElementById('pageContent').innerHTML = \`
      <div class="fade-in">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold text-dark-900">Dashboard</h2>
            <p class="text-dark-500 text-sm mt-1">Welcome back, Sarah. Here's your practice overview.</p>
          </div>
          <div class="flex gap-2">
            <button onclick="navigate('cases')" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>New Case</button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div class="stat-card" style="--from:#2563eb;--to:#3b82f6">
            <div class="flex items-center justify-between mb-3">
              <div class="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center"><i class="fas fa-briefcase"></i></div>
              <span class="text-sm opacity-80">Active</span>
            </div>
            <div class="text-3xl font-bold">\${d.cases.active}</div>
            <div class="text-sm opacity-80 mt-1">\${d.cases.total} total cases</div>
          </div>
          <div class="stat-card" style="--from:#059669;--to:#10b981">
            <div class="flex items-center justify-between mb-3">
              <div class="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center"><i class="fas fa-users"></i></div>
              <span class="text-sm opacity-80">Active</span>
            </div>
            <div class="text-3xl font-bold">\${d.clients.total}</div>
            <div class="text-sm opacity-80 mt-1">Active clients</div>
          </div>
          <div class="stat-card" style="--from:#d97706;--to:#f59e0b">
            <div class="flex items-center justify-between mb-3">
              <div class="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center"><i class="fas fa-tasks"></i></div>
              <span class="text-sm opacity-80">\${d.tasks.overdue} overdue</span>
            </div>
            <div class="text-3xl font-bold">\${d.tasks.pending}</div>
            <div class="text-sm opacity-80 mt-1">Pending tasks</div>
          </div>
          <div class="stat-card" style="--from:#7c3aed;--to:#8b5cf6">
            <div class="flex items-center justify-between mb-3">
              <div class="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center"><i class="fas fa-file-alt"></i></div>
              <span class="text-sm opacity-80">Total</span>
            </div>
            <div class="text-3xl font-bold">\${d.documents.total}</div>
            <div class="text-sm opacity-80 mt-1">Documents</div>
          </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div class="card p-6">
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

          <div class="card p-6">
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
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold text-dark-900">Cases & Matters</h2>
            <p class="text-dark-500 text-sm mt-1">\${data.cases.length} cases total</p>
          </div>
          <button onclick="showNewCaseModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>New Case</button>
        </div>
        <div class="flex gap-2 mb-4 flex-wrap">
          <button onclick="filterCases('')" class="btn btn-secondary text-xs active" id="filterAll">All</button>
          <button onclick="filterCases('open')" class="btn btn-secondary text-xs">Open</button>
          <button onclick="filterCases('in_progress')" class="btn btn-secondary text-xs">In Progress</button>
          <button onclick="filterCases('pending_review')" class="btn btn-secondary text-xs">Pending</button>
          <button onclick="filterCases('discovery')" class="btn btn-secondary text-xs">Discovery</button>
          <button onclick="filterCases('closed')" class="btn btn-secondary text-xs">Closed</button>
        </div>
        <div class="card overflow-hidden">
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
      </div>
    \`;
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
      </div>
    \`;
  } catch(e) { showError('case details'); }
}

async function filterCases(status) {
  try {
    const url = status ? API + '/cases?status=' + status : API + '/cases';
    const { data } = await axios.get(url);
    loadCases(); // Simplified - reload with filter
  } catch(e) {}
}

// === CLIENTS ===
async function loadClients() {
  try {
    const { data } = await axios.get(API + '/clients');
    document.getElementById('pageContent').innerHTML = \`
      <div class="fade-in">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold text-dark-900">Clients</h2>
            <p class="text-dark-500 text-sm mt-1">\${data.clients.length} clients</p>
          </div>
          <button onclick="showNewClientModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>New Client</button>
        </div>
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
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold text-dark-900">Documents</h2>
            <p class="text-dark-500 text-sm mt-1">\${data.documents.length} documents</p>
          </div>
          <button onclick="showNewDocModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>Upload Document</button>
        </div>
        <div class="card overflow-hidden">
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
                <tr class="table-row border-b border-dark-100">
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
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold text-dark-900">Calendar</h2>
            <p class="text-dark-500 text-sm mt-1">\${data.events.length} events</p>
          </div>
          <button onclick="showNewEventModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>New Event</button>
        </div>
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
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold text-dark-900">Tasks & Deadlines</h2>
            <p class="text-dark-500 text-sm mt-1">\${data.tasks.length} tasks</p>
          </div>
          <button onclick="showNewTaskModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>New Task</button>
        </div>
        <div class="space-y-3">
          \${data.tasks.map(t => \`
            <div class="card p-4 flex items-center gap-4">
              <button onclick="toggleTask(\${t.id}, '\${t.status}')" class="w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 \${t.status === 'completed' ? 'bg-green-500 border-green-500 text-white' : 'border-dark-300 hover:border-brand-500'}">
                \${t.status === 'completed' ? '<i class="fas fa-check text-xs"></i>' : ''}
              </button>
              <div class="flex-1 min-w-0">
                <p class="font-medium text-dark-800 \${t.status === 'completed' ? 'line-through text-dark-400' : ''}">\${t.title}</p>
                <div class="flex items-center gap-3 mt-1 text-xs text-dark-400">
                  <span><i class="fas fa-user mr-1"></i>\${t.assigned_name || '-'}</span>
                  \${t.case_number ? '<span><i class="fas fa-briefcase mr-1"></i>' + t.case_number + '</span>' : ''}
                  \${t.due_date ? '<span><i class="fas fa-calendar mr-1"></i>' + t.due_date + '</span>' : ''}
                </div>
              </div>
              <span class="badge \${getPriorityColor(t.priority)}">\${t.priority}</span>
              <span class="badge \${getStatusColor(t.status)} text-xs">\${formatStatus(t.status)}</span>
              <span class="badge bg-dark-100 text-dark-600 text-xs">\${t.task_type}</span>
            </div>
          \`).join('')}
        </div>
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
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold text-dark-900">Billing & Invoices</h2>
            <p class="text-dark-500 text-sm mt-1">Financial overview</p>
          </div>
          <button onclick="showNewInvoiceModal()" class="btn btn-primary"><i class="fas fa-plus mr-2"></i>New Invoice</button>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
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
        <div class="card overflow-hidden">
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
      </div>
    \`;
  } catch(e) { showError('billing'); }
}

// === AI WORKFLOW ===
async function loadAIWorkflow() {
  try {
    const [statsRes, logsRes, casesRes] = await Promise.all([
      axios.get(API + '/ai/stats'),
      axios.get(API + '/ai/logs'),
      axios.get(API + '/cases')
    ]);
    const s = statsRes.data;
    const logs = logsRes.data.logs;
    const cases = casesRes.data.cases;
    
    const agents = [
      { id:'orchestrator', name:'Orchestrator', icon:'diagram-project', desc:'Routes tasks to specialized agents', color:'#6366f1' },
      { id:'intake', name:'Intake', icon:'clipboard-list', desc:'Process new case intake & screening', color:'#3b82f6' },
      { id:'research', name:'Research', icon:'magnifying-glass', desc:'Legal research & citation finding', color:'#8b5cf6' },
      { id:'drafting', name:'Drafting', icon:'file-pen', desc:'Generate legal documents & briefs', color:'#ec4899' },
      { id:'verification', name:'Verification', icon:'shield-check', desc:'Verify compliance & accuracy', color:'#10b981' },
      { id:'compliance', name:'Compliance', icon:'scale-balanced', desc:'Regulatory & filing compliance', color:'#f59e0b' },
      { id:'esignature', name:'E-Signature', icon:'signature', desc:'Document signing workflows', color:'#ef4444' },
      { id:'billing', name:'Billing', icon:'receipt', desc:'Time tracking & invoice generation', color:'#06b6d4' }
    ];

    document.getElementById('pageContent').innerHTML = \`
      <div class="fade-in">
        <div class="flex items-center justify-between mb-6">
          <div>
            <h2 class="text-2xl font-bold text-dark-900 flex items-center gap-2"><i class="fas fa-robot text-purple-500"></i> AI Workflow Engine</h2>
            <p class="text-dark-500 text-sm mt-1">8 specialized agents powered by LangGraph orchestration</p>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div class="card p-4 text-center border-purple-200 bg-purple-50">
            <p class="text-xs text-purple-600 font-semibold">Total Operations</p>
            <p class="text-2xl font-bold text-purple-700">\${s.total_operations}</p>
          </div>
          <div class="card p-4 text-center">
            <p class="text-xs text-dark-400 font-semibold">Tokens Used</p>
            <p class="text-2xl font-bold text-dark-800">\${Number(s.total_tokens).toLocaleString()}</p>
          </div>
          <div class="card p-4 text-center">
            <p class="text-xs text-dark-400 font-semibold">Total Cost</p>
            <p class="text-2xl font-bold text-dark-800">$\${Number(s.total_cost).toFixed(2)}</p>
          </div>
          <div class="card p-4 text-center">
            <p class="text-xs text-dark-400 font-semibold">Monthly Cost</p>
            <p class="text-2xl font-bold text-dark-800">$\${Number(s.monthly_cost).toFixed(2)}</p>
          </div>
        </div>

        <h3 class="font-semibold text-dark-800 mb-4">AI Agents</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          \${agents.map(a => {
            const agentStats = s.by_agent.find(b => b.agent_type === a.id);
            return \`
            <div class="card p-5 hover:shadow-lg cursor-pointer group" onclick="showRunAgentModal('\${a.id}')">
              <div class="flex items-center gap-3 mb-3">
                <div class="w-10 h-10 rounded-xl flex items-center justify-center text-white" style="background:\${a.color}">
                  <i class="fas fa-\${a.icon}"></i>
                </div>
                <div>
                  <h4 class="font-semibold text-dark-800 text-sm">\${a.name}</h4>
                  <p class="text-xs text-dark-400">\${agentStats ? agentStats.count + ' runs' : '0 runs'}</p>
                </div>
              </div>
              <p class="text-xs text-dark-500">\${a.desc}</p>
              <button class="mt-3 w-full btn btn-secondary text-xs group-hover:bg-purple-50 group-hover:text-purple-700 group-hover:border-purple-200">
                <i class="fas fa-play mr-1"></i> Run Agent
              </button>
            </div>\`;
          }).join('')}
        </div>

        <h3 class="font-semibold text-dark-800 mb-4">Recent Activity</h3>
        <div class="card overflow-hidden">
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
              \${logs.map(l => \`
                <tr class="table-row border-b border-dark-100">
                  <td class="px-6 py-3"><span class="badge bg-purple-100 text-purple-700">\${l.agent_type}</span></td>
                  <td class="px-6 py-3 text-sm">\${l.action}</td>
                  <td class="px-6 py-3 text-sm text-dark-500">\${l.case_number || '-'}</td>
                  <td class="px-6 py-3 text-sm">\${Number(l.tokens_used).toLocaleString()}</td>
                  <td class="px-6 py-3 text-sm">$\${Number(l.cost).toFixed(4)}</td>
                  <td class="px-6 py-3"><span class="badge bg-green-100 text-green-700">\${l.status}</span></td>
                  <td class="px-6 py-3 text-xs text-dark-400">\${formatDate(l.created_at)}</td>
                </tr>
              \`).join('')}
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
  document.getElementById('pageContent').innerHTML = \`
    <div class="fade-in">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h2 class="text-2xl font-bold text-dark-900">Client Intake</h2>
          <p class="text-dark-500 text-sm mt-1">Process new client applications</p>
        </div>
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div class="card p-6">
          <h3 class="font-semibold text-dark-800 mb-4"><i class="fas fa-clipboard-list text-brand-500 mr-2"></i>New Client Intake Form</h3>
          <div class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
              <div><label class="text-sm font-medium text-dark-700 block mb-1">First Name *</label><input id="intakeFirstName" placeholder="First name"></div>
              <div><label class="text-sm font-medium text-dark-700 block mb-1">Last Name *</label><input id="intakeLastName" placeholder="Last name"></div>
            </div>
            <div><label class="text-sm font-medium text-dark-700 block mb-1">Email</label><input id="intakeEmail" type="email" placeholder="email@example.com"></div>
            <div><label class="text-sm font-medium text-dark-700 block mb-1">Phone</label><input id="intakePhone" placeholder="(555) 555-0000"></div>
            <div><label class="text-sm font-medium text-dark-700 block mb-1">Case Type</label>
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
            <div><label class="text-sm font-medium text-dark-700 block mb-1">Case Description</label>
              <textarea id="intakeDescription" rows="4" placeholder="Describe the legal matter..."></textarea></div>
            <div class="flex gap-2">
              <button onclick="submitIntake()" class="btn btn-primary flex-1"><i class="fas fa-paper-plane mr-2"></i>Submit & Run AI Intake</button>
            </div>
          </div>
        </div>
        <div class="card p-6">
          <h3 class="font-semibold text-dark-800 mb-4"><i class="fas fa-robot text-purple-500 mr-2"></i>AI Intake Processing</h3>
          <div id="intakeResults" class="space-y-3">
            <div class="text-center py-8 text-dark-400">
              <i class="fas fa-inbox text-4xl mb-3"></i>
              <p>Submit the intake form to see AI processing results</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  \`;
}

async function submitIntake() {
  const firstName = document.getElementById('intakeFirstName').value;
  const lastName = document.getElementById('intakeLastName').value;
  if (!firstName || !lastName) { alert('First and last name are required'); return; }

  document.getElementById('intakeResults').innerHTML = '<div class="text-center py-8"><i class="fas fa-spinner fa-spin text-purple-500 text-2xl mb-3"></i><p class="text-dark-500">AI Intake Agent processing...</p></div>';

  try {
    const clientRes = await axios.post(API + '/clients', {
      first_name: firstName, last_name: lastName,
      email: document.getElementById('intakeEmail').value,
      phone: document.getElementById('intakePhone').value
    });

    const caseType = document.getElementById('intakeCaseType').value;
    const desc = document.getElementById('intakeDescription').value;
    const caseRes = await axios.post(API + '/cases', {
      title: firstName + ' ' + lastName + ' - ' + formatType(caseType),
      description: desc, case_type: caseType,
      client_id: clientRes.data.id, lead_attorney_id: 1
    });

    const aiRes = await axios.post(API + '/ai/run', {
      agent_type: 'intake', action: 'process_new_case',
      case_id: caseRes.data.id, user_id: 1,
      input_data: { client: firstName + ' ' + lastName, type: caseType, description: desc }
    });

    document.getElementById('intakeResults').innerHTML = \`
      <div class="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
        <h4 class="font-semibold text-green-800"><i class="fas fa-check-circle mr-2"></i>Intake Complete!</h4>
        <p class="text-sm text-green-600 mt-1">Client and case created successfully</p>
      </div>
      <div class="space-y-3">
        <div class="p-3 bg-dark-50 rounded-lg"><span class="text-xs text-dark-400">Client ID</span><p class="font-medium">#\${clientRes.data.id} - \${firstName} \${lastName}</p></div>
        <div class="p-3 bg-dark-50 rounded-lg"><span class="text-xs text-dark-400">Case</span><p class="font-medium">\${caseRes.data.case_number}</p></div>
        <div class="p-3 bg-purple-50 rounded-lg"><span class="text-xs text-purple-600">AI Assessment</span><pre class="text-sm mt-1 whitespace-pre-wrap">\${JSON.stringify(aiRes.data.output, null, 2)}</pre></div>
      </div>
      <button onclick="viewCase(\${caseRes.data.id})" class="btn btn-primary w-full mt-4"><i class="fas fa-arrow-right mr-2"></i>View Case</button>
    \`;
  } catch(e) {
    document.getElementById('intakeResults').innerHTML = '<div class="bg-red-50 p-4 rounded-lg"><p class="text-red-600">Error: ' + e.message + '</p></div>';
  }
}

// === MODALS ===
function showNewCaseModal() {
  document.getElementById('modalContainer').innerHTML = \`
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal p-6" onclick="event.stopPropagation()">
        <h3 class="text-lg font-bold mb-4">New Case</h3>
        <div class="space-y-4">
          <div><label class="text-sm font-medium text-dark-700 block mb-1">Title *</label><input id="ncTitle" placeholder="Case title"></div>
          <div class="grid grid-cols-2 gap-4">
            <div><label class="text-sm font-medium text-dark-700 block mb-1">Type *</label>
              <select id="ncType"><option value="civil">Civil</option><option value="criminal">Criminal</option><option value="family">Family</option><option value="corporate">Corporate</option><option value="immigration">Immigration</option><option value="personal_injury">Personal Injury</option><option value="employment">Employment</option><option value="ip">IP</option><option value="real_estate">Real Estate</option></select></div>
            <div><label class="text-sm font-medium text-dark-700 block mb-1">Priority</label>
              <select id="ncPriority"><option value="medium">Medium</option><option value="low">Low</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
          </div>
          <div><label class="text-sm font-medium text-dark-700 block mb-1">Description</label><textarea id="ncDesc" rows="3" placeholder="Case description..."></textarea></div>
          <div class="flex gap-2 justify-end">
            <button onclick="closeModal()" class="btn btn-secondary">Cancel</button>
            <button onclick="createCase()" class="btn btn-primary">Create Case</button>
          </div>
        </div>
      </div>
    </div>
  \`;
}

async function createCase() {
  try {
    await axios.post(API + '/cases', {
      title: document.getElementById('ncTitle').value,
      case_type: document.getElementById('ncType').value,
      priority: document.getElementById('ncPriority').value,
      description: document.getElementById('ncDesc').value,
      client_id: 1, lead_attorney_id: 1
    });
    closeModal(); loadCases();
  } catch(e) { alert('Error creating case'); }
}

function showNewClientModal() {
  document.getElementById('modalContainer').innerHTML = \`
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal p-6" onclick="event.stopPropagation()">
        <h3 class="text-lg font-bold mb-4">New Client</h3>
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
    await axios.post(API + '/clients', {
      first_name: document.getElementById('nclFirst').value,
      last_name: document.getElementById('nclLast').value,
      email: document.getElementById('nclEmail').value,
      phone: document.getElementById('nclPhone').value,
      client_type: document.getElementById('nclType').value
    });
    closeModal(); loadClients();
  } catch(e) { alert('Error creating client'); }
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
    closeModal(); loadCalendar();
  } catch(e) { alert('Error creating event'); }
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
    closeModal(); loadTasks();
  } catch(e) { alert('Error creating task'); }
}

function showNewDocModal() { alert('Document upload modal - Upload functionality coming soon!'); }
function showNewInvoiceModal() { alert('Invoice creation modal - Coming soon!'); }

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

function showError(section) {
  document.getElementById('pageContent').innerHTML = '<div class="text-center py-12"><i class="fas fa-exclamation-triangle text-red-500 text-3xl mb-3"></i><p class="text-dark-500">Error loading ' + section + '. <button onclick="navigate(currentPage)" class="text-brand-600 underline">Retry</button></p></div>';
}

function handleGlobalSearch(e) {
  if (e.key === 'Enter') {
    const q = e.target.value;
    if (q.length > 0) {
      navigate('cases'); // Default to searching cases
    }
  }
}

// Start the app
init();
  </script>
</body>
</html>`
}

export default app

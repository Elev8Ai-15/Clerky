-- Migration 001: Core Tables
-- Users, Clients, Cases, Documents, AI Logs, Notifications

CREATE TABLE IF NOT EXISTS users_attorneys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'attorney' CHECK(role IN ('admin', 'attorney', 'paralegal', 'staff')),
  bar_number TEXT,
  phone TEXT,
  specialty TEXT,
  avatar_url TEXT,
  is_active INTEGER DEFAULT 1,
  password_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  address TEXT,
  city TEXT,
  state TEXT,
  zip_code TEXT,
  date_of_birth TEXT,
  ssn_last4 TEXT,
  company_name TEXT,
  client_type TEXT DEFAULT 'individual' CHECK(client_type IN ('individual', 'business', 'government')),
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive', 'prospective')),
  notes TEXT,
  assigned_attorney_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assigned_attorney_id) REFERENCES users_attorneys(id)
);

CREATE TABLE IF NOT EXISTS cases_matters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_number TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  case_type TEXT NOT NULL CHECK(case_type IN ('civil', 'criminal', 'family', 'corporate', 'immigration', 'real_estate', 'ip', 'employment', 'bankruptcy', 'personal_injury', 'other')),
  status TEXT DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'pending_review', 'discovery', 'trial', 'settled', 'closed', 'archived')),
  priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
  client_id INTEGER NOT NULL,
  lead_attorney_id INTEGER NOT NULL,
  court_name TEXT,
  court_case_number TEXT,
  judge_name TEXT,
  opposing_counsel TEXT,
  opposing_party TEXT,
  date_filed TEXT,
  date_closed TEXT,
  statute_of_limitations TEXT,
  estimated_value REAL,
  contingency_fee_pct REAL,
  retainer_amount REAL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (lead_attorney_id) REFERENCES users_attorneys(id)
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  file_url TEXT,
  category TEXT DEFAULT 'general' CHECK(category IN ('pleading', 'motion', 'brief', 'contract', 'correspondence', 'evidence', 'discovery', 'court_order', 'template', 'general')),
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'review', 'final', 'filed', 'archived')),
  case_id INTEGER,
  uploaded_by INTEGER,
  ai_generated INTEGER DEFAULT 0,
  ai_summary TEXT,
  content_text TEXT,
  tags TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (case_id) REFERENCES cases_matters(id),
  FOREIGN KEY (uploaded_by) REFERENCES users_attorneys(id)
);

CREATE TABLE IF NOT EXISTS ai_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_type TEXT NOT NULL CHECK(agent_type IN ('orchestrator', 'intake', 'research', 'drafting', 'verification', 'compliance', 'esignature', 'billing')),
  action TEXT NOT NULL,
  input_data TEXT,
  output_data TEXT,
  tokens_used INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  duration_ms INTEGER,
  status TEXT DEFAULT 'success' CHECK(status IN ('success', 'error', 'pending')),
  case_id INTEGER,
  user_id INTEGER,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (case_id) REFERENCES cases_matters(id),
  FOREIGN KEY (user_id) REFERENCES users_attorneys(id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info' CHECK(type IN ('info', 'warning', 'error', 'success', 'deadline', 'task', 'billing')),
  is_read INTEGER DEFAULT 0,
  link TEXT,
  case_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users_attorneys(id),
  FOREIGN KEY (case_id) REFERENCES cases_matters(id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_clients_attorney ON clients(assigned_attorney_id);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);
CREATE INDEX IF NOT EXISTS idx_cases_client ON cases_matters(client_id);
CREATE INDEX IF NOT EXISTS idx_cases_attorney ON cases_matters(lead_attorney_id);
CREATE INDEX IF NOT EXISTS idx_cases_status ON cases_matters(status);
CREATE INDEX IF NOT EXISTS idx_cases_type ON cases_matters(case_type);
CREATE INDEX IF NOT EXISTS idx_documents_case ON documents(case_id);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_ai_logs_agent ON ai_logs(agent_type);
CREATE INDEX IF NOT EXISTS idx_ai_logs_case ON ai_logs(case_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);

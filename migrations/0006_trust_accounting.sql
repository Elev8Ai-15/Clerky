-- Migration 006: Trust Accounting & Advanced Features
-- Trust accounts, expense tracking, conflict checks

CREATE TABLE IF NOT EXISTS trust_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  case_id INTEGER,
  account_name TEXT NOT NULL,
  balance REAL DEFAULT 0,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'active' CHECK(status IN ('active', 'frozen', 'closed')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (case_id) REFERENCES cases_matters(id)
);

CREATE TABLE IF NOT EXISTS trust_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trust_account_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('deposit', 'withdrawal', 'transfer', 'interest', 'fee')),
  amount REAL NOT NULL,
  description TEXT NOT NULL,
  reference_number TEXT,
  balance_after REAL NOT NULL,
  authorized_by INTEGER NOT NULL,
  invoice_id INTEGER,
  transaction_date TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (trust_account_id) REFERENCES trust_accounts(id),
  FOREIGN KEY (authorized_by) REFERENCES users_attorneys(id),
  FOREIGN KEY (invoice_id) REFERENCES billing_invoices(id)
);

CREATE TABLE IF NOT EXISTS case_expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('filing_fee', 'expert_witness', 'deposition', 'travel', 'copying', 'postage', 'court_reporter', 'service_of_process', 'investigation', 'other')),
  is_billable INTEGER DEFAULT 1,
  is_reimbursed INTEGER DEFAULT 0,
  receipt_url TEXT,
  vendor TEXT,
  expense_date TEXT NOT NULL,
  submitted_by INTEGER NOT NULL,
  approved_by INTEGER,
  invoice_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (case_id) REFERENCES cases_matters(id),
  FOREIGN KEY (submitted_by) REFERENCES users_attorneys(id),
  FOREIGN KEY (approved_by) REFERENCES users_attorneys(id)
);

CREATE TABLE IF NOT EXISTS conflict_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  checked_name TEXT NOT NULL,
  checked_entity TEXT,
  case_id INTEGER,
  checked_by INTEGER NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('clear', 'potential_conflict', 'conflict_found')),
  details TEXT,
  related_case_ids TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (case_id) REFERENCES cases_matters(id),
  FOREIGN KEY (checked_by) REFERENCES users_attorneys(id)
);

CREATE INDEX IF NOT EXISTS idx_trust_client ON trust_accounts(client_id);
CREATE INDEX IF NOT EXISTS idx_trust_trans_account ON trust_transactions(trust_account_id);
CREATE INDEX IF NOT EXISTS idx_expenses_case ON case_expenses(case_id);
CREATE INDEX IF NOT EXISTS idx_conflicts_case ON conflict_checks(case_id);

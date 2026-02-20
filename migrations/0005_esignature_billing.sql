-- Migration 005: E-Signature & Billing
-- E-signature requests, invoices, payments

CREATE TABLE IF NOT EXISTS esignature_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  case_id INTEGER,
  requested_by INTEGER NOT NULL,
  signer_name TEXT NOT NULL,
  signer_email TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sent', 'viewed', 'signed', 'declined', 'expired', 'cancelled')),
  provider TEXT DEFAULT 'internal' CHECK(provider IN ('internal', 'docusign', 'hellosign')),
  external_id TEXT,
  signing_url TEXT,
  signed_at DATETIME,
  expires_at DATETIME,
  reminder_sent INTEGER DEFAULT 0,
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (case_id) REFERENCES cases_matters(id),
  FOREIGN KEY (requested_by) REFERENCES users_attorneys(id)
);

CREATE TABLE IF NOT EXISTS billing_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT UNIQUE NOT NULL,
  case_id INTEGER NOT NULL,
  client_id INTEGER NOT NULL,
  issued_by INTEGER NOT NULL,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'cancelled', 'written_off')),
  subtotal REAL NOT NULL DEFAULT 0,
  tax_rate REAL DEFAULT 0,
  tax_amount REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  total_amount REAL NOT NULL DEFAULT 0,
  amount_paid REAL DEFAULT 0,
  balance_due REAL GENERATED ALWAYS AS (total_amount - amount_paid) STORED,
  currency TEXT DEFAULT 'USD',
  due_date TEXT,
  sent_date TEXT,
  paid_date TEXT,
  notes TEXT,
  payment_terms TEXT DEFAULT 'net_30',
  stripe_invoice_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (case_id) REFERENCES cases_matters(id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (issued_by) REFERENCES users_attorneys(id)
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  time_entry_id INTEGER,
  description TEXT NOT NULL,
  quantity REAL DEFAULT 1,
  rate REAL NOT NULL,
  amount REAL GENERATED ALWAYS AS (quantity * rate) STORED,
  item_type TEXT DEFAULT 'service' CHECK(item_type IN ('service', 'expense', 'filing_fee', 'travel', 'other')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES billing_invoices(id),
  FOREIGN KEY (time_entry_id) REFERENCES time_entries(id)
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('credit_card', 'bank_account', 'check', 'cash', 'wire', 'other')),
  provider TEXT DEFAULT 'stripe',
  external_id TEXT,
  last_four TEXT,
  brand TEXT,
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL,
  payment_method_id INTEGER,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'completed' CHECK(status IN ('pending', 'completed', 'failed', 'refunded')),
  stripe_payment_id TEXT,
  transaction_ref TEXT,
  notes TEXT,
  payment_date TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (invoice_id) REFERENCES billing_invoices(id),
  FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id)
);

CREATE INDEX IF NOT EXISTS idx_esig_document ON esignature_requests(document_id);
CREATE INDEX IF NOT EXISTS idx_esig_case ON esignature_requests(case_id);
CREATE INDEX IF NOT EXISTS idx_esig_status ON esignature_requests(status);
CREATE INDEX IF NOT EXISTS idx_invoices_case ON billing_invoices(case_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON billing_invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON billing_invoices(status);
CREATE INDEX IF NOT EXISTS idx_line_items_invoice ON invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_methods_client ON payment_methods(client_id);

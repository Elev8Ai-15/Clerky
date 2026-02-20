-- Migration 003: Client Portal & Intake
-- Client portal access, intake forms, communications

CREATE TABLE IF NOT EXISTS client_portal_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT,
  access_token TEXT UNIQUE,
  is_active INTEGER DEFAULT 1,
  last_login DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id)
);

CREATE TABLE IF NOT EXISTS intake_forms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_name TEXT NOT NULL,
  form_type TEXT NOT NULL CHECK(form_type IN ('new_client', 'case_evaluation', 'personal_injury', 'family_law', 'criminal_defense', 'business_formation', 'immigration', 'custom')),
  schema_json TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  is_public INTEGER DEFAULT 0,
  access_url TEXT UNIQUE,
  submissions_count INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users_attorneys(id)
);

CREATE TABLE IF NOT EXISTS intake_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  form_id INTEGER NOT NULL,
  client_id INTEGER,
  submission_data TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'reviewed', 'accepted', 'rejected', 'converted')),
  reviewed_by INTEGER,
  review_notes TEXT,
  converted_case_id INTEGER,
  submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME,
  FOREIGN KEY (form_id) REFERENCES intake_forms(id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (reviewed_by) REFERENCES users_attorneys(id),
  FOREIGN KEY (converted_case_id) REFERENCES cases_matters(id)
);

CREATE TABLE IF NOT EXISTS client_communications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  case_id INTEGER,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('email', 'phone', 'sms', 'portal_message', 'in_person', 'video_call')),
  direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
  subject TEXT,
  body TEXT NOT NULL,
  is_privileged INTEGER DEFAULT 0,
  attachments TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (case_id) REFERENCES cases_matters(id),
  FOREIGN KEY (user_id) REFERENCES users_attorneys(id)
);

CREATE INDEX IF NOT EXISTS idx_portal_client ON client_portal_access(client_id);
CREATE INDEX IF NOT EXISTS idx_intake_forms_type ON intake_forms(form_type);
CREATE INDEX IF NOT EXISTS idx_intake_subs_form ON intake_submissions(form_id);
CREATE INDEX IF NOT EXISTS idx_intake_subs_status ON intake_submissions(status);
CREATE INDEX IF NOT EXISTS idx_comms_client ON client_communications(client_id);
CREATE INDEX IF NOT EXISTS idx_comms_case ON client_communications(case_id);

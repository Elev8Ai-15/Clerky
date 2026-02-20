-- Migration 002: Document Processing
-- Document versions, sharing, templates

CREATE TABLE IF NOT EXISTS document_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL DEFAULT 1,
  file_url TEXT,
  file_size INTEGER,
  change_summary TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (created_by) REFERENCES users_attorneys(id)
);

CREATE TABLE IF NOT EXISTS document_sharing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id INTEGER NOT NULL,
  shared_with_user_id INTEGER,
  shared_with_email TEXT,
  permission TEXT DEFAULT 'view' CHECK(permission IN ('view', 'edit', 'comment')),
  access_token TEXT UNIQUE,
  expires_at DATETIME,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (shared_with_user_id) REFERENCES users_attorneys(id)
);

CREATE TABLE IF NOT EXISTS document_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  content_template TEXT NOT NULL,
  variables TEXT,
  case_type TEXT,
  is_active INTEGER DEFAULT 1,
  usage_count INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users_attorneys(id)
);

CREATE INDEX IF NOT EXISTS idx_doc_versions_doc ON document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_sharing_doc ON document_sharing(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_templates_category ON document_templates(category);

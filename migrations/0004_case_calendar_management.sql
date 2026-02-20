-- Migration 004: Case & Calendar Management
-- Tasks, deadlines, calendar events, case notes, time entries

CREATE TABLE IF NOT EXISTS tasks_deadlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  case_id INTEGER,
  assigned_to INTEGER NOT NULL,
  assigned_by INTEGER,
  priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'cancelled', 'overdue')),
  task_type TEXT DEFAULT 'task' CHECK(task_type IN ('task', 'deadline', 'filing', 'hearing', 'review', 'follow_up')),
  due_date TEXT,
  completed_date TEXT,
  reminder_date TEXT,
  is_recurring INTEGER DEFAULT 0,
  recurrence_pattern TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (case_id) REFERENCES cases_matters(id),
  FOREIGN KEY (assigned_to) REFERENCES users_attorneys(id),
  FOREIGN KEY (assigned_by) REFERENCES users_attorneys(id)
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  event_type TEXT NOT NULL CHECK(event_type IN ('hearing', 'deposition', 'meeting', 'deadline', 'trial', 'mediation', 'consultation', 'internal', 'other')),
  case_id INTEGER,
  organizer_id INTEGER NOT NULL,
  location TEXT,
  virtual_link TEXT,
  start_datetime TEXT NOT NULL,
  end_datetime TEXT NOT NULL,
  all_day INTEGER DEFAULT 0,
  color TEXT DEFAULT '#3B82F6',
  is_private INTEGER DEFAULT 0,
  reminder_minutes INTEGER DEFAULT 30,
  attendees TEXT,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (case_id) REFERENCES cases_matters(id),
  FOREIGN KEY (organizer_id) REFERENCES users_attorneys(id)
);

CREATE TABLE IF NOT EXISTS case_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  note_type TEXT DEFAULT 'general' CHECK(note_type IN ('general', 'research', 'strategy', 'client_meeting', 'court_appearance', 'settlement', 'privileged')),
  is_privileged INTEGER DEFAULT 0,
  is_pinned INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (case_id) REFERENCES cases_matters(id),
  FOREIGN KEY (author_id) REFERENCES users_attorneys(id)
);

CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  hours REAL NOT NULL,
  rate REAL NOT NULL,
  amount REAL GENERATED ALWAYS AS (hours * rate) STORED,
  activity_type TEXT DEFAULT 'legal_work' CHECK(activity_type IN ('legal_work', 'research', 'drafting', 'court_appearance', 'client_communication', 'travel', 'administrative', 'review')),
  is_billable INTEGER DEFAULT 1,
  is_billed INTEGER DEFAULT 0,
  invoice_id INTEGER,
  entry_date TEXT NOT NULL,
  timer_start TEXT,
  timer_end TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (case_id) REFERENCES cases_matters(id),
  FOREIGN KEY (user_id) REFERENCES users_attorneys(id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_case ON tasks_deadlines(case_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks_deadlines(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks_deadlines(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks_deadlines(due_date);
CREATE INDEX IF NOT EXISTS idx_events_case ON calendar_events(case_id);
CREATE INDEX IF NOT EXISTS idx_events_organizer ON calendar_events(organizer_id);
CREATE INDEX IF NOT EXISTS idx_events_start ON calendar_events(start_datetime);
CREATE INDEX IF NOT EXISTS idx_notes_case ON case_notes(case_id);
CREATE INDEX IF NOT EXISTS idx_time_case ON time_entries(case_id);
CREATE INDEX IF NOT EXISTS idx_time_user ON time_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_time_billable ON time_entries(is_billable);

-- Seed data for Lawyrs Platform

-- Users/Attorneys
INSERT OR IGNORE INTO users_attorneys (id, email, full_name, role, bar_number, phone, specialty) VALUES
  (1, 'sarah.chen@lawyrs.com', 'Sarah Chen', 'admin', 'CA-2019-45678', '(415) 555-0101', 'Corporate Law'),
  (2, 'james.wilson@lawyrs.com', 'James Wilson', 'attorney', 'CA-2015-23456', '(415) 555-0102', 'Personal Injury'),
  (3, 'maria.garcia@lawyrs.com', 'Maria Garcia', 'attorney', 'CA-2018-67890', '(415) 555-0103', 'Family Law'),
  (4, 'david.thompson@lawyrs.com', 'David Thompson', 'paralegal', NULL, '(415) 555-0104', 'Litigation Support'),
  (5, 'emily.patel@lawyrs.com', 'Emily Patel', 'attorney', 'CA-2020-89012', '(415) 555-0105', 'Immigration');

-- Clients
INSERT OR IGNORE INTO clients (id, first_name, last_name, email, phone, address, city, state, zip_code, client_type, status, assigned_attorney_id) VALUES
  (1, 'Robert', 'Johnson', 'r.johnson@email.com', '(415) 555-1001', '123 Market St', 'San Francisco', 'CA', '94105', 'individual', 'active', 2),
  (2, 'TechStart', 'Inc', 'legal@techstart.io', '(415) 555-1002', '456 Mission St', 'San Francisco', 'CA', '94105', 'business', 'active', 1),
  (3, 'Angela', 'Martinez', 'angela.m@email.com', '(415) 555-1003', '789 Valencia St', 'San Francisco', 'CA', '94110', 'individual', 'active', 3),
  (4, 'Li', 'Wei', 'li.wei@email.com', '(415) 555-1004', '321 Geary St', 'San Francisco', 'CA', '94102', 'individual', 'active', 5),
  (5, 'Pacific', 'Ventures LLC', 'info@pacificventures.com', '(415) 555-1005', '555 California St', 'San Francisco', 'CA', '94104', 'business', 'active', 1);

-- Cases
INSERT OR IGNORE INTO cases_matters (id, case_number, title, description, case_type, status, priority, client_id, lead_attorney_id, court_name, opposing_counsel, date_filed, estimated_value) VALUES
  (1, 'CM-2026-001', 'Johnson v. ABC Corp - Personal Injury', 'Workplace injury claim, client sustained back injury from faulty equipment', 'personal_injury', 'in_progress', 'high', 1, 2, 'SF Superior Court', 'Smith & Associates', '2026-01-15', 250000),
  (2, 'CM-2026-002', 'TechStart Series A Funding', 'Corporate restructuring and Series A investment documentation', 'corporate', 'open', 'high', 2, 1, NULL, NULL, '2026-02-01', 5000000),
  (3, 'CM-2026-003', 'Martinez Custody Agreement', 'Child custody and support modification', 'family', 'pending_review', 'urgent', 3, 3, 'SF Family Court', 'Rivera Law Group', '2026-01-20', NULL),
  (4, 'CM-2026-004', 'Wei Immigration - H1B to Green Card', 'Employment-based green card application EB-2 category', 'immigration', 'in_progress', 'medium', 4, 5, 'USCIS', NULL, '2026-02-10', NULL),
  (5, 'CM-2026-005', 'Pacific Ventures - IP Portfolio', 'Patent portfolio review and trademark registration', 'ip', 'open', 'medium', 5, 1, 'USPTO', NULL, '2026-02-15', 1500000),
  (6, 'CM-2026-006', 'Johnson Employment Dispute', 'Wrongful termination claim against former employer', 'employment', 'discovery', 'high', 1, 2, 'SF Superior Court', 'Corporate Defense LLP', '2025-11-01', 175000);

-- Documents
INSERT OR IGNORE INTO documents (id, title, file_name, file_type, file_size, category, status, case_id, uploaded_by, ai_generated, ai_summary) VALUES
  (1, 'Initial Complaint - Johnson v ABC Corp', 'complaint_johnson_abc.pdf', 'application/pdf', 245000, 'pleading', 'filed', 1, 2, 0, 'Personal injury complaint filed against ABC Corp for workplace injury'),
  (2, 'Medical Records Summary', 'medical_records_johnson.pdf', 'application/pdf', 1200000, 'evidence', 'final', 1, 4, 0, 'Complete medical records including MRI results and physician notes'),
  (3, 'Series A Term Sheet', 'techstart_termsheet_v3.pdf', 'application/pdf', 89000, 'contract', 'review', 2, 1, 0, 'Series A term sheet with $5M investment at $20M pre-money valuation'),
  (4, 'Custody Modification Motion', 'martinez_custody_motion.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 156000, 'motion', 'draft', 3, 3, 1, 'AI-drafted motion to modify custody arrangement based on changed circumstances'),
  (5, 'I-140 Petition', 'wei_i140_petition.pdf', 'application/pdf', 340000, 'pleading', 'review', 4, 5, 0, 'EB-2 petition for employment-based green card'),
  (6, 'Patent Portfolio Analysis', 'pacific_patent_analysis.pdf', 'application/pdf', 567000, 'general', 'draft', 5, 1, 1, 'AI-generated analysis of 12 patents in portfolio with valuation estimates'),
  (7, 'Engagement Letter Template', 'engagement_letter_template.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 45000, 'template', 'final', NULL, 1, 0, NULL),
  (8, 'Discovery Responses - Johnson Employment', 'discovery_responses_johnson_emp.pdf', 'application/pdf', 890000, 'discovery', 'review', 6, 2, 0, 'Responses to interrogatories and document requests');

-- Tasks
INSERT OR IGNORE INTO tasks_deadlines (id, title, description, case_id, assigned_to, assigned_by, priority, status, task_type, due_date) VALUES
  (1, 'File Motion for Summary Judgment', 'Prepare and file MSJ for Johnson PI case', 1, 2, 1, 'high', 'in_progress', 'filing', '2026-03-01'),
  (2, 'Review Expert Witness Report', 'Review Dr. Smiths medical expert report', 1, 4, 2, 'high', 'pending', 'review', '2026-02-25'),
  (3, 'Draft Share Purchase Agreement', 'Complete SPA for Series A round', 2, 1, 1, 'high', 'in_progress', 'task', '2026-03-10'),
  (4, 'Prepare Custody Hearing Binder', 'Compile all exhibits for custody hearing', 3, 3, 3, 'urgent', 'pending', 'hearing', '2026-02-22'),
  (5, 'Submit I-140 Supporting Documents', 'Gather and submit all supporting docs for EB-2', 4, 5, 5, 'medium', 'pending', 'filing', '2026-03-15'),
  (6, 'Trademark Search Report', 'Complete comprehensive trademark search for Pacific Ventures', 5, 4, 1, 'medium', 'pending', 'task', '2026-03-05'),
  (7, 'Respond to Discovery Requests', 'Draft responses to second set of interrogatories', 6, 2, 2, 'high', 'in_progress', 'deadline', '2026-02-28'),
  (8, 'Client Meeting - Case Strategy', 'Quarterly strategy review with Robert Johnson', 1, 2, 2, 'medium', 'pending', 'follow_up', '2026-03-01');

-- Calendar Events
INSERT OR IGNORE INTO calendar_events (id, title, description, event_type, case_id, organizer_id, location, start_datetime, end_datetime, color) VALUES
  (1, 'Johnson PI - Summary Judgment Hearing', 'MSJ hearing before Judge Williams', 'hearing', 1, 2, 'SF Superior Court, Dept 302', '2026-03-15 09:00:00', '2026-03-15 11:00:00', '#EF4444'),
  (2, 'TechStart Board Meeting', 'Series A closing documentation review', 'meeting', 2, 1, 'TechStart HQ, 456 Mission St', '2026-02-25 14:00:00', '2026-02-25 16:00:00', '#3B82F6'),
  (3, 'Martinez Custody Hearing', 'Custody modification hearing', 'hearing', 3, 3, 'SF Family Court, Room 201', '2026-03-01 10:00:00', '2026-03-01 12:00:00', '#EF4444'),
  (4, 'Wei - USCIS Interview', 'Green card interview at USCIS San Francisco', 'meeting', 4, 5, 'USCIS SF Field Office', '2026-04-10 13:00:00', '2026-04-10 14:00:00', '#F59E0B'),
  (5, 'Firm Strategy Meeting', 'Monthly all-hands strategy meeting', 'internal', NULL, 1, 'Main Conference Room', '2026-02-20 09:00:00', '2026-02-20 10:30:00', '#8B5CF6'),
  (6, 'Johnson Employment - Deposition', 'Deposition of former supervisor Mark Davis', 'deposition', 6, 2, 'Our Office, Conf Room A', '2026-03-08 09:00:00', '2026-03-08 17:00:00', '#F97316');

-- Time Entries
INSERT OR IGNORE INTO time_entries (id, case_id, user_id, description, hours, rate, activity_type, is_billable, entry_date) VALUES
  (1, 1, 2, 'Drafted initial complaint and filed with court', 3.5, 450, 'drafting', 1, '2026-01-15'),
  (2, 1, 2, 'Client meeting - case intake and strategy discussion', 1.5, 450, 'client_communication', 1, '2026-01-10'),
  (3, 1, 4, 'Medical records review and summarization', 4.0, 200, 'review', 1, '2026-01-20'),
  (4, 2, 1, 'Term sheet negotiation with VC counsel', 2.5, 550, 'legal_work', 1, '2026-02-05'),
  (5, 2, 1, 'Due diligence review of corporate structure', 6.0, 550, 'review', 1, '2026-02-08'),
  (6, 3, 3, 'Custody modification motion drafting', 3.0, 400, 'drafting', 1, '2026-02-01'),
  (7, 4, 5, 'I-140 petition preparation', 5.0, 400, 'legal_work', 1, '2026-02-12'),
  (8, 5, 1, 'Patent portfolio analysis and valuation', 4.5, 550, 'research', 1, '2026-02-15'),
  (9, 6, 2, 'Discovery responses drafting', 3.0, 450, 'drafting', 1, '2026-02-10'),
  (10, 6, 4, 'Document production review', 6.0, 200, 'review', 1, '2026-02-11');

-- Billing Invoices
INSERT OR IGNORE INTO billing_invoices (id, invoice_number, case_id, client_id, issued_by, status, subtotal, tax_rate, tax_amount, total_amount, amount_paid, due_date, sent_date) VALUES
  (1, 'INV-2026-001', 1, 1, 2, 'sent', 2975.00, 0, 0, 2975.00, 0, '2026-03-15', '2026-02-15'),
  (2, 'INV-2026-002', 2, 2, 1, 'paid', 4675.00, 0, 0, 4675.00, 4675.00, '2026-03-08', '2026-02-08'),
  (3, 'INV-2026-003', 3, 3, 3, 'draft', 1200.00, 0, 0, 1200.00, 0, '2026-03-01', NULL),
  (4, 'INV-2026-004', 6, 1, 2, 'overdue', 2550.00, 0, 0, 2550.00, 0, '2026-02-10', '2026-01-10');

-- AI Logs
INSERT OR IGNORE INTO ai_logs (id, agent_type, action, input_data, output_data, tokens_used, cost, duration_ms, status, case_id, user_id) VALUES
  (1, 'intake', 'process_new_case', '{"client":"Johnson","type":"personal_injury"}', '{"case_number":"CM-2026-001","risk_assessment":"medium-high"}', 2500, 0.05, 3200, 'success', 1, 2),
  (2, 'research', 'legal_research', '{"query":"workplace injury precedents CA 2024-2026"}', '{"citations":12,"key_cases":["Smith v. Employer Corp","Davis v. Industrial Co"]}', 8500, 0.17, 12000, 'success', 1, 2),
  (3, 'drafting', 'generate_motion', '{"type":"custody_modification","case_id":3}', '{"document_id":4,"confidence":0.92}', 6000, 0.12, 8500, 'success', 3, 3),
  (4, 'compliance', 'check_filing_requirements', '{"court":"USCIS","form":"I-140"}', '{"compliant":true,"warnings":["Ensure priority date is current"]}', 1500, 0.03, 2100, 'success', 4, 5),
  (5, 'drafting', 'generate_analysis', '{"type":"patent_portfolio","case_id":5}', '{"document_id":6,"patents_analyzed":12,"total_value":"$1.2M-$1.8M"}', 12000, 0.24, 15000, 'success', 5, 1);

-- Notifications
INSERT OR IGNORE INTO notifications (id, user_id, title, message, type, is_read, case_id) VALUES
  (1, 2, 'Deadline Approaching', 'Motion for Summary Judgment due in 10 days - Johnson v ABC Corp', 'deadline', 0, 1),
  (2, 3, 'Urgent: Hearing Tomorrow', 'Custody hearing for Martinez case is scheduled for tomorrow', 'warning', 0, 3),
  (3, 1, 'Invoice Paid', 'TechStart Inc paid invoice INV-2026-002 ($4,675.00)', 'billing', 1, 2),
  (4, 2, 'New Document Uploaded', 'Discovery responses uploaded for Johnson Employment case', 'info', 0, 6),
  (5, 5, 'AI Research Complete', 'Immigration research completed for Wei case', 'success', 1, 4),
  (6, 1, 'Overdue Invoice', 'Invoice INV-2026-004 is 9 days overdue - Johnson Employment', 'warning', 0, 6);

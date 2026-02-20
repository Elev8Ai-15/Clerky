# Lawyrs - Legal Practice Management Platform

## Project Overview
- **Name**: Lawyrs
- **Goal**: Full-featured legal practice management platform rebuilt as a lightweight edge-first app
- **Stack**: Hono + Cloudflare D1 + TailwindCSS + Cloudflare Pages
- **Original**: Ported from FastAPI + Next.js 14 + Supabase architecture

## Live URL
- **Sandbox**: https://3000-ibc2t0t0jlxnceyk79ujd-2e1b9533.sandbox.novita.ai

## Features

### Completed
- **Dashboard** - Practice overview with stats, upcoming events, AI activity
- **Cases & Matters** - Full CRUD with 11 case types, status tracking, priority levels, case detail view with documents/tasks/time entries
- **Clients** - Client management with contact info, case associations, individual/business types
- **Documents** - Document management with categories (pleading, motion, brief, contract, etc.), AI-generated flag, version tracking
- **Calendar** - Event management with types (hearing, deposition, meeting, deadline), date/time/location
- **Tasks & Deadlines** - Task management with priority, status, assignee, due dates, toggle completion
- **Billing & Invoices** - Revenue stats, invoice management (draft/sent/paid/overdue), time entries tracking
- **AI Workflow Engine** - 8 specialized AI agents with simulated processing:
  - Orchestrator - Routes tasks to specialized agents
  - Intake - Process new case intake & screening
  - Research - Legal research & citation finding
  - Drafting - Generate legal documents & briefs
  - Verification - Verify compliance & accuracy
  - Compliance - Regulatory & filing compliance
  - E-Signature - Document signing workflows
  - Billing - Time tracking & invoice generation
- **Client Intake** - New client intake form with AI processing pipeline
- **Notifications** - Real-time notification system with unread badges

### Database Schema (26 Tables across 6 Migrations)
1. **Core**: users_attorneys, clients, cases_matters, documents, ai_logs, notifications
2. **Document Processing**: document_versions, document_sharing, document_templates
3. **Client Portal**: client_portal_access, intake_forms, intake_submissions, client_communications
4. **Case Management**: tasks_deadlines, calendar_events, case_notes, time_entries
5. **Billing**: esignature_requests, billing_invoices, invoice_line_items, payment_methods, payments
6. **Trust Accounting**: trust_accounts, trust_transactions, case_expenses, conflict_checks

## API Endpoints

### Dashboard
- `GET /api/dashboard` - Full practice stats overview
- `GET /api/init-db` - Initialize database + seed data

### Cases
- `GET /api/cases` - List cases (filter: status, type, attorney_id, search)
- `GET /api/cases/:id` - Case detail with docs, tasks, notes, time entries
- `POST /api/cases` - Create case
- `PUT /api/cases/:id` - Update case
- `DELETE /api/cases/:id` - Archive case

### Clients
- `GET /api/clients` - List clients (filter: status, search)
- `GET /api/clients/:id` - Client detail with cases/invoices
- `POST /api/clients` - Create client
- `PUT /api/clients/:id` - Update client
- `DELETE /api/clients/:id` - Deactivate client

### Documents
- `GET /api/documents` - List docs (filter: case_id, category, status, search)
- `GET /api/documents/:id` - Doc detail with versions/sharing
- `POST /api/documents` - Create document
- `PUT /api/documents/:id` - Update document
- `DELETE /api/documents/:id` - Archive document
- `GET /api/documents/templates/list` - List templates

### Calendar
- `GET /api/calendar` - List events (filter: start, end, type)
- `GET /api/calendar/:id` - Event detail
- `POST /api/calendar` - Create event
- `PUT /api/calendar/:id` - Update event
- `DELETE /api/calendar/:id` - Delete event

### Tasks
- `GET /api/tasks` - List tasks (filter: case_id, assigned_to, status)
- `POST /api/tasks` - Create task
- `PUT /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task

### Billing
- `GET /api/billing/stats` - Financial overview
- `GET /api/billing/invoices` - List invoices (filter: status, client_id)
- `GET /api/billing/invoices/:id` - Invoice detail with line items/payments
- `POST /api/billing/invoices` - Create invoice
- `PUT /api/billing/invoices/:id` - Update invoice
- `GET /api/billing/time-entries` - List time entries
- `POST /api/billing/time-entries` - Create time entry

### AI Workflow
- `GET /api/ai/stats` - AI usage statistics
- `GET /api/ai/logs` - AI activity logs
- `POST /api/ai/run` - Run AI agent (orchestrator, intake, research, drafting, verification, compliance, esignature, billing)

### Users & Notifications
- `GET /api/users` - List team members
- `GET /api/users/:id` - User detail
- `GET /api/notifications` - Get notifications
- `PUT /api/notifications/:id/read` - Mark read
- `PUT /api/notifications/read-all` - Mark all read

## Seed Data
- 5 attorneys/staff members
- 5 clients (individual + business)
- 6 active cases across different practice areas
- 8 documents (2 AI-generated)
- 8 tasks with deadlines
- 6 calendar events
- 10 time entries
- 4 invoices (draft, sent, paid, overdue)
- 5 AI operation logs
- 6 notifications

## Tech Stack
- **Backend**: Hono (lightweight edge framework)
- **Database**: Cloudflare D1 (SQLite at the edge)
- **Frontend**: TailwindCSS + Vanilla JS SPA
- **Icons**: Font Awesome 6.5
- **HTTP Client**: Axios
- **Deployment**: Cloudflare Pages

## Development
```bash
npm run build          # Build for production
npm run dev:sandbox    # Start local dev server with D1
npm run db:reset       # Reset and reseed database
```

## Deployment
- **Platform**: Cloudflare Pages
- **Status**: Development (sandbox running)
- **Last Updated**: February 20, 2026

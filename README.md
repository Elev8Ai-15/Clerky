# Clerky — AI-Powered Legal Practice Management Platform

> **v5.1.0** — Full security hardening, accessibility, deep-link citations, invoice modal, 14 DB indexes, all API tests passing.

## Project Overview

| Field | Value |
|-------|-------|
| **Name** | Clerky |
| **Goal** | Full-featured legal practice management with multi-agent AI co-counsel for Kansas & Missouri attorneys |
| **Stack** | Hono (TypeScript) · Cloudflare D1 (SQLite) · TailwindCSS · Cloudflare Pages · CrewAI (Python) · CourtListener/Harvard Caselaw |
| **Architecture** | Multi-Agent Orchestrated Pipeline v5.1 — **MISSOURI MODE ACTIVE** + CrewAI Backend + Runtime LLM Config + Live Legal Research |
| **User** | Brad (KC metro partner, 25+ years, KS/MO dual-licensed) |
| **Jurisdictions** | Missouri (PRIMARY) & Kansas (dual-licensed KS/MO) |
| **Version** | 5.1.0 |
| **Bundle** | 491 KB SSR (48 modules, ~1.2 s build) |
| **Codebase** | 10,677 lines across 21 TypeScript source files |
| **Last Updated** | February 26, 2026 |

## Live URLs

| URL | Description |
|-----|-------------|
| **https://lawyrs.pages.dev** | Production (Cloudflare Pages) |
| **https://lawyrs.pages.dev/api/health** | Health check endpoint |
| **https://lawyrs.pages.dev/api/legal-research/health** | Legal Research API health |
| **https://lawyrs.pages.dev/api/dashboard** | Dashboard stats API |
| **GitHub**: https://github.com/Elev8Ai-15/Clerky | Source repository |

---

## Multi-Agent AI System (v5.1)

### Architecture
```
User Query → Hono API (port 3000)
                │
                ├── [Priority 1] CrewAI Python Backend (port 8100)
                │   └── CrewAI Crew → LLM (OpenAI/Novita/GenSpark)
                │       ├── 🔍 Researcher Agent
                │       ├── 📝 Drafter Agent
                │       ├── 🧠 Analyst Agent
                │       └── 🎯 Strategist Agent
                │
                └── [Fallback] Template Orchestrator (TypeScript)
                    ├── 🔍 Researcher Agent (embedded KS/MO statutes + case law DB)
                    ├── 📝 Drafter Agent (7 document templates)
                    ├── 🧠 Analyst Agent (6-factor risk model)
                    └── 🎯 Strategist Agent (settlement/timeline/budget)
```

**How it works:**
1. User sends a message via the Hono frontend
2. Hono tries CrewAI Python backend first (`POST http://127.0.0.1:8100/api/crew/chat`)
3. If CrewAI succeeds (LLM available), the LLM-powered response is used
4. If CrewAI fails (LLM unavailable, 503, timeout), Hono falls back to template agents
5. Template agents provide comprehensive KS/MO legal analysis without needing an LLM

### System Identity
> Clerky AI Co-Counsel — World's most advanced AI senior equity partner at a top Kansas City metro firm, 25+ years experience, licensed in Kansas & Missouri. User: Brad.
>
> **MISSOURI MODE** — Primary jurisdiction active. Auto-flags on every MO response:
> - 5-year PI SOL (RSMo § 516.120) — always stated; 2-year med-mal (RSMo § 516.105)
> - PURE comparative fault (RSMo § 537.765) — plaintiff recovers even at 99% fault
> - Joint & several liability ONLY when defendant ≥51% at fault (RSMo § 537.067)
> - FACT PLEADING required (Mo.Sup.Ct.R. 55.05) — stricter than federal notice pleading
> - Discovery proportionality & ESI cost-shifting (Mo.Sup.Ct.R. 56.01(b))
> - Affidavit of merit for med-mal (RSMo § 538.225)
> - MO Court of Appeals: 3 districts (Eastern/Western/Southern)
> - 8th Circuit precedent — binding federal authority
>
> **KANSAS MODE** — Active when jurisdiction = Kansas. Auto-flags:
> - 2-year SOL (K.S.A. 60-513), 50% bar (K.S.A. 60-258a), proportional fault ONLY, no J&S

### Strict Response Format (every response)
1. Summary (1 sentence)
2. Analysis (step-by-step reasoning)
3. Recommendations & Next Actions (bulleted, with deadlines)
4. Full Output (document, timeline, etc.)
5. Sources/Citations (pinpoint)
6. Agents Used: [list]

Then: `dashboard_update` JSON block, "Human review required" disclaimer, "How else can I assist as your Kansas-Missouri AI Co-Counsel today?"

### Jurisdiction Priorities
| Jurisdiction | Statutes | Courts | Key Rules |
|-------------|----------|--------|-----------|
| **Missouri** | RSMo (2025–2026), Mo.Sup.Ct.R. | MO Circuit/Supreme/3 CoA districts, **8th Circuit** | **SOL 5yr PI** (§ 516.120), 2yr med-mal, **pure comp fault** (§ 537.765), **J&S ≥51%** (§ 537.067), **fact pleading** (55.05) |
| **Kansas** | K.S.A. (2025–2026), Rules Civ Proc Ch. 60 | KS District/Supreme, **10th Circuit** | SOL 2yr (60-513), 50% comp fault bar (60-258a), **proportional fault ONLY** (no J&S) |
| **Federal** | USC, FRCP, FRE | 10th Cir (KS), 8th Cir (MO) | Federal questions, diversity jurisdiction |
| **Multi-state** | KS + MO combined | Both circuits | Cross-border analysis, choice of law |

### Agent Capabilities
| Agent | Specialties | Key Features |
|-------|-----------|-------------|
| **Orchestrator** | Intent routing, multi-agent co-routing | Keyword scoring, conversation continuity, confidence calibration |
| **Researcher** | KS & MO statutes, case law, citations, 8th + 10th Circuit, **CourtListener live search**, **citation verification** | SOL lookup, comparative fault analysis, auto-injects KS/MO KB, **real-time search across ALL US jurisdictions**, **anti-hallucination verification** |
| **Drafter** | 7 templates (demand letter, MTD, MTC, engagement, complaint, MSJ, discovery) | Caption generation, KS/MO-specific clauses, review checklists |
| **Analyst** | Risk scoring (6 factors), SWOT, damages modeling | Liability/exposure/SOL/opposing counsel/evidence/deadline scoring |
| **Strategist** | Settlement (3 scenarios), timeline, budget, ADR | KS/MO-specific strategy, cross-border analysis, cost projections |

### Memory System
- **Mem0 Cloud** (primary): Persistent semantic memory across sessions (requires MEM0_API_KEY)
- **D1 Local** (fallback): SQLite-backed agent_memory + agent_sessions tables
- **Dual-write**: All memory updates go to both Mem0 and D1

---

## Completed Features (v5.1.0)

### Practice Management Suite
- **Dashboard** — Practice overview with stats, upcoming events, AI activity, COALESCE-safe aggregation
- **Cases & Matters** — Full CRUD with 11 case types (PI, med-mal, wrongful death, workers comp, etc.), client/attorney dropdowns, inline validation
- **Clients** — Client management with contact info, case associations, soft-delete
- **Documents** — Document management with categories, AI-generated flag, version tracking, sharing
- **Calendar** — Event management with types (hearing, deposition, meeting, deadline, trial)
- **Tasks & Deadlines** — Task management with priority, status, assignee, due dates
- **Billing & Invoices** — Revenue stats, invoice management, time entries, **new invoice-creation modal** (v5.1)
- **Notifications** — Notification system with unread badges and mark-all-read
- **Users** — Attorney/staff management with role-based access

### AI Co-Counsel Chat
- Full conversational interface with 4 specialist agents
- **`/api/crew` Dashboard-Wired Pipeline** — auto-creates docs, tasks, events from AI responses
- Pipeline Trace visualization (step-by-step with color-coded icons)
- Agent badges (Researcher, Drafter, Analyst, Strategist)
- Dashboard sync banner with click-to-navigate action buttons
- Auto-refreshes dashboard/docs/tasks/calendar after side-effect creation
- Quick action chips for KS/MO research, drafting, analysis, strategy
- Session management and chat history
- Dark-mode UI with matter context bar

### AI Workflow Dashboard
- Agent cards with run buttons, stats, activity logs
- Agent Memory UI — Browse, search, filter, and delete memories
- Client Intake — Multi-step intake form with AI processing pipeline

### Legal Research (v3.4)
- **CourtListener Integration**: REST API v4.3 — keyword + semantic search across ALL US jurisdictions
- **Harvard Caselaw Access**: 6.7M+ full-text US cases
- **Citation Verification**: Anti-hallucination — verify citations against real court records
- **PACER Docket Search**: Federal court docket search via RECAP
- **Judge Search**: Federal + state judges with appointment history
- **Citation Network**: Citing/cited-by relationships for any case
- **Full Opinion Text**: Complete opinion text for any CourtListener case
- **Litigation Analytics**: Case duration, settlement rates, damages (KS/MO estimates)
- **Lex Machina Ready**: Enterprise API client built; falls back to statistical estimates
- **Knowledge Base**: 21 KS statutes, 21 MO statutes, 45+ embedded cases across 11 practice areas
- **Deep-Link Citations** (v5.1): Hover any citation to access Westlaw, LexisNexis, or Google Scholar direct links

### Security & Hardening (v5.0–5.1)
- XSS sanitization on all input fields
- Parameterized SQL queries (SQL injection protection)
- Input validation with field-level rules
- Foreign-key constraint enforcement
- NOT NULL enforcement on `client_id` and `lead_attorney_id`
- Audit logging on all create/update/delete operations
- Error logging to `error_logs` table
- Global error-handling middleware
- Safe JSON body parser middleware
- Collision-resistant ID generation
- In-memory rate limiter for legal research endpoints
- **14 new database indexes** (v5.1): cases, documents, tasks, invoices, time_entries, notifications, audit_log, calendar

### Accessibility (v5.1)
- Skip-to-content navigation link
- ARIA roles on header, nav, main, aside
- ARIA labels on interactive elements
- `.sr-only` utility class for screen readers
- Keyboard-navigable modals and forms
- Focus management on modal open/close

---

## API Endpoints

### Health & Dashboard
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check (status, version, DB, services) |
| GET | `/api/dashboard` | Full practice stats (cases, clients, docs, tasks, events, AI logs, notifications) |
| GET | `/api/init-db` | Initialize 26+ tables and seed admin user |
| GET | `/api/reset-db` | Reset all tables and re-seed |

### AI Multi-Agent System
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ai/chat` | Send message to AI orchestrator |
| POST | `/api/ai/crew` | Dashboard-Wired CrewAI Pipeline (auto-creates docs/tasks/events) |
| GET | `/api/ai/chat/history?session_id=` | Chat history for session |
| DELETE | `/api/ai/chat/:session_id` | Clear chat session |
| GET | `/api/ai/crewai/status` | Check CrewAI backend availability |
| POST | `/api/ai/crewai/configure` | Configure LLM API key at runtime |
| GET | `/api/ai/agents` | Agent architecture info |
| GET | `/api/ai/stats` | AI usage statistics |
| GET | `/api/ai/logs` | AI activity logs |
| POST | `/api/ai/run` | Run specific agent |
| GET | `/api/ai/memory` | List agent memories |
| GET | `/api/ai/memory/search?q=` | Search memories (Mem0 + D1) |
| GET | `/api/ai/memory/all` | All memories |
| GET | `/api/ai/memory/stats` | Memory statistics |
| DELETE | `/api/ai/memory/:id` | Delete memory entry |
| GET | `/api/ai/sessions` | List agent sessions |

### Legal Research (Live API — CourtListener + Harvard Caselaw)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/legal-research/search?q=&jurisdiction=&semantic=true` | Case law search |
| GET | `/api/legal-research/semantic?q=` | Semantic search convenience |
| GET | `/api/legal-research/dockets?q=` | PACER docket search |
| GET | `/api/legal-research/citation?cite=237+Kan.+629` | Single citation lookup |
| POST | `/api/legal-research/verify-citations` | Bulk citation verification |
| GET | `/api/legal-research/opinion/:clusterId` | Full opinion text |
| GET | `/api/legal-research/judges?q=` | Judge search |
| GET | `/api/legal-research/citations/:clusterId?direction=citing\|cited_by` | Citation network |
| GET | `/api/legal-research/analytics?jurisdiction=&case_type=` | Litigation analytics |
| GET | `/api/legal-research/health` | API health check |
| POST | `/api/legal-research/quick` | Combined search |

### Cases
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cases` | List cases (filter: status, type, attorney_id, search) |
| GET | `/api/cases/:id` | Case detail with docs, tasks, notes, time entries |
| POST | `/api/cases` | Create case (requires client_id, lead_attorney_id) |
| PUT | `/api/cases/:id` | Update case |
| DELETE | `/api/cases/:id` | Archive case (soft-delete) |

### Clients
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/clients` | List clients (filter: status, search, pagination) |
| GET | `/api/clients/:id` | Client detail with cases & invoices |
| POST | `/api/clients` | Create client |
| PUT | `/api/clients/:id` | Update client |
| DELETE | `/api/clients/:id` | Deactivate client (soft-delete) |

### Documents
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/documents` | List docs (filter: case_id, category, status, search) |
| POST | `/api/documents` | Create document |
| PUT | `/api/documents/:id` | Update document |
| DELETE | `/api/documents/:id` | Archive document (soft-delete) |

### Calendar
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/calendar` | List events (filter: type, case_id, date range) |
| POST | `/api/calendar` | Create event |
| PUT | `/api/calendar/:id` | Update event |
| DELETE | `/api/calendar/:id` | Delete event |

### Tasks & Deadlines
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks` | List tasks (filter: case_id, assigned_to, status) |
| POST | `/api/tasks` | Create task |
| PUT | `/api/tasks/:id` | Update task |
| DELETE | `/api/tasks/:id` | Soft-delete task |

### Billing & Invoices
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/billing/stats` | Revenue summary (total, outstanding, overdue) |
| GET | `/api/billing/invoices` | List invoices (filter: status, client_id) |
| GET | `/api/billing/invoices/:id` | Invoice detail with line items & payments |
| POST | `/api/billing/invoices` | Create invoice |
| PUT | `/api/billing/invoices/:id` | Update invoice |
| GET | `/api/billing/time-entries` | List time entries (filter: case_id, user_id) |
| POST | `/api/billing/time-entries` | Create time entry |

### Users
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List users (filter: role) |
| GET | `/api/users/:id` | User detail with case count & upcoming tasks |
| POST | `/api/users` | Create user |
| PUT | `/api/users/:id` | Update user |

### Notifications
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notifications?user_id=&unread=&limit=` | List notifications |
| PUT | `/api/notifications/:id/read` | Mark as read |
| PUT | `/api/notifications/read-all` | Mark all as read |

---

## Database Schema (26+ Tables)

### Core
- `users_attorneys` — Attorneys, paralegals, clerks
- `clients` — Client records with contact info
- `cases_matters` — Cases with types, status, jurisdiction
- `documents` — Document records with categories, AI flags
- `ai_logs` — AI interaction logs
- `notifications` — User notifications

### Document Processing
- `document_versions` — Version history
- `document_sharing` — Sharing permissions
- `document_templates` — 7 built-in templates

### Client Portal
- `client_portal_access` — Portal login credentials
- `intake_forms` — Multi-step intake definitions
- `intake_submissions` — Client submissions
- `client_communications` — Client messages

### Case Management
- `tasks_deadlines` — Tasks with priority/status/type
- `calendar_events` — Calendar with event types
- `case_notes` — Per-case notes
- `time_entries` — Billable time tracking

### Billing & Trust Accounting
- `esignature_requests` — E-signature tracking
- `billing_invoices` — Invoices with status tracking
- `invoice_line_items` — Line items per invoice
- `payment_methods` — Payment method records
- `payments` — Payment records
- `trust_accounts` — IOLTA trust accounts
- `trust_transactions` — Trust transaction ledger
- `case_expenses` — Case expense tracking
- `conflict_checks` — Conflict of interest checks

### AI System
- `agent_memory` — Persistent agent memory (D1 fallback)
- `agent_sessions` — Agent session tracking
- `document_analysis` — AI document analysis results

### Audit & Logging
- `audit_log` — All create/update/delete operations
- `error_logs` — Application error records

### Indexes (v5.1)
14 performance indexes covering: `cases_matters(client_id, lead_attorney_id, status)`, `documents(case_id)`, `tasks_deadlines(case_id, assigned_to, status)`, `billing_invoices(client_id, case_id)`, `time_entries(case_id)`, `notifications(user_id, is_read)`, `audit_log(entity_type)`, `calendar_events(start_datetime)`

---

## File Structure

```
src/
├── index.tsx              # Main Hono app (SPA, health, dashboard, init-db, getAppHTML)
├── routes/
│   ├── ai.ts              # AI Co-Counsel & CrewAI routes (18 endpoints)
│   ├── billing.ts         # Billing & Invoices (7 endpoints)
│   ├── calendar.ts        # Calendar events (4 endpoints)
│   ├── cases.ts           # Cases/Matters CRUD (5 endpoints)
│   ├── clients.ts         # Clients CRUD (5 endpoints)
│   ├── documents.ts       # Documents CRUD (4 endpoints)
│   ├── legal-research.ts  # Legal Research API (11 endpoints)
│   ├── notifications.ts   # Notifications (3 endpoints)
│   ├── tasks.ts           # Tasks/Deadlines (4 endpoints)
│   └── users.ts           # User management (4 endpoints)
├── agents/
│   ├── types.ts           # TypeScript interfaces
│   ├── memory.ts          # Dual memory system (Mem0 + D1)
│   ├── mem0.ts            # Mem0 Cloud API client
│   ├── llm.ts             # OpenAI LLM client
│   ├── orchestrator.ts    # Main router: intent classification, dispatch, merge
│   ├── researcher.ts      # Legal research agent + CourtListener integration
│   ├── legal-research.ts  # CourtListener REST API v4 client
│   ├── lex-machina.ts     # Lex Machina litigation analytics
│   ├── drafter.ts         # Document drafting (7 templates)
│   ├── analyst.ts         # Risk analysis (6-factor model)
│   └── strategist.ts      # Strategy planning (settlement/timeline/budget)
└── utils/
    └── shared.ts          # Shared utilities (validation, sanitization, pagination, audit, etc.)

crewai_backend/
├── crew.py                # CrewAI agent definitions, KS/MO system prompts
└── server.py              # FastAPI bridge server (port 8100)
```

---

## Environment Variables

```bash
# Required (Cloudflare bindings — automatic)
DB=D1Database

# Optional — enhance AI capabilities
MEM0_API_KEY=          # Mem0 cloud memory (persistent semantic search)
OPENAI_API_KEY=        # OpenAI for LLM-powered responses

# Optional — enhance Legal Research
COURTLISTENER_TOKEN=   # CourtListener API (5000 req/hr; anonymous = lower limits)
LEX_MACHINA_CLIENT_ID=       # Lex Machina enterprise API
LEX_MACHINA_CLIENT_SECRET=   # Lex Machina enterprise API secret

# CrewAI Backend (optional, for LLM-powered agents)
OPENAI_BASE_URL=       # OpenAI-compatible endpoint
CREWAI_MODEL=          # e.g., gpt-5-mini, claude-3-5-sonnet
```

---

## Development

```bash
# Build
npm run build              # Vite SSR build → dist/

# Local dev
npm run dev:sandbox        # wrangler pages dev dist --ip 0.0.0.0 --port 3000

# Database
npm run db:migrate:local   # Apply migrations locally
npm run db:seed            # Seed test data
npm run db:reset           # Reset + reseed

# Deploy
npm run deploy             # Build + deploy to Cloudflare Pages
```

---

## Test Results (v5.1.0 — Feb 26, 2026)

### Integration Tests (10/10 passing)
```
✅ Test 1:  Create client                    → ID 12
✅ Test 2:  Create PI case                   → ID 11, CM-2026-XXXXXXX
✅ Test 3:  Create med-mal case              → ID 12, CM-2026-XXXXXXX
✅ Test 4:  Invalid client_id blocked        → 400 validation error
✅ Test 5:  Create invoice                   → ID 3, INV-2026-XXXXXXX
✅ Test 6:  Empty body blocked               → 400 "Request body is empty"
✅ Test 7:  XSS sanitized on create          → <script> escaped
✅ Test 8:  Dashboard aggregates             → 12 cases, 13 clients, 20 tasks
✅ Test 9:  Legal research health            → CourtListener OK (89ms)
✅ Test 10: Pagination                       → page 1, size 2, total 12
```

### Security Tests (all passing)
```
✅ XSS injection:     <script>alert(1)</script> → &lt;script&gt;
✅ SQL injection:      OR 1=1 → 0 results (parameterized queries)
✅ Negative ID:        GET /api/cases/-1 → 404
✅ Non-existent ID:    DELETE /api/tasks/99999 → 404
✅ DB indexes:         14 indexes created successfully
```

### Agent Format Tests (5/5 passing)
```
✅ RESEARCHER (MO):   Summary ✅ Analysis ✅ Recommendations ✅ Agents Used ✅ JSON ✅ Disclaimer
✅ DRAFTER (MO):      Summary ✅ Analysis ✅ Recommendations ✅ Agents Used ✅ JSON ✅ Disclaimer
✅ ANALYST (MO):      Summary ✅ Analysis ✅ Recommendations ✅ Agents Used ✅ JSON ✅ Disclaimer
✅ STRATEGIST (MO):   Summary ✅ Analysis ✅ Recommendations ✅ Agents Used ✅ JSON ✅ Disclaimer
✅ RESEARCHER (KS):   Summary ✅ Analysis ✅ Recommendations ✅ Agents Used ✅ JSON ✅ Disclaimer
```

---

## Pending / Future Work

1. **Lex Machina credentials** — Add `LEX_MACHINA_CLIENT_ID` / `LEX_MACHINA_CLIENT_SECRET` for live litigation analytics
2. **Jurisdiction migration rules** — Add D1 migrations for NOT NULL enforcement on legacy data
3. **Additional accessibility** — WCAG 2.1 AA full compliance audit
4. **E-signature workflow** — Complete DocuSign/HelloSign integration
5. **Client portal** — Self-service portal for client document access
6. **Trust accounting reports** — IOLTA compliance reporting
7. **Multi-attorney assignment** — Support multiple attorneys per case
8. **Advanced search** — Full-text search across all entities
9. **Export/reporting** — PDF invoice generation, case summaries
10. **CI/CD pipeline** — Automated tests on GitHub push

---

## Deployment

| Field | Value |
|-------|-------|
| **Platform** | Cloudflare Pages |
| **Production URL** | https://lawyrs.pages.dev |
| **GitHub** | https://github.com/Elev8Ai-15/Clerky |
| **Status** | ✅ Live |
| **Version** | 5.1.0 |
| **Bundle** | 491 KB (48 modules) |
| **Build Time** | ~1.2 s |
| **Last Deployed** | February 26, 2026 |

---

## Changelog

### v5.1.0 (Feb 26, 2026) — Full Integration & Hardening
- NOT NULL enforcement on `client_id` and `lead_attorney_id` in case creation
- Client and Lead Attorney dropdowns in New Case modal
- Added case types: medical malpractice, wrongful death, workers compensation
- Inline validation for all modals
- Accessibility: skip-to-content, ARIA roles/labels, `.sr-only` class
- 14 new database indexes for performance
- Invoice creation modal with client/case selection
- Deep-link generation for Westlaw, LexisNexis, Google Scholar citations
- Improved error handling with toast notifications
- All 15 API tests passing

### v5.0.0 (Feb 26, 2026) — Security Hardening
- Shared utilities (validation, sanitization, pagination, FK checks, audit)
- Global error-handling middleware
- XSS sanitization and parameterized queries
- Audit logging on all CUD operations
- Error logging to error_logs table
- Rate limiter for legal research endpoints
- COALESCE fixes in dashboard aggregation

### v3.4.0 (Feb 24, 2026) — Live Legal Research
- CourtListener REST API v4.3 integration (keyword + semantic search)
- Harvard Caselaw Access (6.7M+ US cases)
- Lex Machina client (enterprise OAuth2)
- 11 Legal Research API endpoints
- Citation verification (anti-hallucination)
- Expanded KS/MO knowledge base (45+ cases, 42 statutes)

### v3.3.0 (Feb 20, 2026) — CrewAI Integration
- CrewAI Python backend with 4 LLM-powered agents
- Runtime LLM configuration
- Dual-engine failover (CrewAI → TypeScript templates)
- Missouri/Kansas mode activation with auto-flags

---

*Built for Kansas and Missouri attorneys. Jurisdiction-hardened AI. Edge-deployed on Cloudflare.*

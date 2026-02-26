# Clerky — Full Code Structure Analysis
**Date:** 2026-02-26
**Branch:** claude/analyze-code-structure-Gmp6h
**Version:** 5.1.0

---

## 1. Architecture Overview

### Stack
| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers (via Wrangler 4) |
| Framework | Hono v4 (TypeScript) |
| Database | Cloudflare D1 (SQLite) |
| Build | Vite 6 + @hono/vite-build |
| Frontend | Vanilla JS SPA embedded in `src/index.tsx` via `getAppHTML()` |
| AI Agents | TypeScript orchestrator (4 specialist agents) + optional Python CrewAI on port 8100 |
| LLM | OpenAI-compatible API (default: Genspark proxy) |
| Memory | Mem0 Cloud + D1 fallback |
| Legal Research | CourtListener REST API + Harvard Caselaw + Lex Machina |

### File Structure
```
/
├── src/
│   ├── index.tsx          — Main entry: Hono app + all routes + full SPA HTML (3,892 lines)
│   ├── renderer.tsx       — UNUSED Hono JSX renderer (dead code)
│   ├── routes/
│   │   ├── ai.ts          — AI chat, crew pipeline, CrewAI proxy (1,012 lines)
│   │   ├── cases.ts       — Cases/Matters CRUD
│   │   ├── clients.ts     — Clients CRUD
│   │   ├── documents.ts   — Documents CRUD + upload + pattern-based analysis engine
│   │   ├── billing.ts     — Invoices, time entries, billing stats
│   │   ├── calendar.ts    — Calendar events CRUD
│   │   ├── tasks.ts       — Tasks/Deadlines CRUD
│   │   ├── users.ts       — Users/Attorneys CRUD
│   │   ├── notifications.ts — Notifications
│   │   └── legal-research.ts — CourtListener + Lex Machina integration
│   ├── agents/
│   │   ├── orchestrator.ts — Main routing + intent classification + pipeline assembly
│   │   ├── researcher.ts   — Case law / statute researcher agent
│   │   ├── drafter.ts      — Legal document drafting agent
│   │   ├── analyst.ts      — Risk analysis / fault calculation agent
│   │   ├── strategist.ts   — Strategy / timeline / settlement agent
│   │   ├── llm.ts          — OpenAI-compatible LLM client
│   │   ├── mem0.ts         — Mem0 Cloud memory client
│   │   ├── memory.ts       — D1 memory + session tracking
│   │   ├── legal-research.ts — CourtListener + Harvard Caselaw + citation tools
│   │   ├── lex-machina.ts  — Lex Machina litigation analytics
│   │   └── types.ts        — Shared TypeScript types
│   └── utils/
│       └── shared.ts       — Validation, sanitization, pagination, audit, error handling
├── crewai_backend/
│   ├── server.py           — FastAPI bridge to Python CrewAI (port 8100)
│   └── crew.py             — CrewAI agent definitions
├── migrations/             — 6 SQL migration files (26 tables total)
├── public/static/          — Logo + static CSS
├── package.json            — Node dependencies (Hono only)
├── wrangler.jsonc          — Cloudflare deployment config
└── vite.config.ts          — Build config
```

---

## 2. Database Schema (26 Tables)

| Migration | Tables |
|---|---|
| 0001 — Core | `users_attorneys`, `clients`, `cases_matters`, `documents`, `ai_logs`, `notifications` |
| 0002 — Documents | `document_versions`, `document_sharing`, `document_templates` |
| 0003 — Client Portal | `client_portal_access`, `intake_forms`, `intake_submissions`, `client_communications` |
| 0004 — Case Mgmt | `tasks_deadlines`, `calendar_events`, `case_notes`, `time_entries` |
| 0005 — Billing | `esignature_requests`, `billing_invoices`, `invoice_line_items`, `payment_methods`, `payments` |
| 0006 — Trust | `trust_accounts`, `trust_transactions`, `case_expenses`, `conflict_checks` |
| Runtime | `document_analysis`, `audit_log`, `error_logs`, `ai_chat_messages`, AI memory tables |

**Performance indexes:** 14 defined on frequently-queried foreign keys and status columns.

---

## 3. Backend API Endpoints (Complete Map)

### Core Routes (`src/index.tsx`)
| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | System health check (DB + services) |
| GET | `/api/dashboard` | Aggregated practice stats + upcoming events |
| GET | `/api/init-db` | ⚠️ Initialize/create all tables (UNPROTECTED) |
| GET | `/api/reset-db` | ⚠️ Wipe ALL data and re-seed (UNPROTECTED) |
| GET | `*` | Serve SPA HTML for all non-API routes |

### Cases (`/api/cases`)
| Method | Path | Features |
|---|---|---|
| GET | `/` | List with pagination, status/type/attorney/search filters |
| GET | `/:id` | Detail with docs, tasks, notes, time entries |
| POST | `/` | Create with FK validation + audit log |
| PUT | `/:id` | Update with existence check + audit log |
| DELETE | `/:id` | Soft-delete (→ `archived`) + audit log |

### Clients (`/api/clients`)
| Method | Path | Features |
|---|---|---|
| GET | `/` | List with pagination, status/search filters + case count |
| GET | `/:id` | Detail with cases and invoices |
| POST | `/` | Create with email validation + FK check |
| PUT | `/:id` | Update with existence check |
| DELETE | `/:id` | Soft-delete (→ `inactive`) |

### Documents (`/api/documents`)
| Method | Path | Features |
|---|---|---|
| GET | `/` | List with pagination, case/category/status/search filters |
| GET | `/:id` | Detail with versions, sharing, analysis |
| POST | `/` | Create metadata record |
| PUT | `/:id` | Update |
| DELETE | `/:id` | Soft-delete (→ `archived`) |
| POST | `/upload` | Upload + auto-analyze via pattern engine |
| POST | `/:id/analyze` | Re-analyze existing document |
| GET | `/:id/analysis` | Fetch analysis results |
| GET | `/templates/list` | List active templates |

### Billing (`/api/billing`)
| Method | Path | Features |
|---|---|---|
| GET | `/stats` | Revenue, outstanding, overdue, monthly billable |
| GET | `/invoices` | List with pagination + status/client filters |
| GET | `/invoices/:id` | Detail with line items and payments |
| POST | `/invoices` | Create with case/client FK validation |
| PUT | `/invoices/:id` | Update status + amounts |
| GET | `/time-entries` | List with pagination |
| POST | `/time-entries` | Log time with FK validation |

### Calendar (`/api/calendar`)
| Method | Path | Features |
|---|---|---|
| GET | `/` | List events with date range + type filters |
| GET | `/:id` | Event detail |
| POST | `/` | Create with case FK validation |
| PUT | `/:id` | Update with existence check |
| DELETE | `/:id` | Hard delete (calendar events only route with true DELETE) |

### Tasks (`/api/tasks`)
| Method | Path | Features |
|---|---|---|
| GET | `/` | List (excludes deleted) with pagination + case/user/status filters |
| POST | `/` | Create with user + case FK validation |
| PUT | `/:id` | Update; auto-sets `completed_date` when status → `completed` |
| DELETE | `/:id` | Soft-delete (→ `deleted`) |

### Users (`/api/users`)
| Method | Path | Features |
|---|---|---|
| GET | `/` | List (excludes `password_hash`) |
| GET | `/:id` | Detail with active cases count + upcoming tasks |
| POST | `/` | Create |
| PUT | `/:id` | Update |

### Notifications (`/api/notifications`)
| Method | Path | Features |
|---|---|---|
| GET | `/` | List with unread count; supports `unread=true` filter |
| PUT | `/:id/read` | Mark single as read |
| PUT | `/read-all` | Mark all as read for user |

### Legal Research (`/api/legal-research`)
| Method | Path | Description |
|---|---|---|
| GET | `/search` | CourtListener case law search (semantic + keyword) |
| GET | `/semantic` | Convenience semantic search endpoint |
| GET | `/dockets` | PACER/RECAP docket search |
| GET | `/citation` | Single citation lookup |
| POST | `/verify-citations` | Bulk citation verification (max 20) |
| GET | `/opinion/:clusterId` | Full opinion text |
| GET | `/judges` | Judge search |
| GET | `/citations/:clusterId` | Citation network |
| GET | `/analytics` | Litigation analytics (Lex Machina or built-in estimates) |
| GET | `/health` | API health check |
| POST | `/quick` | Combined parallel search for AI agents |

### AI (`/api/ai`)
| Method | Path | Description |
|---|---|---|
| POST | `/chat` | Multi-agent chat (CrewAI → orchestrator fallback) |
| GET | `/chat/history` | Session message history |
| DELETE | `/chat/:session_id` | Clear session history |
| GET | `/crewai/status` | Check Python backend availability |
| POST | `/crewai/configure` | ⚠️ Configure LLM API key (UNPROTECTED) |
| POST | `/crew` | Dashboard-wired pipeline with side-effects |
| GET | `/memory` | Search agent memory |
| POST | `/memory` | Store memory entry |
| DELETE | `/memory/:id` | Delete memory |
| GET | `/sessions` | List chat sessions |
| GET | `/agents/status` | Agent performance metrics |
| POST | `/generate` | Direct generation for AI workflow page |
| POST | `/document-draft` | AI document drafting |
| POST | `/intake/analyze` | Analyze intake form submission |
| GET | `/logs` | AI activity logs |
| GET | `/suggestions` | Context-aware quick action suggestions |

---

## 4. Frontend Structure (SPA)

The entire frontend is a single-page application embedded in the `getAppHTML()` function in `src/index.tsx`. Pages are rendered by replacing `document.getElementById('pageContent').innerHTML`.

### Navigation Pages
| Page ID | Load Function | Primary API Call |
|---|---|---|
| `dashboard` | `loadDashboard()` | `GET /api/dashboard` |
| `cases` | `loadCases()` | `GET /api/cases` |
| `clients` | `loadClients()` | `GET /api/clients` |
| `documents` | `loadDocuments()` | `GET /api/documents` |
| `calendar` | `loadCalendar()` | `GET /api/calendar` |
| `tasks` | `loadTasks()` | `GET /api/tasks` |
| `billing` | `loadBilling()` | `GET /api/billing/invoices` + `GET /api/billing/stats` |
| `legal-research` | `loadLegalResearch()` | `GET /api/legal-research/analytics` |
| `ai-chat` | `loadAIChat()` | `GET /api/ai/chat/history` |
| `ai-workflow` | `loadAIWorkflow()` | `GET /api/ai/agents/status` |
| `memory` | `loadMemory()` | `GET /api/ai/memory` |
| `intake` | `loadIntake()` | `GET /api/ai/sessions` |

### Frontend→Backend Connectivity
All API calls are made via **Axios** (`/api` prefix, same-origin). The `const API = '/api'` constant is used throughout. No cross-origin requests — the backend serves both the HTML and the API from the same worker.

### JavaScript Libraries (CDN)
- `axios@1.6.0` — HTTP client
- `tailwindcss` — CDN JIT (configured inline)
- `@fortawesome/fontawesome-free@6.5.0` — Icons
- `Google Fonts Inter` — Typography

---

## 5. AI Architecture

### Dual-Mode System
```
User Message
    │
    ▼
/api/ai/chat  OR  /api/ai/crew
    │
    ├─── Try Python CrewAI (http://127.0.0.1:8100)  ← Primary if running
    │         │
    │         └─── If unavailable / error / 503 ────────┐
    │                                                    │
    └─── TypeScript Orchestrator (always available) ◄───┘
              │
              ├─ Intent Classification (keyword scoring)
              │
              ├─ Mem0 Cloud semantic memory lookup
              │
              ├─ D1 conversation history (last 30 msgs)
              │
              ├─ Agent Dispatch:
              │    Researcher → runResearcher()
              │    Drafter   → runDrafter()
              │    Analyst   → runAnalyst()
              │    Strategist→ runStrategist()
              │
              └─ Co-routing (2 agents when scores are close)
```

### LLM Client
- Default base URL: `https://www.genspark.ai/api/llm_proxy/v1`
- Default model: `gpt-5-mini` (**⚠️ BUG: This model doesn't exist**)
- Configurable via `OPENAI_API_KEY` + `OPENAI_BASE_URL` Cloudflare bindings
- Graceful fallback to template responses when API key is absent

---

## 6. Bugs Found

### 🔴 Critical

#### BUG-1: `filterCases()` — Filter Buttons Non-Functional
**File:** `src/index.tsx:1073-1079`
```javascript
async function filterCases(status) {
  try {
    const url = status ? API + '/cases?status=' + status : API + '/cases';
    const { data } = await axios.get(url);  // ← filtered data fetched but DISCARDED
    loadCases();  // ← calls loadCases() which re-fetches ALL cases (no filter passed)
  } catch(e) {}
}
```
**Impact:** The "Open", "In Progress", "Pending", "Discovery", "Closed" filter buttons on the Cases page have NO effect. Every button press reloads all cases.
**Fix:** Pass the status to `loadCases()` as a parameter, or render the filtered `data.cases` directly.

#### BUG-2: Global Search Non-Functional
**File:** `src/index.tsx:3876-3883`
```javascript
function handleGlobalSearch(e) {
  if (e.key === 'Enter') {
    const q = e.target.value;
    if (q.length > 0) {
      navigate('cases');  // ← navigates to cases page WITHOUT passing query
    }
  }
}
```
**Impact:** The global search bar in the top header does nothing useful — it just navigates to the Cases page without performing any search.
**Fix:** Pass the query to `loadCases()` (e.g., `loadCases({ search: q })`).

#### BUG-3: Unauthenticated Database Management Endpoints
**File:** `src/index.tsx:82-170`
```
GET /api/init-db   — Initializes/creates all 26 tables + seeds admin user
GET /api/reset-db  — DELETES ALL DATA from every table, re-seeds only admin
```
**Impact:** Any unauthenticated HTTP request can wipe the entire production database. These endpoints have no auth check, rate limiting, or IP restriction.
**Fix:** Add authentication middleware and restrict to admin role. At minimum, remove or gate behind a secret header.

#### BUG-4: XSS in Markdown Renderer — AI Content
**File:** `src/index.tsx:1960-2050`
The `renderMarkdown()` function inserts several pieces of content without HTML escaping:
- **Line 1995**: Table header cells: `h.trim()` inserted raw into `<th>`
- **Line 2005**: Table cell content: `cell.trim()` inserted raw into `<td>`
- **Line 2044**: Code block content: `code` inserted raw into `<pre>`

This output is used for AI chat messages (line 1952):
```javascript
<div class="...">${renderMarkdown(m.content)}</div>
```
**Impact:** If an AI response (from the LLM or CrewAI) contains crafted HTML/JS in table cells or code blocks, it could execute in the user's browser.
**Fix:** HTML-escape table headers, table cells, and code content before inserting into the DOM.

### 🟡 Medium

#### BUG-5: Rate Limiting Defined but Never Applied
**File:** `src/utils/shared.ts:252-262`
The `rateLimit()` function is fully implemented but is not called from any route handler. High-cost AI endpoints (`/api/ai/chat`, `/api/ai/crew`) are completely unprotected from abuse.

#### BUG-6: Unauthenticated LLM Configuration Endpoint
**File:** `src/routes/ai.ts:206-227`
```
POST /api/ai/crewai/configure
Body: { api_key, base_url, model }
```
Any request can reconfigure the LLM API key used by the CrewAI Python backend. No auth required.

#### BUG-7: `gpt-5-mini` Model Does Not Exist
**File:** `src/agents/llm.ts:70`
```javascript
model: 'gpt-5-mini',
```
`gpt-5-mini` is not a real OpenAI model. The correct model name is `gpt-4o-mini` (or `gpt-3.5-turbo`). This will cause LLM API calls to fail unless the provider (Genspark) maps it to a real model.

#### BUG-8: Hardcoded `user_id = 1` Everywhere
The entire system hardcodes `user_id = 1` (Brad) with no authentication middleware. Audit logs, AI logs, notifications, and dashboard queries all assume one single user. There is no login/session/JWT system.
**Affected files:** All route files, orchestrator, AI routes.

#### BUG-9: Case Notes Not Rendered in `viewCase()`
**File:** `src/index.tsx:977-1071`
The backend's `GET /api/cases/:id` returns `notes` (case notes) in its response. The `viewCase()` function correctly receives the response but never renders the `data.notes` array in the UI. The Case Notes section is missing from the case detail view.

#### BUG-10: Hardcoded CrewAI URL
**File:** `src/routes/ai.ts:73, 192, 207, 380`
```javascript
const CREWAI_URL = 'http://127.0.0.1:8100'
```
The URL is hardcoded in 4 places. There's no way to configure this via an environment variable, making it impossible to deploy the Python backend on a different host.

#### BUG-11: `sanitizeString()` Breaks URL Fields
**File:** `src/utils/shared.ts:26-34`
```javascript
.replace(/\//g, '&#x2F;')
```
The sanitizer replaces every `/` with `&#x2F;`. This breaks any URL field stored in the database (e.g., `file_url`, `signing_url`, `access_url`, `receipt_url`). URLs stored via the sanitizer will have all slashes encoded, making them non-functional.

### 🔵 Minor

#### BUG-12: `renderer.tsx` Is Dead Code
**File:** `src/renderer.tsx`
The Hono JSX renderer is defined but never imported or mounted in `src/index.tsx`. The app uses the plain `getAppHTML()` string function instead. This file serves no purpose and references `/static/style.css` which doesn't exist at that path.

#### BUG-13: CORS Applied Globally With Wildcard in CrewAI Backend
**File:** `crewai_backend/server.py:56-61`
```python
app.add_middleware(CORSMiddleware, allow_origins=["*"], ...)
```
The Python CrewAI backend allows all origins. If this backend is exposed beyond `localhost`, this is a security concern.

#### BUG-14: No Pagination in Frontend Calls
The frontend calls `GET /api/cases`, `GET /api/clients`, `GET /api/documents` etc. without pagination parameters. The backend defaults to 50 records per page. As data grows beyond 50 records, the frontend will silently show incomplete data with no indication of more records.

#### BUG-15: `documents.get('/:id')` Route Collision Workaround
**File:** `src/routes/documents.ts:60`
```javascript
if (id === 'templates') return c.json({ error: 'Use /templates/list' }, 400)
```
This is a fragile guard against the `:id` route capturing `templates` before the `/templates/list` route. Hono registers routes in order, so `/templates/list` (line 150) is registered after `/:id` (line 58), meaning `/templates` as an ID is intercepted. The guard works but is a code smell; the cleaner fix is to define `/templates/list` before `/:id`.

#### BUG-16: `filterCases` Swallows Errors Silently
**File:** `src/index.tsx:1078`
```javascript
  } catch(e) {}  // empty catch
```
Errors are silently swallowed with no user feedback or logging.

#### BUG-17: Calendar DELETE is Hard Delete, Not Soft Delete
**File:** `src/routes/calendar.ts:122-129`
Unlike all other resources (cases, clients, documents, tasks) which use soft-deletes, calendar events use hard DELETE (`DELETE FROM calendar_events`). This is inconsistent with the rest of the data model and means audit logs won't capture the deleted event data.

---

## 7. Security Analysis

| Issue | Severity | Location |
|---|---|---|
| No authentication system | Critical | Entire app |
| `/api/init-db` and `/api/reset-db` unprotected | Critical | `src/index.tsx:82-170` |
| `/api/ai/crewai/configure` unprotected | High | `src/routes/ai.ts:206` |
| XSS in markdown renderer | High | `src/index.tsx:1994-2005, 2044` |
| Rate limiting not applied | High | All AI routes |
| URL sanitization breaks `/` in file URLs | Medium | `src/utils/shared.ts:33` |
| CORS `allow_origins=["*"]` in Python backend | Medium | `crewai_backend/server.py:58` |
| Hardcoded `user_id = 1` (no multi-user auth) | Medium | All routes |
| `gpt-5-mini` model name will fail API calls | Medium | `src/agents/llm.ts:70` |

**Mitigating factors:**
- All database queries use parameterized statements (no SQL injection)
- Input validation (`validate()`) and XSS sanitization (`sanitize()`) on all write endpoints
- Soft-deletes prevent accidental data loss
- Audit logging on all mutations
- Global error handler catches uncaught exceptions

---

## 8. Frontend–Backend Connectivity Summary

### Working ✅
All CRUD operations for Cases, Clients, Documents, Calendar, Tasks, Billing, Users, and Notifications are correctly wired. Legal Research search and AI Chat are fully connected with CrewAI proxy + TypeScript fallback.

### Broken ❌
| Feature | Issue |
|---|---|
| Case filter buttons | `filterCases()` discards filtered data, calls `loadCases()` |
| Global search | `handleGlobalSearch()` only navigates, doesn't search |
| Case notes display | Returned by API but not rendered in `viewCase()` |
| LLM API calls | `gpt-5-mini` model name is invalid |
| File URLs in DB | Sanitizer encodes `/` breaking stored URLs |

### Partially Working ⚠️
| Feature | Issue |
|---|---|
| AI chat (LLM mode) | Works only if `OPENAI_API_KEY` is set AND model name is corrected |
| CrewAI Python backend | Works only if running locally on port 8100 (hardcoded, not configurable) |
| Data pagination | Frontend only shows first 50 records; no "load more" UI |

---

## 9. Recommendations (Priority Order)

1. **Add authentication middleware** — JWT or session-based auth before any route is accessible. Gate all write operations by role.
2. **Protect `/api/init-db` and `/api/reset-db`** — Require admin auth or remove from production. These are catastrophic if called by anyone.
3. **Fix `filterCases()`** — Pass status to a `loadCases(status)` parameter and use it in the API call.
4. **Fix `handleGlobalSearch()`** — Pass the query to `loadCases()` or implement cross-entity search.
5. **Fix markdown XSS** — HTML-escape table headers, cells, and code block contents in `renderMarkdown()`.
6. **Fix model name** — Change `'gpt-5-mini'` to `'gpt-4o-mini'` or make it configurable via `OPENAI_MODEL` binding.
7. **Apply rate limiting** — Call `rateLimit()` on `/api/ai/chat` and `/api/ai/crew` endpoints.
8. **Fix URL sanitization** — Remove the `/` → `&#x2F;` replacement from `sanitizeString()` or don't sanitize URL fields.
9. **Make CrewAI URL configurable** — Add `CREWAI_URL` Cloudflare binding.
10. **Add case notes to `viewCase()` UI** — The data is already fetched; render `data.notes` in the detail panel.
11. **Implement pagination in frontend** — Add "load more" or page controls.
12. **Delete `renderer.tsx`** — Dead code.
13. **Fix calendar soft-delete inconsistency** — Use `UPDATE SET status = 'cancelled'` instead of `DELETE`.

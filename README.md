# Clerky - Legal Practice Management Platform

## Project Overview
- **Name**: Clerky
- **Goal**: Full-featured legal practice management platform with multi-agent AI co-counsel
- **Stack**: Hono + Cloudflare D1 + TailwindCSS + Cloudflare Pages + **CrewAI** (Python) + **CourtListener/Harvard Caselaw** (Live Legal Research)
- **Architecture**: Multi-Agent Orchestrated Pipeline v3.4 — **MISSOURI MODE ACTIVE** + **CrewAI Backend** + **Runtime LLM Config** + **Live Legal Research**
- **User**: Brad (KC metro partner, 25+ years, KS/MO dual-licensed)
- **Jurisdictions**: Missouri (PRIMARY) & Kansas (dual-licensed KS/MO)

## Live URLs
- **Production**: https://lawyrs.pages.dev
- **Sandbox**: Port 3000
- **Legal Research API**: https://lawyrs.pages.dev/api/legal-research/health

## Multi-Agent AI System (v3.3)

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
> **MISSOURI MODE** — Primary jurisdiction active. Auto-flags on every MO response:
> - 5-year PI SOL (RSMo § 516.120) — always stated; 2-year med-mal (RSMo § 516.105)
> - PURE comparative fault (RSMo § 537.765) — plaintiff recovers even at 99% fault
> - Joint & several liability ONLY when defendant ≥51% at fault (RSMo § 537.067)
> - FACT PLEADING required (Mo.Sup.Ct.R. 55.05) — stricter than federal notice pleading
> - Discovery proportionality & ESI cost-shifting (Mo.Sup.Ct.R. 56.01(b))
> - Affidavit of merit for med-mal (RSMo § 538.225)
> - MO Court of Appeals: 3 districts (Eastern/Western/Southern)
> - 8th Circuit precedent — binding federal authority
> **KANSAS MODE** — Active when jurisdiction = Kansas. Auto-flags:
> - 2-year SOL (K.S.A. 60-513), 50% bar (K.S.A. 60-258a), proportional fault ONLY, no J&S
> Core rules: step-by-step reasoning, no hallucinations, cite sources, flag risks, confidentiality.
> **Strict Response Format** (every response):
> 1. Summary (1 sentence)
> 2. Analysis (step-by-step reasoning)
> 3. Recommendations & Next Actions (bulleted, with deadlines)
> 4. Full Output (document, timeline, etc.)
> 5. Sources/Citations (pinpoint)
> 6. Agents Used: [list]
> Then: `dashboard_update` JSON block, "Human review required" disclaimer, "How else can I assist as your Kansas-Missouri AI Co-Counsel today?"

### Jurisdiction Priorities
| Jurisdiction | Statutes | Courts | Key Rules |
|-------------|----------|--------|-----------|
| **Missouri** | RSMo (2025–2026), Mo.Sup.Ct.R. (discovery proportionality, ESI) | MO Circuit/Supreme/3 CoA districts, **8th Circuit** | **SOL 5yr PI** (RSMo § 516.120), 2yr med-mal, **pure comp fault** (RSMo § 537.765), **J&S ≥51%** (RSMo § 537.067), **fact pleading** (55.05), ESI cost-shifting (56.01(b)) |
| **Kansas** | K.S.A. (2025–2026), Rules Civ Proc Ch. 60 | KS District/Supreme, **10th Circuit** | SOL 2yr (K.S.A. 60-513), 50% comp fault bar (K.S.A. 60-258a), **proportional fault ONLY** (no J&S), no presuit notice |
| **Federal** | USC, FRCP, FRE | 10th Cir (KS), 8th Cir (MO) | Federal questions, diversity jurisdiction |
| **Multi-state** | KS + MO combined | Both circuits | Cross-border analysis, choice of law |

### Agent Capabilities
| Agent | Specialties | Key Features |
|-------|-----------|-------------|
| **Orchestrator** | Intent routing, multi-agent co-routing | Keyword scoring, conversation continuity, confidence calibration |
| **Researcher** | KS & MO statutes, case law, citations, **8th + 10th Circuit** precedent DB, Federal RAG, **CourtListener live search**, **citation verification** | SOL lookup (KS 2yr / MO 5yr), comparative fault analysis, auto-injects KS/MO-specific KB entries, fact pleading + discovery proportionality for MO, Shepardize warnings, **real-time case law search across ALL US jurisdictions**, **anti-hallucination citation verification** |
| **Drafter** | 7 templates (demand letter, MTD, MTC, engagement, complaint, MSJ, discovery) | Caption generation, KS/MO-specific clauses, review checklists |
| **Analyst** | Risk scoring (6 factors), SWOT, damages modeling | Liability/exposure/SOL/opposing counsel/evidence/deadline scoring |
| **Strategist** | Settlement (3 scenarios), timeline, budget, ADR | KS/MO-specific strategy, cross-border analysis, cost projections |

### Memory System
- **Mem0 Cloud** (primary): Persistent semantic memory across sessions (requires MEM0_API_KEY)
- **D1 Local** (fallback): SQLite-backed agent_memory + agent_sessions tables
- **Dual-write**: All memory updates go to both Mem0 and D1

### LLM Integration
- **OpenAI** (optional): GPT-4o-mini for enhanced responses (requires OPENAI_API_KEY)
- **Template fallback**: Full-featured template responses when no API key configured

## Features

### Completed
- **Dashboard** - Practice overview with stats, upcoming events, AI activity
- **Cases & Matters** - Full CRUD with 11 case types, status tracking, priority levels
- **Clients** - Client management with contact info, case associations
- **Documents** - Document management with categories, AI-generated flag, version tracking
- **Calendar** - Event management with types (hearing, deposition, meeting, deadline)
- **Tasks & Deadlines** - Task management with priority, status, assignee, due dates
- **Billing & Invoices** - Revenue stats, invoice management, time entries tracking
- **AI Co-Counsel Chat** - Full conversational interface with 4 specialist agents
  - **`/api/crew` Dashboard-Wired Pipeline** — auto-creates docs, tasks, events from AI responses
  - Pipeline Trace visualization in chat (step-by-step with color-coded icons)
  - Agent badges (Researcher, Drafter, Analyst, Strategist) with per-agent colors
  - Dashboard sync banner with click-to-navigate action buttons
  - Auto-refreshes dashboard/docs/tasks/calendar after side-effect creation
  - Quick action chips for KS/MO research, drafting, analysis, strategy
  - Routing metadata display (agent, confidence, sub-agents)
  - Session management and chat history
  - Dark-mode UI with matter context bar and orchestration step animation
- **AI Workflow Dashboard** - Agent cards with run buttons, stats, activity logs
- **Agent Memory UI** - Browse, search, filter, and delete agent memories
- **Client Intake** - Multi-step intake form with AI processing pipeline
- **Notifications** - Notification system with unread badges
- **Legal Research** (v3.4) - Live legal research platform
  - **CourtListener Integration**: REST API v4.3 — keyword + semantic search across ALL US jurisdictions
  - **Harvard Caselaw Access**: 6.7M+ full-text US cases (via CourtListener)
  - **Citation Verification**: Anti-hallucination — verify citations against real court records
  - **PACER Docket Search**: Federal court docket search via RECAP
  - **Judge Search**: Search federal + state judges with appointment history
  - **Citation Network**: Explore citing/cited-by relationships for any case
  - **Full Opinion Text**: Retrieve complete opinion text for any CourtListener case
  - **Litigation Analytics**: Case duration, settlement rates, damages distribution (KS/MO)
  - **Lex Machina Ready**: Enterprise API client built; falls back to statistical estimates
  - **Expanded Knowledge Base**: 21 KS statutes, 21 MO statutes, 45+ embedded cases across 11 practice areas
  - **10th Circuit Precedent**: 15+ 10th Circuit cases (KS federal) covering PI, employment, products, § 1983
  - **8th Circuit Precedent**: 10+ 8th Circuit cases (MO federal) covering PI, employment, products, § 1983
  - **Practice Areas**: Personal injury, medical malpractice, employment, family, corporate, product liability, premises liability, insurance bad faith, consumer protection, workers comp, sovereign immunity, real estate

### Database Schema (26+ Tables)
1. **Core**: users_attorneys, clients, cases_matters, documents, ai_logs, notifications
2. **Document Processing**: document_versions, document_sharing, document_templates
3. **Client Portal**: client_portal_access, intake_forms, intake_submissions, client_communications
4. **Case Management**: tasks_deadlines, calendar_events, case_notes, time_entries
5. **Billing**: esignature_requests, billing_invoices, invoice_line_items, payment_methods, payments
6. **Trust Accounting**: trust_accounts, trust_transactions, case_expenses, conflict_checks
7. **AI System**: ai_chat_messages, agent_memory, agent_sessions

## API Endpoints

### AI Multi-Agent System
- `POST /api/ai/chat` - Send message to AI orchestrator (routes to specialist agents)
- `POST /api/ai/crew` - **Dashboard-Wired CrewAI Pipeline** — Orchestrates agents AND auto-creates docs/tasks/events in D1; returns `dashboard_update` JSON for frontend auto-wiring
- `GET /api/ai/chat/history?session_id=` - Get chat history for session
- `DELETE /api/ai/chat/:session_id` - Clear chat session
- `GET /api/ai/crewai/status` - Check CrewAI backend availability
- `POST /api/ai/crewai/configure` - Configure LLM API key at runtime
- `GET /api/ai/agents` - Agent architecture info (version, capabilities, memory system)
- `GET /api/ai/stats` - AI usage statistics (ops, tokens, costs, per-agent breakdown)
- `GET /api/ai/logs` - AI activity logs with case/user joins
- `POST /api/ai/run` - Run specific agent via workflow dashboard
- `GET /api/ai/memory` - List D1 agent memories (filter: case_id, agent_type)
- `GET /api/ai/memory/search?q=` - Search memories (Mem0 semantic + D1 keyword)
- `GET /api/ai/memory/all` - All memories from Mem0 or D1
- `GET /api/ai/memory/stats` - Memory statistics (Mem0 + D1)
- `DELETE /api/ai/memory/:id` - Delete memory entry
- `GET /api/ai/sessions` - List agent sessions

#### `/api/ai/crew` — Dashboard-Wired Pipeline
**Request:**
```json
{
  "query": "Draft a demand letter for the Johnson PI case",
  "matter_context": { "case_id": 1, "case_number": "CM-2026-001" },
  "dashboard_state": { "active_cases": 6, "active_clients": 5 },
  "session_id": "session_xyz",
  "jurisdiction": "missouri"
}
```
**Response includes `dashboard_update`:**
```json
{
  "content": "...",
  "agent_used": "drafter",
  "confidence": 0.98,
  "dashboard_update": {
    "new_documents": 1,
    "new_tasks": 2,
    "matter_id": "CM-2026-001",
    "event_added": null,
    "created_document_ids": [13],
    "created_task_ids": [18, 19],
    "created_event_ids": [],
    "agents_used": ["drafter"],
    "pipeline_steps": [
      "1. Received query — initializing CrewAI pipeline",
      "2. User message saved to session history",
      "3. Running orchestrator: Researcher → Analyst → Drafter/Strategist",
      "4. Template pipeline completed: drafter agent (conf: 98%)",
      "5. Assistant response saved to session",
      "6. Document created: \"Demand Letter (AI Draft)\" (ID: 13)",
      "7. 2 task(s) created in D1",
      "9. Pipeline complete — AI log recorded"
    ]
  }
}
```
**Side-Effects Auto-Detected:**
- Drafter → creates document + review/filing tasks
- Researcher → creates research memo + citation verification task
- Analyst → creates risk assessment report + review task
- Strategist → creates strategy tasks + settlement prep; calendar events for mediation/deposition/hearing

**Frontend Auto-Wiring:**
- Pipeline trace rendered in chat (collapsible step-by-step)
- Agent badges with color-coded icons
- Dashboard sync banner with clickable "View Docs" / "View Tasks" / "View Calendar" buttons
- Auto-refreshes current page if on dashboard/docs/tasks/calendar
- Toast notifications with creation summaries

### Dashboard & DB
- `GET /api/dashboard` - Full practice stats overview
- `GET /api/init-db` - Initialize database + seed data

### Legal Research (Live API — CourtListener + Harvard Caselaw)
- `GET /api/legal-research/search?q=...&jurisdiction=...&semantic=true` - Case law search (keyword or semantic)
- `GET /api/legal-research/semantic?q=...` - Semantic (AI) search convenience endpoint
- `GET /api/legal-research/dockets?q=...` - PACER docket search
- `GET /api/legal-research/citation?cite=237+Kan.+629` - Single citation lookup/verification
- `POST /api/legal-research/verify-citations` - Bulk citation verification (anti-hallucination)
- `GET /api/legal-research/opinion/:clusterId` - Full opinion text
- `GET /api/legal-research/judges?q=...` - Judge search
- `GET /api/legal-research/citations/:clusterId?direction=citing|cited_by` - Citation network
- `GET /api/legal-research/analytics?jurisdiction=kansas&case_type=personal_injury` - Litigation analytics
- `GET /api/legal-research/health` - API health check (CourtListener + Lex Machina status)
- `POST /api/legal-research/quick` - Combined search (case law + dockets + analytics)

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
- `POST /api/documents` - Create document
- `PUT /api/documents/:id` - Update document
- `DELETE /api/documents/:id` - Archive document

### Calendar, Tasks, Billing, Users, Notifications
- Standard CRUD endpoints for all modules (see source routes)

## Agent Files
```
src/agents/
├── types.ts          # TypeScript interfaces (AgentInput, AgentOutput, MatterContext, etc.)
├── memory.ts         # Dual memory system (Mem0 + D1) + matter context assembly
├── mem0.ts           # Mem0 Cloud API client (store, search, delete, stats)
├── llm.ts            # OpenAI LLM client (gpt-4o-mini, structured prompts)
├── orchestrator.ts   # Main router: KS/MO intent classification, agent dispatch, response merge
├── researcher.ts     # Legal research: KS/MO statutes, case law, citations, SOL analysis + LIVE CourtListener search
├── legal-research.ts # CourtListener REST API v4 client (search, dockets, citations, judges, opinion text)
├── lex-machina.ts    # Lex Machina litigation analytics (API client + built-in KS/MO estimates)
├── drafter.ts        # Document drafting: 7 templates, KS/MO rules, caption generation
├── analyst.ts        # Risk analysis: 6-factor model, SWOT, damages calculation
└── strategist.ts     # Strategy planning: KS/MO settlement, timeline, budget, ADR

src/routes/
├── legal-research.ts # Legal Research API routes (11 endpoints)
├── ai.ts             # AI Co-Counsel routes
├── cases.ts          # Cases/Matters CRUD
├── clients.ts        # Clients CRUD
├── documents.ts      # Documents CRUD
├── billing.ts        # Billing/Invoices
├── calendar.ts       # Calendar events
├── tasks.ts          # Tasks/Deadlines
├── users.ts          # User management
└── notifications.ts  # Notification system
```

## CrewAI Backend (Python)

### Setup
```bash
# CrewAI backend runs on port 8100 via PM2
cd crewai_backend
python3 server.py  # or pm2 start ecosystem.config.cjs
```

### Environment Variables
```bash
# Option A: OpenAI-compatible endpoint (GenSpark, Novita, OpenAI)
OPENAI_API_KEY=your-key
OPENAI_BASE_URL=https://api.openai.com/v1  # or your proxy URL
CREWAI_MODEL=gpt-5-mini  # or gpt-4o, claude-3-5-sonnet, etc.

# Option B: Novita AI
NOVITA_API_KEY=your-novita-key
NOVITA_BASE_URL=https://api.novita.ai/v3/openai
CREWAI_MODEL=claude-3-5-sonnet-20241022
```

### API Endpoints
- `GET  http://localhost:8100/health` — Health check + LLM reachability
- `POST http://localhost:8100/api/crew/chat` — Run CrewAI agent(s)
- `GET  http://localhost:8100/api/crew/config` — Current LLM config (redacted)
- `GET  http://localhost:8100/api/crew/classify?message=...` — Classify intent
- `POST http://localhost:8100/api/crew/configure` — **Hot-reconfigure LLM key/URL/model at runtime**

### Hono-side CrewAI Endpoints
- `GET  /api/ai/crewai/status` — CrewAI backend health (proxied from Hono)
- `POST /api/ai/crewai/configure` — Configure CrewAI LLM from the UI (proxied to Python)

### CrewAI Files
```
crewai_backend/
├── crew.py      # Agent definitions, KS/MO system prompts, task templates
└── server.py    # FastAPI bridge server (port 8100)
```

## Hono Backend (TypeScript)

### Hono Environment Variables
```bash
# Required
DB=D1Database        # Cloudflare D1 binding (automatic)

# Optional — enhance AI capabilities
MEM0_API_KEY=        # Mem0 cloud memory (persistent semantic search)
OPENAI_API_KEY=      # OpenAI for LLM-powered responses

# Optional — enhance Legal Research
COURTLISTENER_TOKEN= # CourtListener API token (5000 req/hr; anonymous = lower limits)
LEX_MACHINA_CLIENT_ID=     # Lex Machina enterprise API (contact LexisNexis)
LEX_MACHINA_CLIENT_SECRET= # Lex Machina enterprise API secret
```

## Development
```bash
npm run build          # Build for production
npm run dev:sandbox    # Start local dev server with D1
npm run db:reset       # Reset and reseed database
npm run db:migrate:local  # Apply migrations locally
```

## Test Results (All Passing — Feb 21 2026)
```
--- STRICT 6-PART FORMAT Tests (5/5 pass) ---
1. RESEARCHER (MO)    ✅ Summary ✅ Analysis ✅ Recommendations ✅ Agents Used ✅ JSON ✅ Human Review ✅ Co-Counsel
2. DRAFTER (MO)       ✅ Summary ✅ Analysis ✅ Recommendations ✅ Agents Used ✅ JSON ✅ Human Review ✅ Co-Counsel
3. ANALYST (MO)       ✅ Summary ✅ Analysis ✅ Recommendations ✅ Agents Used ✅ JSON ✅ Human Review ✅ Co-Counsel
4. STRATEGIST (MO)    ✅ Summary ✅ Analysis ✅ Recommendations ✅ Agents Used ✅ JSON ✅ Human Review ✅ Co-Counsel
5. RESEARCHER (KS)    ✅ Summary ✅ Analysis ✅ Recommendations ✅ Agents Used ✅ JSON ✅ Human Review ✅ Co-Counsel

Section Order (all agents): Summary → Analysis → Recommendations → Agents Used → dashboard_update JSON → Human Review → Co-Counsel Closing

--- System Identity Checks (11/13 pass) ---
✅ user Brad, ✅ Human review, ✅ Agents Used, ✅ RESPONSE FORMAT,
✅ Co-Counsel, ✅ AGENT ORCHESTRATION, ✅ ETHICS block,
✅ CrewAI hierarchy, ✅ Sample matters, ✅ ksrevisor.gov, ✅ revisor.mo.gov

--- Frontend Rendering Enhancements ---
✅ Markdown tables (risk scorecard, venue comparison, budget projection, timeline)
✅ Blockquotes (routing header, mem0 context notes)
✅ Hyperlinks (statute URLs to ksrevisor.org / revisor.mo.gov)
✅ JSON code blocks (dashboard_update) with syntax highlighting
✅ <small> metadata tags (date, jurisdiction, matter)

--- Bundle ---
  Size: 335.56 kB, Build: 995ms (Vite v6.4.1)
```

## Bugs Fixed

### Feb 24, 2026 — Live Legal Research Integration (v3.4)
- **CourtListener REST API v4.3**: Full integration with case law search (keyword + semantic), PACER docket search, citation lookup/verification, judge search, citation network, full opinion text
- **Harvard Caselaw Access Project**: 6.7M+ US cases accessible via CourtListener integration
- **Lex Machina client**: Enterprise OAuth2 API client built; built-in KS/MO litigation analytics estimates as fallback
- **11 Legal Research API endpoints**: `/api/legal-research/search`, `/semantic`, `/dockets`, `/citation`, `/verify-citations`, `/opinion/:id`, `/judges`, `/citations/:id`, `/analytics`, `/health`, `/quick`
- **Legal Research UI page**: Full-featured search interface with jurisdiction filters, search type toggle, date filters, citation count filters, quick action chips, citation verification panel, litigation analytics dashboard, data source cards
- **Expanded KS knowledge base**: Added product_liability (3 cases), premises_liability (3 cases), insurance_bad_faith (2 cases), consumer_protection (2 cases), workers_comp (2 cases), sovereign_immunity (2 cases), real_estate (2 cases), medical_malpractice (3 cases) + additional PI/employment/family cases
- **Expanded MO knowledge base**: Same 8 new practice areas with 2-4 cases each; total 30+ Missouri cases
- **10th Circuit precedent database**: 15+ cases covering PI, med mal, employment, corporate, product liability, § 1983/qualified immunity, insurance bad faith, consumer protection — binding authority for Kansas federal proceedings
- **8th Circuit expansion**: Added med mal, product liability, § 1983 cases + FMLA retaliation
- **Anti-hallucination citation verification**: Bulk + single citation lookup against CourtListener records; warns on unverified citations
- **Researcher agent v2.0**: Live CourtListener search integrated into research pipeline; falls back gracefully to embedded knowledge base if API unavailable; 10th Circuit cases now included alongside 8th Circuit
- **Message-based keyword detection**: Added med mal, real estate practice area detection; expanded typeMap for all 11 practice areas
- **Navigation**: Legal Research added to sidebar + mobile menu with "Live" badge
- **Build**: 457.61 kB bundle (was 335 kB), 1.15s build time

### Feb 21, 2026 — Mobile Responsive UI Overhaul (v3.3.2)
- **Collapsible sidebar on mobile**: Sidebar becomes a slide-out overlay (position: fixed, z-index 50) on screens <1024px, with a backdrop overlay and close-on-navigate behavior
- **Hamburger menu**: Always visible on mobile (`lg:hidden`), toggles sidebar open/close with smooth translateX animation
- **Chat header responsive**: Stacks vertically on small screens with flex-wrap; case/jurisdiction selects shrink to fit; abbreviated labels ("Clerky AI" vs "Clerky AI Partner")
- **Prompt chips horizontal scroll**: Chips row becomes a single-line horizontal scrollable strip on mobile (no wrapping), each chip set to flex-shrink-0
- **Stat cards 2-column**: Dashboard stat grid uses `grid-cols-2` on mobile (was `grid-cols-1`), collapses to single column on ≤480px
- **Tables scroll horizontally**: All data tables (cases, documents, billing, workflow) wrapped in `.table-scroll` container with `overflow-x: auto` and `min-width: 640px`
- **Chat messages wider on mobile**: Message bubbles use `max-width: 95%` on mobile (was 80%/85%) via `.chat-msg-max` class
- **Header compact**: Top bar padding reduced to `px-3 sm:px-6`; search input responsive width; "AI Co-Counsel" label hidden on small screens
- **Splash screen responsive**: Feature cards grid becomes single column on mobile
- **Matter context bar scrollable**: Horizontal scroll on overflow for long matter details
- **Build**: 338.47 kB bundle, 974ms build time

### Feb 21, 2026 — Strict 6-Part Format + Enhanced Markdown Rendering (v3.3.1)
- **Strict 6-part response format enforced on ALL agents**: Summary → Analysis → Recommendations & Next Actions → Full Output → Sources/Citations → Agents Used
- **Orchestrator response assembly**: Strips agent-added disclaimers, rebuilds in canonical order: routing header → body → Agents Used → `dashboard_update` JSON → Human Review → Co-Counsel closing → metadata footer
- **`dashboard_update` JSON patching**: Placeholder JSON in content replaced with actual side-effect counts post-pipeline
- **Researcher**: Added `### Analysis` wrapper with `####` subsections (Kansas/Missouri Statutory Authority, Case Law, 8th Circuit, SOL/Comparative Fault, Procedural Framework); renamed Sources to Sources/Citations
- **Drafter**: Added `### Analysis` wrapper with `####` subsections (Required Document Sections, Rules & Authority, Draft Outline); moved Jurisdiction-Specific Requirements under Recommendations
- **Analyst**: Added `### Analysis` wrapper with `####` subsections (Risk Scorecard, Comparative Fault Analysis, SWOT, Damages, Proactive Recommendations)
- **Strategist**: Added `### Summary` section + `### Analysis` wrapper with `####` subsections (Settlement Strategy, Venue/Forum Selection, Timeline, Budget, Proactive Analysis, Strategic Options)
- **Frontend renderMarkdown**: Complete rewrite — now supports:
  - **Markdown tables** (pipe-delimited with header/separator/body): rendered as styled `<table>` with alternating row colors
  - **Blockquotes** (`> text`): rendered as left-bordered emerald blocks (routing header, mem0 notes)
  - **Hyperlinks** (`[text](url)`): rendered as emerald links with `target="_blank"`
  - **`<small>` metadata tags**: rendered as tiny slate text blocks
  - **JSON code blocks**: highlighted in amber for dashboard_update visibility

### Feb 20, 2026 — CrewAI Integration + Runtime Config (v3.3)
- **CrewAI Python backend**: 4 agents (Researcher, Analyst, Drafter, Strategist) powered by CrewAI 1.9.3
- **FastAPI bridge server**: REST API on port 8100 with health check, chat, classify, config endpoints
- **Runtime LLM configuration**: `POST /api/crew/configure` — hot-reconfigure API key, base URL, and model without restart
- **Hono proxy with graceful fallback**: `/api/ai/chat` tries CrewAI first, handles 503/errors, falls back to template agents
- **CrewAI settings panel**: UI gear icon in chat header → modal to configure OpenAI/Novita/custom API keys
- **CrewAI status bar**: Real-time status indicator in chat UI showing CrewAI + LLM reachability
- **CrewAI powered badge**: Blue 🤖 CrewAI badge on messages when LLM-powered responses are used
- **PM2 dual-process**: `ecosystem.config.cjs` manages both Hono (port 3000) and CrewAI (port 8100)
- **LLM-agnostic**: Works with any OpenAI-compatible endpoint (GenSpark, Novita, OpenAI, Anthropic)
- **KS/MO system prompts**: Same battle-tested jurisdiction rules from template agents
- **New endpoints**: `/api/ai/crewai/status`, `/api/ai/crewai/configure` (Hono-side), `/health`, `/api/crew/chat`, `/api/crew/config`, `/api/crew/classify`, `/api/crew/configure` (Python-side)

### Feb 20, 2026 — MISSOURI MODE Activation (v3.2)
- **Orchestrator system prompt**: Added MISSOURI MODE priority block with auto-apply rules for every MO response
- **Auto-flag: 5-year PI SOL** (RSMo § 516.120) — always stated; 2-year med-mal (RSMo § 516.105) with affidavit of merit
- **Auto-flag: Pure comparative fault** (RSMo § 537.765) — plaintiff recovers even at 99% fault, damages reduced proportionally
- **Auto-flag: Joint & several liability** (RSMo § 537.067) — applies ONLY when defendant ≥51% at fault; <51% proportionate only
- **Fact pleading** (Mo.Sup.Ct.R. 55.05): Auto-flagged for MO complaints/petitions; stricter than federal notice pleading
- **Discovery proportionality & ESI** (Mo.Sup.Ct.R. 56.01(b)): Cost-shifting and proportionality analysis for MO discovery
- **8th Circuit case law DB**: Added EIGHTH_CIRCUIT_CASES with PI, employment, and corporate precedent entries
- **MO Court of Appeals districts**: Eastern (St. Louis), Western (Kansas City), Southern (Springfield) awareness in strategist venue analysis and drafter sections
- **Researcher auto-inject**: MO fact_pleading + discovery_proportionality KB entries auto-injected for relevant MO queries
- **Drafter MO sections**: Enhanced with RSMo § 516.120 SOL, RSMo § 516.105 med-mal, 8th Circuit reference, Court of Appeals 3-district info, proportionality for all doc types
- **Strategist budget**: Added ESI cost-shifting note for MO discovery budgets
- **Default jurisdiction**: Changed from 'kansas' to 'missouri' in UI
- **Intent routing**: Boosted MO statutory patterns (RSMo, 516.120, 537.765, 537.067, fact plead, ESI, proportionality)

### Feb 20, 2026 — KANSAS MODE Activation (v3.1)
- **Orchestrator system prompt**: Added KANSAS MODE priority block with auto-apply rules for every KS response
- **Auto-flag: 2-year SOL** (K.S.A. 60-513) — automatically stated in all PI/negligence responses
- **Auto-flag: 50% comparative fault bar** (K.S.A. 60-258a) — always flagged with risk implications
- **Proportional fault ONLY**: All agents now emphasize no joint & several liability in Kansas; each defendant liable only for proportionate share
- **No mandatory presuit notice**: Explicitly stated for standard negligence; distinguishes KTCA (K.S.A. 75-6101) 120-day notice for government entities
- **Empty-chair defense**: Referenced in researcher + analyst for non-party fault allocation
- **Researcher auto-inject**: KS comparative_fault and presuit_notice KB entries auto-injected for any PI/negligence query
- **Drafter templates**: Added PROPORTIONAL FAULT ONLY + no presuit notice to complaint/demand letter sections
- **Analyst risk scoring**: Updated comparative fault risk factor notes with proportional-only language
- **Strategist venue analysis**: Updated to emphasize proportional-only vs MO joint-several difference
- **UI chips**: Refined to Kansas-first language (KS case law, K.S.A. 60-258a, 50% bar / proportional fault)
- **Orchestrator routing**: Boosted KS statutory pattern detection (K.S.A., 60-513, 60-258a)

### Feb 20, 2026 — KS/MO Jurisdiction Migration
- **Florida → Kansas/Missouri**: Complete jurisdiction migration from FL to dual KS/MO licensed practice
- **Orchestrator system prompt**: Replaced FL identity with KS-MO senior equity partner (25+ years, dual-licensed)
- **Researcher knowledge base**: Replaced 14 FL statutes + 12 FL cases with KS statutes (K.S.A.), MO statutes (RSMo), KS case law, MO case law, and Federal authorities for both 10th and 8th Circuits
- **Drafter templates**: Updated all 7 templates with KS/MO procedural rules (Kansas Supreme Court Rules, Missouri Supreme Court Rules, K.S.A. citations, RSMo citations)
- **Strategist agent**: Updated settlement modeling with KS/MO-specific comparative fault rules (KS 50% bar vs MO pure comparative), ADR strategies, and court preferences
- **UI jurisdiction selector**: Changed from FL/Federal/Multi-state to Kansas/Missouri/Federal/Multi-state
- **Chat prompt chips**: Updated from FL-specific actions to KS/MO research, motions, SOL lookups
- **Agent descriptions**: Updated all agent metadata from FL to KS/MO in /api/ai/agents endpoint
- **Default jurisdiction**: Changed from 'florida' to 'kansas' in all defaults (DB schema, API routes, memory system)
- **Jurisdiction mapping**: Added case-insensitive jurisdiction label mapping (kansas→Kansas, missouri→Missouri, multistate→Multi-state KS/MO)
- **Zero Florida references**: Verified 0 occurrences of "Florida", "FL Statutes", or "HB 837" in production bundle

### Feb 20, 2026 — Chat UI & Build Fixes
- **Dynamic Tailwind classes**: Replaced string-concatenated badge classes with static class lookups via agentStyles/confStyles maps
- **renderMarkdown code-block ordering**: Fixed regex precedence bug with extract-process-restore pattern
- **shadcn/ui design system**: Added CSS variables (HSL tokens), component classes without React dependency
- **Chat UI rewrite**: Ported React AI Assistant patch to vanilla JS — dark-mode chat, matter context bar, orchestration step animation
- **Missing modules**: Created mem0.ts and llm.ts — imported by orchestrator/agents but didn't exist
- **Memory column mismatch**: Added safe column mapping for agent_memory table
- **Error handling**: Added try/catch wrapper to POST /api/ai/chat

## Deployment
- **Platform**: Cloudflare Pages
- **Production URL**: https://lawyrs.pages.dev
- **Status**: Live (deployed)
- **Last Updated**: February 24, 2026

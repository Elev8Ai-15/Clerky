# Lawyrs - Legal Practice Management Platform

## Project Overview
- **Name**: Lawyrs
- **Goal**: Full-featured legal practice management platform with multi-agent AI co-counsel
- **Stack**: Hono + Cloudflare D1 + TailwindCSS + Cloudflare Pages
- **Architecture**: Multi-Agent Orchestrated Pipeline v3.0
- **Jurisdictions**: Kansas (primary) & Missouri (dual-licensed KS/MO)

## Live URL
- **Sandbox**: Port 3000

## Multi-Agent AI System (v3.0)

### Architecture
```
User Query → Orchestrator (intent classification + confidence scoring)
                ├── 🔍 Researcher Agent (case law, statutes, citations — KS/MO/Federal)
                ├── 📝 Drafter Agent (7 document templates, KS/MO rules)
                ├── 🧠 Analyst Agent (6-factor risk model, SWOT, damages)
                └── 🎯 Strategist Agent (settlement, timeline, budget — KS/MO)
```

### System Identity
> Lawyrs AI — Senior equity partner, 25+ years experience, licensed in Kansas & Missouri.
> Core rules: step-by-step reasoning, no hallucinations, cite sources, flag risks, confidentiality.
> Response structure: Summary → Analysis → Recommendations → Next Actions → Sources.

### Jurisdiction Priorities
| Jurisdiction | Statutes | Courts | Key Rules |
|-------------|----------|--------|-----------|
| **Kansas** | K.S.A., Rules Civ Proc | KS District/Supreme, 10th Circuit | SOL 2yr (K.S.A. 60-513), 50% comp fault bar (K.S.A. 60-258a) |
| **Missouri** | RSMo, Supreme Court Rules | MO Circuit/Supreme, 8th Circuit | SOL 5yr (RSMo § 516.120), 2yr med-mal, pure comp fault (RSMo § 537.765), joint-several ≥51% |
| **Federal** | USC, FRCP, FRE | 10th Cir (KS), 8th Cir (MO) | Federal questions, diversity jurisdiction |
| **Multi-state** | KS + MO combined | Both circuits | Cross-border analysis, choice of law |

### Agent Capabilities
| Agent | Specialties | Key Features |
|-------|-----------|-------------|
| **Orchestrator** | Intent routing, multi-agent co-routing | Keyword scoring, conversation continuity, confidence calibration |
| **Researcher** | KS & MO statutes, case law, citations, Federal RAG | SOL lookup (KS 2yr / MO 5yr), comparative fault analysis, Shepardize warnings |
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
  - Quick action chips for KS/MO research, drafting, analysis, strategy
  - Routing metadata display (agent, confidence, sub-agents)
  - Session management and chat history
  - Dark-mode UI with matter context bar and orchestration step animation
- **AI Workflow Dashboard** - Agent cards with run buttons, stats, activity logs
- **Agent Memory UI** - Browse, search, filter, and delete agent memories
- **Client Intake** - Multi-step intake form with AI processing pipeline
- **Notifications** - Notification system with unread badges

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
- `GET /api/ai/chat/history?session_id=` - Get chat history for session
- `DELETE /api/ai/chat/:session_id` - Clear chat session
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

### Dashboard & DB
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
- `POST /api/documents` - Create document
- `PUT /api/documents/:id` - Update document
- `DELETE /api/documents/:id` - Archive document

### Calendar, Tasks, Billing, Users, Notifications
- Standard CRUD endpoints for all modules (see source routes)

## Agent Files
```
src/agents/
├── types.ts        # TypeScript interfaces (AgentInput, AgentOutput, MatterContext, etc.)
├── memory.ts       # Dual memory system (Mem0 + D1) + matter context assembly
├── mem0.ts         # Mem0 Cloud API client (store, search, delete, stats)
├── llm.ts          # OpenAI LLM client (gpt-4o-mini, structured prompts)
├── orchestrator.ts # Main router: KS/MO intent classification, agent dispatch, response merge
├── researcher.ts   # Legal research: KS/MO statutes, case law, citations, SOL analysis
├── drafter.ts      # Document drafting: 7 templates, KS/MO rules, caption generation
├── analyst.ts      # Risk analysis: 6-factor model, SWOT, damages calculation
└── strategist.ts   # Strategy planning: KS/MO settlement, timeline, budget, ADR
```

## Environment Variables
```bash
# Required
DB=D1Database        # Cloudflare D1 binding (automatic)

# Optional — enhance AI capabilities
MEM0_API_KEY=        # Mem0 cloud memory (persistent semantic search)
OPENAI_API_KEY=      # OpenAI for LLM-powered responses
```

## Development
```bash
npm run build          # Build for production
npm run dev:sandbox    # Start local dev server with D1
npm run db:reset       # Reset and reseed database
npm run db:migrate:local  # Apply migrations locally
```

## Test Results (All Passing — Feb 20 2026)
```
--- KS/MO Agent Tests ---
1. RESEARCHER (Kansas SOL)     ✅ conf=0.98, tok=1195, cit=4, juris=Kansas
2. RESEARCHER (MO comp fault)  ✅ conf=0.82, tok=941,  cit=1, juris=Missouri
3. DRAFTER (Kansas motion)     ✅ conf=0.93, tok=1119, cit=4, juris=Kansas
4. ANALYST (MO employment)     ✅ conf=0.88, tok=1210, cit=1, juris=Missouri
5. STRATEGIST (Multi-state)    ✅ conf=0.82, tok=1959, cit=4, juris=Multi-state (KS/MO)

--- E2E Chat Flow ---
6. Chat history (10 messages)  ✅
7. Delete session              ✅

--- Bundle Verification ---
8. Florida references          ✅ 0 (completely removed)
9. HB 837 references           ✅ 0 (completely removed)
10. Bundle size                ✅ 285.18 kB
```

## Bugs Fixed

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
- **Status**: Development (sandbox running)
- **Last Updated**: February 20, 2026

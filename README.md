# Lawyrs - Legal Practice Management Platform

## Project Overview
- **Name**: Lawyrs
- **Goal**: Full-featured legal practice management platform with multi-agent AI co-counsel
- **Stack**: Hono + Cloudflare D1 + TailwindCSS + Cloudflare Pages
- **Architecture**: Multi-Agent Orchestrated Pipeline v3.0

## Live URL
- **Sandbox**: Port 3000

## Multi-Agent AI System (v3.0)

### Architecture
```
User Query → Orchestrator (intent classification + confidence scoring)
                ├── 🔍 Researcher Agent (case law, statutes, citations)
                ├── 📝 Drafter Agent (7 document templates, FL rules)
                ├── 🧠 Analyst Agent (6-factor risk model, SWOT, damages)
                └── 🎯 Strategist Agent (settlement, timeline, budget)
```

### Agent Capabilities
| Agent | Specialties | Key Features |
|-------|-----------|-------------|
| **Orchestrator** | Intent routing, multi-agent co-routing | Keyword scoring, conversation continuity, confidence calibration |
| **Researcher** | FL statutes (14), case law (12 cases), citations | HB 837 analysis, SOL lookup, Shepardize warnings |
| **Drafter** | 7 templates (demand letter, MTD, MTC, engagement, complaint, MSJ, discovery) | Caption generation, FL-specific clauses, review checklists |
| **Analyst** | Risk scoring (6 factors), SWOT, damages modeling | Liability/exposure/SOL/opposing counsel/evidence/deadline scoring |
| **Strategist** | Settlement (3 scenarios), timeline, budget, ADR | Proactive "what am I missing" checklist, cost projections |

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
  - Quick action chips for research, drafting, analysis, strategy
  - Routing metadata display (agent, confidence, sub-agents)
  - Session management and chat history
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
├── orchestrator.ts # Main router: intent classification, agent dispatch, response merge
├── researcher.ts   # Legal research: FL statutes, case law, citations, HB 837
├── drafter.ts      # Document drafting: 7 templates, FL rules, caption generation
├── analyst.ts      # Risk analysis: 6-factor model, SWOT, damages calculation
└── strategist.ts   # Strategy planning: settlement, timeline, budget, ADR
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

## Test Results (All Passing)
```
1. RESEARCHER (no case)    ✅ agent=researcher, conf=0.98
2. RESEARCHER (with case)  ✅ agent=researcher, conf=0.98, cite=4
3. DRAFTER (no case)       ✅ agent=drafter, conf=0.98
4. DRAFTER (with case)     ✅ agent=drafter, conf=0.98, cite=3
5. ANALYST (no case)       ✅ agent=analyst, conf=0.98
6. ANALYST (with case)     ✅ agent=analyst, conf=0.98, risks=5
7. STRATEGIST (no case)    ✅ agent=strategist, conf=0.98
8. STRATEGIST (with case)  ✅ agent=strategist, conf=0.89
9. MEMORY endpoints        ✅ memories=11
10. STATS                  ✅ ops=26
11. AGENTS                 ✅ v3.0.0, 5 agents
12. WORKFLOW RUN            ✅ status=success
```

## Deployment
- **Platform**: Cloudflare Pages
- **Status**: Development (sandbox running)
- **Last Updated**: February 20, 2026

# Clerky - Comprehensive Platform Summary

## What Clerky Is

Clerky is an AI-powered legal practice management platform built specifically for attorneys practicing in **Kansas** and **Missouri**. It combines traditional practice management tools (cases, clients, billing, documents, calendar) with a groundbreaking **multi-agent AI co-counsel system** that performs legal research, drafts documents, analyzes risk, and develops litigation strategy — all calibrated to the specific statutes, case law, and procedural rules of KS and MO jurisdictions.

The platform is designed for **Brad**, a senior equity partner at a Kansas City metro firm, dual-licensed in Kansas and Missouri with 25+ years of experience. Clerky functions as his always-on AI co-counsel, researcher, analyst, strategist, and drafting partner.

---

## How Clerky Helps Lawyers

### 1. Eliminates Jurisdiction-Specific Research Errors

The single biggest risk for a dual-state practitioner is applying the wrong state's rules. Clerky **automatically enforces jurisdiction-specific rules** on every single AI response:

**Missouri Mode (Primary):**
- Auto-flags the **5-year personal injury SOL** (RSMo SS 516.120) on every PI response
- Auto-flags **2-year medical malpractice SOL** (RSMo SS 516.105) with affidavit of merit requirement (RSMo SS 538.225)
- Applies **pure comparative fault** (RSMo SS 537.765) — plaintiff recovers even at 99% fault
- Flags **joint & several liability** only when defendant >= 51% at fault (RSMo SS 537.067)
- Warns about **fact pleading** requirements (Mo.Sup.Ct.R. 55.05) — stricter than federal notice pleading
- Applies **discovery proportionality & ESI cost-shifting** rules (Mo.Sup.Ct.R. 56.01(b))
- References Missouri Court of Appeals 3 districts (Eastern/Western/Southern) and 8th Circuit precedent

**Kansas Mode:**
- Auto-flags **2-year PI/negligence SOL** (K.S.A. 60-513)
- Applies **50% comparative fault bar** (K.S.A. 60-258a) — plaintiff barred if >= 50% at fault
- Enforces **proportional fault only** — no joint & several liability in Kansas
- Recognizes **empty-chair defense** for non-party fault allocation
- Distinguishes **no mandatory presuit notice** for standard negligence vs. KTCA 120-day notice for government entities (K.S.A. 75-6101)
- References Kansas Supreme Court, Court of Appeals, District Courts, and 10th Circuit precedent

### 2. Four Specialist AI Agents Working in Concert

Instead of a single chatbot, Clerky deploys a **multi-agent orchestrated pipeline** where each agent has deep specialization:

| Agent | What It Does | Key Capabilities |
|-------|-------------|-----------------|
| **Researcher** | Legal research, statute lookup, case law retrieval, citation verification | Embedded KS & MO statute databases (28+ statutes), case law databases (24+ cases across both states + 8th Circuit), SOL calculators, Shepardize-style citation warnings |
| **Drafter** | Document generation with jurisdiction-specific clauses and formatting | 7 document templates (demand letters, motions to dismiss, motions to compel, engagement letters, complaints/petitions, summary judgment motions, discovery responses), auto-generates captions, KS/MO procedural rule compliance |
| **Analyst** | Risk scoring, SWOT analysis, damages modeling, evidence auditing | 6-factor weighted risk model (liability, damages/exposure, SOL/deadlines, comparative fault, evidence gaps, deadline management), deposition analysis, enforceability review, comparative fault impact calculations |
| **Strategist** | Settlement modeling, timeline generation, litigation budgeting, ADR strategy | 3-scenario settlement modeling (early/post-discovery/trial) with dollar ranges, litigation timelines with KS/MO-specific deadlines, budget projections, venue/forum analysis, mediation/arbitration strategy |

**How the pipeline works:**
1. User sends a natural language query ("What is the SOL for PI in Missouri?")
2. The **Orchestrator** classifies intent using keyword scoring with jurisdiction-specific boosts
3. The primary agent executes (e.g., Researcher for legal questions)
4. If two agents score close, both run (**co-routing**) — e.g., a demand letter question triggers both Drafter and Researcher
5. Results are merged with standardized formatting, citations, risk flags, and next actions
6. Every response includes: Summary, Analysis, Recommendations, Sources/Citations, Agents Used, and a mandatory human review disclaimer

### 3. AI That Actually Creates Work Product

Unlike generic AI chat, Clerky's **Dashboard-Wired Pipeline** (`/api/crew`) doesn't just answer questions — it **creates real deliverables** that appear in the practice management system:

- **Drafter agent** creates: Document record in Documents module + review task + filing deadline task
- **Researcher agent** creates: Research memo document + citation verification task
- **Analyst agent** creates: Risk assessment report + attorney review task
- **Strategist agent** creates: Strategy tasks + settlement prep tasks + calendar events for mediation/deposition/hearing dates

The frontend shows a **real-time pipeline trace** in the chat UI — each step is color-coded with icons showing exactly what the AI did. After the pipeline completes, a **dashboard sync banner** appears with clickable buttons to jump directly to the newly created documents, tasks, or calendar events.

### 4. Full Practice Management Suite

Beyond AI, Clerky provides a complete operational backbone:

**Case & Matter Management:**
- Full CRUD for cases with 11 case types (personal injury, employment, family, corporate, immigration, IP, real estate, criminal defense, medical malpractice, wrongful death, workers' compensation)
- Status tracking (open, in progress, pending review, discovery, closed, archived)
- Priority levels (low, medium, high, urgent)
- Links to clients, attorneys, opposing counsel, court information
- Estimated case value, contingency fee percentage, retainer amounts
- Statute of limitations tracking per case

**Client Management:**
- Individual and business client profiles
- Contact information, addresses, assigned attorney
- Client portal access for secure document sharing
- Client communications log (privileged/non-privileged)
- Intake form submissions linked to clients

**Document Management:**
- Document upload with categories (pleading, evidence, contract, motion, discovery, template, general)
- AI-generated document flag and AI summary fields
- Document versioning (track all versions with change summaries)
- Document sharing with permission controls (view/edit) and expiration dates
- Document templates library
- E-signature request tracking (internal and external providers)

**Billing & Financial Management:**
- Time entry tracking with hourly rates and activity types
- Invoice generation with line items, tax, discounts
- Invoice lifecycle (draft, sent, paid, overdue)
- Payment tracking with payment method management
- **Trust accounting** — IOLTA-compliant trust accounts with:
  - Individual trust accounts per client/case
  - Transaction ledger (deposits, withdrawals, transfers)
  - Running balance tracking
  - Authorization tracking per transaction
- Case expense tracking with billable/reimbursable flags and receipt URLs
- Revenue dashboard with total revenue, outstanding, overdue, and monthly billable totals

**Calendar & Scheduling:**
- Event types: hearing, deposition, meeting, deadline, internal, filing
- Virtual meeting link support
- Reminder settings (configurable minutes before)
- Attendee tracking
- Color-coded events by type
- Upcoming events feed on dashboard

**Task & Deadline Management:**
- Task types: task, filing, review, deadline, hearing, follow-up
- Priority and status tracking
- Assignment to team members with "assigned by" tracking
- Due date and reminder date
- Recurring task support with recurrence patterns
- Overdue detection (auto-flags when past due date)

**Notifications:**
- Real-time notification system
- Types: deadline, warning, billing, info, success
- Read/unread tracking with mark-all-read
- Case-linked notifications with deep links

### 5. AI-Powered Client Intake Pipeline

Clerky automates the client intake process with an AI-driven pipeline:

1. **Form Submission** — New client fills out intake form (name, contact, case type, jurisdiction, incident details, injuries, attorney preference)
2. **Conflict Check** — Automated conflict screening against existing clients and cases
3. **AI Assessment** — AI evaluates the case: type classification, jurisdiction analysis, SOL calculation, merit assessment, recommended attorney assignment
4. **Auto-Routing** — Case automatically routed to appropriate attorney based on specialty
5. **Case Created** — Client record, case record, initial tasks, and calendar events all created automatically

The intake pipeline shows a visual step-by-step trace, and the AI assessment includes jurisdiction-specific analysis (e.g., "Missouri PI — 5-year SOL applies, pure comparative fault favorable to plaintiff").

### 6. Persistent AI Memory Across Sessions

Clerky maintains **two memory systems** so the AI remembers prior work:

- **Mem0 Cloud Memory (Primary):** Persistent semantic memory using the Mem0 API. Stores agent outputs, research findings, risk assessments, and case strategies. Supports semantic search — when you ask about a case, the AI retrieves relevant prior analysis from any agent, any session.
- **D1 Local Memory (Fallback):** SQLite-backed memory tables (`agent_memory`, `agent_sessions`) that store memory entries with case/session/agent scoping and confidence scores.

Both systems use **dual-write** — every memory update goes to both Mem0 and D1. The Memory UI page lets you browse, search, filter by agent type, and delete memories.

### 7. Multi-Agent Workflow Dashboard

A dedicated **Workflow Engine** page shows:
- **Agent architecture diagram** — visual pipeline from user query through orchestrator to specialist agents
- **Agent cards** with descriptions, capabilities, and one-click "Run Agent" buttons
- **AI usage statistics** — total operations, tokens consumed, cost tracking, per-agent breakdown
- **Activity logs** — timestamped log of all AI operations with case/user associations
- **System status** — Mem0 connectivity, LLM status, CrewAI backend health

---

## Databases & Data Sources

### Primary Database: Cloudflare D1 (SQLite)

Clerky stores all practice data in a **Cloudflare D1** globally-distributed SQLite database. The schema contains **26+ tables** organized into functional groups:

**Core Tables (6):**
| Table | Purpose | Key Fields |
|-------|---------|------------|
| `users_attorneys` | Firm attorneys and staff | email, full_name, role, bar_number, specialty |
| `clients` | Client records (individual + business) | name, contact, client_type, status, assigned_attorney |
| `cases_matters` | Cases and legal matters | case_number, case_type, status, priority, client_id, lead_attorney, court, opposing_counsel, SOL, estimated_value |
| `documents` | Document records | title, file_type, category, status, case_id, ai_generated flag, ai_summary |
| `ai_logs` | AI operation audit trail | agent_type, action, tokens, cost, duration, status |
| `notifications` | System notifications | user_id, title, message, type, is_read, case_id |

**Document Processing Tables (3):**
| Table | Purpose |
|-------|---------|
| `document_versions` | Version history with change summaries |
| `document_sharing` | Access controls with permissions, tokens, expiration |
| `document_templates` | Reusable document templates with variable placeholders |

**Client Portal Tables (4):**
| Table | Purpose |
|-------|---------|
| `client_portal_access` | Client login credentials and access tokens |
| `intake_forms` | Intake form schemas (JSON-based, public/private) |
| `intake_submissions` | Submitted intake data with review status |
| `client_communications` | Email/call/meeting logs with privilege flags |

**Case Management Tables (4):**
| Table | Purpose |
|-------|---------|
| `tasks_deadlines` | Tasks with priority, status, due dates, recurrence |
| `calendar_events` | Hearings, depositions, meetings, deadlines |
| `case_notes` | Attorney notes with privilege flags and pinning |
| `time_entries` | Billable hours with rates, activity types, timer support |

**Billing & Financial Tables (5):**
| Table | Purpose |
|-------|---------|
| `esignature_requests` | E-signature tracking (DocuSign, internal) |
| `billing_invoices` | Invoices with line items, tax, discounts, payment terms |
| `invoice_line_items` | Itemized billing entries linked to time entries |
| `payment_methods` | Client payment methods (Stripe integration ready) |
| `payments` | Payment records with transaction references |

**Trust Accounting Tables (3):**
| Table | Purpose |
|-------|---------|
| `trust_accounts` | IOLTA trust accounts per client/case |
| `trust_transactions` | Deposits, withdrawals, transfers with running balances |
| `case_expenses` | Billable/reimbursable expenses with receipts |

**Compliance Table (1):**
| Table | Purpose |
|-------|---------|
| `conflict_checks` | Conflict screening results with related case cross-references |

**AI Memory Tables (2, dynamically created):**
| Table | Purpose |
|-------|---------|
| `agent_memory` | Per-agent knowledge entries scoped by case/session |
| `agent_sessions` | Session tracking with agent usage, tokens, routing logs |

### Embedded Legal Knowledge Bases

The AI agents contain **hardcoded, verified legal databases** that don't require internet access or LLM calls:

**Kansas Statutes Database (14 entries):**
- K.S.A. 60-513(a)(4) — Personal injury (2-year SOL)
- K.S.A. 60-513(a)(7) & 60-513a — Medical malpractice (2-year + 4-year repose)
- K.S.A. 60-511(1) — Written contract (5-year SOL)
- K.S.A. 60-512(1) — Oral contract (3-year SOL)
- K.S.A. 60-1901 & 60-513(a)(5) — Wrongful death (2-year)
- K.S.A. 60-513(a)(4) — Property damage (2-year)
- K.S.A. 60-513(a)(3) — Fraud (2-year from discovery)
- K.S.A. 44-1001 et seq. — Employment discrimination (KAAD)
- K.S.A. 23-2101 et seq. — Family law
- K.S.A. 17-6001 et seq. — Corporate law
- K.S.A. 58-2201 et seq. — Real estate
- K.S.A. 60-258a — Comparative fault (50% bar, proportional only)
- K.S.A. 44-501 et seq. — Workers' compensation
- K.S.A. 75-6101 et seq. — Sovereign immunity / Tort Claims Act
- Every entry includes the official URL to ksrevisor.org

**Missouri Statutes Database (14 entries):**
- RSMo SS 516.120 — Personal injury (5-year SOL)
- RSMo SS 516.105 — Medical malpractice (2-year + 10-year repose)
- RSMo SS 516.110(1) — Written contract (10-year SOL)
- RSMo SS 516.120(1) — Oral contract (5-year)
- RSMo SS 537.100 — Wrongful death (3-year)
- RSMo SS 516.120 — Property damage (5-year)
- RSMo SS 516.120(5) — Fraud (5-year from discovery)
- RSMo SS 213.010 et seq. — Employment discrimination (MHRA)
- RSMo SS 452.300 et seq. — Family law
- RSMo SS 351.010 et seq. — Corporate law
- RSMo SS 442.010 et seq. — Real estate
- RSMo SS 537.765 — Pure comparative fault
- RSMo SS 287.010 et seq. — Workers' compensation
- RSMo SS 537.600 — Sovereign immunity
- Mo.Sup.Ct.R. 55.05 — Fact pleading requirements
- Mo.Sup.Ct.R. 56.01(b) — Discovery proportionality & ESI
- Every entry includes the official URL to revisor.mo.gov

**Kansas Case Law Database (12 cases):**
- Personal Injury: *Ling v. Jan's Liquors* (comparative fault), *Baska v. Scherzer* (discovery rule), *Thompson v. KFB Ins.* (fault apportionment)
- Employment: *Lumry v. State* (KAAD exhaustion), *Rebarchek v. Farmers Coop* (retaliatory discharge), *Flenker v. Willamette* (hostile work environment)
- Family: *In re Marriage of Sommers* (property division), *In re Marriage of Bradley* (custody), *In re Marriage of Knoll* (maintenance)
- Corporate: *Arnaud v. Stockgrowers* (business judgment rule), *Sampson v. Hunt* (veil piercing), *Southwest Nat. Bank v. Kautz* (shareholder duties)

**Missouri Case Law Database (12 cases):**
- Personal Injury: *Gustafson v. Benda* (pure comparative fault), *Powel v. Chaminade* (joint & several), *Strahler v. St. Luke's* (discovery rule)
- Employment: *Templemire v. W&M Welding* (MHRA exclusivity), *Daugherty v. City of Maryland Heights* (damage caps), *Fleshner v. Pepose Vision* (whistleblower)
- Family: *Branum v. Branum* (property division), *B.H. v. K.D.* (custody), *Kessinger v. Kessinger* (maintenance modification)
- Corporate: *66, Inc. v. Crestwood Commons* (business judgment), *Collet v. American National* (veil piercing), *Ronnoco Coffee v. Castagna* (non-competes)

**8th Circuit Federal Precedent (5 cases):**
- *Blevins v. Cessna Aircraft* (Erie + MO comparative fault)
- *Dhyne v. State Farm* (summary judgment in diversity)
- *Torgerson v. City of Rochester* (employment discrimination, en banc)
- *Hervey v. County of Koochiching* (hostile work environment)
- *Radaszewski v. Telecom Corp.* (veil piercing standards)

**Document Templates (7 types, each with KS and MO rule sets):**
1. Demand Letter — with comparative fault damage adjustment warnings
2. Motion to Dismiss — KS: K.S.A. 60-212(b); MO: Mo.Sup.Ct.R. 55.27(a)
3. Motion to Compel Discovery — with good faith certification requirements
4. Client Engagement Letter — KRPC/Missouri Rule 4 compliance
5. Civil Complaint/Petition — MO fact pleading vs. KS notice pleading differences
6. Motion for Summary Judgment — KS: K.S.A. 60-256; MO: Mo.Sup.Ct.R. 74.04
7. Discovery Responses — with ESI proportionality for MO

### External Services (Optional)

| Service | Purpose | Required? |
|---------|---------|-----------|
| **Mem0 Cloud** (api.mem0.ai) | Persistent semantic memory for cross-session AI context | Optional (falls back to D1 local) |
| **OpenAI API** (or compatible) | LLM-powered enhanced agent responses | Optional (falls back to template agents) |
| **CrewAI Python Backend** | Real LLM-powered multi-agent orchestration via CrewAI framework | Optional (falls back to TypeScript template agents) |
| **Cloudflare D1** | Primary database (SQLite, globally distributed) | Required |
| **Cloudflare Pages** | Hosting and edge deployment | Required |

### LLM Provider Support

The CrewAI backend supports any OpenAI-compatible API:
- **OpenAI** — GPT-5-mini, GPT-5, etc.
- **OpenRouter** — Access to Claude, GPT, Gemini, and 200+ models
- **Novita AI** — Claude 3.5 Sonnet and open models
- **Anthropic** (via OpenAI-compatible proxy) — Claude Sonnet 4, Opus 4
- **GenSpark LLM Proxy** — Sandbox-provided endpoint
- **Any custom endpoint** — Any API that follows the OpenAI chat completions format

---

## Architecture Summary

```
                        +---------------------------+
                        |     Cloudflare Pages      |
                        |     (Edge Deployment)     |
                        +---------------------------+
                                    |
                        +---------------------------+
                        |   Hono Framework (TS)     |
                        |   Port 3000               |
                        +---------------------------+
                           /    |    |    \
              +-----------+  +--+--+ +--+--+ +-----------+
              | Cases API |  |Docs | |Bill | | Calendar  |
              | Clients   |  |Tasks| |Users| | Notifs    |
              +-----------+  +-----+ +-----+ +-----------+
                                    |
                        +---------------------------+
                        |    AI Route (/api/ai)     |
                        |    Orchestrator           |
                        +---------------------------+
                           /           \
              +----------------+  +------------------+
              | CrewAI Python  |  | Template Agents  |
              | Backend        |  | (TypeScript)     |
              | Port 8100      |  | (No LLM needed)  |
              | (LLM-powered)  |  |                  |
              +----------------+  +------------------+
              | Researcher     |  | Researcher       |
              | Drafter        |  | Drafter          |
              | Analyst        |  | Analyst          |
              | Strategist     |  | Strategist       |
              +----------------+  +------------------+
                                    |
                        +---------------------------+
                        |   Cloudflare D1 (SQLite)  |
                        |   26+ Tables              |
                        +---------------------------+
                                    |
                        +---------------------------+
                        |   Mem0 Cloud (Optional)   |
                        |   Semantic Memory         |
                        +---------------------------+
```

---

## Key Differentiators

1. **Jurisdiction-Hardened AI** — Not a generic legal chatbot. Every response is calibrated to Kansas or Missouri law with embedded statute databases, case law references, and procedural rule awareness.

2. **Dual-Engine Failover** — CrewAI (LLM-powered) runs first; if unavailable, the TypeScript template agents provide equally structured, citation-rich responses without any API dependency.

3. **AI Creates Real Work Product** — The dashboard-wired pipeline doesn't just chat — it creates documents, tasks, calendar events, and expense records directly in the practice management database.

4. **Trust Accounting Built-In** — IOLTA-compliant trust account management with transaction ledgers, running balances, and authorization tracking — a requirement for every law firm.

5. **Multi-Agent Co-Routing** — When a query spans two agent domains (e.g., "Draft a demand letter and assess the settlement value"), both agents run and their outputs are merged with deduplicated citations and risks.

6. **Persistent Legal Memory** — Mem0 semantic memory means the AI remembers prior research, analysis, and strategies across sessions. Ask about a case today, and next week the AI already has context.

7. **Mobile-Responsive** — Collapsible sidebar, horizontal-scroll prompt chips, 2-column stat grids, compact chat headers, and scrollable tables for full functionality on any device.

8. **Edge-Deployed** — Runs on Cloudflare's global edge network via Cloudflare Pages, with D1 database providing low-latency data access worldwide.

---

## Live URLs

- **Production**: https://lawyrs.pages.dev
- **Platform**: Cloudflare Pages + D1
- **Version**: v3.3.4
- **Last Updated**: February 21, 2026

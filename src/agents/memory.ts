// ═══════════════════════════════════════════════════════════════
// LAWYRS MULTI-AGENT SYSTEM — Shared Agent Memory
// Dual memory: Mem0 Cloud (primary) + D1 Local (fallback)
// All agents read/write to shared matter-scoped memory,
// enabling cross-agent, cross-session knowledge sharing.
// ═══════════════════════════════════════════════════════════════

import type { DB, MatterContext, MemoryEntry, MemoryUpdate, DocumentRef, TaskRef, EventRef, BillingSummary, ChatMessage } from './types'
import type { Mem0Client } from './mem0'

// ─── Initialize memory tables (D1 fallback) ─────────────────
export async function initMemoryTables(db: DB) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS agent_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER,
    session_id TEXT,
    agent_type TEXT NOT NULL,
    memory_key TEXT NOT NULL,
    memory_value TEXT NOT NULL,
    confidence REAL DEFAULT 0.8,
    expires_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run()

  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_agent_mem_case ON agent_memory(case_id, agent_type)`).run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_agent_mem_session ON agent_memory(session_id)`).run()

  await db.prepare(`CREATE TABLE IF NOT EXISTS agent_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    case_id INTEGER,
    user_id INTEGER DEFAULT 1,
    agents_used TEXT DEFAULT '[]',
    total_tokens INTEGER DEFAULT 0,
    total_cost REAL DEFAULT 0,
    routing_log TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run()
}

// ─── Assemble full matter context ───────────────────────────
export async function assembleMatterContext(
  db: DB,
  caseId: number | null,
  sessionId: string,
  mem0?: Mem0Client,
  userQuery?: string,
  userId?: string
): Promise<MatterContext> {
  const base: MatterContext = {
    case_id: null, case_number: null, title: null, case_type: null,
    status: null, priority: null, client_name: null, client_type: null,
    attorney_name: null, court_name: null, judge_name: null,
    opposing_counsel: null, opposing_party: null, date_filed: null,
    estimated_value: null, statute_of_limitations: null, description: null,
    documents: [], tasks: [], recent_events: [],
    billing_summary: null, prior_research: [], prior_analysis: []
  }

  if (!caseId) return base

  // Core case data
  const caseData = await db.prepare(`
    SELECT cm.*, c.first_name || ' ' || c.last_name as client_name,
           c.client_type, u.full_name as attorney_name
    FROM cases_matters cm
    LEFT JOIN clients c ON cm.client_id = c.id
    LEFT JOIN users_attorneys u ON cm.lead_attorney_id = u.id
    WHERE cm.id = ?
  `).bind(caseId).first() as any

  if (!caseData) return base

  base.case_id = caseId
  base.case_number = caseData.case_number
  base.title = caseData.title
  base.case_type = caseData.case_type
  base.status = caseData.status
  base.priority = caseData.priority
  base.client_name = caseData.client_name
  base.client_type = caseData.client_type
  base.attorney_name = caseData.attorney_name
  base.court_name = caseData.court_name
  base.judge_name = caseData.judge_name
  base.opposing_counsel = caseData.opposing_counsel
  base.opposing_party = caseData.opposing_party
  base.date_filed = caseData.date_filed
  base.estimated_value = caseData.estimated_value
  base.statute_of_limitations = caseData.statute_of_limitations
  base.description = caseData.description

  // Parallel fetch of related data
  const [docs, tasks, events, billing, research, analysis] = await Promise.all([
    db.prepare(`SELECT id, title, file_type, category, status, ai_summary FROM documents WHERE case_id = ? ORDER BY created_at DESC LIMIT 10`).bind(caseId).all(),
    db.prepare(`SELECT id, title, priority, status, due_date, task_type FROM tasks_deadlines WHERE case_id = ? ORDER BY due_date ASC LIMIT 10`).bind(caseId).all(),
    db.prepare(`SELECT id, title, event_type, start_datetime, end_datetime, location FROM calendar_events WHERE case_id = ? AND start_datetime >= datetime('now') ORDER BY start_datetime ASC LIMIT 5`).bind(caseId).all(),
    db.prepare(`SELECT COALESCE(SUM(bi.total_amount),0) as total_billed, COALESCE(SUM(bi.amount_paid),0) as total_paid, COALESCE(SUM(te.hours),0) as total_hours, COALESCE(AVG(te.rate),0) as avg_rate FROM billing_invoices bi LEFT JOIN time_entries te ON te.case_id = bi.case_id WHERE bi.case_id = ?`).bind(caseId).first(),
    db.prepare(`SELECT id, agent_type, memory_key, memory_value, confidence, created_at FROM agent_memory WHERE case_id = ? AND agent_type = 'researcher' ORDER BY created_at DESC LIMIT 5`).bind(caseId).all(),
    db.prepare(`SELECT id, agent_type, memory_key, memory_value, confidence, created_at FROM agent_memory WHERE case_id = ? AND agent_type = 'analyst' ORDER BY created_at DESC LIMIT 5`).bind(caseId).all()
  ])

  base.documents = (docs.results || []) as unknown as DocumentRef[]
  base.tasks = (tasks.results || []) as unknown as TaskRef[]
  base.recent_events = (events.results || []) as unknown as EventRef[]
  
  const b = billing as any
  base.billing_summary = {
    total_billed: b?.total_billed || 0,
    total_paid: b?.total_paid || 0,
    outstanding: (b?.total_billed || 0) - (b?.total_paid || 0),
    total_hours: b?.total_hours || 0,
    avg_rate: b?.avg_rate || 0
  }

  base.prior_research = ((research.results || []) as any[]).map(r => ({ id: r.id, agent_type: r.agent_type, key: r.memory_key || r.key || '', value: r.memory_value || r.value || '', confidence: r.confidence, created_at: r.created_at })) as MemoryEntry[]
  base.prior_analysis = ((analysis.results || []) as any[]).map(r => ({ id: r.id, agent_type: r.agent_type, key: r.memory_key || r.key || '', value: r.memory_value || r.value || '', confidence: r.confidence, created_at: r.created_at })) as MemoryEntry[]

  return base
}

// ─── Get conversation history ───────────────────────────────
export async function getConversationHistory(db: DB, sessionId: string, limit = 20): Promise<ChatMessage[]> {
  const result = await db.prepare(
    `SELECT role, content, agent_type, created_at FROM ai_chat_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`
  ).bind(sessionId, limit).all()
  return ((result.results || []) as unknown as ChatMessage[]).reverse()
}

// ─── Write agent memory (Mem0 primary, D1 fallback) ─────────
export async function writeMemory(
  db: DB,
  updates: MemoryUpdate[],
  caseId: number | null,
  sessionId: string,
  mem0?: Mem0Client,
  userId?: string,
  jurisdiction?: string
) {
  for (const u of updates) {
    // D1 local write (always — serves as backup and for local queries)
    await db.prepare(`
      INSERT INTO agent_memory (case_id, session_id, agent_type, memory_key, memory_value, confidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(caseId, sessionId, u.agent_type, u.key, u.value, u.confidence).run()

    // Mem0 cloud write (if available)
    if (mem0?.isEnabled && userId) {
      try {
        await mem0.storeAgentMemory({
          agentType: u.agent_type,
          content: `[${u.key}] ${u.value}`,
          caseId,
          userId,
          jurisdiction,
          confidence: u.confidence,
          tags: [u.agent_type, u.key]
        })
      } catch (e) { /* non-critical — D1 backup exists */ }
    }
  }
}

// ─── Read agent memory by key (D1) ──────────────────────────
export async function readMemory(db: DB, caseId: number | null, agentType: string, key?: string): Promise<MemoryEntry[]> {
  let query = `SELECT * FROM agent_memory WHERE case_id = ? AND agent_type = ?`
  const params: any[] = [caseId, agentType]
  if (key) { query += ` AND memory_key = ?`; params.push(key) }
  query += ` ORDER BY created_at DESC LIMIT 10`
  const result = await db.prepare(query).bind(...params).all()
  return (result.results || []) as unknown as MemoryEntry[]
}

// ─── Search memory (Mem0 primary, D1 fallback) ──────────────
export async function searchMemory(
  db: DB,
  query: string,
  caseId: number | null,
  mem0?: Mem0Client,
  userId?: string
): Promise<{ source: 'mem0' | 'd1', results: any[] }> {
  // Try Mem0 first
  if (mem0?.isEnabled && userId) {
    try {
      const results = await mem0.searchMemories({
        query,
        userId,
        limit: 10
      })
      if (results && results.length > 0) {
        return { source: 'mem0', results }
      }
    } catch (e) { /* fall through to D1 */ }
  }

  // D1 fallback — keyword search
  const d1Query = `SELECT * FROM agent_memory WHERE case_id = ? AND (memory_value LIKE ? OR memory_key LIKE ?) ORDER BY created_at DESC LIMIT 10`
  const searchTerm = `%${query.substring(0, 100)}%`
  const result = await db.prepare(d1Query).bind(caseId, searchTerm, searchTerm).all()
  return { source: 'd1', results: (result.results || []) }
}

// ─── Track agent session ────────────────────────────────────
export async function trackSession(db: DB, sessionId: string, caseId: number | null, agentType: string, tokensUsed: number) {
  const existing = await db.prepare(`SELECT * FROM agent_sessions WHERE session_id = ?`).bind(sessionId).first() as any
  if (existing) {
    const agents = JSON.parse(existing.agents_used || '[]')
    if (!agents.includes(agentType)) agents.push(agentType)
    await db.prepare(`
      UPDATE agent_sessions SET agents_used = ?, total_tokens = total_tokens + ?, updated_at = CURRENT_TIMESTAMP WHERE session_id = ?
    `).bind(JSON.stringify(agents), tokensUsed, sessionId).run()
  } else {
    await db.prepare(`
      INSERT INTO agent_sessions (session_id, case_id, agents_used, total_tokens) VALUES (?, ?, ?, ?)
    `).bind(sessionId, caseId, JSON.stringify([agentType]), tokensUsed).run()
  }
}

// ─── Format matter context as text for agent prompts ────────
export function formatMatterContext(m: MatterContext): string {
  if (!m.case_id) return '\n[No matter currently selected — providing general analysis]'

  let ctx = `
══════ CURRENT MATTER CONTEXT ══════
Case: ${m.case_number} — ${m.title}
Type: ${m.case_type} | Status: ${m.status} | Priority: ${m.priority}
Client: ${m.client_name} (${m.client_type})
Lead Attorney: ${m.attorney_name}
Court: ${m.court_name || 'N/A'} | Judge: ${m.judge_name || 'N/A'}
Opposing Counsel: ${m.opposing_counsel || 'N/A'}
Opposing Party: ${m.opposing_party || 'N/A'}
Filed: ${m.date_filed || 'N/A'}
Est. Value: ${m.estimated_value ? '$' + Number(m.estimated_value).toLocaleString() : 'N/A'}
SOL: ${m.statute_of_limitations || 'Not set — VERIFY IMMEDIATELY'}
Description: ${m.description || 'N/A'}`

  if (m.documents.length > 0) {
    ctx += `\n\n── Documents on File (${m.documents.length}) ──`
    for (const d of m.documents) ctx += `\n- [${d.category}] ${d.title} (${d.status})${d.ai_summary ? ' — ' + d.ai_summary : ''}`
  }

  if (m.tasks.length > 0) {
    ctx += `\n\n── Active Tasks/Deadlines (${m.tasks.length}) ──`
    for (const t of m.tasks) ctx += `\n- [${t.priority}/${t.status}] ${t.title} — due: ${t.due_date || 'no date'}`
  }

  if (m.recent_events.length > 0) {
    ctx += `\n\n── Upcoming Events ──`
    for (const e of m.recent_events) ctx += `\n- ${e.event_type}: ${e.title} — ${e.start_datetime}${e.location ? ' @ ' + e.location : ''}`
  }

  if (m.billing_summary && m.billing_summary.total_billed > 0) {
    const b = m.billing_summary
    ctx += `\n\n── Billing Summary ──`
    ctx += `\nBilled: $${b.total_billed.toLocaleString()} | Paid: $${b.total_paid.toLocaleString()} | Outstanding: $${b.outstanding.toLocaleString()}`
    ctx += `\nHours: ${b.total_hours} | Avg Rate: $${b.avg_rate.toFixed(0)}/hr`
  }

  if (m.prior_research.length > 0) {
    ctx += `\n\n── Prior Research Notes ──`
    for (const r of m.prior_research.slice(0, 3)) ctx += `\n- [${r.key || 'note'}] ${(r.value || '').substring(0, 200)}...`
  }

  if (m.prior_analysis.length > 0) {
    ctx += `\n\n── Prior Analysis Notes ──`
    for (const a of m.prior_analysis.slice(0, 3)) ctx += `\n- [${a.key || 'note'}] ${(a.value || '').substring(0, 200)}...`
  }

  return ctx
}

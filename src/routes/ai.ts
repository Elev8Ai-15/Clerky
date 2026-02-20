// ═══════════════════════════════════════════════════════════════
// LAWYRS AI — Multi-Agent API Routes v3.0
// Orchestrator → Researcher | Drafter | Analyst | Strategist
// Mem0 Cloud Memory + LLM Hybrid + D1 Fallback
// ═══════════════════════════════════════════════════════════════

import { Hono } from 'hono'
import { orchestrate, getSystemIdentity, initMemoryTables } from '../agents/orchestrator'
import { createMem0Client } from '../agents/mem0'
import { searchMemory } from '../agents/memory'

type Bindings = { DB: D1Database; MEM0_API_KEY?: string; OPENAI_API_KEY?: string }
const ai = new Hono<{ Bindings: Bindings }>()

// ═══════════════════════════════════════════════════════════════
// Ensure tables exist
// ═══════════════════════════════════════════════════════════════
async function ensureTables(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    case_id INTEGER,
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content TEXT NOT NULL,
    jurisdiction TEXT DEFAULT 'florida',
    agent_type TEXT,
    tokens_used INTEGER DEFAULT 0,
    confidence REAL DEFAULT 0,
    sub_agents TEXT,
    risks_flagged TEXT,
    citations_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run()
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_chat_session ON ai_chat_messages(session_id)`).run()
  await initMemoryTables(db)
}

// ═══════════════════════════════════════════════════════════════
// AI Chat — Multi-Agent Conversational Interface
// ═══════════════════════════════════════════════════════════════

ai.get('/chat/history', async (c) => {
  const sessionId = c.req.query('session_id') || 'default'
  const caseId = c.req.query('case_id')
  await ensureTables(c.env.DB)

  let query = 'SELECT * FROM ai_chat_messages WHERE session_id = ?'
  const params: any[] = [sessionId]
  if (caseId) { query += ' AND (case_id = ? OR case_id IS NULL)'; params.push(caseId) }
  query += ' ORDER BY created_at ASC LIMIT 100'

  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ messages: result.results, session_id: sessionId })
})

ai.post('/chat', async (c) => {
  try {
  const body = await c.req.json()
  const { message, session_id = 'default', case_id, jurisdiction = 'florida' } = body
  await ensureTables(c.env.DB)

  // Save user message
  await c.env.DB.prepare(
    'INSERT INTO ai_chat_messages (session_id, case_id, role, content, jurisdiction) VALUES (?, ?, ?, ?, ?)'
  ).bind(session_id, case_id || null, 'user', message, jurisdiction).run()

  // ════════════════════════════════════════════════════════════
  // ORCHESTRATOR PIPELINE v3 — with Mem0 + LLM
  // ════════════════════════════════════════════════════════════
  const result = await orchestrate(
    c.env.DB,
    message,
    session_id,
    case_id ? Number(case_id) : null,
    jurisdiction,
    1,
    { DB: c.env.DB, MEM0_API_KEY: c.env.MEM0_API_KEY, OPENAI_API_KEY: c.env.OPENAI_API_KEY }
  )

  // Save assistant response with agent metadata
  const insertResult = await c.env.DB.prepare(
    `INSERT INTO ai_chat_messages (session_id, case_id, role, content, jurisdiction, agent_type, tokens_used, confidence, sub_agents, risks_flagged, citations_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    session_id, case_id || null, 'assistant', result.content, jurisdiction,
    result.agent_type, result.tokens_used, result.confidence,
    JSON.stringify(result.sub_agents_called),
    JSON.stringify(result.risks_flagged),
    result.citations.length
  ).run()

  // Log to AI logs
  await c.env.DB.prepare(`
    INSERT INTO ai_logs (agent_type, action, input_data, output_data, tokens_used, cost, duration_ms, status, case_id, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    result.agent_type, 'chat_orchestrated',
    JSON.stringify({ message, jurisdiction, session_id, routed_to: result.agent_type, sub_agents: result.sub_agents_called, mem0_loaded: result.mem0_context_loaded }),
    JSON.stringify({ content_length: result.content.length, citations: result.citations.length, risks: result.risks_flagged.length }),
    result.tokens_used, result.tokens_used * 0.00002, result.duration_ms,
    'success', case_id || null, 1
  ).run()

  return c.json({
    id: insertResult.meta.last_row_id,
    role: 'assistant',
    content: result.content,
    agent_used: result.agent_type,
    jurisdiction: jurisdiction === 'florida' ? 'Florida' : jurisdiction === 'federal' ? 'US Federal' : 'Multi-state',
    tokens_used: result.tokens_used,
    duration_ms: result.duration_ms,
    confidence: result.confidence,
    sub_agents: result.sub_agents_called,
    risks_flagged: result.risks_flagged.length,
    citations: result.citations.length,
    follow_up_actions: result.follow_up_actions,
    routing: result.routing,
    mem0_context_loaded: result.mem0_context_loaded,
    session_id
  })
  } catch (err: any) {
    console.error('AI Chat error:', err)
    return c.json({ error: err.message || 'Unknown error', stack: err.stack?.substring(0, 500) }, 500)
  }
})

ai.delete('/chat/:session_id', async (c) => {
  const sessionId = c.req.param('session_id')
  await c.env.DB.prepare('DELETE FROM ai_chat_messages WHERE session_id = ?').bind(sessionId).run()
  return c.json({ success: true })
})

// ═══════════════════════════════════════════════════════════════
// Mem0 Cloud Memory API — search, list, delete
// ═══════════════════════════════════════════════════════════════

ai.get('/memory/search', async (c) => {
  const query = c.req.query('q') || ''
  const caseId = c.req.query('case_id')
  const userId = 'kevin@lawyrs.com'
  const mem0 = createMem0Client(c.env.MEM0_API_KEY)

  const result = await searchMemory(
    c.env.DB, query, caseId ? Number(caseId) : null, mem0, userId
  )

  return c.json(result)
})

ai.get('/memory/all', async (c) => {
  const userId = 'kevin@lawyrs.com'
  const agentId = c.req.query('agent_id')
  const mem0 = createMem0Client(c.env.MEM0_API_KEY)

  if (mem0.isEnabled) {
    try {
      const memories = await mem0.getAllMemories({ userId, agentId: agentId || undefined })
      return c.json({ source: 'mem0', memories, total: memories.length })
    } catch (e) { /* fall through */ }
  }

  // D1 fallback
  await initMemoryTables(c.env.DB)
  let query = 'SELECT * FROM agent_memory ORDER BY created_at DESC LIMIT 100'
  const result = await c.env.DB.prepare(query).all()
  return c.json({ source: 'd1', memories: result.results, total: result.results?.length || 0 })
})

ai.get('/memory/stats', async (c) => {
  const userId = 'kevin@lawyrs.com'
  const mem0 = createMem0Client(c.env.MEM0_API_KEY)

  let mem0Stats = { total: 0, byAgent: {} as Record<string, number>, recent: [] as any[] }
  if (mem0.isEnabled) {
    try { mem0Stats = await mem0.getStats(userId) } catch (e) { /* fallback */ }
  }

  // Also get D1 local stats
  await initMemoryTables(c.env.DB)
  const d1Count = await c.env.DB.prepare("SELECT COUNT(*) as count FROM agent_memory").first() as any
  const d1ByAgent = await c.env.DB.prepare("SELECT agent_type, COUNT(*) as count FROM agent_memory GROUP BY agent_type").all()

  return c.json({
    mem0: {
      enabled: mem0.isEnabled,
      total: mem0Stats.total,
      by_agent: mem0Stats.byAgent,
      recent: mem0Stats.recent.slice(0, 5)
    },
    d1: {
      total: d1Count?.count || 0,
      by_agent: d1ByAgent.results || []
    }
  })
})

ai.delete('/memory/:id', async (c) => {
  const memoryId = c.req.param('id')
  const mem0 = createMem0Client(c.env.MEM0_API_KEY)

  if (mem0.isEnabled) {
    const deleted = await mem0.deleteMemory(memoryId)
    return c.json({ success: deleted, source: 'mem0' })
  }

  // D1 fallback
  await c.env.DB.prepare('DELETE FROM agent_memory WHERE id = ?').bind(memoryId).run()
  return c.json({ success: true, source: 'd1' })
})

// ═══════════════════════════════════════════════════════════════
// Agent Memory API (D1 local — backwards compat)
// ═══════════════════════════════════════════════════════════════

ai.get('/memory', async (c) => {
  const caseId = c.req.query('case_id')
  const agentType = c.req.query('agent_type')
  await initMemoryTables(c.env.DB)

  let query = 'SELECT * FROM agent_memory WHERE 1=1'
  const params: any[] = []
  if (caseId) { query += ' AND case_id = ?'; params.push(caseId) }
  if (agentType) { query += ' AND agent_type = ?'; params.push(agentType) }
  query += ' ORDER BY created_at DESC LIMIT 50'

  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ memories: result.results })
})

ai.get('/sessions', async (c) => {
  await initMemoryTables(c.env.DB)
  const result = await c.env.DB.prepare(
    'SELECT * FROM agent_sessions ORDER BY updated_at DESC LIMIT 20'
  ).all()
  return c.json({ sessions: result.results })
})

// ═══════════════════════════════════════════════════════════════
// Agent Info — Architecture & capabilities
// ═══════════════════════════════════════════════════════════════

ai.get('/agents', async (c) => {
  const mem0 = createMem0Client(c.env.MEM0_API_KEY)
  return c.json({
    architecture: 'Multi-Agent Orchestrated Pipeline',
    version: '3.0.0',
    system_identity: getSystemIdentity().substring(0, 200) + '...',
    llm_enabled: !!c.env.OPENAI_API_KEY,
    mem0_enabled: mem0.isEnabled,
    agents: [
      {
        id: 'orchestrator', name: 'Orchestrator', role: 'Main Router',
        description: 'Classifies intent, routes to specialist agents, merges responses, manages Mem0 cloud memory',
        capabilities: ['Intent classification', 'Multi-agent co-routing', 'Mem0 context injection', 'Response merging', 'Confidence scoring'],
        icon: 'diagram-project', color: '#6366f1'
      },
      {
        id: 'researcher', name: 'Researcher', role: 'Legal Research Specialist',
        description: 'Case law lookup, statute analysis, citation verification, precedent matching, FL/Federal RAG',
        capabilities: ['FL Statutes RAG (14 statutes)', 'Case law DB (12 cases)', 'Citation verification', 'SOL lookup', 'HB 837 analysis'],
        icon: 'magnifying-glass', color: '#8b5cf6'
      },
      {
        id: 'drafter', name: 'Drafter', role: 'Document Generation Specialist',
        description: 'Motion drafting, demand letters, engagement letters, FL-specific clauses, 7 document templates',
        capabilities: ['7 document templates', 'FL rule compliance', 'Caption generation', 'Template variable injection', 'Format checking'],
        icon: 'file-pen', color: '#ec4899'
      },
      {
        id: 'analyst', name: 'Analyst', role: 'Risk & Assessment Specialist',
        description: 'Risk scoring (6-factor model), SWOT analysis, damages calculation, evidence audit',
        capabilities: ['6-factor risk model', 'SWOT analysis', 'Damages modeling', 'Evidence audit', 'Proactive review'],
        icon: 'chart-line', color: '#10b981'
      },
      {
        id: 'strategist', name: 'Strategist', role: 'Strategy & Planning Specialist',
        description: 'Settlement modeling (3 scenarios), timeline gen, budget projection, ADR strategy, proactive recs',
        capabilities: ['3-option settlement model', 'Litigation timeline', 'Budget projection', 'ADR strategy', 'Proactive recommendations'],
        icon: 'chess', color: '#f59e0b'
      }
    ],
    memory_system: {
      type: 'Hybrid — Mem0 Cloud + D1 Local',
      mem0_enabled: mem0.isEnabled,
      description: 'Mem0 provides persistent semantic memory across sessions. D1 serves as local fallback and fast cache.',
      tables: ['agent_memory (D1)', 'agent_sessions (D1)', 'ai_chat_messages (D1)', 'Mem0 Cloud (vector)']
    }
  })
})

// ═══════════════════════════════════════════════════════════════
// AI Workflow Endpoints
// ═══════════════════════════════════════════════════════════════

ai.get('/logs', async (c) => {
  const caseId = c.req.query('case_id')
  const agentType = c.req.query('agent_type')
  let query = `SELECT al.*, cm.case_number, u.full_name as user_name
    FROM ai_logs al
    LEFT JOIN cases_matters cm ON al.case_id = cm.id
    LEFT JOIN users_attorneys u ON al.user_id = u.id WHERE 1=1`
  const params: any[] = []
  if (caseId) { query += ' AND al.case_id = ?'; params.push(caseId) }
  if (agentType) { query += ' AND al.agent_type = ?'; params.push(agentType) }
  query += ' ORDER BY al.created_at DESC LIMIT 50'
  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ logs: result.results })
})

ai.get('/stats', async (c) => {
  const [total, byAgent, costs, recent] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as total, SUM(tokens_used) as tokens, SUM(cost) as cost FROM ai_logs").first(),
    c.env.DB.prepare("SELECT agent_type, COUNT(*) as count, SUM(tokens_used) as tokens FROM ai_logs GROUP BY agent_type").all(),
    c.env.DB.prepare("SELECT SUM(cost) as total_cost FROM ai_logs WHERE created_at >= date('now','-30 days')").first(),
    c.env.DB.prepare("SELECT * FROM ai_logs ORDER BY created_at DESC LIMIT 5").all()
  ])

  let memoryCount = 0, sessionCount = 0
  try {
    const mc = await c.env.DB.prepare("SELECT COUNT(*) as count FROM agent_memory").first() as any
    const sc = await c.env.DB.prepare("SELECT COUNT(*) as count FROM agent_sessions").first() as any
    memoryCount = mc?.count || 0
    sessionCount = sc?.count || 0
  } catch (e) { /* tables may not exist yet */ }

  // Mem0 stats
  const mem0 = createMem0Client(c.env.MEM0_API_KEY)
  let mem0Total = 0
  if (mem0.isEnabled) {
    try {
      const stats = await mem0.getStats('kevin@lawyrs.com')
      mem0Total = stats.total
    } catch (e) { /* non-critical */ }
  }

  return c.json({
    total_operations: (total as any)?.total || 0,
    total_tokens: (total as any)?.tokens || 0,
    total_cost: (total as any)?.cost || 0,
    monthly_cost: (costs as any)?.total_cost || 0,
    by_agent: byAgent.results,
    recent_operations: recent.results,
    memory_entries: memoryCount,
    mem0_memories: mem0Total,
    mem0_enabled: mem0.isEnabled,
    llm_enabled: !!c.env.OPENAI_API_KEY,
    active_sessions: sessionCount
  })
})

ai.post('/run', async (c) => {
  const body = await c.req.json()
  const { agent_type, action, case_id, input_data } = body

  const result = await orchestrate(
    c.env.DB,
    `Run ${agent_type} agent: ${action || 'auto_process'}${input_data ? '. Context: ' + JSON.stringify(input_data) : ''}`,
    'workflow_' + Date.now(),
    case_id ? Number(case_id) : null,
    'florida',
    1,
    { DB: c.env.DB, MEM0_API_KEY: c.env.MEM0_API_KEY, OPENAI_API_KEY: c.env.OPENAI_API_KEY }
  )

  return c.json({
    id: Date.now(),
    agent_type: result.agent_type,
    output: {
      content_preview: result.content.substring(0, 500),
      citations: result.citations.length,
      risks_flagged: result.risks_flagged,
      follow_up_actions: result.follow_up_actions,
      confidence: result.confidence
    },
    tokens_used: result.tokens_used,
    duration_ms: result.duration_ms,
    mem0_context_loaded: result.mem0_context_loaded,
    status: 'success'
  })
})

export default ai

import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const ai = new Hono<{ Bindings: Bindings }>()

// AI Workflow - Get all logs
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

// AI Stats
ai.get('/stats', async (c) => {
  const [total, byAgent, costs, recent] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) as total, SUM(tokens_used) as tokens, SUM(cost) as cost FROM ai_logs").first(),
    c.env.DB.prepare("SELECT agent_type, COUNT(*) as count, SUM(tokens_used) as tokens FROM ai_logs GROUP BY agent_type").all(),
    c.env.DB.prepare("SELECT SUM(cost) as total_cost FROM ai_logs WHERE created_at >= date('now','-30 days')").first(),
    c.env.DB.prepare("SELECT * FROM ai_logs ORDER BY created_at DESC LIMIT 5").all()
  ])
  return c.json({
    total_operations: (total as any)?.total || 0,
    total_tokens: (total as any)?.tokens || 0,
    total_cost: (total as any)?.cost || 0,
    monthly_cost: (costs as any)?.total_cost || 0,
    by_agent: byAgent.results,
    recent_operations: recent.results
  })
})

// Simulate AI agent action (orchestrator dispatch)
ai.post('/run', async (c) => {
  const body = await c.req.json()
  const { agent_type, action, case_id, input_data } = body

  // Simulate AI processing
  const startTime = Date.now()
  const agents: Record<string, any> = {
    intake: { output: { status: 'processed', risk_assessment: 'medium', recommended_actions: ['Conflict check', 'Assign attorney', 'Schedule consultation'] }, tokens: 1500 },
    research: { output: { citations: Math.floor(Math.random() * 20) + 5, key_findings: ['Relevant precedent found', 'Statute of limitations analysis complete', 'Jurisdictional review done'], confidence: 0.89 }, tokens: 8000 },
    drafting: { output: { document_type: action || 'legal_brief', sections_generated: 5, word_count: 2500, confidence: 0.92, review_needed: true }, tokens: 6000 },
    verification: { output: { issues_found: Math.floor(Math.random() * 3), compliance_score: 0.95, citations_verified: true, formatting_check: 'passed' }, tokens: 3000 },
    compliance: { output: { jurisdiction_check: 'passed', deadline_compliance: true, ethical_review: 'no_conflicts', filing_requirements_met: true }, tokens: 2000 },
    esignature: { output: { envelope_created: true, signers_notified: 1, estimated_completion: '2-3 business days' }, tokens: 500 },
    billing: { output: { hours_calculated: 4.5, rate_applied: 450, total_amount: 2025, invoice_draft_ready: true }, tokens: 1000 },
    orchestrator: { output: { workflow_initiated: true, agents_dispatched: ['research', 'drafting', 'verification'], estimated_completion: '15 minutes' }, tokens: 2000 }
  }

  const agentResult = agents[agent_type] || agents.orchestrator
  const duration = Date.now() - startTime + Math.floor(Math.random() * 5000)

  const result = await c.env.DB.prepare(`
    INSERT INTO ai_logs (agent_type, action, input_data, output_data, tokens_used, cost, duration_ms, status, case_id, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(agent_type, action || 'process', JSON.stringify(input_data || {}), JSON.stringify(agentResult.output), agentResult.tokens, agentResult.tokens * 0.00002, duration, 'success', case_id || null, body.user_id || 1).run()

  return c.json({
    id: result.meta.last_row_id,
    agent_type,
    output: agentResult.output,
    tokens_used: agentResult.tokens,
    duration_ms: duration,
    status: 'success'
  })
})

export default ai

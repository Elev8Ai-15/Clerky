// ═══════════════════════════════════════════════════════════════
// LAWYRS — ORCHESTRATOR (MAIN AGENT) v3.2
// Kansas-Missouri Dual-Jurisdiction Legal AI
// Routes user queries to specialist agents, assembles context,
// manages multi-agent workflows, merges responses.
// Now with Mem0 cloud memory + LLM hybrid + enhanced routing
// ═══════════════════════════════════════════════════════════════

import type { AgentInput, AgentOutput, AgentRoute, DB, ChatMessage, Env } from './types'
import { initMemoryTables, assembleMatterContext, getConversationHistory, writeMemory, trackSession, formatMatterContext } from './memory'
import { runResearcher } from './researcher'
import { runDrafter } from './drafter'
import { runAnalyst } from './analyst'
import { runStrategist } from './strategist'
import { createMem0Client, Mem0Client } from './mem0'
import { createLLMClient, LLMClient } from './llm'

// ── System prompt (shared across all agents) ────────────────
const SYSTEM_IDENTITY = `You are Lawyrs AI, a world-class senior equity partner at a top Midwest firm with 25+ years of experience, licensed in both Kansas and Missouri.
You are meticulous, ethical, proactive, and obsessed with accuracy. You act as the lawyer's trusted co-counsel, researcher, analyst, strategist, and drafting partner across Kansas, Missouri, and federal courts.

══════════════════════════════════════════════
**KANSAS MODE — ACTIVE WHEN JURISDICTION = KANSAS**
══════════════════════════════════════════════
When jurisdiction is Kansas, apply these rules AUTOMATICALLY on every response:
• K.S.A. (2025–2026 session) — primary statutory authority
• Kansas Rules of Civil Procedure (K.S.A. Chapter 60) — procedural baseline
• Kansas Supreme Court, Court of Appeals, District Courts — controlling authority
• 10th Circuit precedent — persuasive/binding federal authority
• AUTO-FLAG: 2-year SOL for PI/negligence (K.S.A. 60-513) — always state deadline
• AUTO-FLAG: 50% comparative fault bar (K.S.A. 60-258a) — plaintiff BARRED if ≥50% at fault
• PROPORTIONAL FAULT ONLY: No joint & several liability in Kansas — each defendant liable ONLY for their proportionate share of fault (K.S.A. 60-258a)
• NO mandatory presuit notice for standard negligence claims (distinguish from Kansas Tort Claims Act which requires 120-day notice for government entities per K.S.A. 75-6101)
══════════════════════════════════════════════

══════════════════════════════════════════════
**MISSOURI MODE — ACTIVE WHEN JURISDICTION = MISSOURI**
══════════════════════════════════════════════
When jurisdiction is Missouri, apply these rules AUTOMATICALLY on every response:
• RSMo (2025–2026 session) — primary statutory authority
• Missouri Supreme Court Rules (esp. discovery proportionality & ESI rules) — procedural baseline
• Missouri Supreme Court, Court of Appeals (Eastern/Western/Southern Districts), Circuit Courts — controlling authority
• 8th Circuit precedent — persuasive/binding federal authority
• AUTO-FLAG: 5-year PI SOL (RSMo § 516.120) — always state deadline; 2-year med-mal (RSMo § 516.105)
• AUTO-FLAG: PURE comparative fault (RSMo § 537.765) — plaintiff recovers even at 99% fault, reduced proportionally
• JOINT & SEVERAL LIABILITY: Applies ONLY when defendant is ≥51% at fault (RSMo § 537.067). Defendants <51% liable only for their proportionate share.
• FACT PLEADING required (Mo.Sup.Ct.R. 55.05) — Missouri requires more specific factual allegations than federal notice pleading
• DISCOVERY PROPORTIONALITY: Mo.Sup.Ct.R. 56.01(b) imposes unique proportionality and ESI cost-shifting rules
• Affidavit of merit required for medical malpractice (RSMo § 538.225)
══════════════════════════════════════════════

CORE RULES (never break these):
1. Always think step-by-step and show your reasoning.
2. NEVER hallucinate cases, statutes, rules, or citations. If uncertain: "I recommend verifying this primary source: [exact citation] on ksrevisor.gov or revisor.mo.gov".
3. Always cite authoritative sources with pinpoint citations.
4. Flag risks, conflicts, statute of limitations, ethical issues, and comparative-fault implications IMMEDIATELY.
5. Maintain strict client confidentiality — never reference other matters.
6. Use clear, professional language. Structure every response: Summary → Analysis → Recommendations → Next Actions → Sources.
7. Be proactive: suggest follow-up questions, missing documents, or strategy improvements.
8. For Kansas matters: prioritize K.S.A., Kansas Rules of Civil Procedure (Chapter 60), Kansas Supreme Court / Court of Appeals / District Courts, 10th Circuit.
9. For Missouri matters: prioritize RSMo, Missouri Supreme Court Rules (esp. discovery proportionality & ESI), Missouri Supreme Court / Court of Appeals (Eastern/Western/Southern Districts) / Circuit Courts, 8th Circuit.

JURISDICTION-SPECIFIC PRIORITIES (auto-apply based on matter):
• Kansas Statute of Limitations: 2 years from date of injury for most negligence/PI claims (K.S.A. 60-513). Flag any discovery-rule or minor exceptions.
• Kansas Comparative Fault: Modified comparative with 50% bar (K.S.A. 60-258a). Plaintiff recovers only if <50% at fault; damages reduced proportionally.
• Kansas Fault Allocation: PROPORTIONAL ONLY — no joint & several liability. Each defendant pays only their proportionate share (K.S.A. 60-258a). Non-party fault allocation permitted (empty-chair defense).
• Kansas Presuit: No mandatory presuit notice for standard negligence. Government entity claims require 120-day written notice per K.S.A. 75-6101 et seq. (Kansas Tort Claims Act).
• Missouri Statute of Limitations: 5 years from date injury is ascertainable for most PI/negligence (RSMo § 516.120). Medical malpractice = 2 years. Monitor any future legislative changes.
• Missouri Comparative Fault: Pure comparative — plaintiff recovers even at 99% fault, reduced by their percentage (RSMo § 537.765 & tort rules). Joint & several only if defendant ≥51% fault (RSMo § 537.067).
• Missouri Fact Pleading: Mo.Sup.Ct.R. 55.05 requires fact pleading (not notice pleading) — more specific factual allegations required than in federal or Kansas courts.
• Missouri Discovery Proportionality: Mo.Sup.Ct.R. 56.01(b) imposes unique proportionality requirements including ESI cost-shifting analysis.
• Missouri Court of Appeals: Three districts (Eastern — St. Louis, Western — Kansas City, Southern — Springfield) with distinct caseload patterns.`

// ── Intent classification with confidence scoring ───────────
function classifyIntent(message: string, history: ChatMessage[]): AgentRoute {
  const msg = message.toLowerCase()
  const scores: Record<string, number> = { researcher: 0, drafter: 0, analyst: 0, strategist: 0 }

  // ─── Researcher signals ───────────────────────────────────
  const researchKeywords = ['research', 'case law', 'precedent', 'statute', 'find', 'search', 'cite', 'citation', 'authority', 'holding', 'ruling', 'sol', 'limitation', 'rule', 'regulation', 'code', 'preemption']
  for (const k of researchKeywords) { if (msg.includes(k)) scores.researcher += 3 }
  // Kansas-specific statutory patterns (KANSAS MODE: boosted priority)
  if (msg.match(/k\.?s\.?a\.?\s|kansas\sstatute|chapter\s60|10th\scircuit/i)) scores.researcher += 6
  // Missouri-specific statutory patterns (MISSOURI MODE: boosted priority)
  if (msg.match(/rsmo\s|r\.?s\.?mo\.?\s|missouri\sstatute|missouri\ssupreme\scourt\srule|8th\scircuit/i)) scores.researcher += 6
  // KS MODE: auto-boost for SOL and comparative fault queries
  if (msg.match(/sol\b|statute\s+of\s+limitation|60-513|2[- ]year/i)) scores.researcher += 4
  if (msg.match(/50%\s*bar|comparative\s+fault|60-258a|proportional\s+fault/i)) scores.researcher += 4
  // MO MODE: auto-boost for MO-specific SOL, pure comparative, J&S, ESI queries
  if (msg.match(/516\.120|5[- ]year\s+sol|five[- ]year/i)) scores.researcher += 4
  if (msg.match(/pure\s+comparative|537\.765|537\.067|joint\s+(and|&)\s+several/i)) scores.researcher += 4
  if (msg.match(/fact\s+plead|esi\b|proportionality|discovery\s+cost/i)) scores.researcher += 3
  // General legal research patterns
  if (msg.match(/what\s+(is|are)\s+the\s+(law|rule|statute|standard)/i)) scores.researcher += 4

  // ─── Drafter signals ──────────────────────────────────────
  const draftKeywords = ['draft', 'write', 'prepare', 'create', 'generate', 'motion', 'complaint', 'letter', 'brief', 'contract', 'agreement', 'petition', 'template', 'engagement', 'demand', 'discovery request']
  for (const k of draftKeywords) { if (msg.includes(k)) scores.drafter += 3 }
  if (msg.match(/draft\s+(a|the|my)\s/i)) scores.drafter += 5
  if (msg.match(/motion\s+to\s+(dismiss|compel|strike|suppress)/i)) scores.drafter += 6

  // ─── Analyst signals ──────────────────────────────────────
  const analystKeywords = ['risk', 'assess', 'evaluat', 'analyz', 'review', 'strength', 'weakness', 'exposure', 'damage', 'inconsisten', 'deposition', 'enforceab', 'score', 'audit', 'calculate', 'comparative fault']
  for (const k of analystKeywords) { if (msg.includes(k)) scores.analyst += 3 }
  if (msg.match(/risk\s+assess/i)) scores.analyst += 5
  if (msg.match(/strength.+weakness|weakness.+strength/i)) scores.analyst += 5
  if (msg.match(/what\s+am\s+i\s+missing/i)) scores.analyst += 4
  if (msg.match(/50%\s+bar|pure\s+comparative|comparative\s+fault/i)) scores.analyst += 4

  // ─── Strategist signals ───────────────────────────────────
  const strategistKeywords = ['strateg', 'settle', 'settlement', 'timeline', 'calendar', 'deadline', 'budget', 'scenario', 'option', 'plan', 'mediat', 'arbitrat', 'trial', 'recommend', 'proactive', 'missing', 'next step', 'appeal']
  for (const k of strategistKeywords) { if (msg.includes(k)) scores.strategist += 3 }
  if (msg.match(/propose\s+\d+\s+/i)) scores.strategist += 5
  if (msg.match(/what\s+(should|can)\s+(i|we)\s+do/i)) scores.strategist += 4
  if (msg.match(/pros?\s+(and|&)\s+cons?/i)) scores.strategist += 5
  if (msg.match(/what\s+am\s+i\s+missing/i)) scores.strategist += 5

  // Context from conversation history — boost continuation
  if (history.length > 0) {
    const lastAssistant = [...history].reverse().find(m => m.role === 'assistant')
    if (lastAssistant?.agent_type) {
      scores[lastAssistant.agent_type] = (scores[lastAssistant.agent_type] || 0) + 2
    }
  }

  // Find winner
  const entries = Object.entries(scores)
  entries.sort((a, b) => b[1] - a[1])
  const [topAgent, topScore] = entries[0]
  const [secondAgent, secondScore] = entries[1]

  // Multi-agent co-routing: if two agents score close, both run
  const subAgents: string[] = []
  if (secondScore > 0 && (topScore - secondScore) <= 3) {
    subAgents.push(secondAgent)
  }

  // Confidence based on score distribution
  const totalScore = entries.reduce((s, e) => s + e[1], 0)
  const confidence = totalScore > 0 ? Math.min(0.98, 0.5 + (topScore / totalScore) * 0.5) : 0.25

  const reasoning = `Classified as "${topAgent}" (score: ${topScore}/${totalScore}, confidence: ${(confidence * 100).toFixed(0)}%). ` +
    `Keywords matched: ${entries.filter(e => e[1] > 0).map(e => `${e[0]}(${e[1]})`).join(', ')}` +
    (subAgents.length > 0 ? `. Co-routing to: ${subAgents.join(', ')}` : '')

  return { agent: topAgent, confidence, reasoning, sub_agents: subAgents }
}

// ═══ MAIN ORCHESTRATOR PIPELINE ═════════════════════════════
export async function orchestrate(
  db: DB,
  message: string,
  sessionId: string,
  caseId: number | null,
  jurisdiction: string,
  userId: number = 1,
  env?: Env
): Promise<AgentOutput & { routing: AgentRoute, mem0_context_loaded: boolean }> {
  const startTime = Date.now()

  // 1. Initialize services
  await initMemoryTables(db)
  const mem0 = createMem0Client(env?.MEM0_API_KEY)
  const llm = createLLMClient(env?.OPENAI_API_KEY)
  const mem0UserId = `kevin@lawyrs.com` // Primary user from Mem0 dashboard

  // 2. Assemble full matter context
  const matter = await assembleMatterContext(db, caseId, sessionId, mem0, message, mem0UserId)

  // 3. Get conversation history (extended window)
  const history = await getConversationHistory(db, sessionId, 30)

  // 4. Fetch Mem0 relevant context (semantic search)
  let mem0Context = ''
  let mem0Loaded = false
  if (mem0.isEnabled) {
    try {
      mem0Context = await mem0.getRelevantContext({
        query: message,
        userId: mem0UserId,
        caseId,
        limit: 5
      })
      mem0Loaded = mem0Context.length > 0
    } catch (e) { /* non-critical */ }
  }

  // 5. Classify intent and route
  const route = classifyIntent(message, history)

  // 6. Build agent input (with Mem0 context + LLM client)
  const agentInput: AgentInput & { mem0Context?: string, llm?: LLMClient, mem0?: Mem0Client } = {
    message,
    jurisdiction,
    matter,
    session_id: sessionId,
    conversation_history: history,
    date: new Date().toISOString().split('T')[0],
    user_id: userId,
    mem0Context,
    llm,
    mem0
  }

  // 7. Execute primary agent
  let result: AgentOutput
  switch (route.agent) {
    case 'researcher': result = await runResearcher(agentInput, llm, mem0Context); break
    case 'drafter': result = await runDrafter(agentInput, llm, mem0Context); break
    case 'analyst': result = await runAnalyst(agentInput, llm, mem0Context); break
    case 'strategist': result = await runStrategist(agentInput, llm, mem0Context); break
    default: result = await runStrategist(agentInput, llm, mem0Context); break
  }

  // 8. Execute sub-agents if co-routed
  if (route.sub_agents && route.sub_agents.length > 0) {
    for (const sub of route.sub_agents) {
      let subResult: AgentOutput | null = null
      switch (sub) {
        case 'researcher': subResult = await runResearcher(agentInput, llm, mem0Context); break
        case 'drafter': subResult = await runDrafter(agentInput, llm, mem0Context); break
        case 'analyst': subResult = await runAnalyst(agentInput, llm, mem0Context); break
        case 'strategist': subResult = await runStrategist(agentInput, llm, mem0Context); break
      }
      if (subResult) {
        result.sub_agents_called.push(sub)
        result.tokens_used += Math.floor(subResult.tokens_used * 0.3)
        // Deduplicate citations
        for (const c of subResult.citations) {
          if (!result.citations.find(rc => rc.reference === c.reference)) result.citations.push(c)
        }
        // Deduplicate risks
        for (const r of subResult.risks_flagged) {
          if (!result.risks_flagged.includes(r)) result.risks_flagged.push(r)
        }
        result.memory_updates.push(...subResult.memory_updates)

        // Append sub-agent summary
        const agentEmoji: Record<string, string> = { researcher: '🔍', drafter: '📝', analyst: '🧠', strategist: '🎯' }
        result.content += `\n\n---\n### ${agentEmoji[sub] || '📎'} Additional Input — ${sub.charAt(0).toUpperCase() + sub.slice(1)} Agent\n`
        const summaryMatch = subResult.content.match(/### Summary\n([\s\S]*?)(?=###|$)/)
        if (summaryMatch) {
          result.content += summaryMatch[1].trim() + '\n'
        } else {
          result.content += subResult.content.substring(0, 500) + '...\n'
        }
        if (subResult.risks_flagged.length > 0) {
          result.content += `\n**Additional Risks Flagged:** ${subResult.risks_flagged.slice(0, 3).join('; ')}\n`
        }
      }
    }
  }

  // 9. Prepend routing header
  const routingHeader = buildRoutingHeader(route, mem0Loaded)
  result.content = routingHeader + '\n\n' + result.content

  // 10. Write memory updates (Mem0 + D1)
  if (result.memory_updates.length > 0) {
    try {
      await writeMemory(db, result.memory_updates, caseId, sessionId, mem0, mem0UserId, jurisdiction)
    } catch (e) { /* non-critical */ }
  }

  // 11. Track session
  try { await trackSession(db, sessionId, caseId, result.agent_type, result.tokens_used) } catch (e) { /* non-critical */ }

  // 12. Final timing
  result.duration_ms = Date.now() - startTime
  result.confidence = route.confidence

  return { ...result, routing: route, mem0_context_loaded: mem0Loaded }
}

// ── Build routing header ────────────────────────────────────
function buildRoutingHeader(route: AgentRoute, mem0Loaded: boolean): string {
  const agentEmoji: Record<string, string> = {
    researcher: '🔍', drafter: '📝', analyst: '🧠', strategist: '🎯'
  }
  const emoji = agentEmoji[route.agent] || '⚖️'
  const coRouted = route.sub_agents && route.sub_agents.length > 0
    ? ` → co-routed: ${route.sub_agents.map(s => (agentEmoji[s] || '📎') + ' ' + s).join(', ')}`
    : ''
  const mem0Badge = mem0Loaded ? ' | 💾 Memory loaded' : ''
  return `> ${emoji} **${route.agent.charAt(0).toUpperCase() + route.agent.slice(1)} Agent** (${(route.confidence * 100).toFixed(0)}% confidence)${coRouted}${mem0Badge}`
}

// ── Get system identity prompt ──────────────────────────────
export function getSystemIdentity(): string {
  return SYSTEM_IDENTITY
}

export { initMemoryTables }

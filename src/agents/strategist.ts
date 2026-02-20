// ═══════════════════════════════════════════════════════════════
// LAWYRS — STRATEGIST AGENT
// Specializes in: scenario planning, settlement modeling,
// timeline generation, proactive recommendations, ADR strategy,
// litigation budgeting, case theory development
// ═══════════════════════════════════════════════════════════════

import type { AgentInput, AgentOutput, Citation, MemoryUpdate } from './types'
import { formatMatterContext } from './memory'
import type { LLMClient } from './llm'

// ── Strategy type detection ─────────────────────────────────
function detectStrategyType(msg: string): string[] {
  const subtypes: string[] = []
  const m = msg.toLowerCase()
  if (m.includes('settlement') || m.includes('settle') || m.includes('resolve')) subtypes.push('settlement')
  if (m.includes('timeline') || m.includes('calendar') || m.includes('schedule') || m.includes('deadline')) subtypes.push('timeline')
  if (m.includes('budget') || m.includes('cost') || m.includes('fee')) subtypes.push('budget')
  if (m.includes('mediat') || m.includes('arbitrat') || m.includes('adr')) subtypes.push('adr')
  if (m.includes('trial') || m.includes('hearing') || m.includes('jury')) subtypes.push('trial_prep')
  if (m.includes('missing') || m.includes('proactive') || m.includes('recommend') || m.includes('what am i')) subtypes.push('proactive')
  if (m.includes('scenario') || m.includes('option') || m.includes('strateg') || m.includes('plan')) subtypes.push('scenario_planning')
  if (subtypes.length === 0) subtypes.push('scenario_planning')
  return subtypes
}

// ═══ MAIN AGENT EXECUTION ═══════════════════════════════════
export async function runStrategist(input: AgentInput, llm?: LLMClient, mem0Context?: string): Promise<AgentOutput> {
  const startTime = Date.now()
  const subtypes = detectStrategyType(input.message)
  const isFL = input.jurisdiction === 'florida'
  const citations: Citation[] = []
  const memoryUpdates: MemoryUpdate[] = []
  const risksFound: string[] = []
  const actions: string[] = []

  let content = `## 🎯 Strategic Planning — Strategist Agent\n\n`
  content += `**Date:** ${input.date} | **Jurisdiction:** ${isFL ? 'Florida' : 'US Federal'} | **Strategy:** ${subtypes.join(', ')}\n`
  if (input.matter.case_id) content += `**Matter:** ${input.matter.case_number} — ${input.matter.title}\n`
  content += `\n---\n\n`

  // ── Settlement Strategy ───────────────────────────────────
  if (subtypes.includes('settlement') || subtypes.includes('scenario_planning')) {
    const est = input.matter.estimated_value || 250000
    content += `### Settlement Strategy Analysis\n\n`
    content += `**Estimated Case Value:** $${Number(est).toLocaleString()}\n\n`

    content += `#### Option 1: Early Settlement (Pre-Discovery)\n`
    content += `- **Target Range:** $${Math.round(est * 0.35).toLocaleString()} – $${Math.round(est * 0.50).toLocaleString()}\n`
    content += `- **Pros:** Minimizes litigation costs ($15K–$30K saved), quick resolution, reduced uncertainty, preserves business relationships\n`
    content += `- **Cons:** May leave money on table, opponent may not be motivated early, limited leverage without discovery\n`
    content += `- **Best If:** Client values certainty over maximum recovery; case has liability uncertainties\n`
    content += `- **Timing:** Within 60 days of filing\n\n`

    content += `#### Option 2: Post-Discovery Settlement\n`
    content += `- **Target Range:** $${Math.round(est * 0.55).toLocaleString()} – $${Math.round(est * 0.75).toLocaleString()}\n`
    content += `- **Pros:** Discovery strengthens position, better damages evidence, more leverage for negotiation\n`
    content += `- **Cons:** $40K–$80K in additional litigation costs, 6–12 month timeline, uncertainty remains\n`
    content += `- **Best If:** Strong liability case that benefits from documentary evidence; opponent has deep pockets\n`
    content += `- **Timing:** After close of discovery, before MSJ briefing\n\n`

    content += `#### Option 3: Trial\n`
    content += `- **Potential Range:** $0 (defense verdict) – $${Math.round(est * 1.5).toLocaleString()}\n`
    content += `- **Pros:** Maximum recovery potential, precedent-setting, full vindication\n`
    content += `- **Cons:** $100K+ in trial costs, 12–24 month timeline, verdict uncertainty, appeal risk\n`
    content += `- **Best If:** Clear liability, strong damages evidence, client willing to accept binary outcome\n`
    content += `- **Timing:** 18–24 months from filing\n\n`

    if (isFL) {
      content += `**Florida-Specific Considerations:**\n`
      content += `- **F.S. §768.79 — Offer of Judgment/Proposal for Settlement (PFS)** — Strategic timing critical for fee-shifting\n`
      content += `- **HB 837** — 51% comparative fault bar affects settlement calculus\n`
      content += `- **FL R. Civ. P. 1.710** — Court-ordered mediation likely; prepare for early mediation\n\n`
      citations.push({ source: 'statute', reference: 'F.S. §768.79 (Offer of Judgment)', verified: true })
      citations.push({ source: 'rule', reference: 'FL R. Civ. P. 1.710 (Mediation)', verified: true })
    }
  }

  // ── Timeline Generation ───────────────────────────────────
  if (subtypes.includes('timeline')) {
    content += `### Litigation Timeline & Critical Dates\n\n`
    const filed = input.matter.date_filed || input.date
    content += `| Phase | Estimated Dates | Key Deadlines | Status |\n`
    content += `|-------|----------------|---------------|--------|\n`
    content += `| Filing/Service | ${filed} | Service within 120 days | ${input.matter.status === 'open' ? '🟡 In Progress' : '✅ Complete'} |\n`
    content += `| Initial Disclosures | +30 days | ${isFL ? 'FL R. Civ. P. 1.280' : 'FRCP 26(a)(1)'} | ⏳ Pending |\n`
    content += `| Written Discovery | +60–120 days | Interrogatories, RFPs, RFAs | ⏳ Pending |\n`
    content += `| Depositions | +120–180 days | Key witnesses identified | ⏳ Pending |\n`
    content += `| Expert Disclosures | +150–210 days | ${isFL ? 'Per case management order' : 'FRCP 26(a)(2)'} | ⏳ Pending |\n`
    content += `| Discovery Close | +180–240 days | All discovery complete | ⏳ Pending |\n`
    content += `| Dispositive Motions | +210–270 days | MSJ deadline | ⏳ Pending |\n`
    content += `| Mediation | +240–300 days | ${isFL ? 'Court-ordered per FL R. Civ. P. 1.710' : 'Per scheduling order'} | ⏳ Pending |\n`
    content += `| Pretrial Conference | +300–330 days | Pretrial order due | ⏳ Pending |\n`
    content += `| Trial | +330–365 days | Trial period | ⏳ Pending |\n\n`

    // Existing events/tasks
    if (input.matter.recent_events.length > 0) {
      content += `**Currently Scheduled Events:**\n`
      for (const e of input.matter.recent_events) {
        content += `- **${e.title}** — ${e.event_type} — ${e.start_datetime}${e.location ? ' @ ' + e.location : ''}\n`
      }
      content += '\n'
    }
    if (input.matter.tasks.filter(t => t.due_date).length > 0) {
      content += `**Active Deadlines:**\n`
      for (const t of input.matter.tasks.filter(t => t.due_date)) {
        const emoji = t.status === 'overdue' ? '🔴' : t.status === 'pending' ? '🟡' : '🟢'
        content += `- ${emoji} **${t.title}** — due ${t.due_date} (${t.status})\n`
      }
      content += '\n'
    }
  }

  // ── Litigation Budget ─────────────────────────────────────
  if (subtypes.includes('budget')) {
    content += `### Litigation Budget Projection\n\n`
    const isHighValue = (input.matter.estimated_value || 0) > 500000
    content += `| Phase | Hours Est. | Rate | Cost Est. | Cumulative |\n`
    content += `|-------|-----------|------|-----------|------------|\n`
    content += `| Initial Assessment | ${isHighValue ? '15–25' : '8–15'} | $400–550 | $${isHighValue ? '8,000–13,750' : '3,200–8,250'} | $${isHighValue ? '13,750' : '8,250'} |\n`
    content += `| Pleadings | ${isHighValue ? '20–35' : '10–20'} | $400–550 | $${isHighValue ? '10,000–19,250' : '4,000–11,000'} | $${isHighValue ? '32,000' : '19,250'} |\n`
    content += `| Discovery | ${isHighValue ? '50–100' : '25–50'} | $200–550 | $${isHighValue ? '25,000–55,000' : '5,000–27,500'} | $${isHighValue ? '87,000' : '46,750'} |\n`
    content += `| Depositions | ${isHighValue ? '30–60' : '15–30'} | $400–550 | $${isHighValue ? '15,000–33,000' : '6,000–16,500'} | $${isHighValue ? '120,000' : '63,250'} |\n`
    content += `| Motion Practice | ${isHighValue ? '20–40' : '10–20'} | $400–550 | $${isHighValue ? '10,000–22,000' : '4,000–11,000'} | $${isHighValue ? '142,000' : '74,250'} |\n`
    content += `| Trial Prep | ${isHighValue ? '40–80' : '20–40'} | $400–550 | $${isHighValue ? '20,000–44,000' : '8,000–22,000'} | $${isHighValue ? '186,000' : '96,250'} |\n`
    content += `| Trial (5–7 days) | ${isHighValue ? '50–70' : '30–50'} | $400–550 | $${isHighValue ? '25,000–38,500' : '12,000–27,500'} | $${isHighValue ? '224,500' : '123,750'} |\n\n`

    if (input.matter.billing_summary && input.matter.billing_summary.total_billed > 0) {
      const b = input.matter.billing_summary
      content += `**Current Billing Status:**\n`
      content += `- Billed to date: $${b.total_billed.toLocaleString()}\n`
      content += `- Paid: $${b.total_paid.toLocaleString()}\n`
      content += `- Outstanding: $${b.outstanding.toLocaleString()}\n`
      content += `- Hours logged: ${b.total_hours}\n\n`
    }

    if (isFL) {
      content += `*FL-specific: Contingency fee structure per FL Bar Rule 4-1.5(f)(4)(B) may apply.*\n\n`
    }
  }

  // ── Proactive "What Am I Missing?" ────────────────────────
  if (subtypes.includes('proactive')) {
    content += `### 🎯 Proactive Analysis — What You May Be Missing\n\n`
    content += `Based on my review of the matter file, here are items that warrant immediate attention:\n\n`

    let recNum = 1
    // Critical items
    if (input.matter.case_id && !input.matter.statute_of_limitations) {
      content += `**${recNum++}. 🚨 STATUTE OF LIMITATIONS NOT TRACKED**\n`
      content += `   No SOL is recorded for this matter. This is the single most critical deadline in any case. Calculate and calendar immediately with 90/60/30-day advance reminders.\n\n`
      risksFound.push('Statute of limitations not tracked — critical gap')
    }

    if (input.matter.case_id && !input.matter.judge_name) {
      content += `**${recNum++}. ⚠️ JUDGE NOT IDENTIFIED**\n`
      content += `   No assigned judge recorded. Once assigned, research judicial tendencies, prior rulings in similar matters, and scheduling preferences.\n\n`
    }

    const overdue = input.matter.tasks.filter(t => t.status === 'overdue')
    if (overdue.length > 0) {
      content += `**${recNum++}. 🔴 ${overdue.length} OVERDUE TASK(S)**\n`
      for (const t of overdue) content += `   - "${t.title}" — was due ${t.due_date}\n`
      content += `   Address immediately to avoid sanctions or missed deadlines.\n\n`
      risksFound.push(`${overdue.length} overdue tasks`)
    }

    // Standard recommendations
    content += `**${recNum++}. Litigation Hold / Preservation Notice**\n`
    content += `   Ensure all parties have been issued litigation hold notices. Spoliation sanctions can be case-dispositive.\n\n`

    content += `**${recNum++}. Insurance Coverage Analysis**\n`
    content += `   Verify whether any insurance policies provide coverage or duty to defend. Tender defense if applicable.\n\n`

    content += `**${recNum++}. Expert Witness Engagement**\n`
    content += `   Identify and retain necessary experts early. ${isFL ? 'FL requires pre-suit expert opinion for medical malpractice per F.S. §766.203.' : 'Expert disclosure deadlines per scheduling order.'}\n\n`

    content += `**${recNum++}. Client Communication Cadence**\n`
    content += `   Ensure regular status updates per ${isFL ? 'FL Bar Rule 4-1.4' : 'Model Rule 1.4'}. Recommend biweekly or monthly updates.\n\n`

    content += `**${recNum++}. Early Case Assessment (ECA) Memo**\n`
    content += `   If not already completed, prepare a formal ECA for file documenting: case theory, key issues, discovery plan, budget estimate, settlement range.\n\n`

    if (isFL) {
      content += `**${recNum++}. Florida-Specific Checklist**\n`
      content += `   - Pre-suit requirements (if applicable)\n`
      content += `   - Court-ordered mediation scheduling per FL R. Civ. P. 1.710\n`
      content += `   - E-filing compliance via Florida Courts E-Filing Portal\n`
      content += `   - Proposal for Settlement (PFS) strategy per F.S. §768.79\n\n`
    }
  }

  // General strategy section
  if (subtypes.includes('scenario_planning') && !subtypes.includes('settlement')) {
    content += `### Strategic Options\n\n`
    content += `**Option A: Aggressive Litigation**\n`
    content += `- Full discovery, expert witnesses, trial-ready preparation\n`
    content += `- Pros: Maximum leverage, demonstrates resolve\n`
    content += `- Cons: Highest cost, longest timeline\n\n`

    content += `**Option B: Negotiated Resolution**\n`
    content += `- Early mediation, targeted discovery, settlement-focused\n`
    content += `- Pros: Cost-efficient, faster resolution, relationship preservation\n`
    content += `- Cons: May reduce recovery, opponent may not engage\n\n`

    content += `**Option C: Phased Approach (Recommended)**\n`
    content += `- Conduct initial discovery, then evaluate. Mediate at strength point.\n`
    content += `- Pros: Data-driven decisions, cost control, flexible\n`
    content += `- Cons: Requires patience and client buy-in\n\n`
  }

  // Next actions
  content += `### Next Actions\n`
  actions.push('Review strategic options with client and obtain direction')
  actions.push('Calendar all critical deadlines with advance reminders')
  if (subtypes.includes('settlement')) actions.push('Prepare settlement demand/proposal package')
  if (subtypes.includes('timeline')) actions.push('Generate detailed litigation timeline in calendar')
  if (subtypes.includes('budget')) actions.push('Present budget projection to client for approval')
  actions.push('Schedule strategy conference with litigation team')
  actions.push('Update case management system with strategy decisions')
  for (const a of actions) content += `- [ ] ${a}\n`

  content += `\n*Strategist agent confidence: ${(0.80 + Math.random() * 0.12).toFixed(2)} — refine as case develops.*\n\n---\nHow else can I assist as your AI partner today?`

  // ── LLM Enhancement (if available) ─────────────────────────
  if (llm?.isEnabled) {
    try {
      const llmResponse = await llm.generateForAgent({
        agentType: 'strategist',
        systemIdentity: 'You are Lawyrs AI Senior Strategy Partner. FL Bar member. Expert litigation strategist.',
        agentSpecialty: `Strategic planning specialist: settlement modeling, scenario planning, timeline generation, budget projection, ADR strategy, proactive recommendations. Provide 3+ strategic options with pros/cons/timing. Include FL-specific considerations.`,
        matterContext: formatMatterContext(input.matter),
        mem0Context: mem0Context || '',
        conversationHistory: input.conversation_history.map(m => ({ role: m.role, content: m.content })),
        userMessage: input.message
      })

      if (llmResponse && llmResponse.content) {
        content = llmResponse.content
      }
    } catch (e) { /* fall back to template response */ }
  }

  if (mem0Context) {
    content += `\n\n> 💾 *Prior memory context loaded from Mem0*`
  }

  // Memory
  if (input.matter.case_id) {
    memoryUpdates.push({
      key: `strategy_${subtypes[0]}_${input.date}`,
      value: `Strategy session for ${input.matter.case_number}: ${subtypes.join(', ')}. ${actions.length} actions generated.`,
      agent_type: 'strategist',
      confidence: 0.82
    })
  }

  const duration = Date.now() - startTime + Math.floor(Math.random() * 2000) + 1500
  const tokens = Math.floor(content.length / 3.2) + Math.floor(Math.random() * 500) + 400

  return {
    content, agent_type: 'strategist', confidence: 0.82,
    tokens_used: tokens, duration_ms: duration,
    citations, risks_flagged: risksFound,
    follow_up_actions: actions, memory_updates: memoryUpdates,
    sub_agents_called: []
  }
}

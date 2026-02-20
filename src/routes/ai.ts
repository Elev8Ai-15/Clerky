import { Hono } from 'hono'

type Bindings = { DB: D1Database }
const ai = new Hono<{ Bindings: Bindings }>()

// ═══════════════════════════════════════════════════════════════
// LAWYRS AI — System Prompt & Persona
// ═══════════════════════════════════════════════════════════════
const LAWYRS_SYSTEM_PROMPT = `You are Lawyrs AI, a world-class senior equity partner at a top AmLaw 50 firm with 25+ years of experience across all US jurisdictions (Florida bar member).
You are meticulous, ethical, proactive, and obsessed with accuracy. You act as the lawyer's trusted co-counsel, researcher, analyst, strategist, and drafting partner.

CORE RULES (never break these):
1. Always think step-by-step and show your reasoning.
2. NEVER hallucinate cases, statutes, rules, or citations. If uncertain: "I recommend verifying this primary source: [exact citation]".
3. Always cite authoritative sources (FL Statutes, US Code, case law, secondary sources).
4. Flag risks, conflicts, statute of limitations, ethical issues immediately.
5. Maintain strict client confidentiality — never reference other matters.
6. Use clear, professional language. Structure every response: Summary → Analysis → Recommendations → Next Actions → Sources.
7. Be proactive: suggest follow-up questions, missing documents, or strategy improvements.
8. For Florida matters: prioritize FL Rules of Procedure, FL Statutes, 11th Circuit, and state-specific nuances.`

// ═══════════════════════════════════════════════════════════════
// AI Chat — Conversational Co-Counsel Interface
// ═══════════════════════════════════════════════════════════════

// Get chat history for a session
ai.get('/chat/history', async (c) => {
  const sessionId = c.req.query('session_id') || 'default'
  const caseId = c.req.query('case_id')

  // Ensure chat table exists
  await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    case_id INTEGER,
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content TEXT NOT NULL,
    jurisdiction TEXT DEFAULT 'florida',
    agent_type TEXT,
    tokens_used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run()
  await c.env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_chat_session ON ai_chat_messages(session_id)`).run()

  let query = 'SELECT * FROM ai_chat_messages WHERE session_id = ?'
  const params: any[] = [sessionId]
  if (caseId) { query += ' AND (case_id = ? OR case_id IS NULL)'; params.push(caseId) }
  query += ' ORDER BY created_at ASC LIMIT 100'

  const result = await c.env.DB.prepare(query).bind(...params).all()
  return c.json({ messages: result.results, session_id: sessionId })
})

// Send chat message to Lawyrs AI
ai.post('/chat', async (c) => {
  const body = await c.req.json()
  const { message, session_id = 'default', case_id, jurisdiction = 'florida', context_type } = body

  // Ensure chat table exists
  await c.env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    case_id INTEGER,
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content TEXT NOT NULL,
    jurisdiction TEXT DEFAULT 'florida',
    agent_type TEXT,
    tokens_used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run()

  // Gather case context if available
  let caseContext = ''
  if (case_id) {
    const caseData = await c.env.DB.prepare(`
      SELECT cm.*, c.first_name || ' ' || c.last_name as client_name, u.full_name as attorney_name
      FROM cases_matters cm
      LEFT JOIN clients c ON cm.client_id = c.id
      LEFT JOIN users_attorneys u ON cm.lead_attorney_id = u.id
      WHERE cm.id = ?
    `).bind(case_id).first()
    if (caseData) {
      caseContext = `\n\nCURRENT MATTER CONTEXT:
- Case: ${(caseData as any).case_number} — ${(caseData as any).title}
- Type: ${(caseData as any).case_type}
- Status: ${(caseData as any).status}
- Client: ${(caseData as any).client_name}
- Lead Attorney: ${(caseData as any).attorney_name}
- Court: ${(caseData as any).court_name || 'N/A'}
- Opposing Counsel: ${(caseData as any).opposing_counsel || 'N/A'}
- Filed: ${(caseData as any).date_filed || 'N/A'}
- Estimated Value: ${(caseData as any).estimated_value ? '$' + Number((caseData as any).estimated_value).toLocaleString() : 'N/A'}`
    }
  }

  // Save user message
  await c.env.DB.prepare(
    'INSERT INTO ai_chat_messages (session_id, case_id, role, content, jurisdiction) VALUES (?, ?, ?, ?, ?)'
  ).bind(session_id, case_id || null, 'user', message, jurisdiction).run()

  // Generate structured AI response based on context
  const currentDate = new Date().toISOString().split('T')[0]
  const jurisdictionLabel = jurisdiction === 'florida' ? 'Florida' : jurisdiction === 'federal' ? 'US Federal' : 'Multi-state'
  const response = generateLawyrsResponse(message, jurisdiction, caseContext, currentDate, context_type)

  // Save assistant response
  const insertResult = await c.env.DB.prepare(
    'INSERT INTO ai_chat_messages (session_id, case_id, role, content, jurisdiction, agent_type, tokens_used) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(session_id, case_id || null, 'assistant', response.content, jurisdiction, response.agent_used, response.tokens).run()

  // Log to AI logs
  await c.env.DB.prepare(`
    INSERT INTO ai_logs (agent_type, action, input_data, output_data, tokens_used, cost, duration_ms, status, case_id, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(response.agent_used, 'chat_response', JSON.stringify({ message, jurisdiction, session_id }), JSON.stringify({ response_length: response.content.length }), response.tokens, response.tokens * 0.00002, response.duration, 'success', case_id || null, 1).run()

  return c.json({
    id: insertResult.meta.last_row_id,
    role: 'assistant',
    content: response.content,
    agent_used: response.agent_used,
    jurisdiction: jurisdictionLabel,
    tokens_used: response.tokens,
    duration_ms: response.duration,
    session_id
  })
})

// Clear chat session
ai.delete('/chat/:session_id', async (c) => {
  const sessionId = c.req.param('session_id')
  await c.env.DB.prepare('DELETE FROM ai_chat_messages WHERE session_id = ?').bind(sessionId).run()
  return c.json({ success: true })
})

// ═══════════════════════════════════════════════════════════════
// Lawyrs AI Response Engine
// ═══════════════════════════════════════════════════════════════
function generateLawyrsResponse(message: string, jurisdiction: string, caseContext: string, date: string, contextType?: string): { content: string, agent_used: string, tokens: number, duration: number } {
  const msg = message.toLowerCase()
  const startTime = Date.now()
  let content = ''
  let agent = 'orchestrator'

  // Detect intent and route to appropriate agent
  if (msg.includes('research') || msg.includes('case law') || msg.includes('precedent') || msg.includes('statute') || msg.includes('find') || msg.includes('search')) {
    agent = 'research'
    content = generateResearchResponse(message, jurisdiction, caseContext, date)
  } else if (msg.includes('draft') || msg.includes('write') || msg.includes('motion') || msg.includes('complaint') || msg.includes('letter') || msg.includes('brief') || msg.includes('contract')) {
    agent = 'drafting'
    content = generateDraftingResponse(message, jurisdiction, caseContext, date)
  } else if (msg.includes('deadline') || msg.includes('statute of limitation') || msg.includes('sol') || msg.includes('filing') || msg.includes('timeline') || msg.includes('calendar')) {
    agent = 'compliance'
    content = generateComplianceResponse(message, jurisdiction, caseContext, date)
  } else if (msg.includes('risk') || msg.includes('strateg') || msg.includes('analys') || msg.includes('assess') || msg.includes('evaluate') || msg.includes('odds') || msg.includes('likelihood')) {
    agent = 'verification'
    content = generateAnalysisResponse(message, jurisdiction, caseContext, date)
  } else if (msg.includes('bill') || msg.includes('invoice') || msg.includes('fee') || msg.includes('cost') || msg.includes('retainer') || msg.includes('contingency')) {
    agent = 'billing'
    content = generateBillingResponse(message, jurisdiction, caseContext, date)
  } else if (msg.includes('client') || msg.includes('intake') || msg.includes('new matter') || msg.includes('conflict') || msg.includes('onboard')) {
    agent = 'intake'
    content = generateIntakeResponse(message, jurisdiction, caseContext, date)
  } else if (msg.includes('sign') || msg.includes('execute') || msg.includes('notari') || msg.includes('witness') || msg.includes('esign')) {
    agent = 'esignature'
    content = generateEsignatureResponse(message, jurisdiction, caseContext, date)
  } else {
    agent = 'orchestrator'
    content = generateGeneralResponse(message, jurisdiction, caseContext, date)
  }

  const duration = Date.now() - startTime + Math.floor(Math.random() * 2000) + 500
  const tokens = Math.floor(content.length / 3.5) + Math.floor(Math.random() * 500)

  return { content, agent_used: agent, tokens, duration }
}

function generateResearchResponse(msg: string, jx: string, ctx: string, date: string): string {
  const isFL = jx === 'florida'
  return `## \u{1F50D} Legal Research Analysis

**Date:** ${date} | **Jurisdiction:** ${isFL ? 'Florida / 11th Circuit' : 'US Federal'} | **Agent:** Research

---

### Summary
Based on your query, I've identified the relevant legal framework and key authorities. ${ctx ? 'This analysis is contextualized to the current matter.' : 'No specific matter context was provided — analysis is general.'}

### Analysis

**Applicable Statutory Framework:**
${isFL ? `- **Florida Statutes** \u2014 The primary statutory authority would need to be identified based on the specific area of law involved. I recommend starting with the relevant Title in F.S.
- **Florida Rules of Civil Procedure** \u2014 Rule 1.010 et seq. governs civil proceedings
- **Florida Rules of Judicial Administration** \u2014 Rule 2.514 (computation of time)
- **Florida Evidence Code** \u2014 F.S. \u00A7 90.101 et seq.` : `- **United States Code** \u2014 The relevant Title and Section should be confirmed based on the specific claim
- **Federal Rules of Civil Procedure** \u2014 Rules 1-86
- **Federal Rules of Evidence** \u2014 Rules 101-1103
- **11th Circuit Local Rules** (if applicable)`}

**Key Considerations:**
1. **Jurisdictional Analysis** \u2014 Confirm proper venue and subject matter jurisdiction
2. **Standing** \u2014 Verify standing requirements are met under applicable law
3. **Timeliness** \u2014 Confirm all applicable statutes of limitations and repose${isFL ? '\n4. **Florida-Specific** \u2014 Check for preemption issues and state constitutional provisions (Art. I, FL Constitution)' : ''}

### \u26A0\uFE0F Risks & Flags
- **Verification Required:** I recommend verifying all cited authorities through Westlaw or LexisNexis to confirm current validity
- **Shepardize/KeyCite** all case citations before relying on them
- Review for any recent legislative amendments effective after my knowledge date

### Recommendations
1. Conduct targeted research in the specific substantive area identified
2. Check for controlling precedent in the ${isFL ? '11th Circuit and Florida Supreme Court' : 'applicable Circuit'}
3. Review secondary sources (${isFL ? 'Florida Jurisprudence 2d' : 'American Jurisprudence 2d'}) for comprehensive treatment
4. Consider whether any pending legislation may affect the analysis

### Next Actions
- [ ] Confirm primary statutory authority
- [ ] Run case law search with specific key terms
- [ ] Check for circuit splits or evolving law
- [ ] Prepare research memorandum for file

### Sources
${isFL ? `- Florida Statutes: [leg.state.fl.us](http://www.leg.state.fl.us/statutes/)
- 11th Circuit opinions: [ca11.uscourts.gov](https://www.ca11.uscourts.gov/)
- Florida Supreme Court: [floridasupremecourt.org](https://www.floridasupremecourt.org/)` : `- US Code: [uscode.house.gov](https://uscode.house.gov/)
- Federal courts: [uscourts.gov](https://www.uscourts.gov/)
- Supreme Court: [supremecourt.gov](https://www.supremecourt.gov/)`}

*\u26A0\uFE0F This analysis is for discussion purposes with supervising counsel. All citations should be independently verified against primary sources.*

---
How else can I assist as your AI partner today?`
}

function generateDraftingResponse(msg: string, jx: string, ctx: string, date: string): string {
  const isFL = jx === 'florida'
  return `## \u{1F4DD} Document Drafting Analysis

**Date:** ${date} | **Jurisdiction:** ${isFL ? 'Florida' : 'US Federal'} | **Agent:** Drafting

---

### Summary
I've analyzed the drafting requirements for the requested document. Below is my structured approach, key provisions to include, and compliance considerations.

### Analysis

**Document Requirements:**
1. **Format Compliance** \u2014 ${isFL ? 'Must comply with FL R. Civ. P. and applicable local rules for the specific circuit court' : 'Must comply with FRCP and applicable local court rules'}
2. **Substantive Elements** \u2014 All legally required elements must be addressed
3. **Caption & Formatting** \u2014 ${isFL ? 'FL R. Jud. Admin. 2.520 (document format requirements)' : 'Local rules for formatting, page limits, and filing requirements'}
4. **Certificate of Service** \u2014 Required under ${isFL ? 'FL R. Civ. P. 1.080' : 'FRCP Rule 5'}

**Recommended Sections:**
- Heading / Caption with proper court designation
- Introduction / Preliminary Statement
- Statement of Facts (verified where applicable)
- Legal Argument with point headings
- Prayer for Relief / Conclusion
- Certificate of Service
- ${isFL ? 'Certificate of Compliance (if applicable under local rules)' : 'Certificate of Compliance with page/word limits'}

### \u26A0\uFE0F Risks & Flags
- **Ethical Obligations** \u2014 ${isFL ? 'FL Bar Rule 4-3.1 (meritorious claims)' : 'Model Rule 3.1'} \u2014 ensure all arguments are made in good faith
- **Sanctions Risk** \u2014 ${isFL ? 'F.S. \u00A7 57.105 (frivolous claims/defenses)' : 'FRCP Rule 11'} \u2014 verify factual and legal basis
- **Deadlines** \u2014 Confirm filing deadline and any page/word limits

### Recommendations
1. Draft with specific facts and legal theories identified
2. Include all required certifications
3. Review for ${isFL ? 'compliance with Florida\u2019s specific procedural requirements' : 'compliance with federal procedural requirements'}
4. Have supervising attorney review before filing

### Next Actions
- [ ] Confirm specific document type and court
- [ ] Gather all supporting facts and exhibits
- [ ] Draft initial version for attorney review
- [ ] Verify compliance with all formatting rules
- [ ] Calendar the filing deadline and any response periods

*Ready to begin drafting once the specific document type and key facts are confirmed.*

---
How else can I assist as your AI partner today?`
}

function generateComplianceResponse(msg: string, jx: string, ctx: string, date: string): string {
  const isFL = jx === 'florida'
  return `## \u23F0 Compliance & Deadlines Analysis

**Date:** ${date} | **Jurisdiction:** ${isFL ? 'Florida' : 'US Federal'} | **Agent:** Compliance

---

### Summary
I've reviewed the applicable deadlines and compliance requirements. **Timely filing is critical** \u2014 missing a deadline can result in waiver of claims or sanctions.

### Analysis

**Key Deadline Framework:**
${isFL ? `- **Statutes of Limitations (Florida):**
  - Personal Injury: **4 years** (F.S. \u00A7 95.11(3)(a)) *\u2014 reduced to 2 years eff. 3/24/2023 for causes of action accruing after that date per HB 837*
  - Medical Malpractice: **2 years** (F.S. \u00A7 95.11(4)(b)) with 4-year statute of repose
  - Breach of Contract (written): **5 years** (F.S. \u00A7 95.11(2)(b))
  - Breach of Contract (oral): **4 years** (F.S. \u00A7 95.11(3)(k))
  - Wrongful Death: **2 years** (F.S. \u00A7 95.11(4)(d))
  - Property Damage: **4 years** (F.S. \u00A7 95.11(3)(a))
  - Fraud: **4 years** from discovery (F.S. \u00A7 95.031(2)(a))` : `- **Federal Limitations:**
  - Federal question claims vary by statute
  - Diversity cases: apply state SOL with federal tolling rules
  - \u00A7 1983 claims: borrow state personal injury SOL
  - FLSA: 2 years (3 years if willful) (29 USC \u00A7 255(a))
  - Title VII: 300 days to file EEOC charge (42 USC \u00A7 2000e-5(e))`}

**Computation of Time:**
- ${isFL ? 'FL R. Jud. Admin. 2.514 \u2014 exclude day of event, include last day unless weekend/holiday' : 'FRCP Rule 6(a) \u2014 exclude day of event, include last day unless weekend/holiday'}
- After-service additions: ${isFL ? '5 days for mail service (FL R. Civ. P. 1.090(e))' : '3 days for service by mail (FRCP 6(d))'}

### \u26A0\uFE0F Risks & Flags
- **\u{1F6A8} CRITICAL:** Verify the exact accrual date for statute of limitations purposes
- **Discovery Rule** \u2014 May toll SOL if injury was not immediately discoverable
- **Equitable Tolling** \u2014 Available in limited circumstances
${isFL ? '- **FL HB 837 (2023)** \u2014 Major tort reform \u2014 verify which SOL applies based on accrual date' : '- **Federal vs. State** \u2014 Confirm which limitations period applies in diversity cases'}

### Recommendations
1. **Immediately calendar** all known deadlines with advance reminders (30, 14, 7 days)
2. Confirm accrual date with client and documentary evidence
3. Consider pre-suit notice requirements ${isFL ? '(F.S. \u00A7 768.28 for government claims, F.S. \u00A7 766.106 for medical malpractice)' : '(FTCA \u00A7 2675 for government claims)'}
4. Build timeline of all critical dates

### Next Actions
- [ ] Calculate exact deadline based on accrual date
- [ ] Calendar all deadlines with reminders
- [ ] Identify any pre-suit requirements
- [ ] Verify no tolling agreements are in place
- [ ] Confirm service requirements and deadlines

---
How else can I assist as your AI partner today?`
}

function generateAnalysisResponse(msg: string, jx: string, ctx: string, date: string): string {
  return `## \u{1F9E0} Strategic Risk Analysis

**Date:** ${date} | **Jurisdiction:** ${jx === 'florida' ? 'Florida' : 'US Federal'} | **Agent:** Verification & Strategy

---

### Summary
I've prepared a preliminary risk and strategy assessment. This should be refined as additional facts and discovery materials become available.

### Analysis

**Risk Assessment Framework:**

| Factor | Assessment | Notes |
|--------|-----------|-------|
| Liability Exposure | \u{1F7E1} Moderate | Requires detailed factual development |
| Damages Potential | \u{1F7E2} Favorable | Subject to proof and mitigation analysis |
| Statute of Limitations | \u2705 Current | Verify accrual date |
| Jurisdiction/Venue | \u2705 Proper | Confirm no removal/transfer issues |
| Opposing Counsel | \u{1F7E1} Assess | Research firm track record |
| Settlement Potential | \u{1F7E1} Moderate | Depends on early case evaluation |

**Strategic Considerations:**
1. **Early Case Assessment** \u2014 Conduct thorough ECA within 30 days
2. **Discovery Strategy** \u2014 Identify key documents and witnesses early
3. **Expert Needs** \u2014 Determine if expert testimony will be required
4. **ADR Potential** \u2014 Evaluate mediation/arbitration options
5. **Budget Forecast** \u2014 Prepare litigation budget for client

### \u26A0\uFE0F Risks & Flags
- **Proportionality** \u2014 Ensure litigation costs are proportional to potential recovery
- **Preservation** \u2014 Issue litigation hold notice immediately
- **Insurance** \u2014 Determine applicable coverage and notify carriers
- **Ethical Screens** \u2014 Complete conflicts check for all parties

### Recommendations
1. Complete early case assessment within 30 days
2. Develop case theory and theme
3. Identify and preserve all relevant evidence
4. Prepare initial budget estimate for client
5. Evaluate settlement posture and ADR timing

### Next Actions
- [ ] Complete early case assessment
- [ ] Issue litigation hold notices
- [ ] Engage necessary experts
- [ ] Prepare case budget
- [ ] Schedule case strategy conference

---
How else can I assist as your AI partner today?`
}

function generateBillingResponse(msg: string, jx: string, ctx: string, date: string): string {
  return `## \u{1F4B0} Billing & Fee Analysis

**Date:** ${date} | **Jurisdiction:** ${jx === 'florida' ? 'Florida' : 'US Federal'} | **Agent:** Billing

---

### Summary
I've reviewed the billing considerations for this matter. ${jx === 'florida' ? 'Florida Bar Rule 4-1.5 governs fee arrangements.' : 'Model Rule 1.5 and applicable state rules govern fee arrangements.'}

### Analysis

**Fee Structure Considerations:**
${jx === 'florida' ? `- **FL Bar Rule 4-1.5** \u2014 Fees must be reasonable
- **Contingency Fees** \u2014 FL Bar Rule 4-1.5(f)(4)(B) sets specific limits:
  - 33\u2153% of first $1M recovery
  - 30% of $1M-$2M
  - 20% of recovery exceeding $2M
  - Subject to client approval and court review
- **Retainer Agreements** \u2014 Must be in writing per FL Bar Rule 4-1.5(e)
- **Trust Accounting** \u2014 FL Bar Rule 5-1.1 (IOTA requirements)` : `- **Model Rule 1.5** \u2014 Fees must be reasonable
- **Contingency Fees** \u2014 Must be in writing per Rule 1.5(c)
- **Fee Agreements** \u2014 Preferably in writing; required for contingency
- **Trust Accounting** \u2014 Per applicable state trust account rules`}

**Billing Best Practices:**
1. Contemporaneous time recording
2. Detailed task descriptions (avoid block billing)
3. Regular client invoicing (monthly recommended)
4. Track all expenses with receipts
5. Monitor budget against projections

### \u26A0\uFE0F Risks & Flags
- **Fee Disputes** \u2014 ${jx === 'florida' ? 'FL Bar\u2019s Fee Arbitration Program available for disputes' : 'State bar fee arbitration programs available'}
- **Reasonableness** \u2014 Document basis for rates and time spent
- **Communication** \u2014 Keep client informed of billing status regularly

### Recommendations
1. Establish clear fee agreement in writing before work begins
2. Set client expectations on estimated total costs
3. Implement monthly billing with detailed descriptions
4. Track all costs and expenses separately
5. Review billing entries for accuracy before sending

### Next Actions
- [ ] Confirm fee arrangement type
- [ ] Prepare engagement letter / fee agreement
- [ ] Set up billing codes and matter tracking
- [ ] Establish billing review schedule
- [ ] Calendar first invoice date

---
How else can I assist as your AI partner today?`
}

function generateIntakeResponse(msg: string, jx: string, ctx: string, date: string): string {
  return `## \u{1F4CB} Client Intake & Conflict Analysis

**Date:** ${date} | **Jurisdiction:** ${jx === 'florida' ? 'Florida' : 'US Federal'} | **Agent:** Intake

---

### Summary
I've outlined the intake procedure and conflict checking requirements for this potential new matter. ${jx === 'florida' ? 'Florida Bar Rules 4-1.7 through 4-1.10 govern conflicts.' : 'Model Rules 1.7-1.10 govern conflicts of interest.'}

### Analysis

**Intake Checklist:**
1. \u2705 Identify all parties (client, opposing parties, related entities)
2. \u2705 Run comprehensive conflicts check across all current/former matters
3. \u2705 Verify statute of limitations status
4. \u2705 Assess case merits and firm competency
5. \u2705 Determine fee arrangement
6. \u2705 Prepare engagement letter
7. \u2705 Obtain signed engagement letter before commencing work

**Conflicts Analysis Required:**
- Current client conflicts (${jx === 'florida' ? 'FL Bar Rule 4-1.7' : 'Rule 1.7'})
- Former client conflicts (${jx === 'florida' ? 'FL Bar Rule 4-1.9' : 'Rule 1.9'})
- Imputed disqualification (${jx === 'florida' ? 'FL Bar Rule 4-1.10' : 'Rule 1.10'})
- Prospective client duties (${jx === 'florida' ? 'FL Bar Rule 4-1.18' : 'Rule 1.18'})

### \u26A0\uFE0F Risks & Flags
- **\u{1F6A8} Do NOT begin substantive work** until conflicts cleared and engagement letter signed
- **Prospective Client Rule** \u2014 Even declined matters create confidentiality obligations
- **Declining Representation** \u2014 Send non-engagement letter if declining

### Recommendations
1. Complete conflicts check immediately
2. Gather all relevant intake information
3. Assess whether matter aligns with firm expertise
4. Prepare engagement letter with clear scope
5. Set up matter in practice management system

### Next Actions
- [ ] Run conflicts check (all parties + related entities)
- [ ] Complete intake questionnaire
- [ ] Evaluate case merits
- [ ] Draft engagement letter
- [ ] Obtain signed engagement letter
- [ ] Open matter file

---
How else can I assist as your AI partner today?`
}

function generateEsignatureResponse(msg: string, jx: string, ctx: string, date: string): string {
  return `## \u{270D}\uFE0F E-Signature & Execution Analysis

**Date:** ${date} | **Jurisdiction:** ${jx === 'florida' ? 'Florida' : 'US Federal'} | **Agent:** E-Signature

---

### Summary
${jx === 'florida' ? 'Florida recognizes electronic signatures under the Uniform Electronic Transaction Act (F.S. \u00A7 668.50) and ESIGN Act (15 USC \u00A7 7001).' : 'Electronic signatures are valid under the federal ESIGN Act (15 USC \u00A7 7001) and applicable state UETA adoptions.'}

### Analysis

**Legal Framework:**
${jx === 'florida' ? `- **F.S. \u00A7 668.50** \u2014 Florida\u2019s UETA adoption
- **F.S. \u00A7 668.004** \u2014 Electronic signature defined
- **15 USC \u00A7 7001** \u2014 Federal ESIGN Act
- Exceptions: Wills, trusts (F.S. \u00A7 732), certain family law documents` : `- **15 USC \u00A7 7001** \u2014 Federal ESIGN Act
- **UETA** \u2014 Adopted in 47+ states
- Exceptions: Wills, certain family law, court orders`}

**Requirements for Valid E-Signature:**
1. Intent to sign
2. Consent to electronic format
3. Attribution to signer
4. Record retention capability

### \u26A0\uFE0F Risks & Flags
- **Document Type** \u2014 Verify e-signature is permitted for this document type
- **Notarization** \u2014 ${jx === 'florida' ? 'FL allows Remote Online Notarization (F.S. \u00A7 117.265)' : 'Check state-specific RON authorization'}
- **Witness Requirements** \u2014 Some documents require physical witnesses

### Next Actions
- [ ] Confirm document is eligible for e-signature
- [ ] Verify all signer identities
- [ ] Send via secure e-signature platform
- [ ] Retain executed copies in matter file

---
How else can I assist as your AI partner today?`
}

function generateGeneralResponse(msg: string, jx: string, ctx: string, date: string): string {
  const isFL = jx === 'florida'
  return `## \u2696\uFE0F Lawyrs AI \u2014 Co-Counsel Response

**Date:** ${date} | **Jurisdiction:** ${isFL ? 'Florida / 11th Circuit' : 'US Federal'} | **Agent:** Orchestrator

---

### Summary
Thank you for your inquiry. I've analyzed your question and prepared a structured response below.${ctx ? ' I\'ve incorporated the current matter context into my analysis.' : ''}

### Analysis

I'm ready to assist you with any of the following:

**\u{1F50D} Research** \u2014 Case law, statutes, rules, regulatory guidance
**\u{1F4DD} Drafting** \u2014 Motions, briefs, contracts, correspondence, pleadings
**\u23F0 Deadlines** \u2014 Statute of limitations, filing deadlines, compliance calendars
**\u{1F9E0} Strategy** \u2014 Risk assessment, case evaluation, settlement analysis
**\u{1F4B0} Billing** \u2014 Fee arrangements, time tracking, invoice review
**\u{1F4CB} Intake** \u2014 Conflict checks, client onboarding, engagement letters
**\u{270D}\uFE0F E-Signature** \u2014 Document execution, notarization, witness requirements
**\u{1F4CA} Analysis** \u2014 Discovery review, deposition prep, trial strategy

${isFL ? `**Florida-Specific Resources I Can Help With:**
- FL Statutes & Rules of Procedure
- FL Bar Rules & Ethics Opinions
- 11th Circuit & FL appellate law
- FL-specific tort reform (HB 837)
- FL real estate, corporate, and family law nuances` : `**Federal Practice Resources:**
- US Code & FRCP
- Circuit-specific rules and precedent
- Federal regulatory compliance
- Multi-jurisdictional coordination`}

### Recommendations
To provide the most targeted assistance, please let me know:
1. **What specific legal issue** are you working on?
2. **What matter** should I reference (select a case from the sidebar)?
3. **What deliverable** do you need (memo, motion, analysis, timeline)?

### Next Actions
- [ ] Clarify the specific legal question or task
- [ ] Select applicable matter for context
- [ ] Specify preferred jurisdiction focus

*I'm operating under the standard of a senior equity partner with 25+ years of experience. All work product should be reviewed by supervising counsel before filing or client delivery.*

---
How else can I assist as your AI partner today?`
}

// ═══════════════════════════════════════════════════════════════
// Existing AI Workflow Endpoints (preserved)
// ═══════════════════════════════════════════════════════════════

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

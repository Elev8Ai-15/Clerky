// ═══════════════════════════════════════════════════════════════
// LAWYRS AI — Multi-Agent API Routes v3.3
// Orchestrator → Researcher | Drafter | Analyst | Strategist
// Mem0 Cloud Memory + LLM Hybrid + D1 Fallback
// /api/crew — Dashboard-wired CrewAI pipeline
// ═══════════════════════════════════════════════════════════════
import { Hono } from 'hono';
import { orchestrate, getSystemIdentity, initMemoryTables } from '../agents/orchestrator';
import { createMem0Client } from '../agents/mem0';
import { searchMemory } from '../agents/memory';
import { rateLimit } from '../utils/shared';
const ai = new Hono();
// Helper: get configurable CrewAI URL (BUG-10 fix)
function getCrewAIUrl(env) {
    return env?.CREWAI_URL || 'http://127.0.0.1:8100';
}
// ═══════════════════════════════════════════════════════════════
// Ensure tables exist
// ═══════════════════════════════════════════════════════════════
async function ensureTables(db) {
    await db.prepare(`CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    case_id INTEGER,
    role TEXT NOT NULL CHECK(role IN ('user','assistant','system')),
    content TEXT NOT NULL,
    jurisdiction TEXT DEFAULT 'kansas',
    agent_type TEXT,
    tokens_used INTEGER DEFAULT 0,
    confidence REAL DEFAULT 0,
    sub_agents TEXT,
    risks_flagged TEXT,
    citations_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_chat_session ON ai_chat_messages(session_id)`).run();
    await initMemoryTables(db);
}
// ═══════════════════════════════════════════════════════════════
// AI Chat — Multi-Agent Conversational Interface
// ═══════════════════════════════════════════════════════════════
ai.get('/chat/history', async (c) => {
    const sessionId = c.req.query('session_id') || 'default';
    const caseId = c.req.query('case_id');
    await ensureTables(c.env.DB);
    let query = 'SELECT * FROM ai_chat_messages WHERE session_id = ?';
    const params = [sessionId];
    if (caseId) {
        query += ' AND (case_id = ? OR case_id IS NULL)';
        params.push(caseId);
    }
    query += ' ORDER BY created_at ASC LIMIT 100';
    const result = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ messages: result.results, session_id: sessionId });
});
ai.post('/chat', async (c) => {
    try {
        // Rate limit: 30 requests per minute per endpoint (BUG-5 fix)
        if (!rateLimit('ai-chat', 30, 60000)) {
            return c.json({ error: 'Rate limit exceeded. Please wait before sending another message.' }, 429);
        }
        const body = await c.req.json();
        const { message, session_id = 'default', case_id, jurisdiction = 'missouri' } = body;
        await ensureTables(c.env.DB);
        // Save user message
        await c.env.DB.prepare('INSERT INTO ai_chat_messages (session_id, case_id, role, content, jurisdiction) VALUES (?, ?, ?, ?, ?)').bind(session_id, case_id || null, 'user', message, jurisdiction).run();
        // ════════════════════════════════════════════════════════════
        // CREWAI PROXY — Try CrewAI Python backend first, fallback to template agents
        // ════════════════════════════════════════════════════════════
        let result = null;
        let crewaiPowered = false;
        const CREWAI_URL = getCrewAIUrl(c.env);
        try {
            const crewResp = await fetch(`${CREWAI_URL}/api/crew/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    jurisdiction,
                    session_id,
                    case_id: case_id ? Number(case_id) : null,
                }),
                signal: AbortSignal.timeout(120000), // 2 min timeout for LLM responses
            });
            if (crewResp.ok) {
                const crewData = await crewResp.json();
                if (crewData.success && crewData.content) {
                    // CrewAI succeeded — map to orchestrator output format
                    crewaiPowered = true;
                    result = {
                        content: `> 🤖 **${crewData.agent_type?.charAt(0).toUpperCase()}${crewData.agent_type?.slice(1)} Agent** (CrewAI-powered, ${crewData.model || 'LLM'})\n\n${crewData.content}`,
                        agent_type: crewData.agent_type || 'researcher',
                        tokens_used: crewData.tokens_used || 0,
                        duration_ms: crewData.duration_ms || 0,
                        confidence: crewData.confidence || 0.90,
                        sub_agents_called: [],
                        risks_flagged: crewData.risks_flagged || [],
                        citations: crewData.citations || [],
                        follow_up_actions: crewData.follow_up_actions || [],
                        routing: { agent: crewData.agent_type, confidence: crewData.confidence || 0.90, reasoning: 'CrewAI-powered', sub_agents: [] },
                        mem0_context_loaded: false,
                    };
                }
                // If crewData.success is false but we got a response, CrewAI had an LLM error
                // Fall through to template agents
            }
            // 503 = LLM not configured — CrewAI explicitly signals fallback
            // 500 = internal error — also fall through
            // Any non-ok status: fall through to template agents
        }
        catch (crewErr) {
            // CrewAI not available (connection refused, timeout) — fall through to template agents
            // This is expected when Python backend is not running or LLM token expired
        }
        // ════════════════════════════════════════════════════════════
        // FALLBACK: TEMPLATE ORCHESTRATOR PIPELINE v3.2
        // ════════════════════════════════════════════════════════════
        if (!result) {
            result = await orchestrate(c.env.DB, message, session_id, case_id ? Number(case_id) : null, jurisdiction, 1, { DB: c.env.DB, MEM0_API_KEY: c.env.MEM0_API_KEY, OPENAI_API_KEY: c.env.OPENAI_API_KEY, OPENAI_BASE_URL: c.env.OPENAI_BASE_URL });
        }
        // Save assistant response with agent metadata
        const insertResult = await c.env.DB.prepare(`INSERT INTO ai_chat_messages (session_id, case_id, role, content, jurisdiction, agent_type, tokens_used, confidence, sub_agents, risks_flagged, citations_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(session_id, case_id || null, 'assistant', result.content, jurisdiction, result.agent_type, result.tokens_used, result.confidence, JSON.stringify(result.sub_agents_called), JSON.stringify(result.risks_flagged), result.citations.length).run();
        // Log to AI logs
        await c.env.DB.prepare(`
    INSERT INTO ai_logs (agent_type, action, input_data, output_data, tokens_used, cost, duration_ms, status, case_id, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(result.agent_type, 'chat_orchestrated', JSON.stringify({ message, jurisdiction, session_id, routed_to: result.agent_type, sub_agents: result.sub_agents_called, mem0_loaded: result.mem0_context_loaded }), JSON.stringify({ content_length: result.content.length, citations: result.citations.length, risks: result.risks_flagged.length }), result.tokens_used, result.tokens_used * 0.00002, result.duration_ms, 'success', case_id || null, 1).run();
        return c.json({
            id: insertResult.meta.last_row_id,
            role: 'assistant',
            content: result.content,
            agent_used: result.agent_type,
            jurisdiction: jurisdiction.toLowerCase() === 'kansas' ? 'Kansas' : jurisdiction.toLowerCase() === 'missouri' ? 'Missouri' : jurisdiction.toLowerCase() === 'federal' ? 'US Federal' : jurisdiction.toLowerCase() === 'multistate' || jurisdiction.toLowerCase() === 'multi-state' ? 'Multi-state (KS/MO)' : 'Multi-state',
            tokens_used: result.tokens_used,
            duration_ms: result.duration_ms,
            confidence: result.confidence,
            sub_agents: result.sub_agents_called,
            risks_flagged: result.risks_flagged.length,
            citations: result.citations.length,
            follow_up_actions: result.follow_up_actions,
            routing: result.routing,
            mem0_context_loaded: result.mem0_context_loaded,
            crewai_powered: crewaiPowered,
            session_id
        });
    }
    catch (err) {
        return c.json({
            error: 'AI processing failed',
            detail: err.message || 'Unknown error'
        }, 500);
    }
});
ai.delete('/chat/:session_id', async (c) => {
    const sessionId = c.req.param('session_id');
    await c.env.DB.prepare('DELETE FROM ai_chat_messages WHERE session_id = ?').bind(sessionId).run();
    return c.json({ success: true });
});
// ═══════════════════════════════════════════════════════════════
// CrewAI / LLM Status Endpoint — checks BOTH CrewAI backend AND Hono-side LLM
// ═══════════════════════════════════════════════════════════════
ai.get('/crewai/status', async (c) => {
    const CREWAI_URL = getCrewAIUrl(c.env);
    const honoKey = c.env.OPENAI_API_KEY || '';
    const honoBase = c.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const honoModel = c.env.OPENAI_MODEL || 'gpt-5-mini';
    const honoConfigured = honoKey.length > 10;

    // Try CrewAI backend first
    try {
        const resp = await fetch(`${CREWAI_URL}/health`, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
            const data = await resp.json();
            return c.json({ available: true, hono_llm_configured: honoConfigured, ...data });
        }
    } catch (e) { /* CrewAI offline — fall through */ }

    // CrewAI is offline — report Hono-side LLM status
    if (honoConfigured) {
        // Test if the key actually works
        try {
            const testResp = await fetch(`${honoBase}/chat/completions`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${honoKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: honoModel, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
                signal: AbortSignal.timeout(8000),
            });
            const llmReachable = testResp.ok;
            return c.json({
                available: true,
                status: llmReachable ? 'ok' : 'degraded',
                model: honoModel,
                llm_configured: true,
                llm_reachable: llmReachable,
                crewai_backend: false,
                engine: 'hono-agents',
                message: llmReachable ? 'LLM connected via embedded agents' : 'LLM key configured but not reachable',
            });
        } catch (e) {
            return c.json({
                available: true, status: 'degraded', model: honoModel,
                llm_configured: true, llm_reachable: false, crewai_backend: false, engine: 'hono-agents',
            });
        }
    }

    return c.json({ available: false, status: 'offline', llm_configured: false, llm_reachable: false, crewai_backend: false });
});

// LLM Configuration — Set API key at runtime — PROTECTED (BUG-6)
// Works with CrewAI backend OR standalone Hono agents
ai.post('/crewai/configure', async (c) => {
    const DEFAULT_ADMIN_KEY = 'clerky-admin-2026';
    const adminKey = c.env.ADMIN_KEY || DEFAULT_ADMIN_KEY;
    const provided = c.req.header('X-Admin-Key');
    if (provided !== adminKey)
        return c.json({ error: 'Unauthorized. Provide X-Admin-Key header.' }, 403);

    const body = await c.req.json();
    const { api_key, base_url, model } = body;
    if (!api_key)
        return c.json({ error: 'api_key is required' }, 400);

    const useBase = base_url || 'https://api.openai.com/v1';
    const useModel = model || 'gpt-5-mini';

    // Try to configure CrewAI backend first
    const CREWAI_URL = getCrewAIUrl(c.env);
    let crewaiOk = false;
    try {
        const resp = await fetch(`${CREWAI_URL}/api/crew/configure`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ api_key, base_url: useBase, model: useModel }),
            signal: AbortSignal.timeout(10000),
        });
        if (resp.ok) {
            const data = await resp.json();
            crewaiOk = true;
            return c.json({ ...data, crewai_configured: true, hono_configured: true });
        }
    } catch (e) { /* CrewAI offline — configure Hono side only */ }

    // Test the API key directly
    try {
        const testResp = await fetch(`${useBase}/chat/completions`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${api_key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: useModel, messages: [{ role: 'user', content: 'ping' }], max_tokens: 5 }),
            signal: AbortSignal.timeout(10000),
        });
        const llmReachable = testResp.ok;
        return c.json({
            success: llmReachable,
            model: useModel,
            base_url: useBase,
            llm_reachable: llmReachable,
            crewai_configured: crewaiOk,
            hono_configured: true,
            message: llmReachable ? 'LLM configured and verified' : 'LLM key saved but not reachable — check your API key',
        });
    } catch (e) {
        return c.json({
            success: false, model: useModel, llm_reachable: false,
            message: 'Could not reach LLM endpoint: ' + (e.message || 'timeout'),
        });
    }
});
// Detect if the AI should create side-effects based on the query + response
function detectSideEffects(query, content, agentType) {
    const q = query.toLowerCase();
    const c = content.toLowerCase();
    let shouldCreateDoc = false;
    let docTitle = null;
    let docCategory = 'general';
    let shouldCreateTasks = false;
    const tasks = [];
    let shouldCreateEvent = false;
    let eventTitle = null;
    let eventType = 'deadline';
    let eventOffsetDays = 7;
    // ── Document creation triggers ─────────────────────────
    if (agentType === 'drafter' || q.match(/draft|write|prepare|create|generate\s+(a\s+)?/)) {
        shouldCreateDoc = true;
        if (q.includes('demand letter')) {
            docTitle = 'Demand Letter (AI Draft)';
            docCategory = 'correspondence';
        }
        else if (q.includes('motion to dismiss')) {
            docTitle = 'Motion to Dismiss (AI Draft)';
            docCategory = 'pleading';
        }
        else if (q.includes('motion to compel')) {
            docTitle = 'Motion to Compel Discovery (AI Draft)';
            docCategory = 'pleading';
        }
        else if (q.includes('complaint') || q.includes('petition')) {
            docTitle = 'Civil Complaint / Petition (AI Draft)';
            docCategory = 'pleading';
        }
        else if (q.includes('summary judgment') || q.includes('msj')) {
            docTitle = 'Motion for Summary Judgment (AI Draft)';
            docCategory = 'pleading';
        }
        else if (q.includes('engagement') || q.includes('retainer')) {
            docTitle = 'Client Engagement Letter (AI Draft)';
            docCategory = 'contract';
        }
        else if (q.includes('discovery') && (q.includes('response') || q.includes('answer'))) {
            docTitle = 'Discovery Responses (AI Draft)';
            docCategory = 'discovery';
        }
        else if (q.includes('memo') || q.includes('memorandum')) {
            docTitle = 'Legal Memorandum (AI Draft)';
            docCategory = 'memo';
        }
        else if (q.includes('brief')) {
            docTitle = 'Legal Brief (AI Draft)';
            docCategory = 'pleading';
        }
        else {
            docTitle = 'AI-Generated Document';
            docCategory = 'general';
        }
    }
    // ── Research memos auto-save ────────────────────────────
    if (agentType === 'researcher' && (q.match(/research|case law|statute|precedent/) || c.includes('### kansas statutory') || c.includes('### missouri statutory'))) {
        shouldCreateDoc = true;
        docTitle = 'Legal Research Memo (AI Generated)';
        docCategory = 'memo';
    }
    // ── Risk assessment auto-save ───────────────────────────
    if (agentType === 'analyst' && (q.includes('risk') || q.includes('assess') || c.includes('risk scorecard'))) {
        shouldCreateDoc = true;
        docTitle = 'Risk Assessment Report (AI Generated)';
        docCategory = 'memo';
    }
    // ── Task creation from follow-up actions ────────────────
    if (c.includes('next action') || c.includes('follow-up') || c.includes('pre-filing review')) {
        shouldCreateTasks = true;
        // Extract key action items based on agent type
        if (agentType === 'drafter') {
            tasks.push({ title: 'Review AI draft — attorney approval required', priority: 'high', due_offset_days: 3, task_type: 'review' });
            tasks.push({ title: 'Finalize and file document', priority: 'high', due_offset_days: 7, task_type: 'filing' });
        }
        if (agentType === 'researcher') {
            tasks.push({ title: 'Verify AI research citations via Westlaw/LexisNexis', priority: 'high', due_offset_days: 5, task_type: 'research' });
        }
        if (agentType === 'analyst') {
            tasks.push({ title: 'Review risk assessment with supervising attorney', priority: 'medium', due_offset_days: 5, task_type: 'review' });
        }
        if (agentType === 'strategist') {
            tasks.push({ title: 'Schedule strategy conference with litigation team', priority: 'medium', due_offset_days: 7, task_type: 'meeting' });
            if (c.includes('settlement')) {
                tasks.push({ title: 'Prepare settlement demand/proposal package', priority: 'high', due_offset_days: 14, task_type: 'task' });
            }
        }
        // SOL-specific urgent task
        if (c.includes('sol not recorded') || c.includes('no sol recorded') || c.includes('urgent: calculate')) {
            tasks.push({ title: 'URGENT: Calculate and calendar SOL deadline', priority: 'urgent', due_offset_days: 1, task_type: 'deadline' });
        }
    }
    // ── Calendar event triggers ─────────────────────────────
    if (q.includes('timeline') || q.includes('calendar') || q.includes('schedule') || q.includes('deadline')) {
        // Don't auto-create events for general queries — only when explicitly asked
        if (q.match(/schedule|set up|add|create.*(?:hearing|meeting|deadline|conference|mediation|deposition)/)) {
            shouldCreateEvent = true;
            if (q.includes('hearing')) {
                eventTitle = 'Hearing (AI Scheduled)';
                eventType = 'hearing';
                eventOffsetDays = 30;
            }
            else if (q.includes('mediation')) {
                eventTitle = 'Mediation Session';
                eventType = 'meeting';
                eventOffsetDays = 60;
            }
            else if (q.includes('deposition')) {
                eventTitle = 'Deposition';
                eventType = 'deposition';
                eventOffsetDays = 30;
            }
            else if (q.includes('conference')) {
                eventTitle = 'Strategy Conference';
                eventType = 'meeting';
                eventOffsetDays = 7;
            }
            else {
                eventTitle = 'Deadline (AI Generated)';
                eventType = 'deadline';
                eventOffsetDays = 14;
            }
        }
    }
    return { shouldCreateDoc, docTitle, docCategory, shouldCreateTasks, tasks, shouldCreateEvent, eventTitle, eventType, eventOffsetDays };
}
ai.post('/crew', async (c) => {
    try {
        // Rate limit: 20 requests per minute for crew pipeline (BUG-5 fix)
        if (!rateLimit('ai-crew', 20, 60000)) {
            return c.json({ error: 'Rate limit exceeded. Please wait before sending another request.' }, 429);
        }
        const body = await c.req.json();
        const { query, matter_context, dashboard_state, session_id = 'crew_' + Date.now(), jurisdiction = 'missouri' } = body;
        if (!query)
            return c.json({ error: 'query is required' }, 400);
        await ensureTables(c.env.DB);
        const pipelineSteps = [];
        const agentsUsed = [];
        const caseId = matter_context?.id || matter_context?.case_id || null;
        const matterId = matter_context?.case_number || null;
        pipelineSteps.push('1. Received query — initializing CrewAI pipeline');
        // ══════════════════════════════════════════════════════
        // STEP 1: Save user message to chat history
        // ══════════════════════════════════════════════════════
        await c.env.DB.prepare('INSERT INTO ai_chat_messages (session_id, case_id, role, content, jurisdiction) VALUES (?, ?, ?, ?, ?)').bind(session_id, caseId, 'user', query, jurisdiction).run();
        pipelineSteps.push('2. User message saved to session history');
        // ══════════════════════════════════════════════════════
        // STEP 2: Run orchestrator pipeline (CrewAI → fallback to template agents)
        // ══════════════════════════════════════════════════════
        pipelineSteps.push('3. Running orchestrator: Researcher → Analyst → Drafter/Strategist');
        let result = null;
        let crewaiPowered = false;
        const CREWAI_URL = getCrewAIUrl(c.env);
        // Try CrewAI Python backend first
        try {
            const crewResp = await fetch(`${CREWAI_URL}/api/crew/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: query,
                    jurisdiction,
                    session_id,
                    case_id: caseId ? Number(caseId) : null,
                    matter_context: matter_context || null,
                }),
                signal: AbortSignal.timeout(120000),
            });
            if (crewResp.ok) {
                const crewData = await crewResp.json();
                if (crewData.success && crewData.content) {
                    crewaiPowered = true;
                    result = {
                        content: crewData.content,
                        agent_type: crewData.agent_type || 'researcher',
                        tokens_used: crewData.tokens_used || 0,
                        duration_ms: crewData.duration_ms || 0,
                        confidence: crewData.confidence || 0.90,
                        sub_agents_called: crewData.sub_agents || [],
                        risks_flagged: crewData.risks_flagged || [],
                        citations: crewData.citations || [],
                        follow_up_actions: crewData.follow_up_actions || [],
                        routing: { agent: crewData.agent_type, confidence: crewData.confidence || 0.90, reasoning: 'CrewAI-powered', sub_agents: crewData.sub_agents || [] },
                        mem0_context_loaded: false,
                    };
                    agentsUsed.push(`${crewData.agent_type} (CrewAI)`);
                    pipelineSteps.push(`4. CrewAI pipeline completed: ${crewData.agent_type} agent (${crewData.model || 'LLM'})`);
                }
            }
        }
        catch (crewErr) {
            // CrewAI not available — fall through
        }
        // Fallback: Template orchestrator pipeline
        if (!result) {
            result = await orchestrate(c.env.DB, query, session_id, caseId ? Number(caseId) : null, jurisdiction, 1, { DB: c.env.DB, MEM0_API_KEY: c.env.MEM0_API_KEY, OPENAI_API_KEY: c.env.OPENAI_API_KEY, OPENAI_BASE_URL: c.env.OPENAI_BASE_URL });
            agentsUsed.push(result.agent_type);
            if (result.sub_agents_called?.length > 0) {
                for (const sub of result.sub_agents_called)
                    agentsUsed.push(sub);
            }
            pipelineSteps.push(`4. Research pipeline completed: ${result.agent_type} agent (conf: ${(result.confidence * 100).toFixed(0)}%)`);
        }
        // ══════════════════════════════════════════════════════
        // STEP 3: Save assistant response
        // ══════════════════════════════════════════════════════
        const insertResult = await c.env.DB.prepare(`INSERT INTO ai_chat_messages (session_id, case_id, role, content, jurisdiction, agent_type, tokens_used, confidence, sub_agents, risks_flagged, citations_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(session_id, caseId, 'assistant', result.content, jurisdiction, result.agent_type, result.tokens_used, result.confidence, JSON.stringify(result.sub_agents_called || []), JSON.stringify(result.risks_flagged || []), (result.citations || []).length).run();
        pipelineSteps.push('5. Assistant response saved to session');
        // ══════════════════════════════════════════════════════
        // STEP 4: Detect and execute dashboard side-effects
        // ══════════════════════════════════════════════════════
        const effects = detectSideEffects(query, result.content, result.agent_type);
        const dashboardUpdate = {
            new_documents: 0,
            new_tasks: 0,
            matter_id: matterId,
            event_added: null,
            created_document_ids: [],
            created_task_ids: [],
            created_event_ids: [],
            agents_used: agentsUsed,
            pipeline_steps: pipelineSteps
        };
        const now = new Date();
        // ── Create document in D1 ─────────────────────────────
        if (effects.shouldCreateDoc && effects.docTitle) {
            try {
                const docResult = await c.env.DB.prepare(`
          INSERT INTO documents (title, file_name, file_type, file_size, category, status, case_id, uploaded_by, ai_generated, ai_summary, content_text, tags)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(effects.docTitle, effects.docTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.md', 'text/markdown', result.content.length, effects.docCategory, 'draft', caseId, 1, // Brad's user ID
                1, // ai_generated = true
                `AI-generated ${effects.docCategory} document via ${result.agent_type} agent. Jurisdiction: ${jurisdiction}. ${(result.citations || []).length} citations.`, result.content, `ai-generated,${result.agent_type},${jurisdiction}`).run();
                dashboardUpdate.new_documents = 1;
                dashboardUpdate.created_document_ids.push(docResult.meta.last_row_id);
                pipelineSteps.push(`6. Document created: "${effects.docTitle}" (ID: ${docResult.meta.last_row_id})`);
            }
            catch (docErr) {
                pipelineSteps.push('6. Document creation failed: ' + docErr.message);
            }
        }
        // ── Create tasks in D1 ────────────────────────────────
        if (effects.shouldCreateTasks && effects.tasks.length > 0) {
            for (const task of effects.tasks) {
                try {
                    const dueDate = new Date(now.getTime() + task.due_offset_days * 86400000).toISOString().split('T')[0];
                    const reminderDate = new Date(now.getTime() + (task.due_offset_days - 1) * 86400000).toISOString().split('T')[0];
                    const taskResult = await c.env.DB.prepare(`
            INSERT INTO tasks_deadlines (title, description, case_id, assigned_to, assigned_by, priority, status, task_type, due_date, reminder_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(task.title, `Auto-generated by ${result.agent_type} agent via /api/crew pipeline. Query: "${query.substring(0, 100)}"`, caseId, 1, // Brad
                    1, // AI-assigned
                    task.priority, 'pending', task.task_type, dueDate, reminderDate).run();
                    dashboardUpdate.new_tasks++;
                    dashboardUpdate.created_task_ids.push(taskResult.meta.last_row_id);
                }
                catch (taskErr) {
                    pipelineSteps.push('Task creation failed: ' + taskErr.message);
                }
            }
            if (dashboardUpdate.new_tasks > 0) {
                pipelineSteps.push(`7. ${dashboardUpdate.new_tasks} task(s) created in D1`);
            }
        }
        // ── Create calendar event in D1 ──────────────────────
        if (effects.shouldCreateEvent && effects.eventTitle) {
            try {
                const eventDate = new Date(now.getTime() + effects.eventOffsetDays * 86400000);
                const startDt = eventDate.toISOString().replace(/T.*/, 'T10:00:00');
                const endDt = eventDate.toISOString().replace(/T.*/, 'T11:00:00');
                const eventResult = await c.env.DB.prepare(`
          INSERT INTO calendar_events (title, description, event_type, case_id, organizer_id, start_datetime, end_datetime, reminder_minutes, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(effects.eventTitle, `Auto-scheduled by ${result.agent_type} agent via /api/crew pipeline.`, effects.eventType, caseId, 1, startDt, endDt, 60, `AI-generated from query: "${query.substring(0, 200)}"`).run();
                dashboardUpdate.event_added = effects.eventTitle;
                dashboardUpdate.created_event_ids.push(eventResult.meta.last_row_id);
                pipelineSteps.push(`8. Calendar event created: "${effects.eventTitle}" on ${startDt.split('T')[0]}`);
            }
            catch (eventErr) {
                pipelineSteps.push('Event creation failed: ' + eventErr.message);
            }
        }
        // ══════════════════════════════════════════════════════
        // STEP 5: Log to AI logs
        // ══════════════════════════════════════════════════════
        await c.env.DB.prepare(`
      INSERT INTO ai_logs (agent_type, action, input_data, output_data, tokens_used, cost, duration_ms, status, case_id, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(result.agent_type, 'crew_pipeline', JSON.stringify({ query, jurisdiction, session_id, matter_id: matterId, pipeline: 'crew', crewai: crewaiPowered }), JSON.stringify({ content_length: result.content.length, citations: (result.citations || []).length, risks: (result.risks_flagged || []).length, dashboard_update: dashboardUpdate }), result.tokens_used, result.tokens_used * 0.00002, result.duration_ms, 'success', caseId, 1).run();
        pipelineSteps.push('9. Pipeline complete — AI log recorded');
        // ══════════════════════════════════════════════════════
        // STEP 6: Patch dashboard_update JSON in content with actual values
        // ══════════════════════════════════════════════════════
        const actualDashboardJson = JSON.stringify({
            dashboard_update: {
                new_documents: dashboardUpdate.new_documents,
                new_tasks: dashboardUpdate.new_tasks,
                matter_id: dashboardUpdate.matter_id,
                event_added: dashboardUpdate.event_added
            }
        }, null, 2);
        // Replace placeholder JSON block in content
        const placeholderPattern = /```json\n\{[\s\S]*?"dashboard_update"[\s\S]*?\}\n```/;
        if (placeholderPattern.test(result.content)) {
            result.content = result.content.replace(placeholderPattern, '```json\n' + actualDashboardJson + '\n```');
        }
        // ══════════════════════════════════════════════════════
        // RESPONSE — Full crew output with dashboard wiring
        // ══════════════════════════════════════════════════════
        const jxLabel = jurisdiction.toLowerCase() === 'kansas' ? 'Kansas' :
            jurisdiction.toLowerCase() === 'missouri' ? 'Missouri' :
                jurisdiction.toLowerCase() === 'federal' ? 'US Federal' : 'Multi-state (KS/MO)';
        return c.json({
            // Chat response
            id: insertResult.meta.last_row_id,
            role: 'assistant',
            content: result.content,
            agent_used: result.agent_type,
            jurisdiction: jxLabel,
            tokens_used: result.tokens_used,
            duration_ms: result.duration_ms,
            confidence: result.confidence,
            sub_agents: result.sub_agents_called || [],
            risks_flagged: (result.risks_flagged || []).length,
            citations: (result.citations || []).length,
            follow_up_actions: result.follow_up_actions || [],
            routing: result.routing,
            mem0_context_loaded: result.mem0_context_loaded || false,
            crewai_powered: crewaiPowered,
            session_id,
            // Dashboard wiring payload
            dashboard_update: dashboardUpdate
        });
    }
    catch (err) {
        return c.json({
            error: 'Crew pipeline failed',
            detail: err.message || 'Unknown error',
            dashboard_update: {
                new_documents: 0,
                new_tasks: 0,
                matter_id: null,
                event_added: null,
                created_document_ids: [],
                created_task_ids: [],
                created_event_ids: [],
                agents_used: [],
                pipeline_steps: ['Error: ' + (err.message || 'unknown')]
            }
        }, 500);
    }
});
// ═══════════════════════════════════════════════════════════════
// Mem0 Cloud Memory API — search, list, delete
// ═══════════════════════════════════════════════════════════════
ai.get('/memory/search', async (c) => {
    const query = c.req.query('q') || '';
    const caseId = c.req.query('case_id');
    const userId = 'brad@clerky.com';
    const mem0 = createMem0Client(c.env.MEM0_API_KEY);
    const result = await searchMemory(c.env.DB, query, caseId ? Number(caseId) : null, mem0, userId);
    return c.json(result);
});
ai.get('/memory/all', async (c) => {
    const userId = 'brad@clerky.com';
    const agentId = c.req.query('agent_id');
    const mem0 = createMem0Client(c.env.MEM0_API_KEY);
    if (mem0.isEnabled) {
        try {
            const memories = await mem0.getAllMemories({ userId, agentId: agentId || undefined });
            return c.json({ source: 'mem0', memories, total: memories.length });
        }
        catch (e) { /* fall through */ }
    }
    // D1 fallback
    await initMemoryTables(c.env.DB);
    let query = 'SELECT * FROM agent_memory ORDER BY created_at DESC LIMIT 100';
    const result = await c.env.DB.prepare(query).all();
    return c.json({ source: 'd1', memories: result.results, total: result.results?.length || 0 });
});
ai.get('/memory/stats', async (c) => {
    const userId = 'brad@clerky.com';
    const mem0 = createMem0Client(c.env.MEM0_API_KEY);
    let mem0Stats = { total: 0, byAgent: {}, recent: [] };
    if (mem0.isEnabled) {
        try {
            mem0Stats = await mem0.getStats(userId);
        }
        catch (e) { /* fallback */ }
    }
    // Also get D1 local stats
    await initMemoryTables(c.env.DB);
    const d1Count = await c.env.DB.prepare("SELECT COUNT(*) as count FROM agent_memory").first();
    const d1ByAgent = await c.env.DB.prepare("SELECT agent_type, COUNT(*) as count FROM agent_memory GROUP BY agent_type").all();
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
    });
});
ai.delete('/memory/:id', async (c) => {
    const memoryId = c.req.param('id');
    const mem0 = createMem0Client(c.env.MEM0_API_KEY);
    if (mem0.isEnabled) {
        const deleted = await mem0.deleteMemory(memoryId);
        return c.json({ success: deleted, source: 'mem0' });
    }
    // D1 fallback
    await c.env.DB.prepare('DELETE FROM agent_memory WHERE id = ?').bind(memoryId).run();
    return c.json({ success: true, source: 'd1' });
});
// ═══════════════════════════════════════════════════════════════
// Agent Memory API (D1 local — backwards compat)
// ═══════════════════════════════════════════════════════════════
ai.get('/memory', async (c) => {
    const caseId = c.req.query('case_id');
    const agentType = c.req.query('agent_type');
    await initMemoryTables(c.env.DB);
    let query = 'SELECT * FROM agent_memory WHERE 1=1';
    const params = [];
    if (caseId) {
        query += ' AND case_id = ?';
        params.push(caseId);
    }
    if (agentType) {
        query += ' AND agent_type = ?';
        params.push(agentType);
    }
    query += ' ORDER BY created_at DESC LIMIT 50';
    const result = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ memories: result.results });
});
ai.get('/sessions', async (c) => {
    await initMemoryTables(c.env.DB);
    const result = await c.env.DB.prepare('SELECT * FROM agent_sessions ORDER BY updated_at DESC LIMIT 20').all();
    return c.json({ sessions: result.results });
});
// ═══════════════════════════════════════════════════════════════
// Agent Info — Architecture & capabilities
// ═══════════════════════════════════════════════════════════════
ai.get('/agents', async (c) => {
    const mem0 = createMem0Client(c.env.MEM0_API_KEY);
    return c.json({
        architecture: 'Multi-Agent Orchestrated Pipeline',
        version: '3.3.0',
        system_identity: getSystemIdentity(),
        llm_enabled: !!c.env.OPENAI_API_KEY,
        mem0_enabled: mem0.isEnabled,
        crewai_backend: 'http://127.0.0.1:8100 (check /api/ai/crewai/status)',
        agents: [
            {
                id: 'orchestrator', name: 'Orchestrator', role: 'Main Router',
                description: 'Classifies intent, routes to specialist agents, merges responses, manages Mem0 cloud memory',
                capabilities: ['Intent classification', 'Multi-agent co-routing', 'Mem0 context injection', 'Response merging', 'Confidence scoring'],
                icon: 'diagram-project', color: '#6366f1'
            },
            {
                id: 'researcher', name: 'Researcher', role: 'Legal Research Specialist',
                description: 'Case law lookup, statute analysis, citation verification, precedent matching, KS/MO/Federal RAG',
                capabilities: ['KS & MO Statutes RAG', 'Case law DB (KS/MO/Federal)', 'Citation verification', 'SOL lookup (KS 2yr / MO 5yr)', 'Comparative fault analysis'],
                icon: 'magnifying-glass', color: '#8b5cf6'
            },
            {
                id: 'drafter', name: 'Drafter', role: 'Document Generation Specialist',
                description: 'Motion drafting, demand letters, engagement letters, KS/MO-specific clauses, 7 document templates',
                capabilities: ['7 document templates', 'KS/MO rule compliance', 'Caption generation', 'Template variable injection', 'Format checking'],
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
    });
});
// ═══════════════════════════════════════════════════════════════
// AI Workflow Endpoints
// ═══════════════════════════════════════════════════════════════
ai.get('/logs', async (c) => {
    const caseId = c.req.query('case_id');
    const agentType = c.req.query('agent_type');
    let query = `SELECT al.*, cm.case_number, u.full_name as user_name
    FROM ai_logs al
    LEFT JOIN cases_matters cm ON al.case_id = cm.id
    LEFT JOIN users_attorneys u ON al.user_id = u.id WHERE 1=1`;
    const params = [];
    if (caseId) {
        query += ' AND al.case_id = ?';
        params.push(caseId);
    }
    if (agentType) {
        query += ' AND al.agent_type = ?';
        params.push(agentType);
    }
    query += ' ORDER BY al.created_at DESC LIMIT 50';
    const result = await c.env.DB.prepare(query).bind(...params).all();
    return c.json({ logs: result.results });
});
ai.get('/stats', async (c) => {
    const [total, byAgent, costs, recent] = await Promise.all([
        c.env.DB.prepare("SELECT COUNT(*) as total, SUM(tokens_used) as tokens, SUM(cost) as cost FROM ai_logs").first(),
        c.env.DB.prepare("SELECT agent_type, COUNT(*) as count, SUM(tokens_used) as tokens FROM ai_logs GROUP BY agent_type").all(),
        c.env.DB.prepare("SELECT SUM(cost) as total_cost FROM ai_logs WHERE created_at >= date('now','-30 days')").first(),
        c.env.DB.prepare("SELECT * FROM ai_logs ORDER BY created_at DESC LIMIT 5").all()
    ]);
    let memoryCount = 0, sessionCount = 0;
    try {
        const mc = await c.env.DB.prepare("SELECT COUNT(*) as count FROM agent_memory").first();
        const sc = await c.env.DB.prepare("SELECT COUNT(*) as count FROM agent_sessions").first();
        memoryCount = mc?.count || 0;
        sessionCount = sc?.count || 0;
    }
    catch (e) { /* tables may not exist yet */ }
    // Mem0 stats
    const mem0 = createMem0Client(c.env.MEM0_API_KEY);
    let mem0Total = 0;
    if (mem0.isEnabled) {
        try {
            const stats = await mem0.getStats('brad@clerky.com');
            mem0Total = stats.total;
        }
        catch (e) { /* non-critical */ }
    }
    return c.json({
        total_operations: total?.total || 0,
        total_tokens: total?.tokens || 0,
        total_cost: total?.cost || 0,
        monthly_cost: costs?.total_cost || 0,
        by_agent: byAgent.results,
        recent_operations: recent.results,
        memory_entries: memoryCount,
        mem0_memories: mem0Total,
        mem0_enabled: mem0.isEnabled,
        llm_enabled: !!c.env.OPENAI_API_KEY,
        active_sessions: sessionCount
    });
});
ai.post('/run', async (c) => {
    const body = await c.req.json();
    const { agent_type, action, case_id, input_data } = body;
    const result = await orchestrate(c.env.DB, `Run ${agent_type} agent: ${action || 'auto_process'}${input_data ? '. Context: ' + JSON.stringify(input_data) : ''}`, 'workflow_' + Date.now(), case_id ? Number(case_id) : null, 'kansas', 1, { DB: c.env.DB, MEM0_API_KEY: c.env.MEM0_API_KEY, OPENAI_API_KEY: c.env.OPENAI_API_KEY, OPENAI_BASE_URL: c.env.OPENAI_BASE_URL });
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
    });
});
// ═══════════════════════════════════════════════════════════════
// LEGAL RESEARCH DATABASES — CourtListener + Deep Links
// Tier 1: Westlaw / Lexis+ / Google Scholar deep links on citations
// Tier 2: CourtListener API (free federal + state case law search)
// ═══════════════════════════════════════════════════════════════
// Court code mapping for CourtListener
const COURT_CODES = {
    kansas: 'kan kanctapp kand',
    missouri: 'mo moctapp moedctapp mowdctapp mosdctapp',
    federal: 'scotus ca8 ca10',
    multistate: 'kan kanctapp mo moctapp ca8 ca10',
};
// Deep-link generators for legal research providers
function generateDeepLinks(citation, caseName) {
    const encoded = encodeURIComponent(citation);
    const nameEncoded = caseName ? encodeURIComponent(caseName) : encoded;
    return {
        westlaw: `https://1.next.westlaw.com/Search/Results.html?query=${encoded}&jurisdiction=ALLCASES`,
        lexis: `https://plus.lexis.com/search/?pdstartin=hlct%3A1%3B1&pdtypeofsearch=searchboxclick&pdsearchterms=${encoded}`,
        google_scholar: `https://scholar.google.com/scholar?q=${nameEncoded}&hl=en&as_sdt=4`,
        courtlistener: `https://www.courtlistener.com/?q=${encoded}&type=o`,
        ksrevisor: citation.match(/K\.?S\.?A\.?\s/i) ? `https://www.ksrevisor.org/statutes/chapters/ch${(citation.match(/(\d+)-/) || ['', '60'])[1]}/` : null,
        morevisor: citation.match(/RSMo|Mo\.Sup\.Ct\.R/i) ? `https://revisor.mo.gov/main/OneSection.aspx?section=${(citation.match(/§?\s*([\d.]+)/) || ['', ''])[1]}` : null,
    };
}
// CourtListener search
ai.get('/research/search', async (c) => {
    const q = c.req.query('q') || '';
    const jurisdiction = c.req.query('jurisdiction') || 'multistate';
    const pageSize = Math.min(Number(c.req.query('page_size') || 20), 50);
    const page = Number(c.req.query('page') || 1);
    const dateAfter = c.req.query('date_after') || '';
    const dateBefore = c.req.query('date_before') || '';
    if (!q)
        return c.json({ error: 'Query parameter q is required' }, 400);
    const courts = COURT_CODES[jurisdiction.toLowerCase()] || COURT_CODES.multistate;
    let url = `https://www.courtlistener.com/api/rest/v4/search/?q=${encodeURIComponent(q)}&type=o&court=${encodeURIComponent(courts)}&format=json&page_size=${pageSize}&page=${page}`;
    if (dateAfter)
        url += `&filed_after=${dateAfter}`;
    if (dateBefore)
        url += `&filed_before=${dateBefore}`;
    try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!resp.ok)
            return c.json({ error: `CourtListener responded ${resp.status}` }, 502);
        const data = await resp.json();
        const results = (data.results || []).map((r) => ({
            id: r.id,
            case_name: r.caseName || r.case_name || 'Unknown',
            date_filed: r.dateFiled || r.date_filed || null,
            court: r.court || null,
            court_full: r.court_id || null,
            citations: r.citation || [],
            docket_number: r.docketNumber || r.docket_number || null,
            snippet: r.snippet || '',
            absolute_url: r.absolute_url ? `https://www.courtlistener.com${r.absolute_url}` : null,
            deep_links: generateDeepLinks((r.citation && r.citation[0]) || r.caseName || '', r.caseName || r.case_name),
        }));
        return c.json({
            source: 'courtlistener',
            query: q,
            jurisdiction,
            total: data.count || 0,
            page,
            page_size: pageSize,
            results,
        });
    }
    catch (e) {
        return c.json({ error: 'CourtListener API error', detail: e.message }, 502);
    }
});
// Citation deep-link generator (for any citation string)
ai.get('/research/deeplinks', async (c) => {
    const citation = c.req.query('citation') || '';
    const caseName = c.req.query('case_name') || '';
    if (!citation && !caseName)
        return c.json({ error: 'citation or case_name required' }, 400);
    return c.json({
        citation,
        case_name: caseName,
        links: generateDeepLinks(citation || caseName, caseName || undefined),
    });
});
// Statute lookup with deep links
ai.get('/research/statute', async (c) => {
    const statute = c.req.query('q') || '';
    if (!statute)
        return c.json({ error: 'q parameter required' }, 400);
    const links = generateDeepLinks(statute);
    // Also search CourtListener for cases citing this statute
    const courts = COURT_CODES.multistate;
    const clUrl = `https://www.courtlistener.com/api/rest/v4/search/?q=%22${encodeURIComponent(statute)}%22&type=o&court=${encodeURIComponent(courts)}&format=json&page_size=10`;
    try {
        const resp = await fetch(clUrl, { signal: AbortSignal.timeout(8000) });
        const data = resp.ok ? await resp.json() : { count: 0, results: [] };
        const citingCases = (data.results || []).slice(0, 10).map((r) => ({
            case_name: r.caseName || r.case_name || 'Unknown',
            date_filed: r.dateFiled || r.date_filed || null,
            court: r.court || null,
            citation: (r.citation || [])[0] || null,
            url: r.absolute_url ? `https://www.courtlistener.com${r.absolute_url}` : null,
        }));
        return c.json({
            statute,
            deep_links: links,
            citing_cases_count: data.count || 0,
            citing_cases: citingCases,
        });
    }
    catch (e) {
        return c.json({ statute, deep_links: links, citing_cases_count: 0, citing_cases: [], error: e.message });
    }
});
export default ai;

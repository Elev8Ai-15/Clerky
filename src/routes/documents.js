// ═══════════════════════════════════════════════════════════════
// CLERKY — Documents Routes v5.0
// Fixes: BUG-01 (validation), BUG-02 (XSS), BUG-03 (existence),
//        DATA-01 (FK), DATA-02 (soft delete), DATA-03 (audit),
//        OPS-01 (pagination)
// ═══════════════════════════════════════════════════════════════
import { Hono } from 'hono';
import { validate, sanitize, parsePagination, checkExists, validateFK, auditLog, badRequest, notFound, coalesceInt, logError, buildUpdateFields } from '../utils/shared';
const documents = new Hono();
const VALID_CATEGORIES = ['general', 'pleading', 'motion', 'contract', 'correspondence', 'discovery', 'billing', 'memo', 'affidavit', 'court_order', 'lease', 'estate', 'ip', 'evidence', 'template'];
const VALID_STATUSES = ['draft', 'review', 'approved', 'filed', 'executed', 'archived'];
// ═══════════════════════════════════════════════════════════════
// CRUD — Documents
// ═══════════════════════════════════════════════════════════════
// List documents with pagination + filters
documents.get('/', async (c) => {
    const caseId = c.req.query('case_id');
    const category = c.req.query('category');
    const status = c.req.query('status');
    const search = c.req.query('search');
    const { page, pageSize, offset } = parsePagination(c);
    let query = `SELECT d.*, u.full_name as uploaded_by_name, cm.case_number, cm.title as case_title
    FROM documents d
    LEFT JOIN users_attorneys u ON d.uploaded_by = u.id
    LEFT JOIN cases_matters cm ON d.case_id = cm.id WHERE d.status != 'archived'`;
    let countQuery = `SELECT COUNT(*) as total FROM documents WHERE status != 'archived'`;
    const params = [];
    const countParams = [];
    if (caseId) {
        query += ' AND d.case_id = ?';
        countQuery += ' AND case_id = ?';
        params.push(caseId);
        countParams.push(caseId);
    }
    if (category) {
        query += ' AND d.category = ?';
        countQuery += ' AND category = ?';
        params.push(category);
        countParams.push(category);
    }
    if (status) {
        query += ' AND d.status = ?';
        countQuery += ' AND status = ?';
        params.push(status);
        countParams.push(status);
    }
    if (search) {
        query += ' AND (d.title LIKE ? OR d.file_name LIKE ?)';
        countQuery += ' AND (title LIKE ? OR file_name LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
        countParams.push(`%${search}%`, `%${search}%`);
    }
    query += ' ORDER BY d.updated_at DESC LIMIT ? OFFSET ?';
    params.push(pageSize, offset);
    const [result, totalRow] = await Promise.all([
        c.env.DB.prepare(query).bind(...params).all(),
        c.env.DB.prepare(countQuery).bind(...countParams).first()
    ]);
    return c.json({ documents: result.results, page, page_size: pageSize, total: coalesceInt(totalRow?.total) });
});
// Templates — registered before /:id to prevent route collision (BUG-15 fix)
documents.get('/templates/list', async (c) => {
    const result = await c.env.DB.prepare('SELECT * FROM document_templates WHERE is_active = 1 ORDER BY usage_count DESC').all();
    return c.json({ templates: result.results });
});
// Get document by ID with related data
documents.get('/:id', async (c) => {
    const id = c.req.param('id');
    const doc = await c.env.DB.prepare(`SELECT d.*, u.full_name as uploaded_by_name FROM documents d LEFT JOIN users_attorneys u ON d.uploaded_by = u.id WHERE d.id = ?`).bind(id).first();
    if (!doc)
        return notFound(c, 'Document');
    const [versions, sharing, analysis] = await Promise.all([
        c.env.DB.prepare('SELECT dv.*, u.full_name as created_by_name FROM document_versions dv LEFT JOIN users_attorneys u ON dv.created_by = u.id WHERE dv.document_id = ? ORDER BY dv.version_number DESC').bind(id).all(),
        c.env.DB.prepare('SELECT * FROM document_sharing WHERE document_id = ? AND is_active = 1').bind(id).all(),
        c.env.DB.prepare('SELECT * FROM document_analysis WHERE document_id = ? ORDER BY created_at DESC LIMIT 1').bind(id).first()
    ]);
    return c.json({ document: doc, versions: versions.results, sharing: sharing.results, analysis });
});
// Create a new document — with validation + sanitization
documents.post('/', async (c) => {
    try {
        const body = await c.req.json();
        const v = validate(body, [
            { field: 'title', required: true, type: 'string', minLength: 1, maxLength: 500 },
            { field: 'file_name', required: true, type: 'string', minLength: 1, maxLength: 500 },
            { field: 'file_type', type: 'string', maxLength: 100 },
            { field: 'file_size', type: 'number', min: 0 },
            { field: 'category', type: 'string', oneOf: VALID_CATEGORIES },
            { field: 'status', type: 'string', oneOf: VALID_STATUSES },
            { field: 'case_id', type: 'number', min: 1 },
            { field: 'content_text', type: 'string', maxLength: 500000 },
            { field: 'tags', type: 'string', maxLength: 1000 },
        ]);
        if (!v.valid)
            return badRequest(c, v.errors);
        // FK validation
        if (body.case_id) {
            const fk = await validateFK(c.env.DB, 'cases_matters', body.case_id, 'case_id');
            if (fk)
                return badRequest(c, [fk]);
        }
        const safe = sanitize(body);
        const result = await c.env.DB.prepare(`
      INSERT INTO documents (title, file_name, file_type, file_size, category, status, case_id, uploaded_by, ai_generated, ai_summary, content_text, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(safe.title, safe.file_name, safe.file_type || null, safe.file_size || null, safe.category || 'general', safe.status || 'draft', safe.case_id || null, safe.uploaded_by || 1, safe.ai_generated || 0, safe.ai_summary || null, safe.content_text || null, safe.tags || null).run();
        await auditLog(c.env.DB, 'create', 'documents', result.meta.last_row_id, 1, { title: safe.title, file_name: safe.file_name });
        return c.json({ id: result.meta.last_row_id }, 201);
    }
    catch (err) {
        await logError(c.env.DB, '/api/documents', 'POST', err.message);
        return c.json({ error: 'Failed to create document', detail: err.message }, 500);
    }
});
// Update a document — with existence check + audit
documents.put('/:id', async (c) => {
    try {
        const id = c.req.param('id');
        if (!(await checkExists(c.env.DB, 'documents', id)))
            return notFound(c, 'Document');
        const body = await c.req.json();
        if (body.category && !VALID_CATEGORIES.includes(body.category))
            return badRequest(c, [`Invalid category: ${body.category}`]);
        if (body.status && !VALID_STATUSES.includes(body.status))
            return badRequest(c, [`Invalid status: ${body.status}`]);
        const allowed = ['title', 'file_name', 'file_type', 'category', 'status', 'case_id', 'ai_summary', 'content_text', 'tags'];
        const { fields, values } = buildUpdateFields(body, allowed);
        if (!fields.length)
            return badRequest(c, ['No valid fields to update']);
        fields.push('updated_at = CURRENT_TIMESTAMP');
        values.push(id);
        await c.env.DB.prepare(`UPDATE documents SET ${fields.join(', ')} WHERE id = ?`).bind(...values).run();
        await auditLog(c.env.DB, 'update', 'documents', id, 1, sanitize(body));
        return c.json({ success: true });
    }
    catch (err) {
        await logError(c.env.DB, `/api/documents/${c.req.param('id')}`, 'PUT', err.message);
        return c.json({ error: 'Failed to update document', detail: err.message }, 500);
    }
});
// Soft-delete a document — with existence check + audit (DATA-02)
documents.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (!(await checkExists(c.env.DB, 'documents', id)))
        return notFound(c, 'Document');
    await c.env.DB.prepare('UPDATE documents SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind('archived', id).run();
    await auditLog(c.env.DB, 'soft_delete', 'documents', id, 1);
    return c.json({ success: true });
});
// ═══════════════════════════════════════════════════════════════
// UPLOAD — Receive file content, store in D1, auto-analyze
// ═══════════════════════════════════════════════════════════════
documents.post('/upload', async (c) => {
    try {
        const body = await c.req.json();
        const v = validate(body, [
            { field: 'title', required: true, type: 'string', minLength: 1, maxLength: 500 },
            { field: 'file_name', required: true, type: 'string', minLength: 1, maxLength: 500 },
            { field: 'content_text', required: true, type: 'string', minLength: 1, maxLength: 500000 },
            { field: 'file_type', type: 'string', maxLength: 100 },
            { field: 'file_size', type: 'number', min: 0 },
            { field: 'category', type: 'string', oneOf: VALID_CATEGORIES },
            { field: 'case_id', type: 'number', min: 1 },
        ]);
        if (!v.valid)
            return badRequest(c, v.errors);
        const { title, file_name, file_type, file_size, category, case_id, content_text } = body;
        // FK validation
        if (case_id) {
            const fk = await validateFK(c.env.DB, 'cases_matters', case_id, 'case_id');
            if (fk)
                return badRequest(c, [fk]);
        }
        const safe = sanitize({ title, file_name, content_text });
        // 1. Store the document
        const result = await c.env.DB.prepare(`
      INSERT INTO documents (title, file_name, file_type, file_size, category, status, case_id, uploaded_by, ai_generated, content_text, tags)
      VALUES (?, ?, ?, ?, ?, 'review', ?, 1, 0, ?, 'uploaded')
    `).bind(safe.title, safe.file_name, file_type || 'text/plain', file_size || content_text.length, category || 'general', case_id || null, safe.content_text).run();
        const docId = result.meta.last_row_id;
        // 2. Run inline analysis (pattern-based extraction)
        const analysis = analyzeDocument(content_text, file_name, category || 'general');
        // 3. Store analysis results
        await c.env.DB.prepare(`
      INSERT INTO document_analysis (document_id, analysis_type, summary, doc_classification, entities_json, key_dates_json, monetary_values_json, parties_json, citations_json, clauses_json, risk_flags_json, obligations_json, deadlines_json, jurisdiction_detected, confidence, analyzed_by)
      VALUES (?, 'full', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pattern_engine')
    `).bind(docId, analysis.summary, analysis.classification, JSON.stringify(analysis.entities), JSON.stringify(analysis.keyDates), JSON.stringify(analysis.monetaryValues), JSON.stringify(analysis.parties), JSON.stringify(analysis.citations), JSON.stringify(analysis.clauses), JSON.stringify(analysis.riskFlags), JSON.stringify(analysis.obligations), JSON.stringify(analysis.deadlines), analysis.jurisdiction, analysis.confidence).run();
        // 4. Update document with AI summary
        await c.env.DB.prepare('UPDATE documents SET ai_summary = ?, status = ? WHERE id = ?')
            .bind(analysis.summary, 'review', docId).run();
        await auditLog(c.env.DB, 'create', 'documents', docId, 1, { title: safe.title, file_name: safe.file_name, analyzed: true });
        return c.json({ id: docId, title, file_name, analysis, message: 'Document uploaded and analyzed successfully' }, 201);
    }
    catch (err) {
        await logError(c.env.DB, '/api/documents/upload', 'POST', err.message);
        return c.json({ error: 'Failed to upload document', detail: err.message }, 500);
    }
});
// ═══════════════════════════════════════════════════════════════
// ANALYZE — Run analysis on an existing document
// ═══════════════════════════════════════════════════════════════
documents.post('/:id/analyze', async (c) => {
    const id = c.req.param('id');
    const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first();
    if (!doc)
        return notFound(c, 'Document');
    if (!doc.content_text)
        return badRequest(c, ['No content text available for analysis']);
    const analysis = analyzeDocument(doc.content_text, doc.file_name, doc.category || 'general');
    // Upsert analysis
    await c.env.DB.prepare('DELETE FROM document_analysis WHERE document_id = ?').bind(id).run();
    await c.env.DB.prepare(`
    INSERT INTO document_analysis (document_id, analysis_type, summary, doc_classification, entities_json, key_dates_json, monetary_values_json, parties_json, citations_json, clauses_json, risk_flags_json, obligations_json, deadlines_json, jurisdiction_detected, confidence, analyzed_by)
    VALUES (?, 'full', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pattern_engine')
  `).bind(id, analysis.summary, analysis.classification, JSON.stringify(analysis.entities), JSON.stringify(analysis.keyDates), JSON.stringify(analysis.monetaryValues), JSON.stringify(analysis.parties), JSON.stringify(analysis.citations), JSON.stringify(analysis.clauses), JSON.stringify(analysis.riskFlags), JSON.stringify(analysis.obligations), JSON.stringify(analysis.deadlines), analysis.jurisdiction, analysis.confidence).run();
    await c.env.DB.prepare('UPDATE documents SET ai_summary = ? WHERE id = ?').bind(analysis.summary, id).run();
    await auditLog(c.env.DB, 'update', 'documents', id, 1, { action: 're-analyze' });
    return c.json({ document_id: id, analysis });
});
// Get analysis for a document
documents.get('/:id/analysis', async (c) => {
    const id = c.req.param('id');
    const analysis = await c.env.DB.prepare('SELECT * FROM document_analysis WHERE document_id = ? ORDER BY created_at DESC LIMIT 1').bind(id).first();
    if (!analysis)
        return notFound(c, 'Analysis');
    const parsed = {
        ...analysis,
        entities: tryParse(analysis.entities_json),
        key_dates: tryParse(analysis.key_dates_json),
        monetary_values: tryParse(analysis.monetary_values_json),
        parties: tryParse(analysis.parties_json),
        citations: tryParse(analysis.citations_json),
        clauses: tryParse(analysis.clauses_json),
        risk_flags: tryParse(analysis.risk_flags_json),
        obligations: tryParse(analysis.obligations_json),
        deadlines: tryParse(analysis.deadlines_json),
    };
    return c.json({ analysis: parsed });
});
function tryParse(s) {
    if (!s)
        return [];
    try {
        return JSON.parse(s);
    }
    catch {
        return [];
    }
}
function analyzeDocument(text, fileName, category) {
    const words = text.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const pageEstimate = Math.max(1, Math.ceil(wordCount / 300));
    const lower = text.toLowerCase();
    // ── Classification ─────────────────────────────────────
    let classification = category;
    if (lower.match(/complaint|petition|plaintiff.*defendant/))
        classification = 'pleading';
    else if (lower.match(/motion to|movant|hereby moves/))
        classification = 'motion';
    else if (lower.match(/contract|agreement|parties agree|whereas/))
        classification = 'contract';
    else if (lower.match(/demand|payment.*due|settlement/))
        classification = 'correspondence';
    else if (lower.match(/interrogator|request for production|deposition/))
        classification = 'discovery';
    else if (lower.match(/invoice|billing|amount due|payment terms/))
        classification = 'billing';
    else if (lower.match(/memorandum|memo|legal analysis/))
        classification = 'memo';
    else if (lower.match(/affidavit|sworn|under penalty of perjury/))
        classification = 'affidavit';
    else if (lower.match(/order|court orders|it is ordered/))
        classification = 'court_order';
    else if (lower.match(/lease|tenant|landlord|rental/))
        classification = 'lease';
    else if (lower.match(/will|testament|beneficiary|executor/))
        classification = 'estate';
    else if (lower.match(/patent|trademark|copyright|intellectual property/))
        classification = 'ip';
    // ── Entity Extraction ──────────────────────────────────
    const entities = [];
    const nameMatches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+\b/g) || [];
    const seenNames = new Set();
    for (const name of nameMatches.slice(0, 20)) {
        const clean = name.trim();
        if (!seenNames.has(clean) && clean.length > 4 && !clean.match(/^(The |This |That |With |From |Under |Section |Article |Chapter )/)) {
            seenNames.add(clean);
            const idx = text.indexOf(clean);
            const ctx = text.substring(Math.max(0, idx - 30), idx + clean.length + 30).trim();
            entities.push({ type: 'person', value: clean, context: ctx });
        }
    }
    const orgPatterns = text.match(/\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\s+(?:Inc|LLC|Corp|Co|Ltd|LLP|PC|PA|Group|Associates|Partners|Foundation|Trust|Bank|Insurance|Company)\b\.?/g) || [];
    for (const org of orgPatterns.slice(0, 10))
        entities.push({ type: 'organization', value: org.trim(), context: '' });
    const addrMatches = text.match(/\d+\s+[A-Z][a-z]+(?:\s+[A-Za-z]+){0,3}\s+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Road|Rd|Lane|Ln|Way|Court|Ct|Place|Pl|Suite|Ste)\b\.?/gi) || [];
    for (const addr of addrMatches.slice(0, 5))
        entities.push({ type: 'address', value: addr.trim(), context: '' });
    const phones = text.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g) || [];
    for (const p of phones.slice(0, 5))
        entities.push({ type: 'phone', value: p.trim(), context: '' });
    const emails = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    for (const e of emails.slice(0, 5))
        entities.push({ type: 'email', value: e, context: '' });
    const caseNums = text.match(/(?:Case\s*(?:No\.?|Number|#)\s*|No\.\s*)\d{2,4}[-/]\w+[-/]?\w*/gi) || [];
    for (const cn of caseNums.slice(0, 5))
        entities.push({ type: 'case_number', value: cn.trim(), context: '' });
    // ── Date Extraction ────────────────────────────────────
    const keyDates = [];
    const datePatterns = [
        /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/gi,
        /\d{1,2}\/\d{1,2}\/\d{2,4}/g,
        /\d{4}-\d{2}-\d{2}/g,
    ];
    const seenDates = new Set();
    for (const pat of datePatterns) {
        const matches = text.match(pat) || [];
        for (const m of matches.slice(0, 10)) {
            if (!seenDates.has(m)) {
                seenDates.add(m);
                const idx = text.indexOf(m);
                const ctx = text.substring(Math.max(0, idx - 50), idx + m.length + 50).trim();
                let dtype = 'date';
                const ctxL = ctx.toLowerCase();
                if (ctxL.includes('due') || ctxL.includes('deadline'))
                    dtype = 'deadline';
                else if (ctxL.includes('filed') || ctxL.includes('filing'))
                    dtype = 'filing_date';
                else if (ctxL.includes('signed') || ctxL.includes('executed'))
                    dtype = 'execution_date';
                else if (ctxL.includes('expir') || ctxL.includes('terminat'))
                    dtype = 'expiration_date';
                else if (ctxL.includes('hearing') || ctxL.includes('trial'))
                    dtype = 'hearing_date';
                else if (ctxL.includes('birth') || ctxL.includes('dob'))
                    dtype = 'date_of_birth';
                keyDates.push({ date: m, context: ctx.substring(0, 100), type: dtype });
            }
        }
    }
    // ── Monetary Values ────────────────────────────────────
    const monetaryValues = [];
    const moneyMatches = text.match(/\$[\d,]+(?:\.\d{2})?(?:\s*(?:million|billion|thousand|k|M|B))?/g) || [];
    for (const m of moneyMatches.slice(0, 15)) {
        const idx = text.indexOf(m);
        const ctx = text.substring(Math.max(0, idx - 40), idx + m.length + 40).trim();
        monetaryValues.push({ amount: m, raw: m, context: ctx.substring(0, 100) });
    }
    const writtenMoney = text.match(/(?:\d[\d,]*(?:\.\d+)?)\s+(?:dollars|USD)/gi) || [];
    for (const m of writtenMoney.slice(0, 5))
        monetaryValues.push({ amount: m, raw: m, context: '' });
    // ── Parties Extraction ─────────────────────────────────
    const parties = [];
    const partyPatterns = [
        [/plaintiff[s]?\s*[:=]?\s*([A-Z][A-Za-z\s,]+?)(?:\n|,\s*v\.?)/gi, 'plaintiff'],
        [/defendant[s]?\s*[:=]?\s*([A-Z][A-Za-z\s,]+?)(?:\n|$)/gi, 'defendant'],
        [/petitioner\s*[:=]?\s*([A-Z][A-Za-z\s,]+?)(?:\n|$)/gi, 'petitioner'],
        [/respondent\s*[:=]?\s*([A-Z][A-Za-z\s,]+?)(?:\n|$)/gi, 'respondent'],
        [/([A-Z][A-Za-z\s.]+?)\s+v\.?\s+([A-Z][A-Za-z\s.]+?)(?:\n|,|\.|$)/g, 'case_caption'],
    ];
    for (const [pat, role] of partyPatterns) {
        let match;
        while ((match = pat.exec(text)) !== null) {
            if (role === 'case_caption') {
                parties.push({ name: match[1].trim().substring(0, 60), role: 'plaintiff' });
                parties.push({ name: match[2].trim().substring(0, 60), role: 'defendant' });
            }
            else {
                parties.push({ name: match[1].trim().substring(0, 60), role });
            }
            if (parties.length >= 10)
                break;
        }
    }
    // ── Citations ──────────────────────────────────────────
    const citations = [];
    const ksStatutes = text.match(/K\.?S\.?A\.?\s*§?\s*\d+[-–]\d+[\w]*/g) || [];
    for (const s of ksStatutes)
        citations.push({ citation: s, type: 'kansas_statute' });
    const moStatutes = text.match(/RSMo\s*§?\s*[\d.]+/g) || [];
    for (const s of moStatutes)
        citations.push({ citation: s, type: 'missouri_statute' });
    const fedStatutes = text.match(/\d+\s+U\.?S\.?C\.?\s*§?\s*\d+/g) || [];
    for (const s of fedStatutes)
        citations.push({ citation: s, type: 'federal_statute' });
    const caseCites = text.match(/\d+\s+(?:Kan|Mo|S\.W\.\d?d|F\.\d?d|U\.S|S\.Ct|F\.Supp)\.?\s*\d+/g) || [];
    for (const s of caseCites)
        citations.push({ citation: s, type: 'case_law' });
    const frcp = text.match(/(?:Fed\.|Federal)\s*R(?:ule)?\.?\s*(?:Civ|Crim)\.?\s*P(?:roc)?\.?\s*\d+/gi) || [];
    for (const s of frcp)
        citations.push({ citation: s, type: 'procedural_rule' });
    // ── Clauses / Sections ─────────────────────────────────
    const clauses = [];
    const sectionHeaders = text.match(/^(?:SECTION|ARTICLE|CLAUSE|PARAGRAPH|PART)\s+\d+[.:]\s*.+$/gmi) || [];
    for (const h of sectionHeaders.slice(0, 15)) {
        const idx = text.indexOf(h);
        const snippet = text.substring(idx, idx + 300).trim();
        let ctype = 'general';
        const hL = h.toLowerCase();
        if (hL.match(/indemn|liability|limit/))
            ctype = 'liability';
        else if (hL.match(/confiden|non-disclos/))
            ctype = 'confidentiality';
        else if (hL.match(/terminat|cancel/))
            ctype = 'termination';
        else if (hL.match(/payment|compensat|fee/))
            ctype = 'payment';
        else if (hL.match(/govern|jurisdict/))
            ctype = 'jurisdiction';
        else if (hL.match(/arbitrat|disput/))
            ctype = 'dispute_resolution';
        clauses.push({ title: h.trim(), content: snippet.substring(0, 200), type: ctype });
    }
    // ── Risk Flags ─────────────────────────────────────────
    const riskFlags = [];
    const riskPatterns = [
        [/statute of limitations/gi, 'SOL Reference', 'high'],
        [/indemnif/gi, 'Indemnification Clause', 'medium'],
        [/waiv(?:e|er|ing)\s+(?:right|claim|jury)/gi, 'Rights Waiver', 'high'],
        [/liquidated damages/gi, 'Liquidated Damages', 'medium'],
        [/non-?compete|non-?solicitation/gi, 'Restrictive Covenant', 'medium'],
        [/confess(?:ed|ion of)\s+judgment/gi, 'Confession of Judgment', 'high'],
        [/binding arbitration/gi, 'Mandatory Arbitration', 'medium'],
        [/class\s+action\s+waiver/gi, 'Class Action Waiver', 'high'],
        [/automatic\s+renewal/gi, 'Auto-Renewal Clause', 'low'],
        [/personal\s+guarantee/gi, 'Personal Guarantee', 'high'],
        [/joint\s+and\s+several/gi, 'Joint & Several Liability', 'high'],
        [/default\s+(?:provision|clause|interest)/gi, 'Default Provision', 'medium'],
        [/force\s+majeure/gi, 'Force Majeure', 'low'],
        [/change\s+of\s+(?:control|ownership)/gi, 'Change of Control', 'medium'],
        [/(?:penalty|penalt(?:y|ies))\s+(?:clause|provision)/gi, 'Penalty Clause', 'medium'],
        [/(?:no|without)\s+(?:notice|prior\s+notice)/gi, 'No Notice Requirement', 'medium'],
    ];
    for (const [pat, flag, severity] of riskPatterns) {
        const match = text.match(pat);
        if (match) {
            const idx = text.indexOf(match[0]);
            const ctx = text.substring(Math.max(0, idx - 30), idx + match[0].length + 60).trim();
            riskFlags.push({ flag, severity, detail: ctx.substring(0, 120) });
        }
    }
    // ── Obligations ────────────────────────────────────────
    const obligations = [];
    const obligPatterns = text.match(/(?:shall|must|is\s+required\s+to|agrees\s+to|will\s+(?:be\s+required\s+to|provide))\s+.{10,100}/gi) || [];
    for (const o of obligPatterns.slice(0, 10)) {
        obligations.push({ party: 'Unspecified', obligation: o.trim().substring(0, 150), deadline: null });
    }
    // ── Deadlines ──────────────────────────────────────────
    const deadlines = [];
    for (const d of keyDates.filter(d => d.type === 'deadline' || d.type === 'hearing_date')) {
        let urgency = 'normal';
        try {
            const dt = new Date(d.date);
            const daysUntil = (dt.getTime() - Date.now()) / 86400000;
            if (daysUntil < 0)
                urgency = 'overdue';
            else if (daysUntil < 7)
                urgency = 'urgent';
            else if (daysUntil < 30)
                urgency = 'upcoming';
        }
        catch { /* non-parseable date */ }
        deadlines.push({ date: d.date, description: d.context, urgency });
    }
    // ── Jurisdiction Detection ─────────────────────────────
    let jurisdiction = 'unknown';
    if (lower.match(/k\.?s\.?a\.?\s|kansas\s+(court|statute|law|code|supreme)/))
        jurisdiction = 'kansas';
    else if (lower.match(/rsmo|missouri\s+(court|statute|law|code|supreme)/))
        jurisdiction = 'missouri';
    else if (lower.match(/u\.?s\.?c\.?\s|federal\s+(court|rule|statute)|united\s+states/))
        jurisdiction = 'federal';
    if (jurisdiction === 'unknown' && lower.match(/kansas/))
        jurisdiction = 'kansas';
    if (jurisdiction === 'unknown' && lower.match(/missouri/))
        jurisdiction = 'missouri';
    // ── Summary Generation ─────────────────────────────────
    const entityCount = entities.length;
    const dateCount = keyDates.length;
    const moneyCount = monetaryValues.length;
    const riskCount = riskFlags.length;
    const citCount = citations.length;
    let summary = `${classification.charAt(0).toUpperCase() + classification.slice(1).replace(/_/g, ' ')} document`;
    summary += ` (${wordCount.toLocaleString()} words, ~${pageEstimate} page${pageEstimate > 1 ? 's' : ''})`;
    if (parties.length > 0)
        summary += `. Parties: ${parties.map(p => `${p.name} (${p.role})`).join(', ')}`;
    if (jurisdiction !== 'unknown')
        summary += `. Jurisdiction: ${jurisdiction.charAt(0).toUpperCase() + jurisdiction.slice(1)}`;
    if (citCount > 0)
        summary += `. ${citCount} legal citation${citCount > 1 ? 's' : ''} found`;
    if (moneyCount > 0)
        summary += `. ${moneyCount} monetary value${moneyCount > 1 ? 's' : ''} identified`;
    if (riskCount > 0)
        summary += `. ${riskCount} risk flag${riskCount > 1 ? 's' : ''} detected`;
    if (deadlines.length > 0)
        summary += `. ${deadlines.length} deadline${deadlines.length > 1 ? 's' : ''} found`;
    summary += '.';
    const confidence = Math.min(0.95, 0.5 + entityCount * 0.02 + dateCount * 0.03 + citCount * 0.04 + (classification !== category ? 0.1 : 0));
    return {
        summary, classification, entities, keyDates, monetaryValues, parties, citations,
        clauses, riskFlags, obligations, deadlines, jurisdiction, confidence, wordCount, pageEstimate,
    };
}
export default documents;

// ═══════════════════════════════════════════════════════════════
// LAWYRS — LEGAL RESEARCH API ROUTES
// Exposes CourtListener, Harvard Caselaw, and Lex Machina
// endpoints via Hono REST API
// ═══════════════════════════════════════════════════════════════

import { Hono } from 'hono'
import {
  searchCaseLaw, searchDockets, lookupCitation,
  verifyCitations, getOpinionText, searchJudges,
  getCitationNetwork, checkApiHealth,
  type CaseLawResult, type LegalSearchResponse
} from '../agents/legal-research'
import {
  getLitigationAnalytics, formatAnalyticsMarkdown,
  LexMachinaClient
} from '../agents/lex-machina'

type Bindings = {
  DB: D1Database
  COURTLISTENER_TOKEN?: string
  LEX_MACHINA_CLIENT_ID?: string
  LEX_MACHINA_CLIENT_SECRET?: string
}

const app = new Hono<{ Bindings: Bindings }>()

// ── 1. CASE LAW SEARCH ───────────────────────────────────────
// GET /api/legal-research/search?q=...&jurisdiction=...&semantic=true
app.get('/search', async (c) => {
  const q = c.req.query('q') || ''
  if (!q) return c.json({ error: 'Query parameter "q" is required' }, 400)

  const jurisdiction = c.req.query('jurisdiction') || 'multi-state'
  const semantic = c.req.query('semantic') === 'true'
  const dateAfter = c.req.query('date_after') || undefined
  const dateBefore = c.req.query('date_before') || undefined
  const citedGt = c.req.query('cited_gt') ? parseInt(c.req.query('cited_gt')!) : undefined
  const orderBy = c.req.query('order_by') || 'score desc'
  const pageSize = Math.min(parseInt(c.req.query('page_size') || '20'), 50)

  const results = await searchCaseLaw({
    query: q,
    jurisdiction,
    semantic,
    date_filed_after: dateAfter,
    date_filed_before: dateBefore,
    cited_gt: citedGt,
    order_by: orderBy,
    page_size: pageSize,
    token: c.env.COURTLISTENER_TOKEN
  })

  return c.json(results)
})

// ── 2. SEMANTIC SEARCH (convenience endpoint) ────────────────
// GET /api/legal-research/semantic?q=...
app.get('/semantic', async (c) => {
  const q = c.req.query('q') || ''
  if (!q) return c.json({ error: 'Query parameter "q" is required' }, 400)

  const jurisdiction = c.req.query('jurisdiction') || 'multi-state'
  const results = await searchCaseLaw({
    query: q,
    jurisdiction,
    semantic: true,
    page_size: 15,
    token: c.env.COURTLISTENER_TOKEN
  })

  return c.json(results)
})

// ── 3. DOCKET SEARCH (PACER) ─────────────────────────────────
// GET /api/legal-research/dockets?q=...
app.get('/dockets', async (c) => {
  const q = c.req.query('q') || ''
  if (!q) return c.json({ error: 'Query parameter "q" is required' }, 400)

  const jurisdiction = c.req.query('jurisdiction') || 'multi-state'
  const dateAfter = c.req.query('date_after') || undefined
  const dateBefore = c.req.query('date_before') || undefined

  const results = await searchDockets({
    query: q,
    jurisdiction,
    date_filed_after: dateAfter,
    date_filed_before: dateBefore,
    page_size: 20,
    token: c.env.COURTLISTENER_TOKEN
  })

  return c.json(results)
})

// ── 4. CITATION LOOKUP ───────────────────────────────────────
// GET /api/legal-research/citation?cite=237+Kan.+629
app.get('/citation', async (c) => {
  const cite = c.req.query('cite') || ''
  if (!cite) return c.json({ error: 'Query parameter "cite" is required' }, 400)

  const result = await lookupCitation(cite, c.env.COURTLISTENER_TOKEN)
  return c.json(result)
})

// ── 5. BULK CITATION VERIFICATION ────────────────────────────
// POST /api/legal-research/verify-citations
// Body: { citations: ["237 Kan. 629", "661 S.W.2d 11"] }
app.post('/verify-citations', async (c) => {
  const body = await c.req.json()
  const citations = body.citations || []
  if (!Array.isArray(citations) || citations.length === 0) {
    return c.json({ error: 'Body must contain an array of citations' }, 400)
  }

  const results = await verifyCitations(citations, c.env.COURTLISTENER_TOKEN)
  const verified = results.filter(r => r.found).length
  const unverified = results.filter(r => !r.found).length

  return c.json({
    total: results.length,
    verified,
    unverified,
    results,
    warning: unverified > 0 ? `${unverified} citation(s) could not be verified — may be hallucinated or incorrectly formatted` : null
  })
})

// ── 6. FULL OPINION TEXT ─────────────────────────────────────
// GET /api/legal-research/opinion/:clusterId
app.get('/opinion/:clusterId', async (c) => {
  const clusterId = parseInt(c.req.param('clusterId'))
  if (isNaN(clusterId)) return c.json({ error: 'Invalid cluster ID' }, 400)

  const result = await getOpinionText(clusterId, c.env.COURTLISTENER_TOKEN)
  if (!result) return c.json({ error: 'Opinion not found' }, 404)

  return c.json(result)
})

// ── 7. JUDGE SEARCH ──────────────────────────────────────────
// GET /api/legal-research/judges?q=...
app.get('/judges', async (c) => {
  const q = c.req.query('q') || ''
  if (!q) return c.json({ error: 'Query parameter "q" is required' }, 400)

  const results = await searchJudges({ query: q, token: c.env.COURTLISTENER_TOKEN })
  return c.json({ results })
})

// ── 8. CITATION NETWORK ──────────────────────────────────────
// GET /api/legal-research/citations/:clusterId?direction=citing|cited_by
app.get('/citations/:clusterId', async (c) => {
  const clusterId = parseInt(c.req.param('clusterId'))
  if (isNaN(clusterId)) return c.json({ error: 'Invalid cluster ID' }, 400)

  const direction = (c.req.query('direction') || 'cited_by') as 'citing' | 'cited_by'
  const results = await getCitationNetwork(clusterId, direction, c.env.COURTLISTENER_TOKEN)

  return c.json({
    cluster_id: clusterId,
    direction,
    total: results.length,
    results
  })
})

// ── 9. LITIGATION ANALYTICS ──────────────────────────────────
// GET /api/legal-research/analytics?jurisdiction=kansas&case_type=personal_injury
app.get('/analytics', async (c) => {
  const jurisdiction = c.req.query('jurisdiction') || 'kansas'
  const caseType = c.req.query('case_type') || 'personal_injury'

  const analytics = getLitigationAnalytics(jurisdiction, caseType)
  const markdown = formatAnalyticsMarkdown(analytics)

  return c.json({
    ...analytics,
    markdown
  })
})

// ── 10. API HEALTH CHECK ─────────────────────────────────────
// GET /api/legal-research/health
app.get('/health', async (c) => {
  const health = await checkApiHealth()

  // Check Lex Machina config
  const lmConfigured = !!(c.env.LEX_MACHINA_CLIENT_ID && c.env.LEX_MACHINA_CLIENT_SECRET)

  return c.json({
    ...health,
    lex_machina: {
      status: lmConfigured ? 'configured' : 'not_configured',
      note: lmConfigured
        ? 'Lex Machina API credentials are configured'
        : 'Using estimated litigation analytics. Configure LEX_MACHINA_CLIENT_ID and LEX_MACHINA_CLIENT_SECRET for live Lex Machina data.'
    },
    courtlistener_token: c.env.COURTLISTENER_TOKEN ? 'configured' : 'anonymous (rate-limited)',
    services: {
      case_law_search: 'CourtListener REST API v4.3',
      docket_search: 'CourtListener PACER/RECAP',
      citation_verification: 'CourtListener Citation Lookup',
      semantic_search: 'CourtListener Citegeist Engine',
      litigation_analytics: lmConfigured ? 'Lex Machina (LexisNexis)' : 'Built-in KS/MO estimates',
      coverage: 'All US jurisdictions — federal + state courts'
    }
  })
})

// ── 11. QUICK RESEARCH (combined search — for AI agent) ──────
// POST /api/legal-research/quick
// Body: { query, jurisdiction, case_type, include_dockets, include_analytics }
app.post('/quick', async (c) => {
  const body = await c.req.json()
  const { query, jurisdiction = 'multi-state', case_type, include_dockets = false, include_analytics = true } = body

  if (!query) return c.json({ error: 'Query is required' }, 400)

  // Run searches in parallel
  const promises: Promise<any>[] = [
    searchCaseLaw({
      query,
      jurisdiction,
      page_size: 10,
      token: c.env.COURTLISTENER_TOKEN
    })
  ]

  if (include_dockets) {
    promises.push(searchDockets({
      query,
      jurisdiction,
      page_size: 5,
      token: c.env.COURTLISTENER_TOKEN
    }))
  }

  const results = await Promise.all(promises)
  const caseResults = results[0] as LegalSearchResponse
  const docketResults = include_dockets ? results[1] : null

  // Get analytics if requested
  const analytics = include_analytics ? getLitigationAnalytics(jurisdiction, case_type || 'personal_injury') : null

  return c.json({
    case_law: caseResults,
    dockets: docketResults,
    analytics,
    summary: {
      total_cases_found: caseResults.total_results,
      total_dockets_found: docketResults?.total_results || 0,
      api_status: caseResults.api_status,
      jurisdiction,
      search_type: caseResults.search_type
    }
  })
})

export default app

// ═══════════════════════════════════════════════════════════════
// LAWYRS — LEGAL RESEARCH SERVICE
// Live case law + docket search via:
//   1. CourtListener (Free Law Project) — REST API v4
//      - Case law search (opinions, clusters)
//      - PACER docket search
//      - Citation lookup & verification
//      - Semantic + keyword search
//   2. Harvard Caselaw Access Project (CAP)
//      - Full-text historical case law (via CourtListener)
//      - Bulk US case law coverage
//
// All data is public domain / free of copyright restrictions.
// ═══════════════════════════════════════════════════════════════

// ── CourtListener Court IDs for Kansas & Missouri ────────────
export const COURT_IDS = {
  // Kansas
  kan: 'kan',               // District of Kansas (Federal)
  kansctapp: 'kansctapp',   // Kansas Court of Appeals
  kansc: 'kan',             // Kansas Supreme Court (note: CL uses 'kan' for state)
  ks: 'kansctapp',          // shortcut
  // Missouri
  mod: 'mod',               // Western District of Missouri (Federal)
  moed: 'moed',             // Eastern District of Missouri (Federal)
  mosc: 'mosc',             // Missouri Supreme Court  (not in CL - use mo)
  moctapp: 'moctapp',       // Missouri Court of Appeals
  mo: 'mo',                 // Missouri general
  // Federal circuits
  ca10: 'ca10',             // 10th Circuit (covers Kansas)
  ca8: 'ca8',               // 8th Circuit (covers Missouri)
  scotus: 'scotus',         // US Supreme Court
} as const

// ── Jurisdiction-to-court mapping ────────────────────────────
export function getCourtIds(jurisdiction: string): string[] {
  const j = jurisdiction?.toLowerCase() || ''
  if (j === 'kansas' || j === 'ks') return ['kan', 'kansctapp', 'ca10']
  if (j === 'missouri' || j === 'mo') return ['mod', 'moed', 'moctapp', 'ca8']
  if (j === 'federal') return ['scotus', 'ca8', 'ca10', 'kan', 'mod', 'moed']
  return ['kan', 'kansctapp', 'ca10', 'mod', 'moed', 'moctapp', 'ca8'] // multi-state
}

// ── Result types ─────────────────────────────────────────────
export interface CaseLawResult {
  id: number
  case_name: string
  case_name_full: string
  citations: string[]
  court: string
  court_id: string
  date_filed: string
  docket_number: string
  status: string // Published, Unpublished, etc.
  snippet: string
  absolute_url: string
  cite_count: number
  judge: string
  source: 'courtlistener' | 'cap'
}

export interface DocketResult {
  id: number
  case_name: string
  court: string
  court_id: string
  docket_number: string
  date_filed: string
  date_terminated: string | null
  nature_of_suit: string
  cause: string
  absolute_url: string
  source: 'courtlistener'
}

export interface CitationLookupResult {
  citation: string
  found: boolean
  case_name: string | null
  court: string | null
  date_filed: string | null
  url: string | null
  cluster_id: number | null
}

export interface LegalSearchResponse {
  query: string
  source: string
  jurisdiction: string
  total_results: number
  results: CaseLawResult[]
  search_type: 'keyword' | 'semantic'
  timestamp: string
  api_status: 'live' | 'fallback'
}

export interface DocketSearchResponse {
  query: string
  source: string
  total_results: number
  results: DocketResult[]
  timestamp: string
  api_status: 'live' | 'fallback'
}

// ── CourtListener API Client ─────────────────────────────────
const CL_BASE = 'https://www.courtlistener.com'
const CL_API = `${CL_BASE}/api/rest/v4`

// Rate-limit tracking (5000/hr = ~83/min)
let lastRequestTime = 0
const MIN_REQUEST_INTERVAL = 750 // ms between requests

async function clFetch(url: string, token?: string): Promise<Response> {
  // Simple rate limiting
  const now = Date.now()
  const elapsed = now - lastRequestTime
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - elapsed))
  }
  lastRequestTime = Date.now()

  const headers: Record<string, string> = {
    'Accept': 'application/json',
  }
  if (token) {
    headers['Authorization'] = `Token ${token}`
  }

  const response = await fetch(url, { headers })
  return response
}

// ── 1. CASE LAW SEARCH (opinions) ────────────────────────────
export async function searchCaseLaw(opts: {
  query: string
  jurisdiction?: string
  court_ids?: string[]
  date_filed_after?: string
  date_filed_before?: string
  cited_gt?: number
  status?: string  // 'Published' | 'Unpublished' | ''
  order_by?: string // 'score desc' | 'dateFiled desc' | 'dateFiled asc' | 'citeCount desc'
  semantic?: boolean
  page_size?: number
  token?: string
}): Promise<LegalSearchResponse> {
  const {
    query, jurisdiction = 'multi-state',
    date_filed_after, date_filed_before,
    cited_gt, status = 'Published',
    order_by = 'score desc',
    semantic = false,
    page_size = 20,
    token
  } = opts

  const courtIds = opts.court_ids || getCourtIds(jurisdiction)

  try {
    // Build search URL
    const params = new URLSearchParams()
    params.set('q', query)
    params.set('type', 'o') // opinions
    if (courtIds.length > 0) params.set('court', courtIds.join(' '))
    if (date_filed_after) params.set('filed_after', date_filed_after)
    if (date_filed_before) params.set('filed_before', date_filed_before)
    if (cited_gt) params.set('cited_gt', String(cited_gt))
    if (status) params.set('stat_Published', 'on')
    if (order_by) params.set('order_by', order_by)
    if (semantic) params.set('semantic', 'true')
    params.set('highlight', 'on')
    // Page size via cursor pagination — CL returns ~20 results per page by default

    const url = `${CL_API}/search/?${params.toString()}`
    const res = await clFetch(url, token)

    if (!res.ok) {
      console.error(`CourtListener search failed: ${res.status} ${res.statusText}`)
      return {
        query, source: 'courtlistener', jurisdiction,
        total_results: 0, results: [],
        search_type: semantic ? 'semantic' : 'keyword',
        timestamp: new Date().toISOString(),
        api_status: 'fallback'
      }
    }

    const data: any = await res.json()
    const results: CaseLawResult[] = (data.results || []).map((r: any) => ({
      id: r.cluster_id || r.id,
      case_name: r.caseName || 'Unknown Case',
      case_name_full: r.caseNameFull || r.caseName || '',
      citations: r.citation || [],
      court: r.court || '',
      court_id: r.court_id || '',
      date_filed: r.dateFiled || '',
      docket_number: r.docketNumber || '',
      status: r.status || 'Unknown',
      snippet: cleanSnippet(r.opinions?.[0]?.snippet || r.snippet || ''),
      absolute_url: r.absolute_url ? `${CL_BASE}${r.absolute_url}` : '',
      cite_count: r.citeCount || 0,
      judge: r.judge || '',
      source: 'courtlistener' as const
    })).slice(0, page_size)

    return {
      query, source: 'courtlistener', jurisdiction,
      total_results: data.count || results.length,
      results,
      search_type: semantic ? 'semantic' : 'keyword',
      timestamp: new Date().toISOString(),
      api_status: 'live'
    }
  } catch (error) {
    console.error('CourtListener search error:', error)
    return {
      query, source: 'courtlistener', jurisdiction,
      total_results: 0, results: [],
      search_type: semantic ? 'semantic' : 'keyword',
      timestamp: new Date().toISOString(),
      api_status: 'fallback'
    }
  }
}

// ── 2. DOCKET SEARCH (PACER) ─────────────────────────────────
export async function searchDockets(opts: {
  query: string
  court_ids?: string[]
  jurisdiction?: string
  date_filed_after?: string
  date_filed_before?: string
  nature_of_suit?: string
  page_size?: number
  token?: string
}): Promise<DocketSearchResponse> {
  const {
    query, jurisdiction = 'multi-state',
    date_filed_after, date_filed_before,
    nature_of_suit, page_size = 20, token
  } = opts

  const courtIds = opts.court_ids || getCourtIds(jurisdiction)

  try {
    const params = new URLSearchParams()
    params.set('q', query)
    params.set('type', 'r') // RECAP dockets
    if (courtIds.length > 0) params.set('court', courtIds.join(' '))
    if (date_filed_after) params.set('filed_after', date_filed_after)
    if (date_filed_before) params.set('filed_before', date_filed_before)
    if (nature_of_suit) params.set('suitNature', nature_of_suit)

    const url = `${CL_API}/search/?${params.toString()}`
    const res = await clFetch(url, token)

    if (!res.ok) {
      return {
        query, source: 'courtlistener',
        total_results: 0, results: [],
        timestamp: new Date().toISOString(),
        api_status: 'fallback'
      }
    }

    const data: any = await res.json()
    const results: DocketResult[] = (data.results || []).map((r: any) => ({
      id: r.docket_id || r.id,
      case_name: r.caseName || 'Unknown Case',
      court: r.court || '',
      court_id: r.court_id || '',
      docket_number: r.docketNumber || '',
      date_filed: r.dateFiled || '',
      date_terminated: r.dateTerminated || null,
      nature_of_suit: r.suitNature || '',
      cause: r.cause || '',
      absolute_url: r.absolute_url ? `${CL_BASE}${r.absolute_url}` : '',
      source: 'courtlistener' as const
    })).slice(0, page_size)

    return {
      query, source: 'courtlistener',
      total_results: data.count || results.length,
      results,
      timestamp: new Date().toISOString(),
      api_status: 'live'
    }
  } catch (error) {
    console.error('CourtListener docket search error:', error)
    return {
      query, source: 'courtlistener',
      total_results: 0, results: [],
      timestamp: new Date().toISOString(),
      api_status: 'fallback'
    }
  }
}

// ── 3. CITATION LOOKUP & VERIFICATION ────────────────────────
// Use this to verify AI-generated citations (anti-hallucination)
export async function lookupCitation(citation: string, token?: string): Promise<CitationLookupResult> {
  try {
    const params = new URLSearchParams()
    params.set('q', `citation:(${citation})`)
    params.set('type', 'o')
    params.set('highlight', 'on')

    const url = `${CL_API}/search/?${params.toString()}`
    const res = await clFetch(url, token)

    if (!res.ok) {
      return { citation, found: false, case_name: null, court: null, date_filed: null, url: null, cluster_id: null }
    }

    const data: any = await res.json()
    if (data.results && data.results.length > 0) {
      const r = data.results[0]
      return {
        citation,
        found: true,
        case_name: r.caseName || null,
        court: r.court || null,
        date_filed: r.dateFiled || null,
        url: r.absolute_url ? `${CL_BASE}${r.absolute_url}` : null,
        cluster_id: r.cluster_id || null
      }
    }
    return { citation, found: false, case_name: null, court: null, date_filed: null, url: null, cluster_id: null }
  } catch (error) {
    return { citation, found: false, case_name: null, court: null, date_filed: null, url: null, cluster_id: null }
  }
}

// ── 4. BULK CITATION VERIFICATION (anti-hallucination) ───────
export async function verifyCitations(citations: string[], token?: string): Promise<CitationLookupResult[]> {
  const results: CitationLookupResult[] = []
  // Process sequentially to respect rate limits
  for (const cite of citations.slice(0, 10)) { // Max 10 at a time
    const result = await lookupCitation(cite, token)
    results.push(result)
  }
  return results
}

// ── 5. GET FULL OPINION TEXT ─────────────────────────────────
export async function getOpinionText(clusterId: number, token?: string): Promise<{
  case_name: string
  citations: string[]
  date_filed: string
  court: string
  text: string
  url: string
} | null> {
  try {
    // Get cluster info
    const clusterUrl = `${CL_API}/clusters/${clusterId}/`
    const clusterRes = await clFetch(clusterUrl, token)
    if (!clusterRes.ok) return null
    const cluster: any = await clusterRes.json()

    // Get first opinion text
    const opinions = cluster.sub_opinions || []
    let text = ''
    if (opinions.length > 0) {
      const opId = typeof opinions[0] === 'object' ? opinions[0].id : opinions[0]
      const opUrl = typeof opId === 'string' && opId.startsWith('http') ? opId : `${CL_API}/opinions/${opId}/`
      const opRes = await clFetch(opUrl, token)
      if (opRes.ok) {
        const op: any = await opRes.json()
        text = op.plain_text || op.html || op.html_lawbox || op.html_columbia || ''
        // Strip HTML tags if we got HTML
        if (text.includes('<')) {
          text = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
        }
      }
    }

    return {
      case_name: cluster.case_name || '',
      citations: (cluster.citations || []).map((c: any) => typeof c === 'string' ? c : c.cite || ''),
      date_filed: cluster.date_filed || '',
      court: cluster.court || '',
      text: text.substring(0, 15000), // Limit to ~15K chars
      url: `${CL_BASE}/opinion/${clusterId}/`
    }
  } catch (error) {
    console.error('getOpinionText error:', error)
    return null
  }
}

// ── 6. SEARCH JUDGES ─────────────────────────────────────────
export async function searchJudges(opts: {
  query: string
  court_ids?: string[]
  token?: string
}): Promise<any[]> {
  try {
    const params = new URLSearchParams()
    params.set('q', opts.query)
    params.set('type', 'p') // people/judges

    const url = `${CL_API}/search/?${params.toString()}`
    const res = await clFetch(url, opts.token)
    if (!res.ok) return []

    const data: any = await res.json()
    return (data.results || []).map((r: any) => ({
      id: r.id,
      name: r.name_full || `${r.name_first || ''} ${r.name_last || ''}`.trim(),
      court: r.court || '',
      date_start: r.date_start || '',
      date_end: r.date_end || '',
      appointing_president: r.appointing_president || '',
      political_affiliation: r.political_affiliation || '',
      absolute_url: r.absolute_url ? `${CL_BASE}${r.absolute_url}` : ''
    })).slice(0, 20)
  } catch (error) {
    return []
  }
}

// ── 7. CITATION NETWORK — cited by / cites ────────────────────
export async function getCitationNetwork(clusterId: number, direction: 'citing' | 'cited_by', token?: string): Promise<CaseLawResult[]> {
  try {
    const param = direction === 'cited_by' ? 'cites' : 'cited_by'
    const params = new URLSearchParams()
    params.set('q', `${param}:(${clusterId})`)
    params.set('type', 'o')
    params.set('order_by', 'citeCount desc')

    const url = `${CL_API}/search/?${params.toString()}`
    const res = await clFetch(url, token)
    if (!res.ok) return []

    const data: any = await res.json()
    return (data.results || []).map((r: any) => ({
      id: r.cluster_id || r.id,
      case_name: r.caseName || '',
      case_name_full: r.caseNameFull || '',
      citations: r.citation || [],
      court: r.court || '',
      court_id: r.court_id || '',
      date_filed: r.dateFiled || '',
      docket_number: r.docketNumber || '',
      status: r.status || '',
      snippet: cleanSnippet(r.opinions?.[0]?.snippet || ''),
      absolute_url: r.absolute_url ? `${CL_BASE}${r.absolute_url}` : '',
      cite_count: r.citeCount || 0,
      judge: r.judge || '',
      source: 'courtlistener' as const
    })).slice(0, 15)
  } catch (error) {
    return []
  }
}

// ── Utility: Clean HTML snippet ──────────────────────────────
function cleanSnippet(snippet: string): string {
  if (!snippet) return ''
  // Keep <mark> for highlighting, strip everything else
  return snippet
    .replace(/<(?!\/?mark\b)[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Health check for API availability ────────────────────────
export async function checkApiHealth(): Promise<{
  courtlistener: { status: 'ok' | 'degraded' | 'down', latency_ms: number }
}> {
  const start = Date.now()
  try {
    const res = await fetch(`${CL_BASE}/api/rest/v4/`, {
      headers: { 'Accept': 'application/json' }
    })
    return {
      courtlistener: {
        status: res.ok ? 'ok' : 'degraded',
        latency_ms: Date.now() - start
      }
    }
  } catch {
    return {
      courtlistener: { status: 'down', latency_ms: Date.now() - start }
    }
  }
}

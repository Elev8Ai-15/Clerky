// ═══════════════════════════════════════════════════════════════
// LAWYRS MULTI-AGENT SYSTEM — Type Definitions
// ═══════════════════════════════════════════════════════════════

export interface MatterContext {
  case_id: number | null
  case_number: string | null
  title: string | null
  case_type: string | null
  status: string | null
  priority: string | null
  client_name: string | null
  client_type: string | null
  attorney_name: string | null
  court_name: string | null
  judge_name: string | null
  opposing_counsel: string | null
  opposing_party: string | null
  date_filed: string | null
  estimated_value: number | null
  statute_of_limitations: string | null
  description: string | null
  // Enriched context from memory
  documents: DocumentRef[]
  tasks: TaskRef[]
  recent_events: EventRef[]
  billing_summary: BillingSummary | null
  prior_research: MemoryEntry[]
  prior_analysis: MemoryEntry[]
}

export interface DocumentRef {
  id: number
  title: string
  file_type: string
  category: string
  status: string
  ai_summary: string | null
}

export interface TaskRef {
  id: number
  title: string
  priority: string
  status: string
  due_date: string | null
  task_type: string
}

export interface EventRef {
  id: number
  title: string
  event_type: string
  start_datetime: string
  end_datetime: string
  location: string | null
}

export interface BillingSummary {
  total_billed: number
  total_paid: number
  outstanding: number
  total_hours: number
  avg_rate: number
}

export interface MemoryEntry {
  id: number
  agent_type: string
  key: string
  value: string
  confidence: number
  created_at: string
}

export interface AgentInput {
  message: string
  jurisdiction: string
  matter: MatterContext
  session_id: string
  conversation_history: ChatMessage[]
  date: string
  user_id: number
}

export interface AgentOutput {
  content: string
  agent_type: string
  confidence: number
  tokens_used: number
  duration_ms: number
  citations: Citation[]
  risks_flagged: string[]
  follow_up_actions: string[]
  memory_updates: MemoryUpdate[]
  sub_agents_called: string[]
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  agent_type?: string
  created_at?: string
}

export interface Citation {
  source: string
  reference: string
  url?: string
  verified: boolean
}

export interface MemoryUpdate {
  key: string
  value: string
  agent_type: string
  confidence: number
}

export interface AgentRoute {
  agent: string
  confidence: number
  reasoning: string
  sub_agents?: string[]
}

export type DB = D1Database

export interface Env {
  DB: D1Database
  MEM0_API_KEY?: string
  OPENAI_API_KEY?: string
}

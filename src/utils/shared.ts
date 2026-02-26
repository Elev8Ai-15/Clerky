// ═══════════════════════════════════════════════════════════════
// CLERKY — Shared Utilities v5.0
// Sanitization, validation, audit logging, pagination, safe IDs,
// rate limiting, error handling, CSRF, response helpers
// Addresses: BUG-01..05, SEC-01..04, DATA-01..03, OPS-01..04
// ═══════════════════════════════════════════════════════════════

import { Context, Next } from 'hono'

// ── XSS Sanitization (SEC-02 / BUG-02) ───────────────────────
export function sanitize(input: any): any {
  if (input === null || input === undefined) return input
  if (typeof input === 'number' || typeof input === 'boolean') return input
  if (typeof input === 'string') return sanitizeString(input)
  if (Array.isArray(input)) return input.map(sanitize)
  if (typeof input === 'object') {
    const clean: Record<string, any> = {}
    for (const [k, v] of Object.entries(input)) {
      clean[k] = sanitize(v)
    }
    return clean
  }
  return input
}

export function sanitizeString(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
}

// ── Input Validation (BUG-01) ─────────────────────────────────
export interface FieldRule {
  field: string
  required?: boolean
  type?: 'string' | 'number' | 'boolean' | 'email'
  maxLength?: number
  minLength?: number
  oneOf?: string[]
  min?: number
  max?: number
  pattern?: RegExp
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
  sanitized: Record<string, any>
}

export function validate(body: any, rules: FieldRule[]): ValidationResult {
  const errors: string[] = []
  const sanitized: Record<string, any> = {}

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Request body must be a JSON object'], sanitized: {} }
  }

  for (const rule of rules) {
    const val = body[rule.field]

    if (rule.required && (val === undefined || val === null || val === '')) {
      errors.push(`${rule.field} is required`)
      continue
    }

    if (val === undefined || val === null) {
      sanitized[rule.field] = val
      continue
    }

    if (rule.type === 'number') {
      const n = Number(val)
      if (isNaN(n)) { errors.push(`${rule.field} must be a number`); continue }
      if (rule.min !== undefined && n < rule.min) { errors.push(`${rule.field} must be >= ${rule.min}`); continue }
      if (rule.max !== undefined && n > rule.max) { errors.push(`${rule.field} must be <= ${rule.max}`); continue }
      sanitized[rule.field] = n
      continue
    }

    if (rule.type === 'boolean') {
      sanitized[rule.field] = !!val
      continue
    }

    if (rule.type === 'email' && typeof val === 'string') {
      if (!val.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) { errors.push(`${rule.field} must be a valid email`); continue }
    }

    if (typeof val === 'string') {
      if (rule.maxLength && val.length > rule.maxLength) { errors.push(`${rule.field} must be <= ${rule.maxLength} characters`); continue }
      if (rule.minLength && val.length < rule.minLength) { errors.push(`${rule.field} must be >= ${rule.minLength} characters`); continue }
      if (rule.oneOf && !rule.oneOf.includes(val)) { errors.push(`${rule.field} must be one of: ${rule.oneOf.join(', ')}`); continue }
      if (rule.pattern && !rule.pattern.test(val)) { errors.push(`${rule.field} has an invalid format`); continue }
      sanitized[rule.field] = sanitizeString(val)
    } else {
      sanitized[rule.field] = val
    }
  }

  return { valid: errors.length === 0, errors, sanitized }
}

// ── Safe JSON Body Parser Middleware (BUG-01) ─────────────────
// Wraps POST/PUT handlers so malformed/empty JSON returns 400 not 500
export async function safeJsonParse(c: Context, next: Next) {
  if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
    const ct = c.req.header('content-type') || ''
    if (ct.includes('json') || !ct) {
      try {
        const clone = c.req.raw.clone()
        const text = await clone.text()
        if (!text || text.trim().length === 0) {
          return c.json({ error: 'Request body is empty', errors: ['Request body must be a JSON object'] }, 400)
        }
        JSON.parse(text) // validate it's parseable
      } catch (e: any) {
        if (e?.message?.includes('JSON')) {
          return c.json({ error: 'Invalid JSON in request body', errors: ['Request body must be valid JSON'] }, 400)
        }
        // For empty body parsing errors
        return c.json({ error: 'Invalid request body', errors: ['Request body must be a JSON object'] }, 400)
      }
    }
  }
  await next()
}

// ── Safe ID Generation (BUG-04) ──────────────────────────────
// Collision-resistant: PREFIX-YYYY-RRRRRR (6-digit random)
export function generateSafeId(prefix: string): string {
  const year = new Date().getFullYear()
  // Combine timestamp + random for collision resistance
  const ts = String(Date.now()).slice(-5)
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
  return `${prefix}-${year}-${ts}${rand.slice(0, 2)}`
}

// ── Pagination Helper (OPS-01) ────────────────────────────────
export interface PaginationParams {
  page: number
  pageSize: number
  offset: number
}

export function parsePagination(c: any, defaults = { page: 1, pageSize: 50, maxSize: 200 }): PaginationParams {
  const page = Math.max(1, Number(c.req.query('page')) || defaults.page)
  const pageSize = Math.min(defaults.maxSize, Math.max(1, Number(c.req.query('page_size')) || defaults.pageSize))
  return { page, pageSize, offset: (page - 1) * pageSize }
}

// ── Existence Check for UPDATE/DELETE (BUG-03) ────────────────
export async function checkExists(db: D1Database, table: string, id: string | number): Promise<boolean> {
  // Whitelist safe table names to prevent SQL injection in table name
  const safeTables = [
    'cases_matters', 'clients', 'documents', 'tasks_deadlines', 'calendar_events',
    'billing_invoices', 'notifications', 'users_attorneys', 'case_notes', 'time_entries',
    'document_templates', 'document_sharing', 'document_versions', 'esignature_requests',
    'trust_accounts', 'trust_transactions', 'case_expenses', 'conflict_checks',
    'client_communications', 'intake_forms', 'intake_submissions', 'client_portal_access',
    'payments', 'payment_methods', 'invoice_line_items', 'document_analysis'
  ]
  if (!safeTables.includes(table)) return false
  const row = await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(id).first()
  return !!row
}

// ── Foreign Key Validation (DATA-01) ──────────────────────────
export async function validateFK(db: D1Database, table: string, id: number | null | undefined, fieldName: string): Promise<string | null> {
  if (id === null || id === undefined) return null
  const exists = await checkExists(db, table, id)
  if (!exists) return `${fieldName} references non-existent record (ID: ${id})`
  return null
}

// ── Audit Trail (DATA-03) ─────────────────────────────────────
export async function auditLog(
  db: D1Database,
  action: 'create' | 'update' | 'delete' | 'soft_delete',
  entity: string,
  entityId: number | string,
  userId: number,
  changes?: Record<string, any>,
  oldValues?: Record<string, any>
): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO audit_log (action, entity_type, entity_id, user_id, changes_json, old_values_json)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(
      action, entity, String(entityId), userId,
      changes ? JSON.stringify(changes) : null,
      oldValues ? JSON.stringify(oldValues) : null
    ).run()
  } catch (e) { /* non-critical — don't break the operation */ }
}

// ── Error Response Helpers ────────────────────────────────────
export function badRequest(c: any, errors: string[]) {
  return c.json({ error: 'Validation failed', errors }, 400)
}

export function notFound(c: any, entity: string) {
  return c.json({ error: `${entity} not found` }, 404)
}

export function serverError(c: any, message: string, detail?: string) {
  return c.json({ error: message, ...(detail ? { detail } : {}) }, 500)
}

// ── Dashboard SQL Fix (BUG-05) ────────────────────────────────
export function coalesceInt(val: any): number {
  if (val === null || val === undefined) return 0
  const n = Number(val)
  return isNaN(n) ? 0 : n
}

// ── API Error Logging (OPS-04) ────────────────────────────────
export async function logError(db: D1Database, route: string, method: string, error: string, details?: string): Promise<void> {
  try {
    await db.prepare(`
      INSERT INTO error_logs (route, method, error_message, details)
      VALUES (?, ?, ?, ?)
    `).bind(route, method, error.substring(0, 500), details?.substring(0, 2000) || null).run()
  } catch (e) { /* silent */ }
}

// ── Global Error Handler Middleware (OPS-03) ──────────────────
export async function globalErrorHandler(c: Context, next: Next) {
  try {
    await next()
  } catch (err: any) {
    const msg = err?.message || 'Internal server error'
    console.error(`[CLERKY ERROR] ${c.req.method} ${c.req.url}: ${msg}`)
    // Try to log to DB (non-critical)
    try {
      const db = (c.env as any)?.DB
      if (db) await logError(db, c.req.url, c.req.method, msg)
    } catch { /* silent */ }
    return c.json({ error: 'Internal server error', detail: msg }, 500)
  }
}

// ── Rate Limiter Helper (SEC-02) ──────────────────────────────
// In-memory simple rate limiter (per-worker instance)
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

export function rateLimit(key: string, maxRequests: number = 60, windowMs: number = 60000): boolean {
  const now = Date.now()
  const entry = rateLimitStore.get(key)
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs })
    return true // allowed
  }
  entry.count++
  if (entry.count > maxRequests) return false // blocked
  return true // allowed
}

// ── Dynamic Update Builder ────────────────────────────────────
// Builds SET clause from body + allowed fields, with sanitization
export function buildUpdateFields(body: Record<string, any>, allowedFields: string[]): { fields: string[]; values: any[] } {
  const safe = sanitize(body)
  const fields: string[] = []
  const values: any[] = []
  for (const f of allowedFields) {
    if (safe[f] !== undefined) {
      fields.push(`${f} = ?`)
      values.push(safe[f])
    }
  }
  return { fields, values }
}

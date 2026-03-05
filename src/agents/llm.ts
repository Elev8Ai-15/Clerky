// ═══════════════════════════════════════════════════════════════
// CLERKY — LLM Client (Anthropic claude-opus-4-6)
// Powers all AI searching, cross-referencing, and research.
// Configured via ANTHROPIC_API_KEY Cloudflare env binding.
// Falls back gracefully to template responses when unavailable.
// ═══════════════════════════════════════════════════════════════

const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1'
const ANTHROPIC_MODEL = 'claude-opus-4-6'
const ANTHROPIC_VERSION = '2023-06-01'

export interface LLMClient {
  isEnabled: boolean
  generateForAgent(params: {
    agentType: string
    systemIdentity: string
    agentSpecialty: string
    matterContext: string
    mem0Context: string
    conversationHistory: { role: string; content: string }[]
    userMessage: string
    embeddedKnowledge?: string
  }): Promise<{ content: string; tokens_used: number } | null>
}

export function createLLMClient(apiKey?: string, _baseUrl?: string): LLMClient {
  const isEnabled = !!apiKey && apiKey.length > 10

  return {
    isEnabled,

    async generateForAgent({
      systemIdentity,
      agentSpecialty,
      matterContext,
      mem0Context,
      conversationHistory,
      userMessage,
      embeddedKnowledge
    }) {
      if (!isEnabled) return null

      try {
        // Build system prompt with full context
        let systemContent = `${systemIdentity}\n\nSpecialty: ${agentSpecialty}\n\n`
        if (matterContext) systemContent += `Current Matter Context:\n${matterContext}\n\n`
        if (mem0Context) systemContent += `Prior Memory Context (from Mem0):\n${mem0Context}\n\n`
        if (embeddedKnowledge) systemContent += `Embedded Knowledge Base:\n${embeddedKnowledge}\n\n`
        systemContent += `Respond in structured markdown. Include citations, risks, and next actions.`

        // Build messages array (last 10 history messages + current)
        const messages: { role: string; content: string }[] = []
        for (const msg of conversationHistory.slice(-10)) {
          messages.push({ role: msg.role, content: msg.content })
        }
        messages.push({ role: 'user', content: userMessage })

        const response = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey!,
            'anthropic-version': ANTHROPIC_VERSION
          },
          body: JSON.stringify({
            model: ANTHROPIC_MODEL,
            max_tokens: 4000,
            system: systemContent,
            messages
          })
        })

        if (!response.ok) {
          const text = await response.text()
          console.error(`Anthropic API error ${response.status}: ${text}`)
          return null
        }

        const data = await response.json() as any
        const textBlock = data.content?.find((b: any) => b.type === 'text')
        if (!textBlock?.text) return null

        const tokens_used = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)

        return {
          content: textBlock.text,
          tokens_used
        }
      } catch (e) {
        console.error('LLM generation failed:', e)
        return null
      }
    }
  }
}

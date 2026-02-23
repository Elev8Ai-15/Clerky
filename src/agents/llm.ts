// ═══════════════════════════════════════════════════════════════
// CLERKY — LLM Client (OpenAI-compatible)
// Provides AI-powered generation when OPENAI_API_KEY is set.
// Falls back gracefully to template responses when unavailable.
// Supports any OpenAI-compatible endpoint via OPENAI_BASE_URL.
// ═══════════════════════════════════════════════════════════════

const DEFAULT_BASE = 'https://www.genspark.ai/api/llm_proxy/v1'

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

export function createLLMClient(apiKey?: string, baseUrl?: string): LLMClient {
  const isEnabled = !!apiKey && apiKey.length > 10
  const base = baseUrl || DEFAULT_BASE

  return {
    isEnabled,

    async generateForAgent({
      agentType,
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
        // Build system message with full context
        let systemContent = `${systemIdentity}\n\nSpecialty: ${agentSpecialty}\n\n`
        if (matterContext) systemContent += `Current Matter Context:\n${matterContext}\n\n`
        if (mem0Context) systemContent += `Prior Memory Context (from Mem0):\n${mem0Context}\n\n`
        if (embeddedKnowledge) systemContent += `Embedded Knowledge Base:\n${embeddedKnowledge}\n\n`
        systemContent += `Respond in structured markdown. Include citations, risks, and next actions.`

        const messages: { role: string; content: string }[] = [
          { role: 'system', content: systemContent }
        ]

        // Add conversation history (last 10 messages)
        for (const msg of conversationHistory.slice(-10)) {
          messages.push({ role: msg.role, content: msg.content })
        }

        // Add current user message
        messages.push({ role: 'user', content: userMessage })

        const response = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: 'gpt-5-mini',
            messages,
            max_tokens: 4000,
            temperature: 0.3
          })
        })

        if (!response.ok) {
          const text = await response.text()
          console.error(`LLM API error ${response.status}: ${text}`)
          return null
        }

        const data = await response.json() as any
        const choice = data.choices?.[0]
        if (!choice?.message?.content) return null

        return {
          content: choice.message.content,
          tokens_used: data.usage?.total_tokens || 0
        }
      } catch (e) {
        console.error('LLM generation failed:', e)
        return null
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// CLERKY — LLM Client (Multi-Provider)
// Supports Anthropic (native), OpenAI-compatible endpoints,
// and GenSpark LLM proxy. Auto-detects provider from API key.
// Falls back gracefully to template responses when unavailable.
// ═══════════════════════════════════════════════════════════════

const DEFAULT_BASE = 'https://www.genspark.ai/api/llm_proxy/v1'

export interface LLMClient {
  isEnabled: boolean
  provider: 'anthropic' | 'openai' | 'none'
  model: string
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

function detectProvider(apiKey: string, baseUrl?: string): 'anthropic' | 'openai' {
  if (apiKey.startsWith('sk-ant-')) return 'anthropic'
  return 'openai'
}

// Anthropic native API call
async function callAnthropic(apiKey: string, model: string, system: string, messages: { role: string; content: string }[]): Promise<{ content: string; tokens_used: number } | null> {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        system,
        messages,
        max_tokens: 4096,
        temperature: 0.3
      })
    })

    if (!response.ok) {
      const text = await response.text()
      console.error(`Anthropic API error ${response.status}: ${text}`)
      return null
    }

    const data = await response.json() as any
    const content = data.content?.[0]?.text
    if (!content) return null

    return {
      content,
      tokens_used: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
    }
  } catch (e) {
    console.error('Anthropic API failed:', e)
    return null
  }
}

// OpenAI-compatible API call
async function callOpenAI(apiKey: string, baseUrl: string, model: string, messages: { role: string; content: string }[]): Promise<{ content: string; tokens_used: number } | null> {
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
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

export function createLLMClient(apiKey?: string, baseUrl?: string, modelName?: string, anthropicKey?: string): LLMClient {
  // Priority: Anthropic key > OpenAI key
  const effectiveKey = anthropicKey || apiKey || ''
  const isEnabled = effectiveKey.length > 10
  const provider = isEnabled ? detectProvider(effectiveKey, baseUrl) : 'none' as const
  const base = baseUrl || DEFAULT_BASE

  let model: string
  if (provider === 'anthropic') {
    model = 'claude-sonnet-4-20250514'
  } else {
    model = modelName || 'gpt-4o-mini'
  }

  return {
    isEnabled,
    provider,
    model,

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

      // Build system prompt
      let systemContent = `${systemIdentity}\n\nSpecialty: ${agentSpecialty}\n\n`
      if (matterContext) systemContent += `Current Matter Context:\n${matterContext}\n\n`
      if (mem0Context) systemContent += `Prior Memory Context (from Mem0):\n${mem0Context}\n\n`
      if (embeddedKnowledge) systemContent += `Embedded Knowledge Base:\n${embeddedKnowledge}\n\n`
      systemContent += `Respond in structured markdown. Include citations, risks, and next actions.`

      // Build messages
      const msgs: { role: string; content: string }[] = []
      for (const msg of conversationHistory.slice(-10)) {
        msgs.push({ role: msg.role, content: msg.content })
      }
      msgs.push({ role: 'user', content: userMessage })

      if (provider === 'anthropic') {
        return callAnthropic(effectiveKey, model, systemContent, msgs)
      } else {
        // OpenAI-compatible: system message goes first in messages array
        const allMsgs = [{ role: 'system', content: systemContent }, ...msgs]
        return callOpenAI(effectiveKey, base, model, allMsgs)
      }
    }
  }
}

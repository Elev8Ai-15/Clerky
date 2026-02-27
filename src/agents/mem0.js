// ═══════════════════════════════════════════════════════════════
// LAWYRS — Mem0 Cloud Memory Client
// Provides persistent semantic memory across sessions via
// Mem0 API (https://api.mem0.ai/v1). Falls back gracefully
// when API key is not configured.
// ═══════════════════════════════════════════════════════════════
const MEM0_BASE = 'https://api.mem0.ai/v1';
export function createMem0Client(apiKey) {
    const isEnabled = !!apiKey && apiKey.length > 10;
    async function apiCall(path, options = {}) {
        if (!isEnabled)
            return null;
        const response = await fetch(`${MEM0_BASE}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${apiKey}`,
                ...(options.headers || {})
            }
        });
        if (!response.ok) {
            const text = await response.text();
            throw new Error(`Mem0 API error ${response.status}: ${text}`);
        }
        return response.json();
    }
    return {
        isEnabled,
        async storeAgentMemory({ agentType, content, caseId, userId, jurisdiction, confidence, tags }) {
            if (!isEnabled)
                return null;
            try {
                return await apiCall('/memories/', {
                    method: 'POST',
                    body: JSON.stringify({
                        messages: [{ role: 'user', content }],
                        user_id: userId,
                        agent_id: agentType,
                        metadata: {
                            case_id: caseId,
                            jurisdiction: jurisdiction || 'kansas',
                            confidence: confidence || 0.8,
                            tags: tags || [],
                            source: 'clerky-agent'
                        }
                    })
                });
            }
            catch {
                return null;
            }
        },
        async searchMemories({ query, userId, limit = 10 }) {
            if (!isEnabled)
                return [];
            try {
                const result = await apiCall('/memories/search/', {
                    method: 'POST',
                    body: JSON.stringify({
                        query,
                        user_id: userId,
                        limit
                    })
                });
                return result?.results || result || [];
            }
            catch {
                return [];
            }
        },
        async getRelevantContext({ query, userId, caseId, limit = 5 }) {
            if (!isEnabled)
                return '';
            try {
                const memories = await this.searchMemories({ query, userId, limit });
                if (!memories || memories.length === 0)
                    return '';
                return memories
                    .map((m, i) => `[Memory ${i + 1}] ${m.memory || m.content || JSON.stringify(m)}`)
                    .join('\n');
            }
            catch {
                return '';
            }
        },
        async getAllMemories({ userId, agentId }) {
            if (!isEnabled)
                return [];
            try {
                let path = `/memories/?user_id=${encodeURIComponent(userId)}`;
                if (agentId)
                    path += `&agent_id=${encodeURIComponent(agentId)}`;
                const result = await apiCall(path);
                return result?.results || result || [];
            }
            catch {
                return [];
            }
        },
        async getStats(userId) {
            if (!isEnabled)
                return { total: 0, byAgent: {}, recent: [] };
            try {
                const memories = await this.getAllMemories({ userId });
                const byAgent = {};
                for (const m of memories) {
                    const agent = m.agent_id || m.metadata?.agent_type || 'unknown';
                    byAgent[agent] = (byAgent[agent] || 0) + 1;
                }
                return {
                    total: memories.length,
                    byAgent,
                    recent: memories.slice(0, 10)
                };
            }
            catch {
                return { total: 0, byAgent: {}, recent: [] };
            }
        },
        async deleteMemory(memoryId) {
            if (!isEnabled)
                return false;
            try {
                await apiCall(`/memories/${memoryId}/`, { method: 'DELETE' });
                return true;
            }
            catch {
                return false;
            }
        }
    };
}

import { LLMAgent } from 'ploinky-agent-lib';

let cachedAgent;

export function getTestLLMAgent(options = {}) {
    if (!cachedAgent) {
        const agentName = options.name || 'VeritasAI-TestAgent';
        cachedAgent = new LLMAgent({
            name: agentName,
            invokerStrategy: options.invokerStrategy || null
        });
    }
    return cachedAgent;
}

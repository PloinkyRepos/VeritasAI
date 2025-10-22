import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { SimpleLLmStrategy } from '../../lib/strategies/simple-llm-strategy.mjs';
import { KnowledgeStore } from '../../lib/knowledge-store.mjs';
import { getTestLLMAgent } from './llm.js';

const TEMP_ROOT = path.resolve(process.cwd(), 'tests', '.tmp');

async function ensureTempRoot() {
    await mkdir(TEMP_ROOT, { recursive: true });
}

export async function createStrategyContext(label = 'strategy') {
    await ensureTempRoot();
    const storagePath = path.join(TEMP_ROOT, `${label}-${randomUUID()}.json`);
    const knowledgeStore = new KnowledgeStore({ storagePath });
    const llmAgent = getTestLLMAgent();

    const strategy = new SimpleLLmStrategy({
        knowledgeStore,
        llmAgent,
        logger: async () => {}
    });

    return { strategy, knowledgeStore, storagePath, llmAgent };
}

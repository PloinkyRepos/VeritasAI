'use strict';

const embeddingsModelKey = process.env.EMBEDDINGS_MODEL || 'text-embedding-3-large';
const llmModelKey = process.env.LLM_MODEL || 'gpt-4o-mini';
const embeddingsKey = process.env.EMBEDDINGS_API_KEY || '';
const llmKey = process.env.LLM_API_KEY || '';

let initialized = false;

async function initSettings() {
    if (initialized) return;
    initialized = true;

    const llamaindex = await import('llamaindex');
    const { Settings } = llamaindex;

    const hasEmbeddings = embeddingsKey && embeddingsKey.trim();
    const hasLlm = llmKey && llmKey.trim();

    if (hasEmbeddings) {
        try {
            const { OpenAIEmbedding } = await import('@llamaindex/openai');
            Settings.embedModel = new OpenAIEmbedding({ apiKey: embeddingsKey.trim(), model: embeddingsModelKey });
        } catch (err) {
            console.warn('[llamaindex/runtime] Failed to configure embedding model:', err?.message || err);
        }
    }

    if (hasLlm) {
        try {
            const { OpenAI } = await import('@llamaindex/openai');
            Settings.llm = new OpenAI({ apiKey: llmKey.trim(), model: llmModelKey });
        } catch (err) {
            console.warn('[llamaindex/runtime] Failed to configure LLM model:', err?.message || err);
        }
    }
}

module.exports = {
    initSettings
};


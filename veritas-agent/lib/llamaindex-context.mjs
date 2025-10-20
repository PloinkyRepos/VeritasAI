import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_EMBED_MODEL = process.env.LLAMA_EMBED_MODEL || 'text-embedding-3-large';
const DEFAULT_LLM_MODEL = process.env.LLAMA_LLM_MODEL || 'gpt-5';

let cachedModule = null;
let cachedContext = null;

async function importLlamaIndex() {
    if (cachedModule) {
        return cachedModule;
    }

    const errors = [];
    const candidates = [
        () => import('llamaindex'),
        () => import('@llamaindex/core'),
        () => import('@llamaindex/node')
    ];

    for (const loader of candidates) {
        try {
            const mod = await loader();
            cachedModule = mod;
            return cachedModule;
        } catch (error) {
            errors.push(error);
        }
    }

    const message = errors.length
        ? errors.map((err) => err?.message || String(err)).join('\n')
        : 'No llamaindex module found.';
    throw new Error(`Unable to import LlamaIndex. Ensure it is installed.\n${message}`);
}

function ensurePersistDir(dir) {
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
        throw new Error(`Failed to prepare LlamaIndex persist directory '${dir}': ${error.message}`);
    }
}

export async function initLlamaIndex(options = {}) {
    if (cachedContext) {
        return cachedContext;
    }

    const {
        workspaceDir = process.env.PLOINKY_WORKSPACE_DIR || process.cwd(),
        persistSubdir = 'rag/index',
        apiKey = process.env.OPENAI_API_KEY,
        embedModel = DEFAULT_EMBED_MODEL,
        llmModel = DEFAULT_LLM_MODEL
    } = options;

    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is required for LlamaIndex initialization.');
    }

    const persistDir = path.resolve(workspaceDir, persistSubdir);
    ensurePersistDir(persistDir);

    const llamaIndex = await importLlamaIndex();
    const {
        Settings,
        storageContextFromDefaults,
        serviceContextFromDefaults,
        OpenAI,
        OpenAIEmbedding,
        VectorStoreIndex,
        Document
    } = llamaIndex;

    if (!Settings || !OpenAI || !OpenAIEmbedding) {
        throw new Error('LlamaIndex exports are missing expected members. Verify the installed version.');
    }

    Settings.llm = new OpenAI({ model: llmModel, apiKey });
    Settings.embedModel = new OpenAIEmbedding({ model: embedModel, apiKey });

    const storageContext = storageContextFromDefaults
        ? await storageContextFromDefaults({ persistDir })
        : null;
    const serviceContext = serviceContextFromDefaults
        ? await serviceContextFromDefaults()
        : null;

    async function loadIndex(loadOptions = {}) {
        if (!VectorStoreIndex) {
            throw new Error('VectorStoreIndex export not available.');
        }
        if (!storageContext) {
            throw new Error('Storage context is not initialized.');
        }
        return VectorStoreIndex.init({ storageContext, ...loadOptions });
    }

    async function createIndex(documents, createOptions = {}) {
        if (!Array.isArray(documents) || documents.length === 0) {
            throw new Error('Provide at least one document to build the index.');
        }
        if (!VectorStoreIndex) {
            throw new Error('VectorStoreIndex export not available.');
        }
        if (!storageContext) {
            throw new Error('Storage context is not initialized.');
        }
        return VectorStoreIndex.fromDocuments(documents, {
            storageContext,
            serviceContext: serviceContext || undefined,
            ...createOptions
        });
    }

    async function getQueryEngine(engineOptions = {}) {
        const index = await loadIndex(engineOptions.indexOptions);
        return index.asQueryEngine(engineOptions.queryOptions);
    }

    cachedContext = {
        models: {
            llm: llmModel,
            embedding: embedModel
        },
        persistDir,
        workspaceDir,
        loadIndex,
        createIndex,
        getQueryEngine,
        storageContext,
        serviceContext,
        Document: Document || null,
        Settings
    };

    return cachedContext;
}

export function getLlamaIndexContext() {
    if (!cachedContext) {
        throw new Error('Call initLlamaIndex() before accessing the context.');
    }
    return cachedContext;
}

export function resetLlamaIndexContext() {
    cachedContext = null;
}

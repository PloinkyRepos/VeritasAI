'use strict';

const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const DEFAULT_RANK_TOP_K = 5;

async function createToolkit() {
    return {
        tools: [
            createFileUploadTool(),
            createRankStatementsTool(),
            createAuditStatementTool()
        ],
        resources: [],
        prompts: []
    };
}

function createFileUploadTool() {
    return {
        name: 'upload-file',
        title: 'Upload File Into LlamaIndex Document Store',
        description: 'Reads a workspace file, converts it into a LlamaIndex Document, and persists it to a local SimpleDocumentStore.',
        inputSchema: {
            filePath: { type: 'string', minLength: 1, description: 'File path relative to workspace (or absolute).' },
            metadata: { type: 'object', optional: true, description: 'Optional metadata object merged into the Document.' },
            persistDir: { type: 'string', optional: true, description: 'Relative directory for persistence (default ./storage).' },
            documentId: { type: 'string', optional: true, description: 'Optional explicit document id.' },
            allowUpdate: { type: 'boolean', optional: true, description: 'Set to false to forbid overwriting existing docs.' },
            encoding: { type: 'string', optional: true, description: 'File encoding. Use "binary" to store base64 text. Default utf8.' }
        },
        async invoke({ input }) {
            const params = input || {};
            const filePath = typeof params.filePath === 'string' ? params.filePath.trim() : '';
            if (!filePath) throw new Error('filePath is required');

            const resolvedPath = resolveWorkspacePath(filePath);
            await ensureReadable(resolvedPath);

            const stats = await fsp.stat(resolvedPath);
            const encoding = typeof params.encoding === 'string' && params.encoding.trim() ? params.encoding.trim() : 'utf8';

            let text;
            if (encoding === 'binary') {
                text = (await fsp.readFile(resolvedPath)).toString('base64');
            } else {
                text = await fsp.readFile(resolvedPath, { encoding });
            }

            const metadata = normalizeMetadata(params.metadata);
            metadata.sourcePath = path.relative(process.cwd(), resolvedPath) || path.basename(resolvedPath);
            metadata.originalPath = resolvedPath;
            metadata.sizeBytes = stats.size;
            metadata.modifiedAt = stats.mtime.toISOString();
            metadata.encoding = encoding;

            const llamaindex = await import('llamaindex');
            const { SimpleDocumentStore, Document, DEFAULT_PERSIST_DIR, DEFAULT_DOC_STORE_PERSIST_FILENAME } = llamaindex;

            const persistDirName = typeof params.persistDir === 'string' && params.persistDir.trim()
                ? params.persistDir.trim()
                : (DEFAULT_PERSIST_DIR || 'storage');
            const persistDir = resolveWorkspacePath(persistDirName);
            await fsp.mkdir(persistDir, { recursive: true });

            const docStore = await SimpleDocumentStore.fromPersistDir(persistDir);
            const document = new Document({ text, metadata });
            if (typeof params.documentId === 'string' && params.documentId.trim()) {
                document.id_ = params.documentId.trim();
            }

            const allowUpdate = params.allowUpdate !== false;
            await docStore.addDocuments([document], allowUpdate);
            const persistFile = path.join(persistDir, DEFAULT_DOC_STORE_PERSIST_FILENAME || 'doc_store.json');
            await docStore.persist(persistFile);

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        docId: document.id_,
                        storedAt: persistDir,
                        file: path.basename(resolvedPath),
                        metadata
                    }, null, 2)
                }]
            };
        }
    };
}

function createRankStatementsTool() {
    return {
        name: 'rank-statements',
        title: 'Rank Statements Against Document Store',
        description: 'Scores statements by semantic relevance against a persisted LlamaIndex document store.',
        inputSchema: {
            statements: { type: 'array', minItems: 1, description: 'List of statements to rank.' },
            persistDir: { type: 'string', optional: true, description: 'Directory containing persisted doc/vector stores (default ./storage).' },
            k: { type: 'number', optional: true, description: 'How many top statements to return (default 5).' },
            includeContexts: { type: 'boolean', optional: true, description: 'Include retrieved source node snippets in the response.' },
            topRefs: { type: 'number', optional: true, description: 'Number of top reference nodes per statement (default 3).' }
        },
        async invoke({ input }) {
            const params = input || {};
            const statements = normalizeStatements(params);
            if (!statements.length) {
                throw new Error('At least one statement is required.');
            }

            const llamaindex = await import('llamaindex');
            const {
                storageContextFromDefaults,
                VectorStoreIndex,
                Document,
                DEFAULT_PERSIST_DIR
            } = llamaindex;

            const persistDirName = typeof params.persistDir === 'string' && params.persistDir.trim()
                ? params.persistDir.trim()
                : (DEFAULT_PERSIST_DIR || 'storage');
            const persistDir = resolveWorkspacePath(persistDirName);

            const storageContext = await storageContextFromDefaults({ persistDir });
            const index = await VectorStoreIndex.fromDocuments([], { storageContext });
            const retriever = index.asRetriever();
            const analyzer = index.asQueryEngine();

            const topK = coerceNumber(params.k, DEFAULT_RANK_TOP_K);
            const topRefs = coerceNumber(params.topRefs, 3);
            const includeContexts = coerceBoolean(params.includeContexts, false);

            const scored = [];
            for (const statement of statements) {
                const query = statement.trim();
                const retrieved = await retriever.retrieve(query);
                const topNodes = retrieved.slice(0, topRefs);

                const similarity = topNodes.reduce((sum, node) => sum + (typeof node.score === 'number' ? node.score : 0), 0);
                const normalizedScore = topNodes.length ? similarity / topNodes.length : 0;

                const entry = {
                    statement: query,
                    averageSimilarity: normalizedScore,
                    references: topNodes.map(node => ({
                        score: node.score,
                        id: node.node?.id_,
                        text: includeContexts ? node.node?.text : undefined,
                        metadata: node.node?.metadata
                    }))
                };

                if (includeContexts) {
                    try {
                        const response = await analyzer.query({ query, similarityTopK: topRefs, responseMode: 'compact' });
                        entry.analysis = {
                            response: response?.response,
                            sourceNodes: Array.isArray(response?.sourceNodes) ? response.sourceNodes.map(node => ({
                                id: node.id,
                                score: node.score,
                                text: node.text,
                                metadata: node.metadata
                            })) : []
                        };
                    } catch (err) {
                        entry.analysisError = err?.message || String(err);
                    }
                }

                scored.push(entry);
            }

            scored.sort((a, b) => (b.averageSimilarity || 0) - (a.averageSimilarity || 0));
            const top = scored.slice(0, topK);

            return {
                content: [{ type: 'text', text: JSON.stringify({
                    persistDir,
                    requested: statements.length,
                    returned: top.length,
                    results: top
                }, null, 2) }]
            };
        }
    };
}

function createAuditStatementTool() {
    return {
        name: 'audit-statement',
        title: 'Audit Statement (Support vs. Contradiction)',
        description: 'Retrieves evidence from the document store and lets the configured LLM judge whether a statement is supported, contradicted, or uncertain.',
        inputSchema: {
            statement: { type: 'string', minLength: 1, description: 'Statement to audit.' },
            persistDir: { type: 'string', optional: true, description: 'Directory containing persisted stores (default ./storage).' },
            topRefs: { type: 'number', optional: true, description: 'Number of reference nodes to retrieve (default 5).' }
        },
        async invoke({ input }) {
            const params = input || {};
            const statement = typeof params.statement === 'string' ? params.statement.trim() : '';
            if (!statement) throw new Error('statement is required.');

            const llamaindex = await import('llamaindex');
            const {
                storageContextFromDefaults,
                VectorStoreIndex,
                Settings,
                DEFAULT_PERSIST_DIR
            } = llamaindex;

            if (!Settings.llm) {
                throw new Error('LLM not configured. Set LLM_API_KEY and LLM_MODEL to enable auditing.');
            }

            const persistDirName = typeof params.persistDir === 'string' && params.persistDir.trim()
                ? params.persistDir.trim()
                : (DEFAULT_PERSIST_DIR || 'storage');
            const persistDir = resolveWorkspacePath(persistDirName);

            const storageContext = await storageContextFromDefaults({ persistDir });
            const index = await VectorStoreIndex.fromDocuments([], { storageContext });
            const retriever = index.asRetriever();

            const topRefs = coerceNumber(params.topRefs, 5);
            const retrieved = await retriever.retrieve(statement);
            const evidenceNodes = retrieved.slice(0, topRefs).map(node => ({
                score: node.score,
                text: node.node?.text || '',
                metadata: node.node?.metadata || {}
            }));

            const evidenceBlock = evidenceNodes.map((node, idx) => {
                const header = `Evidence #${idx + 1} (score=${node.score ?? 'n/a'})`;
                const meta = Object.keys(node.metadata || {}).length
                    ? `Metadata: ${JSON.stringify(node.metadata)}`
                    : '';
                return `${header}\n${meta}\n${node.text}`.trim();
            }).join('\n\n---\n\n');

            const prompt = buildAuditPrompt(statement, evidenceBlock);
            const completion = await Settings.llm.complete({ prompt });
            const raw = completion?.text ?? completion?.output ?? completion ?? '';

            const result = parseJsonSafe(raw, {
                decision: 'uncertain',
                supportingEvidence: [],
                contradictoryEvidence: [],
                analysis: raw?.toString?.() || ''
            });

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        statement,
                        persistDir,
                        evidenceCount: evidenceNodes.length,
                        result,
                        evidenceNodes
                    }, null, 2)
                }]
            };
        }
    };
}

function resolveWorkspacePath(targetPath) {
    const candidate = path.resolve(process.cwd(), targetPath);
    if (!candidate.startsWith(process.cwd())) {
        throw new Error('Path must stay within the workspace.');
    }
    return candidate;
}

async function ensureReadable(resolvedPath) {
    try {
        await fsp.access(resolvedPath, fs.constants.R_OK);
    } catch (err) {
        throw new Error(`Cannot read file at ${resolvedPath}: ${err?.message || err}`);
    }
}

function normalizeMetadata(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return {};
    }
    const result = {};
    for (const [key, value] of Object.entries(raw)) {
        if (value === undefined) continue;
        try {
            result[key] = JSON.parse(JSON.stringify(value));
        } catch (_) {
            result[key] = String(value);
        }
    }
    return result;
}

function buildAuditPrompt(statement, evidenceBlock) {
    return `You are an evidence auditor. Given a target statement and a set of retrieved evidence excerpts, decide whether the evidence supports, contradicts, or is insufficient for the statement.\n\n` +
        `Return a JSON object with the following keys: "decision" (one of "supported", "contradicted", "uncertain"), ` +
        `"supportingEvidence" (array of strings), "contradictoryEvidence" (array of strings), and "analysis" (short explanation).\n\n` +
        `Statement:\n${statement}\n\n` +
        `Evidence:\n${evidenceBlock || 'No evidence retrieved.'}\n\n` +
        `Respond with JSON only.`;
}

function parseJsonSafe(raw, fallback) {
    if (!raw || typeof raw !== 'string') return fallback;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (_) {
        return fallback;
    }
}

function normalizeStatements(params) {
    const value = params?.statements;
    if (Array.isArray(value)) {
        return value.map(String).map(s => s.trim()).filter(Boolean);
    }
    if (value && typeof value === 'object') {
        return Object.values(value).map(String).map(s => s.trim()).filter(Boolean);
    }
    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value.trim());
            if (Array.isArray(parsed)) {
                return parsed.map(String).map(s => s.trim()).filter(Boolean);
            }
        } catch (_) {
            return value.split(/\r?\n|\s*;\s*/).map(s => s.trim()).filter(Boolean);
        }
    }
    const altArray = params?.['statements[]'];
    if (Array.isArray(altArray)) {
        return altArray.map(String).map(s => s.trim()).filter(Boolean);
    }
    return [];
}

function coerceNumber(value, fallback) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(1, Math.floor(value));
    }
    if (typeof value === 'string' && value.trim()) {
        const n = Number(value.trim());
        if (Number.isFinite(n)) {
            return Math.max(1, Math.floor(n));
        }
    }
    return fallback;
}

function coerceBoolean(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const lower = value.trim().toLowerCase();
        if (lower === 'true') return true;
        if (lower === 'false') return false;
    }
    return fallback;
}

module.exports = {
    createToolkit,
    default: createToolkit
};

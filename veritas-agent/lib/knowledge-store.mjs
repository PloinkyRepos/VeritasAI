import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = (() => {
    const hint = process.env.PLOINKY_WORKSPACE_DIR;
    if (typeof hint === 'string' && hint.trim()) {
        return path.resolve(hint.trim());
    }
    return null;
})();

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const DEFAULT_STORAGE_PATH = WORKSPACE_ROOT
    ? path.resolve(WORKSPACE_ROOT, '.veritas', 'veritas-knowledge.json')
    : path.resolve(DATA_DIR, 'veritas-knowledge.json');

async function readJson(filePath) {
    try {
        const raw = await readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
    return { version: 1, resources: {} };
}

async function writeJson(filePath, value) {
    await mkdir(path.dirname(filePath), { recursive: true });
    const payload = `${JSON.stringify(value, null, 2)}\n`;
    await writeFile(filePath, payload, 'utf8');
}

function toStringOrNull(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length ? trimmed : null;
    }
    if (value === null || value === undefined) {
        return null;
    }
    return String(value);
}

function sanitizeTags(tags) {
    if (!Array.isArray(tags)) {
        return [];
    }
    const unique = new Set();
    for (const entry of tags) {
        const label = toStringOrNull(entry);
        if (!label) {
            continue;
        }
        unique.add(label.toLowerCase());
    }
    return Array.from(unique);
}

function clampConfidence(value) {
    if (typeof value !== 'number' || Number.isNaN(value)) {
        return null;
    }
    const clamped = Math.max(0, Math.min(1, value));
    return Number.isFinite(clamped) ? Number(clamped.toFixed(4)) : null;
}

function normalizeAspect(aspect, { resourceKey, defaultType }) {
    if (!aspect) {
        return null;
    }

    if (typeof aspect === 'string') {
        const trimmed = aspect.trim();
        if (!trimmed) {
            return null;
        }
        return {
            id: `auto-${randomUUID()}`,
            type: defaultType || 'fact',
            content: trimmed,
            source: resourceKey || null,
            tags: [],
            confidence: null,
            metadata: {},
            createdAt: new Date().toISOString()
        };
    }

    if (typeof aspect !== 'object') {
        return null;
    }

    const content = toStringOrNull(aspect.content ?? aspect.statement ?? aspect.text);
    if (!content) {
        return null;
    }

    const rawType = toStringOrNull(aspect.type) || defaultType || 'fact';
    const normalizedType = ['fact', 'rule'].includes(rawType.toLowerCase()) ? rawType.toLowerCase() : (defaultType || 'fact');

    const normalized = {
        id: toStringOrNull(aspect.id) || `auto-${randomUUID()}`,
        type: normalizedType,
        title: toStringOrNull(aspect.title) || null,
        content,
        rationale: toStringOrNull(aspect.rationale || aspect.reason) || null,
        source: toStringOrNull(aspect.source) || resourceKey || null,
        reference: toStringOrNull(aspect.reference) || null,
        tags: sanitizeTags(aspect.tags),
        confidence: clampConfidence(aspect.confidence),
        createdAt: toStringOrNull(aspect.createdAt) || new Date().toISOString(),
        metadata: {}
    };

    if (aspect.metadata && typeof aspect.metadata === 'object' && !Array.isArray(aspect.metadata)) {
        normalized.metadata = { ...aspect.metadata };
    }

    if (!normalized.metadata.resourceKey && resourceKey) {
        normalized.metadata.resourceKey = resourceKey;
    }

    return normalized;
}

function deriveResourceKey(resourceURL, fallbackText = '') {
    const trimmed = toStringOrNull(resourceURL);
    if (trimmed) {
        return trimmed;
    }
    const hash = createHash('sha256').update(fallbackText || '').digest('hex').slice(0, 24);
    return `statement:${hash}`;
}

class KnowledgeStore {
    constructor(options = {}) {
        const { storagePath = DEFAULT_STORAGE_PATH } = options;
        this.storagePath = storagePath;
        this.cache = null;
        this.cacheDirty = false;
    }

    async loadData() {
        if (this.cache && !this.cacheDirty) {
            return this.cache;
        }
        const data = await readJson(this.storagePath);
        if (!data.resources || typeof data.resources !== 'object') {
            data.resources = {};
        }
        this.cache = data;
        this.cacheDirty = false;
        return data;
    }

    async saveData(data) {
        this.cache = data;
        this.cacheDirty = false;
        await writeJson(this.storagePath, data);
    }

    async getSnapshot() {
        const data = await this.loadData();
        return JSON.parse(JSON.stringify(data));
    }

    async replaceResource(resourceURL, aspects, context = {}) {
        const data = await this.loadData();
        if (!data.resources) {
            data.resources = {};
        }
        const resourceKey = deriveResourceKey(resourceURL, context.statement || '');
        const normalized = [];
        const defaultType = context.defaultType || null;
        if (Array.isArray(aspects)) {
            for (const aspect of aspects) {
                const entry = normalizeAspect(aspect, { resourceKey, defaultType });
                if (entry) {
                    normalized.push(entry);
                }
            }
        }
        data.resources[resourceKey] = {
            resource: resourceURL || null,
            statement: context.statement || null,
            savedAt: new Date().toISOString(),
            aspects: normalized
        };
        this.cacheDirty = true;
        await this.saveData(data);
        return normalized;
    }

    async mergeResource(resourceURL, aspects, context = {}) {
        const data = await this.loadData();
        if (!data.resources) {
            data.resources = {};
        }
        const resourceKey = deriveResourceKey(resourceURL, context.statement || '');
        const existing = data.resources[resourceKey]?.aspects ?? [];
        const existingIndex = new Map(existing.map(entry => [entry.id, entry]));
        const defaultType = context.defaultType || null;

        if (Array.isArray(aspects)) {
            for (const aspect of aspects) {
                const normalized = normalizeAspect(aspect, { resourceKey, defaultType });
                if (!normalized) {
                    continue;
                }
                existingIndex.set(normalized.id, { ...existingIndex.get(normalized.id), ...normalized });
            }
        }

        const merged = Array.from(existingIndex.values());
        data.resources[resourceKey] = {
            resource: resourceURL || null,
            statement: context.statement || null,
            savedAt: new Date().toISOString(),
            aspects: merged
        };
        this.cacheDirty = true;
        await this.saveData(data);
        return merged;
    }

    async getAspectsByResource(resourceURL, statement = '') {
        const data = await this.loadData();
        if (!data.resources) {
            return [];
        }
        const resourceKey = deriveResourceKey(resourceURL, statement);
        const entry = data.resources[resourceKey];
        return entry?.aspects ? entry.aspects.map(item => ({ ...item })) : [];
    }

    async listAllAspects() {
        const data = await this.loadData();
        const results = [];
        for (const [resourceKey, value] of Object.entries(data.resources || {})) {
            if (!value || !Array.isArray(value.aspects)) {
                continue;
            }
            for (const aspect of value.aspects) {
                results.push({
                    ...aspect,
                    resourceKey,
                    resource: value.resource || null,
                    statement: value.statement || null
                });
            }
        }
        return results;
    }

    async getAspectById(aspectId) {
        if (!aspectId) {
            return null;
        }
        const data = await this.loadData();
        for (const value of Object.values(data.resources || {})) {
            if (!value || !Array.isArray(value.aspects)) {
                continue;
            }
            const match = value.aspects.find(item => item.id === aspectId);
            if (match) {
                return {
                    ...match,
                    resource: value.resource || null,
                    statement: value.statement || null
                };
            }
        }
        return null;
    }

    async getAspectsByIds(aspectIds) {
        if (!Array.isArray(aspectIds) || !aspectIds.length) {
            return [];
        }
        const lookup = new Map();
        const data = await this.loadData();
        for (const value of Object.values(data.resources || {})) {
            if (!value || !Array.isArray(value.aspects)) {
                continue;
            }
            for (const aspect of value.aspects) {
                lookup.set(aspect.id, {
                    ...aspect,
                    resource: value.resource || null,
                    statement: value.statement || null
                });
            }
        }
        return aspectIds.map(id => lookup.get(id)).filter(Boolean);
    }
}

export {
    KnowledgeStore,
    deriveResourceKey
};

import { randomUUID } from 'node:crypto';

const STOP_WORDS = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'has',
    'been', 'will', 'shall', 'could', 'would', 'should', 'into', 'onto',
    'about', 'after', 'before', 'where', 'when', 'your', 'their', 'there',
    'which', 'while', 'within', 'without', 'through', 'against', 'under',
    'over', 'between', 'because', 'during', 'each', 'other', 'such'
]);

export function generateId(prefix = 'id') {
    const base = randomUUID();
    return `${prefix}_${base}`;
}

export function nowIso() {
    return new Date().toISOString();
}

export function toSafeString(value) {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (value === null || value === undefined) {
        return '';
    }
    return String(value).trim();
}

export function toConfidenceNumber(value, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }
    if (numeric < 0) {
        return 0;
    }
    if (numeric > 1) {
        return 1;
    }
    return Number(numeric.toFixed(4));
}

export function toTagString(tags) {
    if (!tags) {
        return '';
    }
    if (typeof tags === 'string') {
        return tags
            .split(/[,;]/)
            .map(token => token.trim())
            .filter(Boolean)
            .join(', ');
    }
    if (Array.isArray(tags)) {
        return tags
            .map(token => (typeof token === 'string' ? token.trim() : ''))
            .filter(Boolean)
            .join(', ');
    }
    return '';
}

function tokenize(text) {
    if (!text || typeof text !== 'string') {
        return [];
    }
    const tokens = text
        .toLowerCase()
        .match(/\b[a-z0-9][a-z0-9_-]*\b/g);
    if (!tokens) {
        return [];
    }
    return Array.from(new Set(tokens.filter(token => token.length >= 3 && !STOP_WORDS.has(token))));
}

function computeSimilarityScore(queryTokens, targetText) {
    const targetTokens = tokenize(targetText);
    if (!targetTokens.length) {
        return 0;
    }
    const intersection = targetTokens.filter(token => queryTokens.has(token));
    if (!intersection.length) {
        return 0;
    }
    const union = new Set([...queryTokens, ...targetTokens]);
    return intersection.length / union.size;
}

export function selectTopBySimilarity(query, records, fieldName, limit = 12) {
    if (!Array.isArray(records) || !records.length) {
        return [];
    }
    const queryTokens = new Set(tokenize(query));
    const scored = records.map((record, index) => {
        const value = toSafeString(record?.[fieldName]);
        const score = queryTokens.size ? computeSimilarityScore(queryTokens, value) : 0;
        return { record, score, index };
    });
    const positive = scored.filter(item => item.score > 0);
    const candidates = positive.length ? positive : scored;
    return candidates
        .sort((a, b) => {
            if (b.score !== a.score) {
                return b.score - a.score;
            }
            return a.index - b.index;
        })
        .slice(0, limit)
        .map(item => item.record);
}

export function buildFactPromptBlock(facts) {
    if (!Array.isArray(facts) || !facts.length) {
        return 'No known facts.';
    }
    return facts.map(fact => {
        const id = fact.fact_id || fact.id || 'unknown-fact';
        const source = toSafeString(fact.source) || 'unknown source';
        const confidence = typeof fact.confidence === 'number'
            ? ` (confidence: ${fact.confidence})`
            : '';
        const tags = toSafeString(fact.tags);
        const tagsSuffix = tags ? ` | tags: ${tags}` : '';
        return `[${id}] ${toSafeString(fact.content)} — source: ${source}${confidence}${tagsSuffix}`;
    }).join('\n');
}

export function buildRulePromptBlock(rules) {
    if (!Array.isArray(rules) || !rules.length) {
        return 'No governing rules.';
    }
    return rules.map(rule => {
        const id = rule.rule_id || rule.id || 'unknown-rule';
        const title = toSafeString(rule.title);
        const content = toSafeString(rule.content);
        const source = toSafeString(rule.source);
        const tags = toSafeString(rule.tags);
        const prefix = title ? `${title}: ` : '';
        const suffix = source || tags
            ? ` (source: ${source || 'n/a'}${tags ? ` | tags: ${tags}` : ''})`
            : '';
        return `[${id}] ${prefix}${content}${suffix}`;
    }).join('\n');
}

export function extractJsonPayload(raw) {
    if (typeof raw === 'object' && raw !== null) {
        return raw;
    }
    if (!raw || typeof raw !== 'string') {
        return null;
    }
    const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i);
    if (fencedMatch) {
        try {
            return JSON.parse(fencedMatch[1]);
        } catch {
            // fall through
        }
    }
    const genericMatch = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (genericMatch) {
        try {
            return JSON.parse(genericMatch[0]);
        } catch {
            return null;
        }
    }
    return null;
}

export async function fetchRules(client, { filter = {}, limit, options = {} } = {}) {
    if (!client || typeof client.execute !== 'function') {
        return [];
    }
    const queryOptions = {
        sortBy: 'created_at',
        descending: true,
        ...options
    };
    if (typeof limit === 'number' && limit > 0) {
        queryOptions.limit = limit;
    }
    try {
        const response = await client.execute('select', 'rule', filter, queryOptions);
        return Array.isArray(response?.objects) ? response.objects : [];
    } catch (error) {
        console.warn('Failed to fetch rules:', error.message);
        return [];
    }
}

export async function fetchFacts(client, { filter = {}, limit, options = {} } = {}) {
    if (!client || typeof client.execute !== 'function') {
        return [];
    }
    const queryOptions = {
        sortBy: 'created_at',
        descending: true,
        ...options
    };
    if (typeof limit === 'number' && limit > 0) {
        queryOptions.limit = limit;
    }
    try {
        const response = await client.execute('select', 'fact', filter, queryOptions);
        return Array.isArray(response?.objects) ? response.objects : [];
    } catch (error) {
        console.warn('Failed to fetch facts:', error.message);
        return [];
    }
}

function encodeIdList(values) {
    if (!values) {
        return '';
    }
    if (typeof values === 'string') {
        return values;
    }
    if (Array.isArray(values)) {
        const normalized = values
            .map((value) => {
                if (typeof value === 'string') {
                    return value.trim();
                }
                if (value && typeof value === 'object') {
                    return toSafeString(value.fact_id || value.rule_id || value.id);
                }
                return '';
            })
            .filter(Boolean);
        if (!normalized.length) {
            return '';
        }
        return JSON.stringify(normalized);
    }
    return '';
}

export async function logAssessment(client, payload = {}) {
    if (!client || typeof client.execute !== 'function') {
        return null;
    }
    const analysisSource = toSafeString(payload.analysisSource);
    const baseNotes = toSafeString(payload.notes);
    const composedNotes = analysisSource
        ? `${baseNotes}${baseNotes ? ' ' : ''}[analysis: ${analysisSource}]`
        : baseNotes;
    const record = {
        assessment_id: generateId('assessment'),
        target_type: toSafeString(payload.targetType || 'statement'),
        target_reference: toSafeString(payload.targetReference),
        statement: toSafeString(payload.statement),
        verdict: toSafeString(payload.verdict),
        supporting_fact_ids: encodeIdList(payload.supportingFactIds || payload.supportingFacts),
        contradicting_fact_ids: encodeIdList(payload.contradictingFactIds || payload.contradictingFacts),
        notes: composedNotes,
        created_at: nowIso()
    };
    try {
        await client.execute('createAssessmentLog', record);
        return record;
    } catch (error) {
        console.warn('Failed to record assessment:', error.message);
        return null;
    }
}

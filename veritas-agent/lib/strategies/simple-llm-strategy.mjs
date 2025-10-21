import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { KnowledgeStore } from '../knowledge-store.mjs';
import { getSkillServices } from '../runtime.mjs';

const MAX_CONTEXT_ASPECTS = 30;
const JSON_BLOCK_REGEX = /```json\s*([\s\S]*?)```/gi;
const BULLET_REGEX = /^\s*[-*]\s+(.*)$/gm;

function isLikelyLocalPath(resourceURL = '') {
    if (!resourceURL || typeof resourceURL !== 'string') {
        return false;
    }
    if (/^[a-z]+:\/\//i.test(resourceURL)) {
        return false;
    }
    if (/^[a-z]+:/i.test(resourceURL)) {
        return false;
    }
    return true;
}

function tokenize(text = '') {
    const tokens = String(text).toLowerCase().match(/\b[0-9a-z]{3,}\b/g);
    return new Set(tokens || []);
}

function scoreAspect(referenceTokens, aspect) {
    if (!aspect || !aspect.content) {
        return 0;
    }
    const contentTokens = tokenize(aspect.content);
    if (Array.isArray(aspect.tags)) {
        for (const tag of aspect.tags) {
            const normalized = typeof tag === 'string' ? tag.trim().toLowerCase() : '';
            if (normalized) {
                contentTokens.add(normalized);
            }
        }
    }
    let overlap = 0;
    for (const token of contentTokens) {
        if (referenceTokens.has(token)) {
            overlap += 1;
        }
    }
    return aspect.type === 'rule' ? overlap + 0.5 : overlap;
}

function extractJsonBlocks(markdown) {
    if (!markdown || typeof markdown !== 'string') {
        return [];
    }
    const results = [];
    let match;
    while ((match = JSON_BLOCK_REGEX.exec(markdown)) !== null) {
        const raw = match[1];
        if (!raw) {
            continue;
        }
        try {
            const parsed = JSON.parse(raw);
            results.push(parsed);
        } catch {
            // Ignore malformed blocks
        }
    }
    return results;
}

function flattenAspectCollection(collection, defaultType) {
    const results = [];
    const fallbackType = defaultType || 'fact';

    if (Array.isArray(collection)) {
        for (const entry of collection) {
            if (typeof entry === 'string') {
                const trimmed = entry.trim();
                if (trimmed) {
                    results.push({ type: fallbackType, content: trimmed });
                }
            } else if (entry && typeof entry === 'object') {
                results.push({ type: entry.type || fallbackType, ...entry });
            }
        }
        return results;
    }

    if (collection && typeof collection === 'object') {
        for (const [key, value] of Object.entries(collection)) {
            const normalizedKey = typeof key === 'string' ? key.toLowerCase() : '';
            if (Array.isArray(value)) {
                const inferredType = ['rule', 'rules'].includes(normalizedKey)
                    ? 'rule'
                    : ['fact', 'facts'].includes(normalizedKey)
                        ? 'fact'
                        : fallbackType;
                results.push(...flattenAspectCollection(value, inferredType));
                continue;
            }
            if (value && typeof value === 'object' && (value.content || value.statement || value.text)) {
                const inferredType = ['rule', 'rules'].includes(normalizedKey) ? 'rule' : fallbackType;
                results.push({ type: inferredType, ...value });
                continue;
            }
            if (typeof value === 'string') {
                const trimmed = value.trim();
                if (trimmed) {
                    const inferredType = ['rule', 'rules'].includes(normalizedKey) ? 'rule' : fallbackType;
                    results.push({ type: inferredType, title: key, content: trimmed });
                }
            }
        }
        if (!results.length && (collection.content || collection.statement || collection.text)) {
            results.push({ type: fallbackType, ...collection });
        }
        return results;
    }

    if (typeof collection === 'string') {
        const trimmed = collection.trim();
        if (trimmed) {
            results.push({ type: fallbackType, content: trimmed });
        }
    }

    return results;
}

function parseMarkdownWithAgent(agent, markdown, defaultType) {
    if (!agent || typeof agent.responseToJSON !== 'function') {
        return [];
    }

    const fallbackType = defaultType || 'fact';
    const structured = agent.responseToJSON(markdown);
    if (!structured || !Array.isArray(structured.sections)) {
        return [];
    }

    const results = [];
    for (const section of structured.sections) {
        if (section.keyValues && Object.keys(section.keyValues).length) {
            results.push(...flattenAspectCollection(section.keyValues, fallbackType));
        }
        if (Array.isArray(section.ideas) && section.ideas.length) {
            results.push(...section.ideas.map(content => ({ type: fallbackType, content })));
        }
        if (section.raw) {
            let bulletMatch;
            while ((bulletMatch = BULLET_REGEX.exec(section.raw)) !== null) {
                const bulletText = bulletMatch[1] ? bulletMatch[1].trim() : '';
                if (!bulletText) {
                    continue;
                }
                const parts = bulletText.split(/\s*\|\s*/);
                if (parts.length > 1) {
                    const parsed = {};
                    for (const part of parts) {
                        const [key, ...rest] = part.split(':');
                        if (!key || !rest.length) {
                            continue;
                        }
                        parsed[key.trim().toLowerCase()] = rest.join(':').trim();
                    }
                    if (parsed.content || parsed.statement || parsed.text) {
                        results.push({
                            id: parsed.id,
                            type: parsed.type || fallbackType,
                            title: parsed.title,
                            content: parsed.content || parsed.statement || parsed.text,
                            source: parsed.source || parsed.reference
                        });
                        continue;
                    }
                }
                results.push({ type: fallbackType, content: bulletText });
            }
        }
    }
    return results;
}

function uniqueAspects(entries) {
    const byId = new Map();
    const byContent = new Set();
    const results = [];
    for (const entry of entries) {
        if (!entry || !entry.content) {
            continue;
        }
        const id = typeof entry.id === 'string' ? entry.id : null;
        const contentKey = entry.content.toLowerCase();
        if (id) {
            if (byId.has(id)) {
                continue;
            }
            byId.set(id, true);
        } else if (byContent.has(contentKey)) {
            continue;
        } else {
            byContent.add(contentKey);
        }
        results.push(entry);
    }
    return results;
}

class SimpleLLmStrategy {
    constructor(options = {}) {
        const { knowledgeStore = null, llmAgent = null, logger = null } = options;
        this.knowledgeStore = knowledgeStore || new KnowledgeStore();
        this.llmAgent = llmAgent;
        this.logger = logger;
    }

    getAgent() {
        if (this.llmAgent) {
            return this.llmAgent;
        }
        const services = getSkillServices();
        if (services?.llmAgent) {
            this.llmAgent = services.llmAgent;
            return this.llmAgent;
        }
        throw new Error('LLM agent is not available for SimpleLLmStrategy.');
    }

    async readResource(resourceURL) {
        if (!resourceURL) {
            return null;
        }
        if (!isLikelyLocalPath(resourceURL)) {
            return null;
        }
        try {
            const resolved = path.resolve(resourceURL);
            return await readFile(resolved, 'utf8');
        } catch (error) {
            if (this.logger) {
                await this.logger('warn', 'simple-strategy-read-failed', {
                    resourceURL,
                    error: error.message
                });
            }
            return null;
        }
    }

    buildExtractionPrompt({ resourceURL, statement, defaultType }) {
        const scope = resourceURL ? `resource "${resourceURL}"` : 'statement';
        const focus =
            defaultType === 'rule'
                ? 'Extract the rules and governance constraints that appear most relevant.'
                : 'Extract the key facts and governing rules that appear most relevant.';

        return [
            `Analyse the ${scope}.`,
            focus,
            statement ? `Give extra weight to aspects related to: "${statement}".` : null,
            'Respond with a Markdown document that includes exactly one fenced JSON block.',
            'The JSON must contain a top-level object or array with `facts` and/or `rules` arrays.',
            'Each array item needs: "id" (string), "type" ("fact" or "rule"), "content", optional "rationale", "source", "tags" (string array).',
            'After the JSON block, add a short Markdown bullet list summary.'
        ]
            .filter(Boolean)
            .join('\n');
    }

    buildCitationPrompt({ statement, aspects, decision }) {
        const intent =
            decision === 'challenge'
                ? 'Identify stored facts or rules that contradict or weaken the statement.'
                : 'Identify stored facts or rules that support the statement.';
        const inventory =
            aspects
                .map(aspect => {
                    const source = aspect.source || aspect.resource || aspect.resourceKey || 'unknown';
                    return `- id: ${aspect.id} | type: ${aspect.type} | source: ${source} | content: ${aspect.content}`;
                })
                .join('\n') || '- (no aspects)';

        return [
            intent,
            `Statement: "${statement}"`,
            'Consider only the provided knowledge entries:',
            inventory,
            'Return a Markdown document that contains a JSON block with a `citations` array.',
            'Each citation entry must include: "id", "decision" ("support" or "challenge"), "explanation", "source".',
            'After the JSON block add a brief Markdown conclusion.'
        ].join('\n');
    }

    parseAspects(markdown, { defaultType = 'fact' } = {}) {
        const jsonBlocks = extractJsonBlocks(markdown);
        let results = [];
        for (const block of jsonBlocks) {
            results.push(...flattenAspectCollection(block, defaultType));
        }
        if (!results.length) {
            const agent = this.getAgent();
            results = parseMarkdownWithAgent(agent, markdown, defaultType);
        }
        return uniqueAspects(results).map(entry => ({
            ...entry,
            type: entry.type === 'rule' ? 'rule' : 'fact'
        }));
    }

    parseCitations(markdown) {
        const jsonBlocks = extractJsonBlocks(markdown);
        for (const block of jsonBlocks) {
            if (Array.isArray(block)) {
                return block;
            }
            if (block && typeof block === 'object') {
                if (Array.isArray(block.citations)) {
                    return block.citations;
                }
                const merged = [];
                if (Array.isArray(block.supporting)) {
                    merged.push(...block.supporting.map(entry => ({ decision: 'support', ...entry })));
                }
                if (Array.isArray(block.challenging)) {
                    merged.push(...block.challenging.map(entry => ({ decision: 'challenge', ...entry })));
                }
                if (merged.length) {
                    return merged;
                }
            }
        }
        return [];
    }

    async extractAspects({ resourceURL, statement, text, defaultType }) {
        const agent = this.getAgent();
        const prompt = this.buildExtractionPrompt({ resourceURL, statement, defaultType });
        const body = text || statement || '';
        if (!body.trim()) {
            return [];
        }
        const markdown = await agent.doTask(
            { intent: 'extract-aspects', resource: resourceURL, statement },
            prompt,
            {
                mode: 'precision',
                history: [{ role: 'user', message: body }]
            }
        );
        return this.parseAspects(markdown, { defaultType });
    }

    async detectRelevantAspectsFromSingleFile(resourceURL, statement = '') {
        const text = await this.readResource(resourceURL);
        return this.extractAspects({
            resourceURL,
            statement,
            text: text || statement,
            defaultType: 'fact'
        });
    }

    async storeRelevantAspectsFromSingleFile(resourceURL, statement = '') {
        const text = await this.readResource(resourceURL);
        const aspects = await this.extractAspects({
            resourceURL,
            statement,
            text: text || statement,
            defaultType: 'fact'
        });
        if (!aspects.length) {
            return [];
        }
        await this.knowledgeStore.mergeResource(resourceURL, aspects, {
            statement,
            defaultType: 'fact'
        });
        return aspects;
    }

    async detectRulesFromStatement(statement) {
        return this.extractAspects({
            resourceURL: null,
            statement,
            text: statement,
            defaultType: 'rule'
        });
    }

    async getEvidencesForStatement(statement) {
        return this.generateCitations(statement, 'support');
    }

    async getChallengesForStatement(statement) {
        return this.generateCitations(statement, 'challenge');
    }

    async generateCitations(statement, decision) {
        const allAspects = await this.knowledgeStore.listAllAspects();
        if (!allAspects.length) {
            return [];
        }
        const referenceTokens = tokenize(statement);
        const topAspects = allAspects
            .map(aspect => ({ aspect, score: scoreAspect(referenceTokens, aspect) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_CONTEXT_ASPECTS)
            .map(entry => entry.aspect);

        const agent = this.getAgent();
        const prompt = this.buildCitationPrompt({ statement, aspects: topAspects, decision });
        const markdown = await agent.doTask(
            {
                intent: decision === 'challenge' ? 'find-challenges' : 'find-support',
                statement
            },
            prompt,
            { mode: 'precision' }
        );

        const citations = this.parseCitations(markdown);
        if (!Array.isArray(citations)) {
            return [];
        }

        return citations
            .map(entry => {
                const id = entry.id || entry.fact_id || entry.rule_id;
                if (!id) {
                    return null;
                }
                const matched =
                    topAspects.find(aspect => aspect.id === id) ||
                    allAspects.find(aspect => aspect.id === id);
                if (!matched) {
                    return null;
                }
                return {
                    fact_id: matched.id,
                    type: matched.type,
                    content: matched.content,
                    source: matched.source || matched.resource || null,
                    explanation: entry.explanation || entry.reason || entry.justification || null,
                    decision: entry.decision || decision
                };
            })
            .filter(Boolean);
    }
}

export {
    SimpleLLmStrategy
};

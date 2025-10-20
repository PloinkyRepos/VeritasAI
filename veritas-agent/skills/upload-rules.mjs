import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getSkillServices, ensurePersistoSchema } from '../lib/runtime.mjs';
import {
    generateId,
    nowIso,
    toSafeString,
    toTagString,
    toConfidenceNumber
} from '../lib/rag-helpers.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.resolve(__dirname, '..', 'temp');

function listUploadableFiles() {
    try {
        const entries = readdirSync(TEMP_DIR, { withFileTypes: true });
        return entries
            .filter(entry => entry.isFile())
            .map(entry => entry.name)
            .filter(name => /\.(json|txt|md)$/i.test(name));
    } catch {
        return [];
    }
}

function isFactCandidate(entry) {
    if (!entry || typeof entry !== 'object') {
        return false;
    }
    const type = typeof entry.type === 'string' ? entry.type.toLowerCase() : '';
    if (type.includes('fact') || type.includes('evidence')) {
        return true;
    }
    if (type.includes('rule') || type.includes('policy')) {
        return false;
    }
    if (entry.fact_id || entry.rule_id || entry.document_id) {
        return true;
    }
    if (typeof entry.confidence === 'number' || typeof entry.score === 'number') {
        return true;
    }
    return Boolean(entry.statement || entry.content) && Boolean(entry.source || entry.document || entry.evidence);
}

function isRuleCandidate(entry) {
    if (!entry || typeof entry !== 'object') {
        return false;
    }
    const type = typeof entry.type === 'string' ? entry.type.toLowerCase() : '';
    if (type.includes('rule') || type.includes('policy') || type.includes('constraint')) {
        return true;
    }
    if (type.includes('fact')) {
        return false;
    }
    if (entry.rule_id || entry.condition || entry.title) {
        return true;
    }
    return Boolean(entry.content) && !isFactCandidate(entry);
}

function interpretPayload(rawContent, defaultSource) {
    const payload = {
        rules: [],
        facts: []
    };

    if (!rawContent || typeof rawContent !== 'string') {
        return payload;
    }

    const trimmed = rawContent.trim();
    if (!trimmed) {
        return payload;
    }

    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
            for (const entry of parsed) {
                if (isFactCandidate(entry)) {
                    payload.facts.push(entry);
                } else {
                    payload.rules.push(entry);
                }
            }
            return payload;
        }
        if (parsed && typeof parsed === 'object') {
            const { rules, facts } = parsed;
            if (Array.isArray(rules)) {
                payload.rules.push(...rules);
            }
            if (Array.isArray(facts)) {
                payload.facts.push(...facts);
            }
            if (!rules && !facts) {
                if (isFactCandidate(parsed)) {
                    payload.facts.push(parsed);
                } else {
                    payload.rules.push(parsed);
                }
            }
            return payload;
        }
    } catch {
        // Not JSON, fall back to newline parsing
    }

    const lines = trimmed
        .split(/\r?\n/)
        .map(line => line.replace(/^[*-]\s*/, '').trim())
        .filter(Boolean);

    if (lines.length) {
        payload.rules.push(...lines.map(line => ({
            content: line,
            source: defaultSource
        })));
    }

    return payload;
}

function normalizeRuleEntry(entry, defaultSource, index) {
    const content = toSafeString(entry?.content || entry?.text || entry?.statement);
    if (!content) {
        return null;
    }

    const title = toSafeString(entry?.title || entry?.name);
    const source = toSafeString(entry?.source || defaultSource);

    return {
        rule_id: toSafeString(entry?.rule_id) || generateId('rule'),
        title: title || `Rule ${index + 1}`,
        content,
        source,
        tags: toTagString(entry?.tags || entry?.labels || entry?.topics),
        created_at: entry?.created_at ? toSafeString(entry.created_at) : nowIso()
    };
}

function normalizeFactEntry(entry, defaultSource, index) {
    const content = toSafeString(entry?.content || entry?.statement || entry?.text);
    if (!content) {
        return null;
    }

    const source = toSafeString(entry?.source || defaultSource || entry?.document || entry?.origin);

    return {
        fact_id: toSafeString(entry?.fact_id) || generateId('fact'),
        content,
        source,
        document_id: toSafeString(entry?.document_id || entry?.document || entry?.doc_id),
        rule_id: toSafeString(entry?.rule_id || entry?.rule || entry?.policy_id),
        confidence: toConfidenceNumber(entry?.confidence ?? entry?.score ?? entry?.support ?? 0.5, 0.5),
        tags: toTagString(entry?.tags || entry?.labels || entry?.topics),
        created_at: entry?.created_at ? toSafeString(entry.created_at) : nowIso()
    };
}

async function upsertRule(client, ruleRecord) {
    try {
        const existing = await client.execute('select', 'rule', { content: ruleRecord.content });
        const match = existing?.objects?.[0];
        if (match) {
            await client.execute('updateRule', match.rule_id, {
                title: ruleRecord.title,
                source: ruleRecord.source,
                tags: ruleRecord.tags,
                created_at: match.created_at || ruleRecord.created_at,
                content: ruleRecord.content
            });
            return { status: 'updated', id: match.rule_id };
        }
        await client.execute('createRule', ruleRecord);
        return { status: 'created', id: ruleRecord.rule_id };
    } catch (error) {
        return { status: 'failed', error: error.message };
    }
}

async function upsertFact(client, factRecord) {
    try {
        const existing = await client.execute('select', 'fact', { content: factRecord.content });
        const match = existing?.objects?.[0];
        if (match) {
            await client.execute('updateFact', match.fact_id, {
                source: factRecord.source,
                document_id: factRecord.document_id,
                rule_id: factRecord.rule_id,
                confidence: factRecord.confidence,
                tags: factRecord.tags,
                content: factRecord.content
            });
            return { status: 'updated', id: match.fact_id };
        }
        await client.execute('createFact', factRecord);
        return { status: 'created', id: factRecord.fact_id };
    } catch (error) {
        return { status: 'failed', error: error.message };
    }
}

export function specs() {
    return {
        name: 'upload-rules',
        needConfirmation: true,
        description: 'Upload, import, or add rules and facts to the VeritasAI knowledge base. Supports JSON or newline text inputs.',
        why: 'Keeps the retrieval-augmented knowledge base updated with the latest rules and supporting evidence.',
        what: 'Reads structured data and inserts or updates rule and fact records in the RAG datastore.',
        humanDescription: 'Upload new rules and supporting facts.',
        arguments: {
            file: {
                type: 'string',
                description: 'Optional file in the temp directory containing rules/facts (JSON or text).',
                enumerator: listUploadableFiles
            },
            rules: {
                type: 'string',
                description: 'Rules to add (JSON array or newline text).',
                multiline: true
            },
            facts: {
                type: 'string',
                description: 'Facts or evidence entries (JSON array or newline text).',
                multiline: true
            },
            source: {
                type: 'string',
                description: 'Default source or reference applied when entries omit a source.'
            }
        },
        requiredArguments: []
    };
}

export function roles() {
    return ['sysAdmin'];
}

export async function action({ file, rules, facts, source } = {}) {
    const { client } = getSkillServices();
    await ensurePersistoSchema();

    if (!client || typeof client.execute !== 'function') {
        throw new Error('Persisto client is unavailable.');
    }

    const defaultSource = toSafeString(source);
    const aggregate = {
        rules: [],
        facts: []
    };

    if (file) {
        const filePath = path.resolve(TEMP_DIR, file);
        try {
            const content = await readFile(filePath, 'utf-8');
            const parsed = interpretPayload(content, defaultSource);
            aggregate.rules.push(...parsed.rules);
            aggregate.facts.push(...parsed.facts);
        } catch (error) {
            throw new Error(`Failed to read file "${file}": ${error.message}`);
        }
    }

    if (rules) {
        const parsed = interpretPayload(rules, defaultSource);
        aggregate.rules.push(...parsed.rules);
    }

    if (facts) {
        const parsed = interpretPayload(facts, defaultSource);
        aggregate.facts.push(...parsed.facts);
    }

    if (!aggregate.rules.length && !aggregate.facts.length) {
        throw new Error('Provide at least one rule or fact via arguments or a file.');
    }

    const normalizedRules = aggregate.rules
        .map((entry, index) => normalizeRuleEntry(entry, defaultSource, index))
        .filter(Boolean);

    const normalizedFacts = aggregate.facts
        .map((entry, index) => normalizeFactEntry(entry, defaultSource, index))
        .filter(Boolean);

    const results = {
        rules: { created: 0, updated: 0, failed: [] },
        facts: { created: 0, updated: 0, failed: [] }
    };

    for (const ruleRecord of normalizedRules) {
        const result = await upsertRule(client, ruleRecord);
        if (result.status === 'created') {
            results.rules.created++;
        } else if (result.status === 'updated') {
            results.rules.updated++;
        } else {
            results.rules.failed.push({ rule: ruleRecord.content, error: result.error });
        }
    }

    for (const factRecord of normalizedFacts) {
        const result = await upsertFact(client, factRecord);
        if (result.status === 'created') {
            results.facts.created++;
        } else if (result.status === 'updated') {
            results.facts.updated++;
        } else {
            results.facts.failed.push({ fact: factRecord.content, error: result.error });
        }
    }

    console.log(`# Upload complete`);
    console.log(`- Rules created: ${results.rules.created}`);
    console.log(`- Rules updated: ${results.rules.updated}`);
    console.log(`- Facts created: ${results.facts.created}`);
    console.log(`- Facts updated: ${results.facts.updated}`);

    if (results.rules.failed.length || results.facts.failed.length) {
        console.log('\nSome entries could not be saved:');
        for (const failure of results.rules.failed) {
            console.log(`Rule failed: ${failure.rule} — ${failure.error}`);
        }
        for (const failure of results.facts.failed) {
            console.log(`Fact failed: ${failure.fact} — ${failure.error}`);
        }
    }

    return {
        success: true,
        createdRules: results.rules.created,
        updatedRules: results.rules.updated,
        createdFacts: results.facts.created,
        updatedFacts: results.facts.updated,
        failedRules: results.rules.failed.length,
        failedFacts: results.facts.failed.length
    };
}

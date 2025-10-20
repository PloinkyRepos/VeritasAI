import { getSkillServices, ensurePersistoSchema } from '../lib/runtime.mjs';
import {
    fetchFacts,
    buildFactPromptBlock,
    extractJsonPayload,
    selectTopBySimilarity,
    toSafeString
} from '../lib/rag-helpers.mjs';

function normalizeCount(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 5;
    }
    return Math.min(Math.floor(numeric), 25);
}

export function specs() {
    return {
        name: 'rank-statements',
        needConfirmation: false,
        description: 'Analyze a document and list the most relevant knowledge base statements.',
        why: 'Quickly surfaces the facts that matter most for a document review or audit.',
        what: 'Ranks knowledge base facts by relevance to the supplied document and provides a short rationale.',
        humanDescription: 'Rank the top knowledge base statements for a document.',
        arguments: {
            document: {
                type: 'string',
                description: 'Full text of the document or excerpt to compare against the knowledge base.',
                required: true,
                multiline: true
            },
            count: {
                type: 'number',
                description: 'How many statements to return (default 5, max 25).'
            }
        },
        requiredArguments: ['document']
    };
}

export function roles() {
    return ['Analyst', 'Reviewer', 'Auditor', 'KnowledgeAdmin'];
}

function buildPrompt({ document, facts, count }) {
    return [
        'You are VeritasAI, a retrieval expert.',
        'Your task is to analyse the supplied document and identify the most relevant factual statements from the knowledge base.',
        '',
        'Document:',
        '"""',
        document,
        '"""',
        '',
        `Knowledge base facts (${facts.length} candidates):`,
        buildFactPromptBlock(facts),
        '',
        `Return the ${count} most relevant facts as JSON with the shape:`,
        '{ "rankedStatements": [ { "fact_id": "fact identifier", "relevance_score": 0.0-1.0, "summary": "short restatement", "reason": "why it is relevant" } ] }',
        'If fewer than the requested number are relevant, return only the ones that apply.'
    ].join('\n');
}

function fallbackRanking(document, facts, count) {
    const ranked = selectTopBySimilarity(document, facts, 'content', count);
    return ranked.map((fact, index) => ({
        fact_id: fact.fact_id,
        relevance_score: Number(((count - index) / count).toFixed(2)),
        summary: fact.content.slice(0, 120),
        reason: 'Selected via lexical similarity fallback.'
    }));
}

async function generateStatementsWithoutRag({ document, count, llmAgent }) {
    const prompt = [
        'You are VeritasAI. The knowledge base is currently empty or unavailable.',
        `Extract the ${count} most important factual statements from the provided document and explain why each matters.`,
        '',
        'Document:',
        '"""',
        document,
        '"""',
        '',
        'Return JSON with this structure:',
        '{',
        '  "statements": [',
        '    { "statement": "string", "reason": "string", "confidence": 0-1 }',
        '  ]',
        '}',
        'If unsure, provide your best effort and set confidence close to 0.5.'
    ].join('\n');

    let statements = [];
    let rawResponse = '';
    try {
        rawResponse = await llmAgent.complete({ prompt, temperature: 0.2 });
        const parsed = extractJsonPayload(rawResponse);
        const list = Array.isArray(parsed?.statements) ? parsed.statements : Array.isArray(parsed) ? parsed : null;
        if (list) {
            statements = list
                .map((entry) => ({
                    statement: toSafeString(entry.statement || entry.summary || entry.text),
                    reason: toSafeString(entry.reason || entry.explanation || entry.context),
                    confidence: Number(entry.confidence ?? entry.score ?? 0.5)
                }))
                .filter(item => item.statement)
                .slice(0, count);
        }
    } catch (error) {
        console.error('LLM extraction failed while operating without RAG.', error.message);
    }

    if (!statements.length) {
        const sentences = document
            .split(/(?<=[.!?])\s+/)
            .map(part => part.trim())
            .filter(Boolean)
            .slice(0, count);
        statements = sentences.map((sentence, index) => ({
            statement: sentence,
            reason: 'Derived directly from the document (fallback).',
            confidence: Number(((count - index) / count).toFixed(2))
        }));
    }

    return statements;
}

export async function action({ document, count } = {}) {
    const trimmedDocument = toSafeString(document);
    if (!trimmedDocument) {
        throw new Error('Provide a document to analyse.');
    }

    const { client, llmAgent } = getSkillServices();
    await ensurePersistoSchema();

    if (!llmAgent) {
        throw new Error('LLM agent is unavailable.');
    }

    const desiredCount = normalizeCount(count);
    const allFacts = await fetchFacts(client, { limit: 200 });
    let analysisSource = 'rag';

    if (!allFacts.length) {
        console.log('⚠️  Knowledge base is empty; extracting statements directly with the LLM.');
        const statements = await generateStatementsWithoutRag({ document: trimmedDocument, count: desiredCount, llmAgent });
        const table = statements.map((item, index) => ({
            Rank: index + 1,
            Statement: item.statement,
            Reason: item.reason,
            Confidence: Number(item.confidence || 0).toFixed(2)
        }));
        console.table(table);

        return {
            success: true,
            requested: desiredCount,
            returned: statements.length,
            factIds: [],
            statements,
            analysisSource: 'llm'
        };
    }

    const candidateFacts = selectTopBySimilarity(trimmedDocument, allFacts, 'content', Math.min(allFacts.length, 60));
    const prompt = buildPrompt({
        document: trimmedDocument,
        facts: candidateFacts,
        count: desiredCount
    });

    let rankedStatements = [];
    try {
        const raw = await llmAgent.complete({ prompt, temperature: 0.1 });
        const parsed = extractJsonPayload(raw);
        const list = Array.isArray(parsed?.rankedStatements) ? parsed.rankedStatements : Array.isArray(parsed) ? parsed : null;
        if (list) {
            rankedStatements = list
                .map(entry => ({
                    fact_id: toSafeString(entry.fact_id),
                    relevance_score: Number(entry.relevance_score ?? entry.score ?? 0),
                    summary: toSafeString(entry.summary || entry.statement || entry.content),
                    reason: toSafeString(entry.reason || entry.explanation)
                }))
                .filter(item => item.fact_id);
        }
    } catch (error) {
        console.error('Ranking via LLM failed, using fallback ranking.', error.message);
    }

    if (!rankedStatements.length) {
        rankedStatements = fallbackRanking(trimmedDocument, candidateFacts, desiredCount);
    } else if (rankedStatements.length > desiredCount) {
        rankedStatements = rankedStatements.slice(0, desiredCount);
    }

    console.log(`# Ranked statements`);
    const table = rankedStatements.map((item, index) => {
        const fact = allFacts.find(f => f.fact_id === item.fact_id) || {};
        return {
            Rank: index + 1,
            Fact: item.fact_id,
            Score: Number(item.relevance_score || 0).toFixed(2),
            Summary: item.summary || toSafeString(fact.content).slice(0, 120),
            Reason: item.reason
        };
    });
    console.table(table);

    return {
        success: true,
        requested: desiredCount,
        returned: rankedStatements.length,
        factIds: rankedStatements.map(item => item.fact_id),
        analysisSource
    };
}

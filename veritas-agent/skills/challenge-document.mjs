import { getSkillServices, ensurePersistoSchema } from '../lib/runtime.mjs';
import { analyzeDocument } from '../lib/rag-analysis.mjs';
import { toSafeString } from '../lib/rag-helpers.mjs';

function normalizeLimit(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 6;
    }
    return Math.min(Math.floor(numeric), 20);
}

function printContradictions(entries) {
    if (!entries.length) {
        console.log('No contradictions were discovered.');
        return;
    }
    console.log('Contradicting findings:');
    for (const item of entries) {
        const statementLine = item.statement ? `Document: "${item.statement}"` : 'Document excerpt unavailable.';
        console.log(`- [${item.fact_id}] ${statementLine}`);
        if (item.content) {
            console.log(`  Fact: ${item.content}`);
        }
        if (item.explanation) {
            console.log(`  Reason: ${item.explanation}`);
        }
        if (item.source) {
            console.log(`  Source: ${item.source}`);
        }
    }
}

export function specs() {
    return {
        name: 'challenge-document',
        needConfirmation: false,
        description: 'Identify knowledge base facts that contradict a document.',
        why: 'Surfaces conflicts before policies or reports are approved.',
        what: 'Analyses the document and lists contradicting facts with reasoning.',
        humanDescription: 'Challenge a document with contradicting evidence.',
        arguments: {
            document: {
                type: 'string',
                description: 'Document text to challenge.',
                required: true,
                multiline: true
            },
            highlights: {
                type: 'number',
                description: 'Maximum contradictions to list (default 6, max 20).'
            }
        },
        requiredArguments: ['document']
    };
}

export function roles() {
    return ['sysAdmin'];
}

export async function action({ document, highlights } = {}) {
    const trimmedDocument = toSafeString(document);
    if (!trimmedDocument) {
        throw new Error('Provide a document to challenge.');
    }

    const { client, llmAgent } = getSkillServices();
    await ensurePersistoSchema();

    const limit = normalizeLimit(highlights);

    const result = await analyzeDocument({
        document: trimmedDocument,
        mode: 'challenge',
        client,
        llmAgent,
        maxHighlights: limit,
        log: true
    });

    console.log(`# Challenge document`);
    console.log(`- Verdict: ${result.verdict.toUpperCase()}`);
    if (result.notes) {
        console.log(`- Notes: ${result.notes}`);
    }
    if (result.analysisSource === 'llm') {
        console.log('- Knowledge base unavailable; response generated via LLM-only reasoning.');
    }

    printContradictions(result.contradictingFacts.slice(0, limit));

    if (result.supportingFacts.length) {
        console.log('\nSupporting facts identified:');
        for (const item of result.supportingFacts.slice(0, limit)) {
            console.log(`- [${item.fact_id}] ${item.content}`);
        }
    }

    return {
        success: true,
        verdict: result.verdict,
        contradictingFacts: result.contradictingFacts,
        supportingFacts: result.supportingFacts,
        notes: result.notes,
        analysisSource: result.analysisSource
    };
}

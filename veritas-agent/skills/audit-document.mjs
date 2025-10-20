import { getSkillServices, ensurePersistoSchema } from '../lib/runtime.mjs';
import { analyzeDocument } from '../lib/rag-analysis.mjs';
import { toSafeString } from '../lib/rag-helpers.mjs';

function normalizeHighlightCount(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 6;
    }
    return Math.min(Math.floor(numeric), 20);
}

function printFindings(title, entries) {
    if (!entries.length) {
        console.log(`- ${title}: none`);
        return;
    }
    console.log(`- ${title}:`);
    for (const item of entries) {
        const statementLine = item.statement ? ` "${item.statement}"` : '';
        console.log(`  • [${item.fact_id}]${statementLine}`);
        if (item.content) {
            console.log(`    Fact: ${item.content}`);
        }
        if (item.explanation) {
            console.log(`    Reason: ${item.explanation}`);
        }
        if (item.source) {
            console.log(`    Source: ${item.source}`);
        }
    }
}

export function specs() {
    return {
        name: 'audit-document',
        needConfirmation: false,
        description: 'Audit a document to identify statements that are supported or contradicted by the knowledge base.',
        why: 'Generates a balanced view of strengths and gaps in a document before reviews or sign-off.',
        what: 'Produces a report with supporting and contradicting evidence plus an overall verdict.',
        humanDescription: 'Audit a document for support vs contradictions.',
        arguments: {
            document: {
                type: 'string',
                description: 'Full text of the document to audit.',
                required: true,
                multiline: true
            },
            highlights: {
                type: 'number',
                description: 'Maximum number of findings to report in each category (default 6, max 20).'
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
        throw new Error('Provide a document to audit.');
    }

    const { client, llmAgent } = getSkillServices();
    await ensurePersistoSchema();

    const maxHighlights = normalizeHighlightCount(highlights);

    const result = await analyzeDocument({
        document: trimmedDocument,
        mode: 'audit',
        client,
        llmAgent,
        maxHighlights,
        log: true
    });

    console.log(`# Document audit`);
    console.log(`- Verdict: ${result.verdict.toUpperCase()}`);
    if (result.notes) {
        console.log(`- Notes: ${result.notes}`);
    }
    if (result.analysisSource === 'llm') {
        console.log('- Knowledge base unavailable; response generated via LLM-only reasoning.');
    }

    printFindings('Supported statements', result.supportingFacts.slice(0, maxHighlights));
    printFindings('Contradicted statements', result.contradictingFacts.slice(0, maxHighlights));

    return {
        success: true,
        verdict: result.verdict,
        supportingFacts: result.supportingFacts,
        contradictingFacts: result.contradictingFacts,
        notes: result.notes,
        analysisSource: result.analysisSource
    };
}

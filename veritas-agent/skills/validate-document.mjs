import { getSkillServices, ensurePersistoSchema } from '../lib/runtime.mjs';

function normalizeLimit(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 6;
    }
    return Math.min(Math.floor(numeric), 20);
}

function printSupport(entries) {
    if (!entries.length) {
        console.log('No supporting evidence was found.');
        return;
    }
    console.log('Supporting findings:');
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
        name: 'validate-document',
        needConfirmation: false,
        description: 'Retrieve knowledge base facts that support the document.',
        why: 'Helps attach evidence before distributing or approving documents.',
        what: 'Analyses the document and lists supporting facts with explanations.',
        humanDescription: 'Validate a document with supporting evidence.',
        arguments: {
            document: {
                type: 'string',
                description: 'Document text to validate.',
                required: true,
                multiline: true
            },
            highlights: {
                type: 'number',
                description: 'Maximum supporting findings to show (default 6, max 20).'
            }
        },
        requiredArguments: ['document']
    };
}

export function roles() {
    return ['sysAdmin'];
}

export async function action({ document, highlights } = {}) {
    const { ragService } = getSkillServices();
    await ensurePersistoSchema();

    const limit = normalizeLimit(highlights);

    const result = await ragService.analyzeDocument({
        document,
        mode: 'validate',
        maxHighlights: limit,
        log: true
    });

    console.log(`# Validate document`);
    console.log(`- Verdict: ${result.verdict.toUpperCase()}`);
    if (result.notes) {
        console.log(`- Notes: ${result.notes}`);
    }
    if (result.analysisSource === 'llm') {
        console.log('- Knowledge base unavailable; response generated via LLM-only reasoning.');
    }

    printSupport(result.supportingFacts.slice(0, limit));

    if (result.contradictingFacts.length) {
        console.log('\nContradicting facts identified:');
        for (const item of result.contradictingFacts.slice(0, limit)) {
            console.log(`- [${item.fact_id}] ${item.content}`);
        }
    }

    return {
        success: true,
        verdict: result.verdict,
        supportingFacts: result.supportingFacts,
        contradictingFacts: result.contradictingFacts,
        notes: result.notes,
        analysisSource: result.analysisSource
    };
}

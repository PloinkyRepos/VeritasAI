import { getSkillServices, ensurePersistoSchema } from '../lib/runtime.mjs';
import { analyzeStatement } from '../lib/rag-analysis.mjs';
import { toSafeString } from '../lib/rag-helpers.mjs';

function printSupport(entries) {
    if (!entries.length) {
        console.log('No supporting facts were found.');
        return;
    }
    console.log('Supporting facts:');
    for (const item of entries) {
        console.log(`- [${item.fact_id}] ${item.content}`);
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
        name: 'validate-statement',
        needConfirmation: false,
        description: 'Retrieve evidence that confirms the supplied statement.',
        why: 'Provides quick proof or validation for critical claims.',
        what: 'Finds supporting facts and reports the validation verdict.',
        humanDescription: 'Validate a statement with knowledge base evidence.',
        arguments: {
            statement: {
                type: 'string',
                description: 'The statement or claim to validate.',
                required: true,
                multiline: true
            }
        },
        requiredArguments: ['statement']
    };
}

export function roles() {
    return ['Analyst', 'Reviewer', 'KnowledgeAdmin'];
}

export async function action({ statement } = {}) {
    const trimmedStatement = toSafeString(statement);
    if (!trimmedStatement) {
        throw new Error('Provide a statement to validate.');
    }

    const { client, llmAgent } = getSkillServices();
    await ensurePersistoSchema();

    const result = await analyzeStatement({
        statement: trimmedStatement,
        mode: 'validate',
        client,
        llmAgent,
        log: true
    });

    console.log(`# Validate statement`);
    console.log(`- Statement: "${result.statement}"`);
    console.log(`- Verdict: ${result.verdict.toUpperCase()}`);
    if (result.notes) {
        console.log(`- Notes: ${result.notes}`);
    }
    if (result.analysisSource === 'llm') {
        console.log('- Knowledge base unavailable; response generated via LLM-only reasoning.');
    }

    printSupport(result.supportingFacts);

    if (result.contradictingFacts.length) {
        console.log('\nContradicting facts were also identified:');
        for (const item of result.contradictingFacts) {
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

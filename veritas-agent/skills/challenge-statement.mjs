import { getSkillServices, ensurePersistoSchema } from '../lib/runtime.mjs';
import { analyzeStatement } from '../lib/rag-analysis.mjs';
import { toSafeString } from '../lib/rag-helpers.mjs';

function printContradictions(entries) {
    if (!entries.length) {
        console.log('No contradicting facts were found.');
        return;
    }
    console.log('Contradicting facts:');
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
        name: 'challenge-statement',
        needConfirmation: false,
        description: 'Find evidence from the knowledge base that contradicts the supplied statement.',
        why: 'Highlights risks by exposing claims that conflict with established facts.',
        what: 'Searches for contradicting facts and reports the findings.',
        humanDescription: 'Retrieve evidence that disproves a statement.',
        arguments: {
            statement: {
                type: 'string',
                description: 'The statement or claim to challenge.',
                required: true,
                multiline: true
            }
        },
        requiredArguments: ['statement']
    };
}

export function roles() {
    return ['sysAdmin'];
}

export async function action({ statement } = {}) {
    const trimmedStatement = toSafeString(statement);
    if (!trimmedStatement) {
        throw new Error('Provide a statement to challenge.');
    }

    const { client, llmAgent } = getSkillServices();
    await ensurePersistoSchema();

    const result = await analyzeStatement({
        statement: trimmedStatement,
        mode: 'challenge',
        client,
        llmAgent,
        log: true
    });

    console.log(`# Challenge statement`);
    console.log(`- Statement: "${result.statement}"`);
    console.log(`- Verdict: ${result.verdict.toUpperCase()}`);
    if (result.notes) {
        console.log(`- Notes: ${result.notes}`);
    }
    if (result.analysisSource === 'llm') {
        console.log('- Knowledge base unavailable; response generated via LLM-only reasoning.');
    }

    printContradictions(result.contradictingFacts);

    if (result.supportingFacts.length) {
        console.log('\nSupporting facts were also identified:');
        for (const item of result.supportingFacts) {
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

import { getSkillServices, ensurePersistoSchema } from '../lib/runtime.mjs';

function printFactList(title, entries) {
    if (!entries.length) {
        console.log(`- ${title}: none`);
        return;
    }
    console.log(`- ${title}:`);
    for (const item of entries) {
        console.log(`  • [${item.fact_id}] ${item.content}`);
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
        name: 'audit-statement',
        needConfirmation: false,
        description: 'Assess whether a specific statement is supported or contradicted by the knowledge base.',
        why: 'Determines alignment between a claim and recorded evidence.',
        what: 'Analyses a single statement and returns supporting and contradicting facts with a verdict.',
        humanDescription: 'Audit a statement against the knowledge base.',
        arguments: {
            statement: {
                type: 'string',
                description: 'The statement or claim to audit.',
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
    const { ragService } = getSkillServices();
    await ensurePersistoSchema();

    const result = await ragService.analyzeStatement({
        statement,
        mode: 'audit',
        log: true
    });

    console.log(`# Statement audit`);
    console.log(`- Statement: "${result.statement}"`);
    console.log(`- Verdict: ${result.verdict.toUpperCase()}`);
    if (result.notes) {
        console.log(`- Notes: ${result.notes}`);
    }
    if (result.analysisSource === 'llm') {
        console.log('- Knowledge base unavailable; response generated via LLM-only reasoning.');
    }

    printFactList('Supporting facts', result.supportingFacts);
    printFactList('Contradicting facts', result.contradictingFacts);

    return {
        success: true,
        verdict: result.verdict,
        supportingFacts: result.supportingFacts,
        contradictingFacts: result.contradictingFacts,
        notes: result.notes,
        analysisSource: result.analysisSource
    };
}

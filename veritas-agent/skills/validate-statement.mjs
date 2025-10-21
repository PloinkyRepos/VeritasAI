import { getSkillServices, ensurePersistoSchema } from '../lib/runtime.mjs';

function printSupport(entries, heading = 'Supporting facts') {
    if (!entries.length) {
        console.log(`No ${heading.toLowerCase()} were found.`);
        return;
    }
    console.log(`${heading}:`);
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
        needConfirmation: true,
        description: 'Retrieve evidence that confirms the supplied statement.',
        why: 'Provides quick proof or validation for critical claims.',
        what: 'Finds supporting facts and reports the validation verdict.',
        humanDescription: 'Validate a statement with knowledge base evidence.',
        arguments: {
            statement: {
                type: 'string',
                description: 'The statement or claim to validate.',
                llmHint: 'Provide the exact claim you want verified, for example “Revenue exceeded $2M in 2024 Q1”. Avoid command-style inputs.',
                required: true,
                multiline: true,
                minLength: 12,
                validator: meaningfulStatement
            }
        },
        requiredArguments: ['statement']
    };
}

export function roles() {
    return ['sysAdmin'];
}

function meaningfulStatement(value = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized.length < 12) {
        return { valid: false };
    }
    const looksLikeCommand = /^(validate|audit|challenge|check)\b/i.test(normalized);
    if (looksLikeCommand) {
        return { valid: false };
    }
    return { valid: true, value: normalized };
}
export async function action({ statement } = {}) {
    await ensurePersistoSchema();
    const { ragService } = getSkillServices();
    if (!ragService) {
        throw new Error('RAG service is unavailable.');
    }

    const result = await ragService.analyzeStatement({
        statement,
        mode: 'validate',
        log: true
    });

    console.log('# Statement validation');
    console.log(`- Statement: "${result.statement}"`);
    console.log(`- Verdict: ${result.verdict.toUpperCase()}`);
    if (result.notes) {
        console.log(`- Notes: ${result.notes}`);
    }
    if (result.analysisSource === 'llm') {
        console.log('- Knowledge base unavailable; response generated via LLM-only reasoning.');
    }

    printSupport(result.supportingFacts, 'Supporting facts');
    if (Array.isArray(result.contradictingFacts) && result.contradictingFacts.length) {
        printSupport(result.contradictingFacts, 'Contradicting facts');
    }

    return {
        success: result.verdict === 'supported',
        statement: result.statement,
        verdict: result.verdict,
        supportingFacts: result.supportingFacts,
        contradictingFacts: result.contradictingFacts,
        notes: result.notes,
        analysisSource: result.analysisSource
    };
}

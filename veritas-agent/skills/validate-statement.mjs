import { getSkillServices, ensurePersistoSchema } from '../lib/runtime.mjs';

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
    return ['sysAdmin'];
}

export async function action({ statement } = {}) {
    console.log('Validating statement:', statement);
    const { ragService, getStrategy } = getSkillServices();
    const mockStrategy = getStrategy('mock');
    return mockStrategy.processStatement('validate-statement', { statement });
}

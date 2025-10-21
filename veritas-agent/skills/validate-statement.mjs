import {getStrategy} from '../lib/strategy-registry.mjs';

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
                validator: mockValidation
            }
        },
        requiredArguments: ['statement']
    };
}

export function roles() {
    return ['sysAdmin'];
}

function mockValidation(statement) {
    console.log('Validating statement:------->', statement);
    return {valid: true, value: statement};
}

function meaningfulStatement(value = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized.length < 12) {
        return {valid: false};
    }
    const looksLikeCommand = /^(validate|audit|challenge|check)\b/i.test(normalized);
    if (looksLikeCommand) {
        console.log('Statement looks like a command:', normalized);
        return {valid: false};
    }

    console.log('Statement is valid:', normalized);
    return {valid: true, value: normalized};
}

export async function action(statement) {
    console.log('Validating statement:', statement);
    const mockStrategy = getStrategy('mock');
    const response = await mockStrategy.processStatement('validate-statement', {statement});
    console.log('Validation result:', response.result);
    return {success: true, result: response.result};
}

import {getStrategy} from '../lib/strategy-registry.mjs';

function mockValidation(statement) {
    console.log('Validating statement:------->', statement);
    return {valid: true, value: statement};
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
                multiline: true,
                validator: mockValidation
            }
        },
        requiredArguments: ['statement']
    };
}

export function roles() {
    return ['sysAdmin'];
}

export async function action(statement) {
    console.log('Auditing statement:', statement);
    const mockStrategy = getStrategy('mock');
    const response = await mockStrategy.processStatement('audit-statement', {statement});
    console.log('Audit result:', response.result);
    return {success: true, result: response.result};
}

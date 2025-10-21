import {getStrategy} from '../lib/strategy-registry.mjs';

function mockValidation(statement) {
    console.log('Validating statement:------->', statement);
    return {valid: true, value: statement};
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
                multiline: true,
                validator: mockValidation
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

export async function action(document, highlights) {
    console.log('Validating document:', document, highlights);
    const mockStrategy = getStrategy('mock');
    const response = await mockStrategy.processStatement('validate-document', {document, highlights});
    console.log('Validation result:', response.result);
    return {success: true, result: response.result};
}

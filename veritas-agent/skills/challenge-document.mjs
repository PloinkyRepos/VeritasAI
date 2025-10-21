import {getStrategy} from '../lib/strategy-registry.mjs';

function mockValidation(statement) {
    console.log('Validating statement:------->', statement);
    return {valid: true, value: statement};
}

export function specs() {
    return {
        name: 'challenge-document',
        needConfirmation: false,
        description: 'Identify knowledge base facts that contradict a document.',
        why: 'Surfaces conflicts before policies or reports are approved.',
        what: 'Analyses the document and lists contradicting facts with reasoning.',
        humanDescription: 'Challenge a document with contradicting evidence.',
        arguments: {
            document: {
                type: 'string',
                description: 'Document text to challenge.',
                required: true,
                multiline: true,
                validator: mockValidation
            },
            highlights: {
                type: 'number',
                description: 'Maximum contradictions to list (default 6, max 20).'
            }
        },
        requiredArguments: ['document']
    };
}

export function roles() {
    return ['sysAdmin'];
}

export async function action(document, highlights) {
    console.log('Challenging document:', document, highlights);
    const mockStrategy = getStrategy('mock');
    const response = await mockStrategy.processStatement('challenge-document', {document, highlights});
    console.log('Challenge result:', response.result);
    return {success: true, result: response.result};
}

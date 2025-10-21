import {getStrategy} from '../lib/strategy-registry.mjs';

function mockValidation(statement) {
    console.log('Validating statement:------->', statement);
    return {valid: true, value: statement};
}

export function specs() {
    return {
        name: 'audit-document',
        needConfirmation: false,
        description: 'Audit a document to identify statements that are supported or contradicted by the knowledge base.',
        why: 'Generates a balanced view of strengths and gaps in a document before reviews or sign-off.',
        what: 'Produces a report with supporting and contradicting evidence plus an overall verdict.',
        humanDescription: 'Audit a document for support vs contradictions.',
        arguments: {
            document: {
                type: 'string',
                description: 'Full text of the document to audit.',
                required: true,
                multiline: true,
                validator: mockValidation
            },
            highlights: {
                type: 'number',
                description: 'Maximum number of findings to report in each category (default 6, max 20).'
            }
        },
        requiredArguments: ['document']
    };
}

export function roles() {
    return ['sysAdmin'];
}

export async function action(document, highlights) {
    console.log('Auditing document:', document, highlights);
    const mockStrategy = getStrategy('mock');
    const response = await mockStrategy.processStatement('audit-document', {document, highlights});
    console.log('Audit result:', response.result);
    return {success: true, result: response.result};
}

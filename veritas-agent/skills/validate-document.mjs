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

function meaningfulDocument(value = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized.length < 50) {
        return {valid: false, reason: 'Document text is too short for a meaningful validation.'};
    }
    return {valid: true, value: normalized};
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
                llmHint: 'Provide the full document text you want to validate.',
                required: true,
                multiline: true,
                validator: meaningfulDocument
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
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
        return {valid: false, reason: 'Document text is too short for a meaningful audit.'};
    }
    return {valid: true, value: normalized};
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
                llmHint: 'Provide the full document text you want to audit. The document should be substantial enough for a meaningful analysis.',
                required: true,
                multiline: true,
                validator: meaningfulDocument
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
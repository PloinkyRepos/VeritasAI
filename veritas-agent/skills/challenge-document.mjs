import {getStrategy} from '../lib/strategy-registry.mjs';

function printSupport(entries, heading = 'Contradicting facts') {
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
        return {valid: false, reason: 'Document text is too short for a meaningful challenge.'};
    }
    return {valid: true, value: normalized};
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
                llmHint: 'Provide the full document text you want to challenge. The document should be substantial enough for a meaningful analysis.',
                required: true,
                multiline: true,
                validator: meaningfulDocument
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
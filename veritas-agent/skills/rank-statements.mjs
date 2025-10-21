import {getStrategy} from '../lib/strategy-registry.mjs';

function meaningfulDocument(value = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized.length < 50) {
        return {valid: false, reason: 'Document text is too short for a meaningful ranking.'};
    }
    return {valid: true, value: normalized};
}

export function specs() {
    return {
        name: 'rank-statements',
        needConfirmation: false,
        description: 'Analyze a document and list the most relevant knowledge base statements.',
        why: 'Quickly surfaces the facts that matter most for a document review or audit.',
        what: 'Ranks knowledge base facts by relevance to the supplied document and provides a short rationale.',
        humanDescription: 'Rank the top knowledge base statements for a document.',
        arguments: {
            document: {
                type: 'string',
                description: 'Full text of the document or excerpt to compare against the knowledge base.',
                llmHint: 'Provide the full document text for which you want to rank relevant statements.',
                required: true,
                multiline: true,
                validator: meaningfulDocument
            },
            count: {
                type: 'number',
                description: 'How many statements to return (default 5, max 25).'
            }
        },
        requiredArguments: ['document']
    };
}

export function roles() {
    return ['sysAdmin'];
}

export async function action(document, count) {
    console.log('Ranking statements for document:', document, count);
    const rankingStrategy = getStrategy('ranking');
    const response = await rankingStrategy.rankStatements({
        skillName: 'rank-statements',
        document,
        count
    });
    console.log('Ranking result:', response.result);
    return {success: true, result: response.result};
}

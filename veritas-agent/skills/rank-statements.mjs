import {getStrategy} from '../lib/strategy-registry.mjs';

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
                required: true,
                multiline: true
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
    const response = await rankingStrategy.rankStatements({document, count});
    console.log('Ranking result:', response.result);
    return {success: true, result: response.result};
}

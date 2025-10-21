import {getStrategy} from '../lib/strategy-registry.mjs';

export function specs() {
    return {
        name: 'upload-rules',
        needConfirmation: true,
        description: 'Upload, import, or add rules and facts to the VeritasAI knowledge base. Supports JSON or newline text inputs.',
        why: 'Keeps the retrieval-augmented knowledge base updated with the latest rules and supporting evidence.',
        what: 'Reads structured data and inserts or updates rule and fact records in the RAG datastore.',
        humanDescription: 'Upload new rules and supporting facts.',
        arguments: {
            file: {
                type: 'string',
                description: 'Optional file in the temp directory containing rules/facts (JSON or text).'
            },
            rules: {
                type: 'string',
                description: 'Rules to add (JSON array or newline text).',
                multiline: true
            },
            facts: {
                type: 'string',
                description: 'Facts or evidence entries (JSON array or newline text).',
                multiline: true
            },
            source: {
                type: 'string',
                description: 'Default source or reference applied when entries omit a source.'
            }
        },
        requiredArguments: []
    };
}

export function roles() {
    return ['sysAdmin'];
}

export async function action({file, rules, facts, source}) {
    console.log('Uploading rules and facts:', {file, rules, facts, source});
    const uploadStrategy = getStrategy('upload');
    const response = await uploadStrategy.uploadRulesAndFacts({file, rules, facts, source});
    console.log('Upload result:', response.result);
    return {success: true, result: response.result};
}

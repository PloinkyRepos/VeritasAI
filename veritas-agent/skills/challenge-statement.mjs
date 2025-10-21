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

function meaningfulStatement(value = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized.length < 12) {
        return {valid: false};
    }
    const looksLikeCommand = /^(validate|audit|challenge|check)\b/i.test(normalized);
    if (looksLikeCommand) {
        return {valid: false, reason: 'Input looks like a command, please provide a statement to challenge.'};
    }
    return {valid: true, value: normalized};
}

export function specs() {
    return {
        name: 'challenge-statement',
        needConfirmation: false,
        description: 'Find evidence from the knowledge base that contradicts the supplied statement.',
        why: 'Highlights risks by exposing claims that conflict with established facts.',
        what: 'Searches for contradicting facts and reports the findings.',
        humanDescription: 'Retrieve evidence that disproves a statement.',
        arguments: {
            statement: {
                type: 'string',
                description: 'The statement or claim to challenge.',
                llmHint: 'Provide the exact claim you want to challenge, for example “All systems are currently secure”. Avoid command-like inputs.',
                required: true,
                multiline: true,
                validator: meaningfulStatement
            }
        },
        requiredArguments: ['statement']
    };
}

export function roles() {
    return ['sysAdmin'];
}

export async function action(statement) {
    console.log('Challenging statement:', statement);
    const mockStrategy = getStrategy('mock');
    const response = await mockStrategy.processStatement('challenge-statement', {statement});
    console.log('Challenge result:', response.result);
    return {success: true, result: response.result};
}
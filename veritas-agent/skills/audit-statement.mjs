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

function meaningfulStatement(value = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized.length < 12) {
        return {valid: false};
    }
    const looksLikeCommand = /^(validate|audit|challenge|check)\b/i.test(normalized);
    if (looksLikeCommand) {
        return {valid: false, reason: 'Input looks like a command, please provide a statement to audit.'};
    }
    return {valid: true, value: normalized};
}

export function specs() {
    return {
        name: 'audit-statement',
        needConfirmation: false,
        description: 'Assess whether a specific statement is supported or contradicted by the knowledge base.',
        why: 'Determines alignment between a claim and recorded evidence.',
        what: 'Analyses a single statement and returns supporting and contradicting facts with a verdict.',
        humanDescription: 'Audit a statement against the knowledge base.',
        arguments: {
            statement: {
                type: 'string',
                description: 'The statement or claim to audit.',
                llmHint: 'Provide the exact claim you want to audit, for example “The project is on track to meet its deadline”. Avoid command-like inputs.',
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
    console.log('Auditing statement:', statement);
    const mockStrategy = getStrategy('mock');
    const response = await mockStrategy.processStatement('audit-statement', {statement});
    console.log('Audit result:', response.result);
    return {success: true, result: response.result};
}
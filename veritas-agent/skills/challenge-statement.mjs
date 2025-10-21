import {getStrategy} from '../lib/strategy-registry.mjs';

function mockValidation(statement) {
    console.log('Validating statement:------->', statement);
    return {valid: true, value: statement};
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
                required: true,
                multiline: true,
                validator: mockValidation
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

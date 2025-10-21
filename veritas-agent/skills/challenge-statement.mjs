import { resolveStrategy, tryGetLlmAgent } from '../lib/skill-utils.mjs';

function fallbackReport(statement, citations) {
    const header = '# Challenge Brief';
    const statementSection = `## Statement\n${statement}`;
    const contradictions = citations.length
        ? `## Contradicting Evidence\n${citations.map(item => `- **${item.fact_id}**: ${item.content}${item.source ? ` _(source: ${item.source})_` : ''}${item.explanation ? `\n  - Rationale: ${item.explanation}` : ''}`).join('\n')}`
        : '## Contradicting Evidence\n- No contradictions were located in the current knowledge base.';
    const riskLevel = citations.length ? 'medium' : 'uncertain';
    const riskSection = `## Risk Assessment\n${riskLevel}`;
    const nextSteps = citations.length
        ? '## Recommended Actions\n- Investigate cited contradictions and address any conflicts.\n- Confirm sources to determine severity.'
        : '## Recommended Actions\n- Capture additional evidence or monitor for conflicting information.';
    return [header, statementSection, contradictions, riskSection, nextSteps].join('\n\n');
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
    const strategy = resolveStrategy(['default', 'simple-llm']);
    const citations = await strategy.getChallengesForStatement(statement);

    const llmAgent = tryGetLlmAgent();
    const payload = {
        statement,
        citations: citations.map(item => ({
            id: item.fact_id,
            type: item.type,
            source: item.source,
            explanation: item.explanation,
            content: item.content
        }))
    };

    let report = fallbackReport(statement, citations);
    if (llmAgent) {
        try {
            const description = [
                'Create a Markdown challenge brief for the supplied statement.',
                'Include sections: # Challenge Brief, ## Statement, ## Contradicting Evidence, ## Risk Assessment, ## Recommended Actions.',
                'Summarise the severity based on available contradictions. If none exist, highlight the lack of evidence.',
                'Use bullet lists for evidence and do not fabricate IDs or sources.'
            ].join('\n');
            const history = [{
                role: 'user',
                message: `Evaluate the following data:\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
            }];
            report = await llmAgent.doTask(
                { skill: 'challenge-statement', intent: 'challenge', statement },
                description,
                { mode: 'precision', history }
            );
        } catch (error) {
            console.warn('Falling back to static challenge report generator:', error.message);
        }
    }

    console.log(report);
    return {
        success: true,
        result: {
            statement,
            citations,
            report
        }
    };
}

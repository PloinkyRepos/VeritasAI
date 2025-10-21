import { resolveStrategy, tryGetLlmAgent } from '../lib/skill-utils.mjs';

function fallbackReport(statement, supporting, challenging) {
    const header = '# Statement Audit';
    const statementSection = `## Statement\n${statement}`;
    const supportingSection = supporting.length
        ? `## Supporting Evidence\n${supporting.map(item => `- **${item.fact_id}**: ${item.content}${item.source ? ` _(source: ${item.source})_` : ''}${item.explanation ? `\n  - Rationale: ${item.explanation}` : ''}`).join('\n')}`
        : '## Supporting Evidence\n- No supporting citations were located.';
    const challengingSection = challenging.length
        ? `## Contradicting Evidence\n${challenging.map(item => `- **${item.fact_id}**: ${item.content}${item.source ? ` _(source: ${item.source})_` : ''}${item.explanation ? `\n  - Rationale: ${item.explanation}` : ''}`).join('\n')}`
        : '## Contradicting Evidence\n- No contradictions were found.';
    const verdict = supporting.length && !challenging.length
        ? 'supported'
        : challenging.length && !supporting.length
            ? 'contradicted'
            : supporting.length || challenging.length
                ? 'mixed'
                : 'insufficient';
    const verdictSection = `## Verdict\n${verdict}`;
    const nextSteps = challenging.length
        ? '## Next Steps\n- Investigate contradictions and align with stakeholders.'
        : supporting.length
            ? '## Next Steps\n- Maintain evidence and monitor for new contradictions.'
            : '## Next Steps\n- Gather more evidence before proceeding.';
    return [header, statementSection, supportingSection, challengingSection, verdictSection, nextSteps].join('\n\n');
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
    const strategy = resolveStrategy(['default', 'simple-llm']);
    const [supporting, challenging] = await Promise.all([
        strategy.getEvidencesForStatement(statement),
        strategy.getChallengesForStatement(statement)
    ]);

    const llmAgent = tryGetLlmAgent();
    const payload = {
        statement,
        supporting: supporting.map(item => ({
            id: item.fact_id,
            type: item.type,
            source: item.source,
            explanation: item.explanation,
            content: item.content
        })),
        challenging: challenging.map(item => ({
            id: item.fact_id,
            type: item.type,
            source: item.source,
            explanation: item.explanation,
            content: item.content
        }))
    };

    let report = fallbackReport(statement, supporting, challenging);
    if (llmAgent) {
        try {
            const description = [
                'Compile a Markdown audit report for the provided statement.',
                'Structure sections: # Statement Audit, ## Statement, ## Supporting Evidence, ## Contradicting Evidence, ## Verdict, ## Next Steps.',
                'Summarise the verdict as supported, contradicted, mixed, or insufficient.',
                'Use bullet lists for evidence and do not fabricate data.'
            ].join('\n');
            const history = [{
                role: 'user',
                message: `Audit using this data:\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
            }];
            report = await llmAgent.doTask(
                { skill: 'audit-statement', intent: 'audit', statement },
                description,
                { mode: 'precision', history }
            );
        } catch (error) {
            console.warn('Falling back to static statement audit report:', error.message);
        }
    }

    console.log(report);
    return {
        success: true,
        result: {
            statement,
            supporting,
            challenging,
            report
        }
    };
}

import { resolveStrategy, tryGetLlmAgent } from '../lib/skill-utils.mjs';

function fallbackReport(statement, citations) {
    const header = '# Validation Brief';
    const statementSection = `## Statement\n${statement}`;
    const evidenceSection = citations.length
        ? `## Supporting Evidence\n${citations.map(entry => `- **${entry.fact_id}**: ${entry.content}${entry.source ? ` _(source: ${entry.source})_` : ''}${entry.explanation ? `\n  - Rationale: ${entry.explanation}` : ''}`).join('\n')}`
        : '## Supporting Evidence\n- No supporting citations were found for this statement.';
    const confidence = citations.length ? 'medium' : 'insufficient';
    const confidenceSection = `## Confidence\n${confidence}`;
    const nextSteps = citations.length
        ? '## Next Steps\n- Review cited sources for completeness.\n- Consider collecting additional evidence if higher assurance is needed.'
        : '## Next Steps\n- Gather more data points or confirm the statement with subject matter experts.';
    return [header, statementSection, evidenceSection, confidenceSection, nextSteps].join('\n\n');
}

function meaningfulStatement(value = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized.length < 12) {
        return {valid: false, reason: 'Statement is too short for a meaningful validation.'};
    }
    const looksLikeCommand = /^(validate|audit|challenge|check)\b/i.test(normalized);
    if (looksLikeCommand) {
        return {valid: false, reason: 'Input looks like a command, please provide a statement to validate.'};
    }
    return {valid: true, value: normalized};
}

export function specs() {
    return {
        name: 'validate-statement',
        needConfirmation: true,
        description: 'Retrieve evidence that confirms the supplied statement.',
        why: 'Provides quick proof or validation for critical claims.',
        what: 'Finds supporting facts and reports the validation verdict.',
        humanDescription: 'Validate a statement with knowledge base evidence.',
        arguments: {
            statement: {
                type: 'string',
                description: 'The statement or claim to validate.',
                llmHint: 'Provide the exact claim you want verified, for example “Revenue exceeded $2M in 2024 Q1”. Avoid command-style inputs.',
                required: true,
                multiline: true,
                minLength: 12,
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
    const citations = await strategy.getEvidencesForStatement(statement);

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
                'Produce a concise Markdown validation brief for the provided statement and supporting citations.',
                'Required sections: # Validation Brief, ## Statement, ## Supporting Evidence, ## Confidence, ## Next Steps.',
                'Summarise overall confidence as high/medium/low based on evidence strength.',
                'Use bullet points for evidence. If citations list is empty, clearly state that evidence is insufficient.',
                'Do not invent sources or IDs.'
            ].join('\n');
            const history = [{
                role: 'user',
                message: `Provide the report for this JSON payload:\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
            }];
            report = await llmAgent.doTask(
                { skill: 'validate-statement', intent: 'validate', statement },
                description,
                { mode: 'precision', history }
            );
        } catch (error) {
            console.warn('Falling back to static report generator:', error.message);
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

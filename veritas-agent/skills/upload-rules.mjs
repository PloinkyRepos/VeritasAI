import { resolveStrategy, tryGetLlmAgent } from '../lib/skill-utils.mjs';

function requireRulesOrFacts(value, {file, rules, facts}) {
    const hasContent = file || rules || facts;
    if (!hasContent) {
        return {valid: false, reason: 'Please provide rules or facts to upload, either directly or in a file.'};
    }
    return {valid: true};
}

function fallbackReport(actions) {
    const header = '# Knowledge Upload Summary';
    if (!actions.length) {
        return `${header}\n\n- No rules or facts were recognised in the provided inputs.`;
    }

    const totals = actions.reduce((acc, entry) => {
        const counts = entry.aspects.reduce((tally, aspect) => {
            const type = aspect.type === 'rule' ? 'rules' : 'facts';
            tally[type] += 1;
            return tally;
        }, { rules: 0, facts: 0 });
        acc.rules += counts.rules;
        acc.facts += counts.facts;
        return acc;
    }, { rules: 0, facts: 0 });

    const actionsSection = actions.map(entry => {
        const counts = entry.aspects.reduce((tally, aspect) => {
            const type = aspect.type === 'rule' ? 'rules' : 'facts';
            tally[type] += 1;
            return tally;
        }, { rules: 0, facts: 0 });
        const details = entry.aspects.slice(0, 5).map(aspect => `  - **${aspect.id}** (${aspect.type}): ${aspect.content}`);
        const truncated = entry.aspects.length > 5 ? `  - … ${entry.aspects.length - 5} additional entries` : null;
        return [
            `## Source: ${entry.label}`,
            `- Rules stored: ${counts.rules}`,
            `- Facts stored: ${counts.facts}`,
            entry.aspects.length ? ['### Highlights', ...details, truncated].filter(Boolean).join('\n') : ''
        ].filter(Boolean).join('\n');
    }).join('\n\n');

    const totalsSection = `## Totals\n- Rules stored: ${totals.rules}\n- Facts stored: ${totals.facts}`;
    const nextSteps = '## Next Steps\n- Validate newly added knowledge with audit or validation skills as needed.';

    return [header, totalsSection, actionsSection, nextSteps].filter(Boolean).join('\n\n');
}

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
                description: 'Optional file in the temp directory containing rules/facts (JSON or text).',
                llmHint: 'You can specify a file from the temp directory to upload.'
            },
            rules: {
                type: 'string',
                description: 'Rules to add (JSON array or newline text).',
                llmHint: 'You can provide the rules directly as a JSON array or as newline-separated text.',
                multiline: true,
                validator: requireRulesOrFacts
            },
            facts: {
                type: 'string',
                description: 'Facts or evidence entries (JSON array or newline text).',
                llmHint: 'You can provide the facts directly as a JSON array or as newline-separated text.',
                multiline: true
            },
            source: {
                type: 'string',
                description: 'Default source or reference applied when entries omit a source.',
                llmHint: 'Optionally, you can specify a default source for the rules and facts.'
            }
        },
        requiredArguments: []
    };
}

export function roles() {
    return ['sysAdmin'];
}

export async function action({file, rules, facts, source}) {
    const strategy = resolveStrategy(['default', 'simple-llm']);
    const knowledgeStore = strategy.knowledgeStore;
    if (!knowledgeStore) {
        throw new Error('Knowledge store is unavailable. Cannot persist rules or facts.');
    }

    const actions = [];

    if (file) {
        const detected = await strategy.detectRelevantAspectsFromSingleFile(file, source || '');
        const enriched = detected.map(aspect => ({
            ...aspect,
            source: aspect.source || source || file
        }));
        if (enriched.length) {
            await knowledgeStore.replaceResource(file, enriched, { statement: source || '', defaultType: 'fact' });
            actions.push({ label: file, type: 'file', aspects: enriched });
        }
    }

    if (rules) {
        const context = source ? `Rules from ${source}:\n${rules}` : rules;
        const detectedRules = await strategy.detectRulesFromStatement(context);
        const normalizedRules = detectedRules.map(aspect => ({
            ...aspect,
            source: aspect.source || source || null
        }));
        if (normalizedRules.length) {
            const resourceKey = source ? `${source}#rules` : `inline:rules#${Date.now()}`;
            await knowledgeStore.mergeResource(resourceKey, normalizedRules, { statement: context, defaultType: 'rule' });
            actions.push({ label: resourceKey, type: 'rules', aspects: normalizedRules });
        }
    }

    if (facts) {
        const context = source ? `Facts from ${source}:\n${facts}` : facts;
        const detectedFacts = await strategy.detectRelevantAspectsFromSingleFile(null, context);
        const normalizedFacts = detectedFacts.map(aspect => ({
            ...aspect,
            source: aspect.source || source || null
        }));
        if (normalizedFacts.length) {
            const resourceKey = source ? `${source}#facts` : `inline:facts#${Date.now()}`;
            await knowledgeStore.mergeResource(resourceKey, normalizedFacts, { statement: context, defaultType: 'fact' });
            actions.push({ label: resourceKey, type: 'facts', aspects: normalizedFacts });
        }
    }

    const llmAgent = tryGetLlmAgent();
    const payload = {
        source,
        actions: actions.map(entry => ({
            label: entry.label,
            type: entry.type,
            aspects: entry.aspects.map(aspect => ({
                id: aspect.id,
                type: aspect.type,
                content: aspect.content,
                source: aspect.source || source || null
            }))
        }))
    };

    let report = fallbackReport(actions);
    if (llmAgent) {
        try {
            const description = [
                'Summarise the uploaded rules and facts in Markdown.',
                'Sections: # Knowledge Upload Summary, ## Totals, one ## Source section per input, ## Next Steps.',
                'For each source, list counts of rules vs facts and highlight notable entries.',
                'If no entries were extracted, state that nothing was stored.',
                'Use only the supplied data.'
            ].join('\n');
            const history = [{
                role: 'user',
                message: `Upload payload:\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
            }];
            report = await llmAgent.doTask(
                { skill: 'upload-rules', intent: 'ingest-knowledge', source },
                description,
                { mode: 'precision', history }
            );
        } catch (error) {
            console.warn('Falling back to static upload summary:', error.message);
        }
    }

    console.log(report);
    return {
        success: true,
        result: {
            actions,
            report
        }
    };
}

import { resolveStrategy, tryGetLlmAgent, resolveResourceInput } from '../lib/skill-utils.mjs';
import { getServices } from '../lib/service-context.mjs';
import {
    ensureUploadsRegisteredFromTask,
    getRegisteredUploads
} from '../lib/upload-registry.mjs';

function requireInput(value) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) {
        return { valid: true };
    }
    const services = getServices();
    const workspaceDir = services?.workspaceDir || process.cwd();
    if (services?.task) {
        ensureUploadsRegisteredFromTask(services.task, { workspaceDir });
    }
    if (getRegisteredUploads().length) {
        return { valid: true };
    }
    return { valid: false, reason: 'Please provide rules or facts to upload, either directly or in a file.' };
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
        needConfirmation: false,
        description: 'Upload, import, or add rules and facts to the VeritasAI knowledge base. Provide either a file path/URL or inline text.',
        why: 'Keeps the retrieval-augmented knowledge base updated with the latest rules and supporting evidence.',
        what: 'Reads structured data and inserts or updates rule and fact records in the RAG datastore.',
        humanDescription: 'Upload new rules and supporting facts.',
        arguments: {
            input: {
                type: 'string',
                description: 'Either a file path/URL pointing to rules and facts or inline text that contains them.',
                llmHint: 'Provide a local path, an uploaded filename, or paste the rules/facts directly.',
                multiline: true,
                validator: requireInput
            }
        },
        requiredArguments: ['input']
    };
}

export function roles() {
    return ['sysAdmin'];
}

export async function action({input}) {
    const strategy = resolveStrategy(['simple-llm', 'default']);
    const knowledgeStore = strategy.knowledgeStore;
    if (!knowledgeStore) {
        throw new Error('Knowledge store is unavailable. Cannot persist rules or facts.');
    }

    const actions = [];

    const services = getServices();
    const workspaceDir = services?.workspaceDir || process.cwd();
    if (services?.task) {
        ensureUploadsRegisteredFromTask(services.task, { workspaceDir });
    }

    const uploads = getRegisteredUploads();
    let candidateInput = typeof input === 'string' ? input.trim() : '';
    let candidateLabel = candidateInput;

    if (!candidateInput && uploads.length) {
        const latestUpload = uploads[uploads.length - 1];
        candidateInput = latestUpload.path || latestUpload.url || latestUpload.id || '';
        candidateLabel = latestUpload.name || latestUpload.url || latestUpload.id || candidateInput;
    }

    if (!candidateInput) {
        throw new Error('Provide a file path/URL or inline text containing rules or facts.');
    }

    if (!candidateLabel) {
        candidateLabel = candidateInput;
    }

    const { resourceURL, text } = await resolveResourceInput(candidateInput);

    if (resourceURL) {
        const stored = await strategy.storeRelevantAspectsFromSingleFile(
            resourceURL,
            '',
            { defaultSource: resourceURL }
        );
        if (stored.length) {
            actions.push({
                label: candidateLabel || resourceURL,
                type: 'file',
                aspects: stored
            });
        }
    } else if (text) {
        const resourceKey = `inline:${Date.now()}`;
        const label = candidateLabel || (text.length > 60 ? `${text.slice(0, 57)}…` : text);
        const stored = await strategy.storeRelevantAspectsFromStatement(text, {
            resourceKey,
            defaultType: 'fact',
            defaultSource: label
        });
        if (stored.length) {
            actions.push({
                label,
                type: 'statement',
                aspects: stored
            });
        }
    } else {
        throw new Error('Unable to read content from the provided input.');
    }

    const llmAgent = tryGetLlmAgent();
    const payload = {
        actions: actions.map(entry => ({
            label: entry.label,
            type: entry.type,
            aspects: entry.aspects.map(aspect => ({
                id: aspect.id,
                type: aspect.type,
                content: aspect.content,
                source: aspect.source || null
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
                { skill: 'upload-rules', intent: 'ingest-knowledge' },
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

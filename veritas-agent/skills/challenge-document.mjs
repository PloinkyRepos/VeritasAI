import { resolveStrategy, tryGetLlmAgent } from '../lib/skill-utils.mjs';
import { analyzeDocument, summariseDocument } from '../lib/document-skill-helpers.mjs';

function fallbackReport(summary, findings) {
    const header = '# Document Challenge Report';
    const documentSection = `## Document Snapshot\n${summary || '_No preview available._'}`;

    const conflictSection = findings.length
        ? `## Conflict Map\n${findings.map(({ aspect, challenging }) => {
            const title = `- **${aspect.content}**`;
            if (!challenging.length) {
                return `${title}\n  - No contradicting citations were found.`;
            }
            const lines = challenging.map(item => `  - **${item.fact_id}**: ${item.content}${item.source ? ` _(source: ${item.source})_` : ''}${item.explanation ? ` — ${item.explanation}` : ''}`);
            return [title, ...lines].join('\n');
        }).join('\n')}`
        : '## Conflict Map\n- No contradictions were detected for this document.';

    const totalContradictions = findings.reduce((sum, entry) => sum + entry.challenging.length, 0);
    const riskLevel = totalContradictions > findings.length
        ? 'high'
        : totalContradictions > 0
            ? 'medium'
            : 'low';
    const riskSection = `## Risk Assessment\n${riskLevel}`;
    const recommendations = totalContradictions
        ? '## Recommended Actions\n- Address the listed contradictions before publishing.\n- Engage content owners to reconcile conflicts.'
        : '## Recommended Actions\n- Monitor for new conflicting evidence and maintain supporting documentation.';

    return [header, documentSection, conflictSection, riskSection, recommendations].join('\n\n');
}

function meaningfulDocument(value = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized.length < 50) {
        return {valid: false, reason: 'Document text is too short for a meaningful challenge.'};
    }
    return {valid: true, value: normalized};
}

export function specs() {
    return {
        name: 'challenge-document',
        needConfirmation: false,
        description: 'Identify knowledge base facts that contradict a document.',
        why: 'Surfaces conflicts before policies or reports are approved.',
        what: 'Analyses the document and lists contradicting facts with reasoning.',
        humanDescription: 'Challenge a document with contradicting evidence.',
        arguments: {
            document: {
                type: 'string',
                description: 'Document text to challenge.',
                llmHint: 'Provide the full document text you want to challenge. The document should be substantial enough for a meaningful analysis.',
                required: true,
                multiline: true,
                validator: meaningfulDocument
            },
            highlights: {
                type: 'number',
                description: 'Maximum contradictions to list (default 6, max 20).'
            }
        },
        requiredArguments: ['document']
    };
}

export function roles() {
    return ['sysAdmin'];
}

export async function action(document, highlights) {
    const strategy = resolveStrategy(['default', 'simple-llm']);
    const analysis = await analyzeDocument(strategy, document, { highlights, mode: 'challenge' });

    const llmAgent = tryGetLlmAgent();
    const documentSummary = summariseDocument(analysis.text);
    const payload = {
        resourceURL: analysis.resourceURL,
        summary: documentSummary,
        findings: analysis.findings.map(({ aspect, challenging }) => ({
            aspect: {
                id: aspect.id,
                type: aspect.type,
                content: aspect.content,
                source: aspect.source
            },
            challenging: challenging.map(item => ({
                id: item.fact_id,
                type: item.type,
                source: item.source,
                explanation: item.explanation,
                content: item.content
            }))
        }))
    };

    let report = fallbackReport(documentSummary, analysis.findings);
    if (llmAgent) {
        try {
            const description = [
                'Create a Markdown challenge report using the document analysis data provided.',
                'Output sections: # Document Challenge Report, ## Document Snapshot, ## Conflict Map, ## Risk Assessment, ## Recommended Actions.',
                'Summarise contradictions per document aspect and highlight severity.',
                'If contradictions are absent, state that no conflicts were found.',
                'Avoid inventing sources or IDs.'
            ].join('\n');
            const history = [{
                role: 'user',
                message: `Document challenge analysis:\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
            }];
            report = await llmAgent.doTask(
                { skill: 'challenge-document', intent: 'challenge-document', resource: analysis.resourceURL },
                description,
                { mode: 'precision', history }
            );
        } catch (error) {
            console.warn('Using static document challenge report due to LLM error:', error.message);
        }
    }

    console.log(report);
    return {
        success: true,
        result: {
            resource: analysis.resourceURL,
            aspects: analysis.aspects,
            findings: analysis.findings,
            report
        }
    };
}

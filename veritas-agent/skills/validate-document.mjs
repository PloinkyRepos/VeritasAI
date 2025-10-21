import { resolveStrategy, tryGetLlmAgent } from '../lib/skill-utils.mjs';
import { analyzeDocument, summariseDocument } from '../lib/document-skill-helpers.mjs';

function fallbackReport(summary, findings) {
    const header = '# Document Validation Report';
    const documentSection = `## Document Snapshot\n${summary || '_No preview available._'}`;

    const evidenceSection = findings.length
        ? `## Evidence Map\n${findings.map(({ aspect, supporting }) => {
            const title = `- **${aspect.content}**`;
            if (!supporting.length) {
                return `${title}\n  - No supporting citations were found.`;
            }
            const lines = supporting.map(item => `  - **${item.fact_id}**: ${item.content}${item.source ? ` _(source: ${item.source})_` : ''}${item.explanation ? ` — ${item.explanation}` : ''}`);
            return [title, ...lines].join('\n');
        }).join('\n')}`
        : '## Evidence Map\n- No relevant assertions were detected for validation.';

    const totalSupporting = findings.reduce((sum, entry) => sum + entry.supporting.length, 0);
    const confidence = totalSupporting > findings.length
        ? 'high'
        : totalSupporting > 0
            ? 'medium'
            : 'insufficient';
    const confidenceSection = `## Confidence\n${confidence}`;
    const nextSteps = totalSupporting
        ? '## Next Steps\n- Review cited evidence before final approval.\n- Capture any missing references if higher assurance is needed.'
        : '## Next Steps\n- Gather more supporting evidence and rerun the validation.';

    return [header, documentSection, evidenceSection, confidenceSection, nextSteps].join('\n\n');
}

function meaningfulDocument(value = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized.length < 50) {
        return {valid: false, reason: 'Document text is too short for a meaningful validation.'};
    }
    return {valid: true, value: normalized};
}

export function specs() {
    return {
        name: 'validate-document',
        needConfirmation: false,
        description: 'Retrieve knowledge base facts that support the document.',
        why: 'Helps attach evidence before distributing or approving documents.',
        what: 'Analyses the document and lists supporting facts with explanations.',
        humanDescription: 'Validate a document with supporting evidence.',
        arguments: {
            document: {
                type: 'string',
                description: 'Document text to validate.',
                llmHint: 'Provide the full document text you want to validate.',
                required: true,
                multiline: true,
                validator: meaningfulDocument
            },
            highlights: {
                type: 'number',
                description: 'Maximum supporting findings to show (default 6, max 20).'
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
    const analysis = await analyzeDocument(strategy, document, { highlights, mode: 'validate' });

    const llmAgent = tryGetLlmAgent();
    const documentSummary = summariseDocument(analysis.text);
    const payload = {
        resourceURL: analysis.resourceURL,
        summary: documentSummary,
        findings: analysis.findings.map(({ aspect, supporting }) => ({
            aspect: {
                id: aspect.id,
                type: aspect.type,
                content: aspect.content,
                source: aspect.source
            },
            supporting: supporting.map(item => ({
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
                'Generate a Markdown validation report for the supplied document analysis.',
                'Include sections: # Document Validation Report, ## Document Snapshot, ## Evidence Map, ## Confidence, ## Next Steps.',
                'When listing evidence, group citations under their corresponding document aspects.',
                'If no evidence is available, clearly state the gap.',
                'Do not hallucinate sources or IDs.'
            ].join('\n');
            const history = [{
                role: 'user',
                message: `Document analysis data:\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
            }];
            report = await llmAgent.doTask(
                { skill: 'validate-document', intent: 'validate-document', resource: analysis.resourceURL },
                description,
                { mode: 'precision', history }
            );
        } catch (error) {
            console.warn('Using static document validation report due to LLM error:', error.message);
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

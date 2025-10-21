import { resolveStrategy, tryGetLlmAgent } from '../lib/skill-utils.mjs';
import { analyzeDocument, summariseDocument } from '../lib/document-skill-helpers.mjs';

function fallbackReport(summary, findings) {
    const header = '# Document Audit Report';
    const documentSection = `## Document Snapshot\n${summary || '_No preview available._'}`;

    const findingsSection = findings.length
        ? `## Findings\n${findings.map(({ aspect, supporting, challenging }) => {
            const title = `### ${aspect.content}`;
            const supportLines = supporting.length
                ? supporting.map(item => `- **Support ${item.fact_id}**: ${item.content}${item.source ? ` _(source: ${item.source})_` : ''}${item.explanation ? ` — ${item.explanation}` : ''}`).join('\n')
                : '- No supporting citations identified.';
            const challengeLines = challenging.length
                ? challenging.map(item => `- **Challenge ${item.fact_id}**: ${item.content}${item.source ? ` _(source: ${item.source})_` : ''}${item.explanation ? ` — ${item.explanation}` : ''}`).join('\n')
                : '- No contradictions detected.';
            return [title, '#### Supporting Evidence', supportLines, '#### Contradicting Evidence', challengeLines].join('\n');
        }).join('\n\n')}`
        : '## Findings\n- No material assertions were extracted for this document.';

    const totalSupport = findings.reduce((sum, entry) => sum + entry.supporting.length, 0);
    const totalChallenge = findings.reduce((sum, entry) => sum + entry.challenging.length, 0);
    const verdict = totalSupport && !totalChallenge
        ? 'supported'
        : totalChallenge && !totalSupport
            ? 'contradicted'
            : totalSupport || totalChallenge
                ? 'mixed'
                : 'insufficient data';
    const verdictSection = `## Overall Verdict\n${verdict}`;

    let recommendations;
    if (verdict === 'supported') {
        recommendations = '## Recommendations\n- Proceed while keeping the cited evidence on record.';
    } else if (verdict === 'contradicted') {
        recommendations = '## Recommendations\n- Resolve the highlighted contradictions before approving the document.';
    } else if (verdict === 'mixed') {
        recommendations = '## Recommendations\n- Review conflicting sections with stakeholders and update the document accordingly.';
    } else {
        recommendations = '## Recommendations\n- Collect additional evidence or clarify the document before further review.';
    }

    return [header, documentSection, findingsSection, verdictSection, recommendations].join('\n\n');
}

function meaningfulDocument(value = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (normalized.length < 50) {
        return {valid: false, reason: 'Document text is too short for a meaningful audit.'};
    }
    return {valid: true, value: normalized};
}

export function specs() {
    return {
        name: 'audit-document',
        needConfirmation: false,
        description: 'Audit a document to identify statements that are supported or contradicted by the knowledge base.',
        why: 'Generates a balanced view of strengths and gaps in a document before reviews or sign-off.',
        what: 'Produces a report with supporting and contradicting evidence plus an overall verdict.',
        humanDescription: 'Audit a document for support vs contradictions.',
        arguments: {
            document: {
                type: 'string',
                description: 'Full text of the document to audit.',
                llmHint: 'Provide the full document text you want to audit. The document should be substantial enough for a meaningful analysis.',
                required: true,
                multiline: true,
                validator: meaningfulDocument
            },
            highlights: {
                type: 'number',
                description: 'Maximum number of findings to report in each category (default 6, max 20).'
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
    const analysis = await analyzeDocument(strategy, document, { highlights, mode: 'audit' });

    const llmAgent = tryGetLlmAgent();
    const documentSummary = summariseDocument(analysis.text);
    const payload = {
        resourceURL: analysis.resourceURL,
        summary: documentSummary,
        findings: analysis.findings.map(({ aspect, supporting, challenging }) => ({
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
            })),
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
                'Draft a Markdown audit report for the analysed document.',
                'Required sections: # Document Audit Report, ## Document Snapshot, ## Findings, ## Overall Verdict, ## Recommendations.',
                'For each finding include subsections for supporting and contradicting evidence.',
                'Summarise the overall verdict as supported, contradicted, mixed, or insufficient.',
                'Use only the supplied data and avoid inventing sources.'
            ].join('\n');
            const history = [{
                role: 'user',
                message: `Document audit analysis:\n\`\`\`json\n${JSON.stringify(payload, null, 2)}\n\`\`\``
            }];
            report = await llmAgent.doTask(
                { skill: 'audit-document', intent: 'audit-document', resource: analysis.resourceURL },
                description,
                { mode: 'precision', history }
            );
        } catch (error) {
            console.warn('Using static document audit report due to LLM error:', error.message);
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

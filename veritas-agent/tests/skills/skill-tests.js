import { registerStrategy } from '../../lib/strategy-registry.mjs';
import { getSkillServices, setSkillServices } from '../../lib/runtime.mjs';
import { action as validateStatementAction } from '../../skills/validate-statement.mjs';
import { action as challengeStatementAction } from '../../skills/challenge-statement.mjs';
import { action as auditStatementAction } from '../../skills/audit-statement.mjs';
import { action as validateDocumentAction } from '../../skills/validate-document.mjs';
import { action as challengeDocumentAction } from '../../skills/challenge-document.mjs';
import { action as auditDocumentAction } from '../../skills/audit-document.mjs';
import { action as uploadRulesAction } from '../../skills/upload-rules.mjs';

import { evaluateExpectations } from '../utils/evaluator.js';
import { createStrategyContext } from '../utils/strategy.js';
import {
    pharmaAspects,
    pharmaStatements,
    pharmaDocument,
    pharmaFactsText,
    pharmaRulesText
} from '../utils/pharma-fixtures.js';

async function seedPharmaKnowledge(knowledgeStore) {
    await knowledgeStore.replaceResource('fixtures:pharma', pharmaAspects, { defaultType: 'fact' });
}

async function setupSkillTest({ seed = true } = {}) {
    const context = await createStrategyContext('skill');
    const { strategy, knowledgeStore, llmAgent } = context;

    registerStrategy('simple-llm', strategy);
    registerStrategy('default', strategy);

    const existingServices = getSkillServices();
    setSkillServices({
        ...existingServices,
        llmAgent,
        task: '',
        user: { username: 'qa-bot', roles: ['sysAdmin'] }
    });

    if (seed) {
        await seedPharmaKnowledge(knowledgeStore);
    }

    return { strategy, knowledgeStore, llmAgent };
}

function composeOutputReport(title, payload) {
    return [
        `# ${title}`,
        typeof payload.report === 'string' ? payload.report : '',
        '---',
        'Citations:',
        JSON.stringify(payload.citations ?? payload.supporting ?? payload.findings ?? payload, null, 2)
    ].join('\n');
}

export async function registerSkillTests(runner) {
    runner.add('Skill validate-statement recognises supporting pharma evidence', async () => {
        await setupSkillTest({ seed: true });
        const response = await validateStatementAction(pharmaStatements.validate);
        if (!response?.success) {
            throw new Error('validate-statement action did not complete successfully.');
        }
        const output = composeOutputReport('validate-statement', response.result);
        await evaluateExpectations({
            title: 'validate-statement: aseptic requalification',
            output,
            expectations: [
                'The report cites fact pharma-fact-aseptic-2024 as supporting evidence.',
                'The summary communicates that the statement has supporting evidence (not insufficient).'
            ]
        });
    });

    runner.add('Skill challenge-statement highlights pharma contradictions', async () => {
        await setupSkillTest({ seed: true });
        const response = await challengeStatementAction(pharmaStatements.challenge);
        if (!response?.success) {
            throw new Error('challenge-statement action did not complete successfully.');
        }
        const output = composeOutputReport('challenge-statement', response.result);
        await evaluateExpectations({
            title: 'challenge-statement: excursions in April',
            output,
            expectations: [
                'The report lists fact pharma-fact-em-excursions-apr as contradicting the statement.',
                'The summary or recommended actions indicate that the claim is challenged or risky.'
            ]
        });
    });

    runner.add('Skill audit-statement reports mixed findings', async () => {
        await setupSkillTest({ seed: true });
        const response = await auditStatementAction(pharmaStatements.mixed);
        if (!response?.success) {
            throw new Error('audit-statement action did not complete successfully.');
        }
        const output = [
            `# audit-statement`,
            response.result.report,
            '---',
            'Supporting:',
            JSON.stringify(response.result.supporting, null, 2),
            'Challenging:',
            JSON.stringify(response.result.challenging, null, 2)
        ].join('\n');
        await evaluateExpectations({
            title: 'audit-statement: mixed pharma claim',
            output,
            expectations: [
                'Supporting evidence references pharma-fact-aseptic-2024 or pharma-fact-training-q1.',
                'Contradicting evidence references pharma-fact-batch-hold-0412 or pharma-fact-em-excursions-apr.',
                'The verdict communicates a mixed or risk-aware outcome.'
            ]
        });
    });

    runner.add('Skill validate-document surfaces supporting pharma evidence', async () => {
        await setupSkillTest({ seed: true });
        const response = await validateDocumentAction(pharmaDocument, 5);
        if (!response?.success) {
            throw new Error('validate-document action did not complete successfully.');
        }
        const output = composeOutputReport('validate-document', response.result);
        await evaluateExpectations({
            title: 'validate-document: pharma summary',
            output,
            expectations: [
                'Evidence map contains pharma-fact-aseptic-2024 or pharma-fact-training-q1 as supportive entries.',
                'Confidence or next steps indicate that supporting evidence exists.'
            ]
        });
    });

    runner.add('Skill challenge-document finds pharma contradictions', async () => {
        await setupSkillTest({ seed: true });
        const response = await challengeDocumentAction(pharmaDocument, 5);
        if (!response?.success) {
            throw new Error('challenge-document action did not complete successfully.');
        }
        const output = composeOutputReport('challenge-document', response.result);
        await evaluateExpectations({
            title: 'challenge-document: pharma summary',
            output,
            expectations: [
                'Conflict map lists pharma-fact-em-excursions-apr as contradicting the document.',
                'Risk assessment or recommendations highlight the contradiction.'
            ]
        });
    });

    runner.add('Skill audit-document presents balanced pharma findings', async () => {
        await setupSkillTest({ seed: true });
        const response = await auditDocumentAction(pharmaDocument, 5);
        if (!response?.success) {
            throw new Error('audit-document action did not complete successfully.');
        }
        const output = [
            '# audit-document',
            response.result.report,
            '---',
            'Findings:',
            JSON.stringify(response.result.findings, null, 2)
        ].join('\n');
        await evaluateExpectations({
            title: 'audit-document: pharma summary',
            output,
            expectations: [
                'Findings include supporting evidence such as pharma-fact-aseptic-2024 or pharma-fact-training-q1.',
                'Findings include contradicting evidence such as pharma-fact-em-excursions-apr or pharma-fact-batch-hold-0412.',
                'Overall verdict communicates whether the document is mixed or has gaps.'
            ]
        });
    });

    runner.add('Skill upload-rules ingests pharma dataset', async () => {
        const { knowledgeStore } = await setupSkillTest({ seed: false });
        const response = await uploadRulesAction({
            file: null,
            rules: pharmaRulesText,
            facts: pharmaFactsText,
            source: 'pharma-fixtures'
        });

        if (!response?.success) {
            throw new Error('upload-rules action did not complete successfully.');
        }

        const aspects = await knowledgeStore.listAllAspects();
        const ids = new Set(aspects.map(entry => entry.id));
        const expectedIds = [
            'pharma-fact-aseptic-2024',
            'pharma-fact-em-excursions-apr',
            'pharma-fact-batch-hold-0412',
            'pharma-fact-training-q1',
            'pharma-rule-aseptic-training',
            'pharma-rule-annex-excursions'
        ];

        const missing = expectedIds.filter(id => !ids.has(id));
        if (missing.length) {
            throw new Error(`upload-rules did not store expected entries: ${missing.join(', ')}`);
        }

        const output = composeOutputReport('upload-rules', response.result);
        await evaluateExpectations({
            title: 'upload-rules: pharma fixtures summary',
            output,
            expectations: [
                'Summary references the pharma-fixtures source and indicates both facts and rules were stored.',
                'Report counts or highlights at least one rule and one fact.'
            ]
        });
    });
}

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { createStrategyContext } from '../utils/strategy.js';
import { pharmaAspects, pharmaResourceMarkdown, pharmaStatements } from '../utils/pharma-fixtures.js';

const TEMP_ROOT = path.resolve(process.cwd(), 'tests', '.tmp');

async function createTempResource(content, label = 'resource') {
    await mkdir(TEMP_ROOT, { recursive: true });
    const filePath = path.join(TEMP_ROOT, `${label}-${randomUUID()}.md`);
    await writeFile(filePath, content, 'utf8');
    return filePath;
}

export async function registerStrategyTests(runner) {
    runner.add('SimpleLLmStrategy detects pharma aspects from markdown', async () => {
        const { strategy } = await createStrategyContext('detect');
        const resourcePath = await createTempResource(pharmaResourceMarkdown, 'pharma-detect');

        const aspects = await strategy.detectRelevantAspectsFromSingleFile(resourcePath, 'aseptic operations in pharma manufacturing');

        if (!Array.isArray(aspects) || !aspects.length) {
            throw new Error('detectRelevantAspectsFromSingleFile returned no aspects.');
        }

        const ids = new Set(aspects.map(entry => entry.id));
        if (!ids.has('pharma-fact-aseptic-2024')) {
            throw new Error('Expected aspect "pharma-fact-aseptic-2024" was not detected.');
        }
        if (!ids.has('pharma-rule-annex-excursions')) {
            throw new Error('Expected rule "pharma-rule-annex-excursions" was not detected.');
        }
        const ruleCount = aspects.filter(entry => entry.type === 'rule').length;
        if (ruleCount === 0) {
            throw new Error('No rules were identified in the detected aspects.');
        }
    });

    runner.add('SimpleLLmStrategy returns supporting evidence for statements', async () => {
        const { strategy, knowledgeStore } = await createStrategyContext('evidence');
        await knowledgeStore.replaceResource('fixtures:pharma', pharmaAspects, { defaultType: 'fact' });

        const citations = await strategy.getEvidencesForStatement(pharmaStatements.validate);

        if (!Array.isArray(citations) || !citations.length) {
            throw new Error('getEvidencesForStatement returned no citations.');
        }
        const match = citations.find(entry => entry.fact_id === 'pharma-fact-aseptic-2024');
        if (!match) {
            throw new Error('Supporting evidence did not include pharma-fact-aseptic-2024.');
        }
        if ((match.decision || '').toLowerCase() !== 'support') {
            throw new Error(`Expected decision "support" but received "${match.decision}".`);
        }
    });

    runner.add('SimpleLLmStrategy highlights contradictions for challenged statements', async () => {
        const { strategy, knowledgeStore } = await createStrategyContext('challenge');
        await knowledgeStore.replaceResource('fixtures:pharma', pharmaAspects, { defaultType: 'fact' });

        const citations = await strategy.getChallengesForStatement(pharmaStatements.challenge);

        if (!Array.isArray(citations) || !citations.length) {
            throw new Error('getChallengesForStatement returned no citations.');
        }
        const match = citations.find(entry => entry.fact_id === 'pharma-fact-em-excursions-apr');
        if (!match) {
            throw new Error('Contradicting evidence did not include pharma-fact-em-excursions-apr.');
        }
        if ((match.decision || '').toLowerCase() !== 'challenge') {
            throw new Error(`Expected decision "challenge" but received "${match.decision}".`);
        }
    });
}

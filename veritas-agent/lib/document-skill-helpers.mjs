import { resolveResourceInput } from './skill-utils.mjs';

function normalizeHighlightCount(input, defaultValue = 6, maxValue = 20) {
    const numeric = Number.parseInt(input, 10);
    if (Number.isFinite(numeric) && numeric > 0) {
        return Math.min(maxValue, Math.max(1, numeric));
    }
    return defaultValue;
}

export async function analyzeDocument(strategy, documentInput, { highlights, mode } = {}) {
    const maxHighlights = normalizeHighlightCount(highlights);
    const { resourceURL, text } = await resolveResourceInput(documentInput);
    if (!text) {
        return {
            resourceURL,
            text: '',
            aspects: [],
            findings: []
        };
    }

    const aspects = await strategy.detectRelevantAspectsFromSingleFile(resourceURL, text);
    const selected = aspects.slice(0, maxHighlights);

    const needSupport = mode === 'validate' || mode === 'audit';
    const needChallenge = mode === 'challenge' || mode === 'audit';

    const findings = [];
    for (const aspect of selected) {
        const [supporting, challenging] = await Promise.all([
            needSupport ? strategy.getEvidencesForStatement(aspect.content) : Promise.resolve([]),
            needChallenge ? strategy.getChallengesForStatement(aspect.content) : Promise.resolve([])
        ]);
        findings.push({
            aspect,
            supporting,
            challenging
        });
    }

    return {
        resourceURL,
        text,
        aspects: selected,
        findings
    };
}

export function summariseDocument(text, maxLength = 400) {
    if (!text) {
        return '';
    }
    const trimmed = text.trim().replace(/\s+/g, ' ');
    if (trimmed.length <= maxLength) {
        return trimmed;
    }
    return `${trimmed.slice(0, maxLength - 1)}…`;
}

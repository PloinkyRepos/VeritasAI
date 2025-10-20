import {
    fetchFacts,
    fetchRules,
    buildFactPromptBlock,
    buildRulePromptBlock,
    extractJsonPayload,
    selectTopBySimilarity,
    toSafeString,
    logAssessment
} from './rag-helpers.mjs';

const STATEMENT_MODE_INSTRUCTIONS = {
    audit: 'Determine whether the statement is supported, contradicted, both (mixed), or if evidence is insufficient. Cite relevant fact_ids.',
    validate: 'Identify facts that directly confirm the statement. If nothing confirms it, state that evidence is insufficient.',
    challenge: 'Identify facts that contradict or undermine the statement. If no contradictions are found, state that evidence is insufficient.'
};

const DOCUMENT_MODE_INSTRUCTIONS = {
    audit: 'Review the document, list claims that are supported and claims that are contradicted. Summarise the overall verdict.',
    validate: 'List portions of the document that are supported by the knowledge base and summarise the supportive verdict.',
    challenge: 'List portions of the document that are contradicted by the knowledge base and summarise the contradictory verdict.'
};

function buildStatementPrompt({ statement, mode, facts, rules }) {
    const instruction = STATEMENT_MODE_INSTRUCTIONS[mode] || STATEMENT_MODE_INSTRUCTIONS.audit;
    return [
        'You are VeritasAI, an evidence auditor.',
        'Evaluate the following statement using the known rules and facts.',
        '',
        'Statement:',
        `"${statement}"`,
        '',
        'Relevant rules:',
        buildRulePromptBlock(rules),
        '',
        'Relevant facts:',
        buildFactPromptBlock(facts),
        '',
        `${instruction}`,
        'Respond strictly in JSON with the following structure:',
        '{',
        '  "verdict": "supported|contradicted|mixed|insufficient",',
        '  "supporting_facts": [ { "fact_id": "string", "explanation": "short reason" } ],',
        '  "contradicting_facts": [ { "fact_id": "string", "explanation": "short reason" } ],',
        '  "notes": "optional additional context"',
        '}',
        'Only reference fact_ids that appear in the provided list.'
    ].join('\n');
}

function mapFactReferences(entries, facts) {
    if (!Array.isArray(entries)) {
        return [];
    }
    return entries
        .map(entry => {
            const factId = toSafeString(entry.fact_id || entry.id);
            if (!factId) {
                return null;
            }
            const fact = facts.find(item => item.fact_id === factId);
            return {
                fact_id: factId,
                content: toSafeString(fact?.content),
                source: toSafeString(fact?.source),
                explanation: toSafeString(entry.explanation || entry.reason || entry.justification)
            };
        })
        .filter(Boolean);
}

function ensureVerdict(verdict, supporting, contradicting, { requireEvidence = true } = {}) {
    const normalized = toSafeString(verdict).toLowerCase();
    const allowed = ['supported', 'contradicted', 'mixed', 'insufficient'];
    if (normalized && allowed.includes(normalized)) {
        if (!requireEvidence) {
            return normalized;
        }
        if (normalized === 'supported' && !supporting.length) {
            return 'insufficient';
        }
        if (normalized === 'contradicted' && !contradicting.length) {
            return 'insufficient';
        }
        if (normalized === 'mixed' && (!supporting.length || !contradicting.length)) {
            return supporting.length ? 'supported' : (contradicting.length ? 'contradicted' : 'insufficient');
        }
        return normalized;
    }
    if (supporting.length && contradicting.length) {
        return 'mixed';
    }
    if (supporting.length && !contradicting.length) {
        return 'supported';
    }
    if (!supporting.length && contradicting.length) {
        return 'contradicted';
    }
    return 'insufficient';
}

export async function analyzeStatement({ statement, mode = 'audit', client, llmAgent, log = true } = {}) {
    const trimmedStatement = toSafeString(statement);
    if (!trimmedStatement) {
        throw new Error('Statement is required.');
    }
    if (!client || typeof client.execute !== 'function') {
        throw new Error('Persisto client is unavailable.');
    }
    if (!llmAgent) {
        throw new Error('LLM agent is unavailable.');
    }

    const allFacts = await fetchFacts(client, { limit: 200 });
    const allRules = await fetchRules(client, { limit: 120 });

    const facts = selectTopBySimilarity(trimmedStatement, allFacts, 'content', 18);
    const rules = selectTopBySimilarity(trimmedStatement, allRules, 'content', 10);

    const ragAvailable = Boolean(facts.length || rules.length);

    if (!ragAvailable) {
        return analyzeStatementWithoutRag({
            statement: trimmedStatement,
            mode,
            llmAgent,
            client,
            log
        });
    }

    const prompt = buildStatementPrompt({ statement: trimmedStatement, mode, facts, rules });

    let parsed = null;
    try {
        const raw = await llmAgent.complete({ prompt, temperature: 0.1 });
        parsed = extractJsonPayload(raw);
    } catch (error) {
        console.error('Statement analysis failed.', error.message);
    }

    const supportingFacts = mapFactReferences(parsed?.supporting_facts, facts);
    const contradictingFacts = mapFactReferences(parsed?.contradicting_facts, facts);
    const verdict = ensureVerdict(parsed?.verdict, supportingFacts, contradictingFacts, { requireEvidence: true });
    const notes = toSafeString(parsed?.notes);

    if (log) {
        await logAssessment(client, {
            targetType: 'statement',
            targetReference: trimmedStatement,
            statement: trimmedStatement,
            verdict,
            supportingFacts,
            contradictingFacts,
            notes,
            analysisSource: 'rag'
        });
    }

    return {
        statement: trimmedStatement,
        verdict,
        supportingFacts,
        contradictingFacts,
        notes,
        facts,
        rules,
        analysisSource: 'rag'
    };
}

function buildDocumentPrompt({ document, mode, facts, rules, maxHighlights }) {
    const instruction = DOCUMENT_MODE_INSTRUCTIONS[mode] || DOCUMENT_MODE_INSTRUCTIONS.audit;
    return [
        'You are VeritasAI, a knowledge auditor.',
        'Evaluate the document using the known rules and facts.',
        '',
        'Document:',
        '"""',
        document,
        '"""',
        '',
        'Relevant rules:',
        buildRulePromptBlock(rules),
        '',
        'Relevant facts:',
        buildFactPromptBlock(facts),
        '',
        `${instruction}`,
        `Identify up to ${maxHighlights} key findings.`,
        'Respond strictly in JSON with the following structure:',
        '{',
        '  "verdict": "supported|contradicted|mixed|insufficient",',
        '  "supporting_facts": [ { "fact_id": "string", "statement": "part of the document", "explanation": "short reason" } ],',
        '  "contradicting_facts": [ { "fact_id": "string", "statement": "part of the document", "explanation": "short reason" } ],',
        '  "notes": "optional context or recommendations"',
        '}',
        'Only reference fact_ids that appear in the provided list.'
    ].join('\n');
}

export async function analyzeDocument({ document, mode = 'audit', client, llmAgent, maxHighlights = 8, log = true } = {}) {
    const trimmedDocument = toSafeString(document);
    if (!trimmedDocument) {
        throw new Error('Document text is required.');
    }
    if (!client || typeof client.execute !== 'function') {
        throw new Error('Persisto client is unavailable.');
    }
    if (!llmAgent) {
        throw new Error('LLM agent is unavailable.');
    }

    const allFacts = await fetchFacts(client, { limit: 200 });
    const allRules = await fetchRules(client, { limit: 120 });

    const facts = selectTopBySimilarity(trimmedDocument, allFacts, 'content', Math.min(30, maxHighlights * 3));
    const rules = selectTopBySimilarity(trimmedDocument, allRules, 'content', Math.min(15, maxHighlights * 2));

    const ragAvailable = Boolean(facts.length || rules.length);

    if (!ragAvailable) {
        return analyzeDocumentWithoutRag({
            document: trimmedDocument,
            mode,
            llmAgent,
            client,
            maxHighlights,
            log
        });
    }

    const prompt = buildDocumentPrompt({ document: trimmedDocument, mode, facts, rules, maxHighlights });

    let parsed = null;
    try {
        const raw = await llmAgent.complete({ prompt, temperature: 0.1 });
        parsed = extractJsonPayload(raw);
    } catch (error) {
        console.error('Document analysis failed.', error.message);
    }

    const supportingFacts = mapFactReferences(parsed?.supporting_facts, facts).map((entry, index) => ({
        ...entry,
        statement: toSafeString(parsed?.supporting_facts?.[index]?.statement)
    }));

    const contradictingFacts = mapFactReferences(parsed?.contradicting_facts, facts).map((entry, index) => ({
        ...entry,
        statement: toSafeString(parsed?.contradicting_facts?.[index]?.statement)
    }));

    const verdict = ensureVerdict(parsed?.verdict, supportingFacts, contradictingFacts, { requireEvidence: true });
    const notes = toSafeString(parsed?.notes);

    if (log) {
        await logAssessment(client, {
            targetType: 'document',
            targetReference: trimmedDocument.slice(0, 140),
            statement: trimmedDocument.slice(0, 280),
            verdict,
            supportingFacts,
            contradictingFacts,
            notes,
            analysisSource: 'rag'
        });
    }

    return {
        document: trimmedDocument,
        verdict,
        supportingFacts,
        contradictingFacts,
        notes,
        facts,
        rules,
        analysisSource: 'rag'
    };
}

async function analyzeStatementWithoutRag({ statement, mode, llmAgent, client, log = true }) {
    const prompt = [
        'You are VeritasAI. The structured knowledge base is currently empty or unavailable.',
        'Provide a best-effort assessment of the statement using general domain reasoning.',
        '',
        `Mode: ${mode}`,
        `Statement: "${statement}"`,
        '',
        'Respond in JSON with this structure:',
        '{',
        '  "verdict": "supported|contradicted|mixed|insufficient",',
        '  "notes": "short narrative explanation for the user"',
        '}',
        'Do not hallucinate knowledge base facts. If you are unsure, choose "insufficient".'
    ].join('\n');

    let parsed = null;
    let rawResponse = '';
    try {
        rawResponse = await llmAgent.complete({ prompt, temperature: 0.2 });
        parsed = extractJsonPayload(rawResponse);
    } catch (error) {
        console.error('Fallback statement analysis failed.', error.message);
    }

    const notes = toSafeString(parsed?.notes || rawResponse);
    const verdict = ensureVerdict(parsed?.verdict, [], [], { requireEvidence: false });

    const result = {
        statement,
        verdict,
        supportingFacts: [],
        contradictingFacts: [],
        notes: notes || 'No additional context provided.',
        facts: [],
        rules: [],
        analysisSource: 'llm'
    };

    if (log) {
        const noteWithSource = notes
            ? `${notes} (LLM analysis without RAG)`
            : 'LLM analysis without RAG';
        await logAssessment(client, {
            targetType: 'statement',
            targetReference: statement,
            statement,
            verdict,
            supportingFacts: [],
            contradictingFacts: [],
            notes: noteWithSource,
            analysisSource: 'llm'
        });
    }

    return result;
}

async function analyzeDocumentWithoutRag({ document, mode, llmAgent, client, maxHighlights, log = true }) {
    const prompt = [
        'You are VeritasAI. The structured knowledge base is currently empty or unavailable.',
        'Provide a best-effort review of the document using general reasoning.',
        '',
        `Mode: ${mode}`,
        'Document:',
        '"""',
        document,
        '"""',
        '',
        `Return JSON with this structure:`,
        '{',
        '  "verdict": "supported|contradicted|mixed|insufficient",',
        '  "notes": "short narrative explanation for the user"',
        '}',
        `If you cannot reach a conclusion, return verdict "insufficient".`
    ].join('\n');

    let parsed = null;
    let rawResponse = '';
    try {
        rawResponse = await llmAgent.complete({ prompt, temperature: 0.2 });
        parsed = extractJsonPayload(rawResponse);
    } catch (error) {
        console.error('Fallback document analysis failed.', error.message);
    }

    const notes = toSafeString(parsed?.notes || rawResponse);
    const verdict = ensureVerdict(parsed?.verdict, [], [], { requireEvidence: false });

    const result = {
        document,
        verdict,
        supportingFacts: [],
        contradictingFacts: [],
        notes: notes || 'No additional context provided.',
        facts: [],
        rules: [],
        analysisSource: 'llm'
    };

    if (log) {
        const noteWithSource = notes
            ? `${notes} (LLM analysis without RAG)`
            : 'LLM analysis without RAG';
        await logAssessment(client, {
            targetType: 'document',
            targetReference: document.slice(0, 140),
            statement: document.slice(0, 280),
            verdict,
            supportingFacts: [],
            contradictingFacts: [],
            notes: noteWithSource,
            analysisSource: 'llm'
        });
    }

    return result;
}

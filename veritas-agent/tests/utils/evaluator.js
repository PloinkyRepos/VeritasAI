import { getTestLLMAgent } from './llm.js';

function extractJsonPayload(raw) {
    if (!raw || typeof raw !== 'string') {
        throw new Error('LLM response was empty.');
    }

    const blockMatch = raw.match(/```json\s*([\s\S]*?)```/i);
    const candidate = blockMatch ? blockMatch[1] : raw.trim();

    try {
        return JSON.parse(candidate);
    } catch (error) {
        throw new Error(`Failed to parse LLM evaluation response as JSON: ${error.message}\nRaw response:\n${raw}`);
    }
}

export async function evaluateExpectations({ title, output, expectations, strict = true }) {
    if (!Array.isArray(expectations) || !expectations.length) {
        throw new Error(`Test "${title}" did not provide any expectations for evaluation.`);
    }

    const llmAgent = getTestLLMAgent();
    const description = [
        'You are validating the output of an automated test for the VeritasAI platform.',
        'Review the provided skill output and confirm whether all required expectations were satisfied.',
        'Respond with a JSON object inside a ```json``` code block using the schema:',
        '{ "status":"pass|fail", "score":0-1, "summary":"string", "missing":["..."], "notes":["..."] }',
        'Mark status "pass" only if every expectation is clearly met in the output.',
        strict ? 'If there is any doubt about an expectation, mark the test as fail and list the missing items.' : 'If uncertain, err on the side of passing and note ambiguities in "notes".'
    ].join('\n');

    const expectationList = expectations.map((item, index) => `${index + 1}. ${item}`).join('\n');
    const userMessage = [
        `Test Case: ${title}`,
        'Expectations:',
        expectationList,
        '',
        'Skill Output:',
        typeof output === 'string' ? output : JSON.stringify(output, null, 2)
    ].join('\n');

    const response = await llmAgent.doTask(
        { intent: 'test-evaluation', title },
        description,
        {
            mode: 'precision',
            history: [{ role: 'user', message: userMessage }]
        }
    );

    const parsed = extractJsonPayload(response);
    if (!parsed || (parsed.status !== 'pass' && parsed.status !== 'fail')) {
        throw new Error(`LLM evaluation returned an unexpected payload:\n${response}`);
    }

    if (parsed.status !== 'pass') {
        const missing = Array.isArray(parsed.missing) && parsed.missing.length
            ? `Missing: ${parsed.missing.join('; ')}`
            : '';
        const notes = Array.isArray(parsed.notes) && parsed.notes.length
            ? `Notes: ${parsed.notes.join('; ')}`
            : '';
        const summary = parsed.summary ? `Summary: ${parsed.summary}` : '';
        throw new Error(
            [`Evaluation marked test "${title}" as FAIL.`, summary, missing, notes]
                .filter(Boolean)
                .join(' ')
        );
    }

    return parsed;
}

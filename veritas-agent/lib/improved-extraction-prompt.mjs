/**
 * Improved LLM extraction prompt for VeritasAI
 *
 * This module patches the extraction prompt to include:
 * 1. Skill context (description, what it does)
 * 2. Argument descriptions (not just names)
 * 3. Better examples (positional, natural, structured)
 * 4. Original task description for context
 */

/**
 * Build an improved argument section with descriptions
 */
function buildImprovedArgumentSection(context, includeOptional = false) {
    const lines = [];
    const missingRequired = context.missingRequired();
    const optionalMissing = includeOptional ? context.missingOptional() : [];

    if (missingRequired.length) {
        lines.push('Required arguments:');
        for (const name of missingRequired) {
            const def = context.argumentDefinitions.find(d => d.name === name);
            const desc = def?.description || '';
            const samples = context.getOptionSamples(name, 5);
            const sampleText = samples.length ? ` (options: ${samples.join(', ')})` : '';
            lines.push(`  • ${name}: ${desc}${sampleText}`);
        }
    }

    if (optionalMissing.length) {
        lines.push('');
        lines.push('Optional arguments:');
        for (const name of optionalMissing) {
            const def = context.argumentDefinitions.find(d => d.name === name);
            const desc = def?.description || '';
            const samples = context.getOptionSamples(name, 5);
            const sampleText = samples.length ? ` (options: ${samples.join(', ')})` : '';
            lines.push(`  • ${name}: ${desc}${sampleText}`);
        }
    }

    return lines.join('\n');
}

/**
 * Build generic examples using actual argument names and descriptions
 */
function buildGenericExamples(context) {
    const requiredArgs = context.missingRequired();
    if (requiredArgs.length === 0) {
        return '';
    }

    const lines = [];
    
    // Build examples using actual argument names as placeholders
    const placeholders = requiredArgs.map(name => `<${name}>`);
    
    lines.push('');
    lines.push('## Format Examples');
    lines.push('');
    lines.push('### Positional Format');
    lines.push(`User: "... ${placeholders.join(' ')}"`);
    lines.push('Extract:');
    for (const name of requiredArgs) {
        lines.push(`  - ${name}: <value_from_user>`);
    }
    
    lines.push('');
    lines.push('### Explicit Key-Value Format');
    const kvExample = requiredArgs.map(name => `${name} <value>`).join(' ');
    lines.push(`User: "${kvExample}"`);
    lines.push('Extract:');
    for (const name of requiredArgs) {
        lines.push(`  - ${name}: <value_from_user>`);
    }
    
    lines.push('');
    lines.push('### Natural Language');
    lines.push('User describes what they want in conversational English');
    lines.push('Extract: Any argument values explicitly mentioned');

    return lines.join('\n');
}

/**
 * Create enhanced extraction prompt (fully dynamic, no hardcoded examples)
 */
export function buildEnhancedExtractionPrompt(context, userMessage, { taskDescription = '' } = {}) {
    const existingValues = JSON.stringify(context.normalizedArgs, null, 2);
    const argumentSection = buildImprovedArgumentSection(context, true);
    const skillName = context.skill?.name || 'unknown';
    const skillDesc = context.skill?.humanDescription || context.skill?.description || '';
    const genericExamples = buildGenericExamples(context);

    const prompt = [
        '# Extract Argument Values',
        '',
        '## Task Context',
        `Skill: ${skillName}`,
        skillDesc ? `Purpose: ${skillDesc}` : null,
        taskDescription ? `Original request: "${taskDescription}"` : null,
        '',
        '## Current State',
        `Arguments: ${existingValues}`,
        '',
        argumentSection ? `## ${argumentSection}` : null,
        '',
        '## Instructions',
        '1. Extract ONLY values explicitly stated by the user',
        '2. Output format: Markdown bullet list `- argument_name: value`',
        '3. Use snake_case for argument names exactly as shown above',
        '4. DO NOT invent, guess, or use placeholder values like "your_value" or "value1"',
        '5. If a value is not explicitly mentioned, DO NOT include it in response',
        '6. If no changes needed, reply with `- result: none`',
        '7. Values should be taken from user message as-is (preserve formatting)',
        genericExamples,
        '',
        '## Common Patterns',
        '',
        '### Positional (values in sequence)',
        'Extract values in the order they appear, matching to required arguments',
        '',
        '### Explicit (key=value or key: value)',
        'Look for argument names followed by values',
        '',
        '### Natural language',
        'Identify arguments from conversational context',
        '',
        '### Corrections',
        'When user says "change X to Y" or "set X as Y", extract just the updates',
        '',
        '## Critical Rules',
        '',
        '❌ NEVER use placeholders like "your_name", "value1", "TBD"',
        '❌ NEVER invent values the user did not state',
        '❌ NEVER include command keywords (create, add, new) as argument values',
        '✅ ONLY extract what the user explicitly said',
        '✅ If unsure, omit the argument (better to prompt than to guess wrong)',
        '',
        '## Parse This User Message',
        `"${userMessage}"`,
    ].filter(x => x !== null).join('\n');

    return prompt;
}

/**
 * Enhanced extraction wrapper that uses improved prompt
 */
export async function extractArgumentsWithEnhancedPrompt(llmAgent, context, userMessage, options = {}) {
    if (!llmAgent) {
        return {};
    }

    const { taskDescription = '' } = options;
    const prompt = buildEnhancedExtractionPrompt(context, userMessage, { taskDescription });

    const history = [];
    if (taskDescription) {
        history.push({ role: 'system', message: `Initial context: ${taskDescription}` });
    }
    history.push({ role: 'user', message: userMessage });

    const raw = await llmAgent.complete({
        prompt,
        history,
        mode: 'fast',
        context: { intent: 'skill-argument-extraction', skillName: context.skill?.name },
    });

    const keyValues = llmAgent.parseMarkdownKeyValues(raw);
    const updates = {};

    for (const [key, value] of Object.entries(keyValues)) {
        if (!value) {
            continue;
        }
        if (key === 'result' && value.toLowerCase() === 'none') {
            continue;
        }
        const match = context.argumentDefinitions.find(def => def.name.toLowerCase() === key.toLowerCase());
        const targetName = match ? match.name : key;
        updates[targetName] = value;
    }

    return updates;
}

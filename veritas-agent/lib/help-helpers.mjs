/**
 * Help system utilities for the VeritasAI agent
 * Extracted from orchestratorAgent.mjs to support the show-help skill
 */

/**
 * Extract a friendly summary from a skill definition
 * @param {Object} skill - Skill definition object
 * @returns {string} Friendly summary text
 */
export function extractFriendlySummary(skill) {
    if (!skill) {
        return '';
    }

    const candidates = [
        skill.humanDescription,
        skill.description,
        skill.what,
        skill.why,
    ].map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean);

    const rawSummary = candidates[0] || '';

    const sentencePattern = /(?<=\.)\s+/; // split on sentence boundaries while keeping punctuation
    const sentences = rawSummary ? rawSummary.split(sentencePattern).filter(Boolean) : [];
    const filteredSentences = sentences.length
        ? sentences.filter((sentence) => !/persisto/i.test(sentence))
        : [];

    const summary = filteredSentences.join(' ').trim() || rawSummary.replace(/persisto/ig, '').replace(/\s{2,}/g, ' ').trim();

    if (summary) {
        return summary;
    }

    if (skill.what && typeof skill.what === 'string') {
        return skill.what.trim();
    }

    if (skill.name && typeof skill.name === 'string') {
        return `Ask the assistant to ${skill.name.replace(/[-_]+/g, ' ')}`.trim();
    }

    return 'Ask the assistant for help with this task.';
}

/**
 * Generate example prompts for a skill
 * @param {Object} skill - Skill definition object
 * @returns {Array<string>} Array of example prompt strings
 */
export function generateExamplePrompts(skill) {
    const name = (skill.name || '').toLowerCase();
    const humanDesc = skill.humanDescription || skill.description || '';

    const exampleMap = {
        'upload-rules': [
            'Upload the latest compliance rules and related facts from audit_rules.json',
            'Add these new safety policies and evidence to the knowledge base'
        ],
        'rank-statements': [
            'Rank the five most relevant knowledge base statements for the Q3 security report',
            'Given this incident summary, list the top 3 applicable policies'
        ],
        'audit-statement': [
            'Audit the claim "All vendors completed security training last month"',
            'Check if the statement "Backups run every 4 hours" is supported'
        ],
        'challenge-statement': [
            'Find evidence that disproves "No production outages occurred in May"',
            'Challenge the statement "We operate solely in the EU"'
        ],
        'validate-statement': [
            'Validate the statement "Incident response plans were updated in 2024"',
            'Find supporting evidence for "Access reviews happen quarterly"'
        ],
        'audit-document': [
            'Audit this policy PDF for supported and contradicted statements',
            'Provide a support vs contradiction report for the attached compliance memo'
        ],
        'challenge-document': [
            'List the facts that conflict with this quarterly report',
            'Show contradictions between the knowledge base and this onboarding guide'
        ],
        'validate-document': [
            'Find the facts that back up this risk assessment',
            'Highlight the evidence that supports this draft policy'
        ],
        'show-help': [
            'What can VeritasAI help me with?',
            'Show the available knowledge base operations'
        ]
    };

    for (const [key, examples] of Object.entries(exampleMap)) {
        if (name.includes(key)) {
            return examples;
        }
    }

    if (humanDesc) {
        return [`${humanDesc}`];
    }

    return [];
}

/**
 * Print available actions for a user, optionally filtered by query
 * @param {Object} agent - Agent instance with listSkillsForRole method
 * @param {Object} user - User object with roles array
 * @param {string} query - Optional search query to filter results
 */
export function printAvailableActions(agent, user, query = '') {
    if (!user || !user.roles || !user.roles.length) {
        console.log('Authenticate with "authenticate <name> as <role>" to see available actions.');
        return;
    }

    let allSkills = new Set();
    
    // Collect skills from all user's roles
    for (const role of user.roles) {
        try {
            const roleSkills = agent.listSkillsForRole(role);
            roleSkills.forEach(skill => {
                // Use skill name as key to avoid duplicates
                allSkills.add(JSON.stringify(skill));
            });
        } catch (error) {
            // Role might not have any skills
        }
    }
    
    let skills = Array.from(allSkills).map(s => JSON.parse(s));

    const trimmedQuery = typeof query === 'string' ? query.trim().toLowerCase() : '';
    if (trimmedQuery) {
        skills = skills.filter((skill) => {
            const nameMatch = skill.name.toLowerCase().includes(trimmedQuery);
            const desc = skill.description ? skill.description.toLowerCase() : '';
            return nameMatch || desc.includes(trimmedQuery);
        });
    }

    if (!skills.length) {
        if (trimmedQuery) {
            console.log(`I didn't find anything for "${query}" in your available actions.`);
        } else {
            console.log(`I don't have any ready-made tasks for your roles yet.`);
        }
        return;
    }

    // Markdown-formatted output (rendered in webchat, readable in terminal)
    const heading = trimmedQuery
        ? `# 🔍 Matching Actions for "${query}"`
        : `# 📋 Available Actions`;

    console.log(heading);
    console.log('');
    console.log(`**Your roles:** ${user.roles.join(', ')}`);
    console.log('');

    // Display each skill with Markdown formatting
    for (const skill of skills) {
        const summary = extractFriendlySummary(skill);
        const requiredArgs = skill.requiredArguments || [];
        const examples = generateExamplePrompts(skill);
        
        console.log(`## ${summary}`);
        console.log('');
        
        // Show what it does
        if (skill.why) {
            console.log(`**Why:** ${skill.why}`);
            console.log('');
        }
        
        // Show required information
        if (requiredArgs.length > 0) {
            const args = skill.arguments || {};
            const reqArgsList = requiredArgs.map(argName => {
                const argDef = args[argName];
                const desc = argDef?.description || argName;
                return `\`${argName}\` (${desc})`;
            }).join(', ');
            console.log(`**Required:** ${reqArgsList}`);
            console.log('');
        }
        
        // Show example prompts
        if (examples.length > 0) {
            console.log(`**Examples:**`);
            examples.forEach(ex => console.log(`- ${ex}`));
            console.log('');
        }
        
        console.log('');  // Extra blank line before HR to separate blocks
        console.log('---');
        console.log('');  // Extra blank line after HR to separate blocks
    }

    if (!trimmedQuery) {
        console.log('💡 **Tip:** Just describe what you want to do in natural language!');
        console.log('');
        console.log('Examples: *"check inventory levels"*, *"create a job for Smith Construction"*');
        console.log('');
    }
}

/**
 * Print authentication help message with available roles
 * @param {Array} availableRoles - Array of role objects with id and label
 */
export function printAuthenticationHelp(availableRoles) {
    console.log('Authenticate with `authenticate <name> as <role>` before issuing tasks.');
    const roleList = formatRoleList(availableRoles);
    if (roleList) {
        console.log(`Known roles: ${roleList}.`);
    }
}

/**
 * Format role list as comma-separated string
 * @param {Array} availableRoles - Array of role objects
 * @returns {string} Formatted role list
 */
export function formatRoleList(availableRoles) {
    if (!Array.isArray(availableRoles) || availableRoles.length === 0) {
        return '';
    }

    const labels = availableRoles
        .map((entry) => typeof entry?.label === 'string' ? entry.label.trim() : '')
        .filter(Boolean);

    return labels.join(', ');
}

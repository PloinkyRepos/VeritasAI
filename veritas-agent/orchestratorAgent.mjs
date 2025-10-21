#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readdir } from 'node:fs/promises';

import { SkilledAgent, LLMAgent } from 'ploinkyAgentLib';
import {
    getSkillServices,
    setSkillServices,
    ensurePersistoSchema as ensurePersistoSchemaRuntime
} from './lib/runtime.mjs';
import { initLlamaIndex } from './lib/llamaindex-context.mjs';
import { resolveArgumentOptions } from './lib/argument-options.mjs';
import {
    getSkillDiscoveryLogger,
    getAuditLogger,
    getNoMatchLogger,
    initializeLogging
} from './lib/file-logger.mjs';
import {
    printAvailableActions,
    printAuthenticationHelp,
    extractFriendlySummary,
    generateExamplePrompts,
    formatRoleList
} from './lib/help-helpers.mjs';
import { createPromptReader } from './lib/prompt-reader.mjs';
import { initializeStrategies, getStrategy } from './lib/strategy-registry.mjs';
// import { extractArgumentsWithEnhancedPrompt } from './lib/improved-extraction-prompt.mjs'; // TODO: Needs proper integration

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SKILLS_DIRECTORY = path.resolve(__dirname, 'skills');
const SESSION_KEY = 'orchestratorAgent.session';

// Create LLMAgent instance
const llmAgent = new LLMAgent({
    name: 'VeritasAI-LLM',
});

// Create SkilledAgent with the LLMAgent instance and processing indicator callbacks
const agent = new SkilledAgent({
    name: 'VeritasAI',
    llmAgent,
    promptReader: createPromptReader,  // Use custom prompt reader to disable echo in PTY
    onProcessingStart: () => {
        // Output dots pattern that webchat recognizes as "processing"
        // The webchat client will detect this pattern and show the typing animation
        process.stdout.write('. . . . .\n');
    },
    onProcessingEnd: () => {
        // The typing indicator will be hidden automatically when the next real output
        // (like skill selection results or prompts) is written to stdout.
        // No action needed here to avoid interfering with the output stream.
    }
});
const baseServices = {
    ...getSkillServices(),
    llmAgent,
    getStrategy
};

try {
    const llamaIndexContext = await initLlamaIndex();
    baseServices.llamaIndex = llamaIndexContext;
    console.log('[LlamaIndex] Initialized', llamaIndexContext.models);
} catch (error) {
    console.warn('[LlamaIndex] Initialization skipped:', error.message);
}

setSkillServices(baseServices);
const roleDirectory = new Map();

// Make agent available globally for help skill
globalThis.__veritasAgent = agent;

function ensureSessionStorage() {
    if (globalThis.sessionStorage && typeof globalThis.sessionStorage.getItem === 'function') {
        return globalThis.sessionStorage;
    }

    const store = new Map();
    const storage = {
        getItem(key) {
            return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
            store.set(String(key), String(value));
        },
        removeItem(key) {
            store.delete(String(key));
        },
        clear() {
            store.clear();
        },
        key(index) {
            if (typeof index !== 'number' || index < 0) {
                return null;
            }
            const keys = Array.from(store.keys());
            return keys[index] ?? null;
        },
        get length() {
            return store.size;
        }
    };

    globalThis.sessionStorage = storage;
    return storage;
}

function parseCliArguments() {
    const args = process.argv.slice(2);
    const ssoArgs = {
        username: null,
        userId: null,
        email: null,
        roles: []
    };

    for (const arg of args) {
        if (arg.startsWith('--sso-user=')) {
            ssoArgs.username = arg.substring('--sso-user='.length);
        } else if (arg.startsWith('--sso-user-id=')) {
            ssoArgs.userId = arg.substring('--sso-user-id='.length);
        } else if (arg.startsWith('--sso-email=')) {
            ssoArgs.email = arg.substring('--sso-email='.length);
        } else if (arg.startsWith('--sso-roles=')) {
            const rolesStr = arg.substring('--sso-roles='.length);
            ssoArgs.roles = rolesStr.split(',').map(r => r.trim()).filter(Boolean);
        }
    }

    return (ssoArgs.username && ssoArgs.roles.length > 0) ? ssoArgs : null;
}

function normalizeSkillSpec(rawSpec = {}, moduleName) {
    if (typeof rawSpec !== 'object' || rawSpec === null) {
        throw new TypeError(`Skill specs from ${moduleName} must be an object.`);
    }

    const description = typeof rawSpec.description === 'string' && rawSpec.description.trim()
        ? rawSpec.description.trim()
        : typeof rawSpec.humanDescription === 'string' && rawSpec.humanDescription.trim()
            ? rawSpec.humanDescription.trim()
            : typeof rawSpec.what === 'string' && rawSpec.what.trim()
                ? rawSpec.what.trim()
                : `Skill ${rawSpec.name || moduleName}`;

    const normalizedArguments = {};

    if (rawSpec.arguments && typeof rawSpec.arguments === 'object' && !Array.isArray(rawSpec.arguments)) {
        for (const [name, definition] of Object.entries(rawSpec.arguments)) {
            const trimmedName = typeof name === 'string' ? name.trim() : '';
            if (!trimmedName) {
                continue;
            }
            if (typeof definition === 'object' && definition !== null) {
                normalizedArguments[trimmedName] = { ...definition };
            } else {
                normalizedArguments[trimmedName] = { description: String(definition) };
            }
        }
    }

    const requiredArguments = Array.isArray(rawSpec.requiredArguments)
        ? rawSpec.requiredArguments.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)
        : [];

    const sanitized = {
        ...rawSpec,
        name: rawSpec.name,
        description,
        arguments: normalizedArguments,
        requiredArguments,
    };

    return sanitized;
}

function registerRoles(roleList = []) {
    if (!Array.isArray(roleList)) {
        return;
    }

    for (const role of roleList) {
        if (typeof role !== 'string') {
            continue;
        }
        const trimmed = role.trim();
        if (!trimmed) {
            continue;
        }
        const id = trimmed.toLowerCase();
        if (!roleDirectory.has(id)) {
            roleDirectory.set(id, { id, label: trimmed });
        }
    }
}

function listAvailableRoles() {
    return Array.from(roleDirectory.values()).sort((a, b) => a.label.localeCompare(b.label));
}

agent.listAvailableRoles = listAvailableRoles;

// Helper to normalize option entries
function normalizeOptions(options) {
    if (!Array.isArray(options)) {
        return [];
    }
    const normalized = [];
    for (const entry of options) {
        if (entry == null) {
            continue;
        }
        if (typeof entry === 'string') {
            normalized.push({ value: entry, label: entry });
            continue;
        }
        if (typeof entry === 'object') {
            const value = Object.prototype.hasOwnProperty.call(entry, 'value') ? entry.value : entry;
            if (value == null) {
                continue;
            }
            const label = Object.prototype.hasOwnProperty.call(entry, 'label') ? entry.label : String(value);
            normalized.push({ value, label });
            continue;
        }
        normalized.push({ value: entry, label: String(entry) });
    }
    return normalized;
}

function buildOptionsResolver(skillModule = {}) {
    const specFactory = typeof skillModule.specs === 'function' ? skillModule.specs : null;
    if (!specFactory) {
        return async () => ({});
    }

    return async () => {
        const specDefinition = specFactory();
        const args = specDefinition?.arguments;

        if (!args || typeof args !== 'object') {
            return {};
        }

        const providers = {};
        const result = {};

        for (const [argumentName, definition] of Object.entries(args)) {
            // Handle enumerator property directly in the argument definition
            if (typeof definition?.enumerator === 'function') {
                try {
                    const rawOptions = definition.enumerator();
                    result[argumentName] = normalizeOptions(rawOptions);
                } catch (error) {
                    console.warn(`Failed to call enumerator for '${argumentName}':`, error.message);
                    result[argumentName] = [];
                }
                continue;
            }

            // Handle type='%providerName' pattern
            const typeName = typeof definition?.type === 'string' ? definition.type : '';
            if (typeName.startsWith('%')) {
                const providerName = typeName.slice(1);
                const provider = skillModule[providerName];
                if (typeof provider !== 'function') {
                    throw new Error(`Skill '${specDefinition?.name || 'unknown'}' is missing options provider '${providerName}' for argument '${argumentName}'.`);
                }
                providers[providerName] = provider;
            }
        }

        // Resolve %provider-based options
        const providerOptions = await resolveArgumentOptions(specDefinition, providers);

        // Merge enumerator-based and provider-based options
        return { ...result, ...providerOptions };
    };
}

async function registerSkills(agentInstance) {
    const files = await readdir(SKILLS_DIRECTORY, { withFileTypes: true });
    roleDirectory.clear();

    for (const entry of files) {
        if (!entry.isFile() || !entry.name.endsWith('.mjs')) {
            continue;
        }

        const filePath = path.join(SKILLS_DIRECTORY, entry.name);
        const moduleUrl = pathToFileURL(filePath).href;
        let skillModule;

        try {
            skillModule = await import(moduleUrl);
        } catch (error) {
            console.warn(`Failed to load skill module ${entry.name}: ${error.message}`);
            continue;
        }

        const { specs: specFactory, roles, action, ...additionalExports } = skillModule;
        if (typeof specFactory !== 'function' || typeof action !== 'function') {
            console.warn(`Skipping ${entry.name}: missing specs() or action().`);
            continue;
        }

        let normalizedSpecs;
        try {
            normalizedSpecs = normalizeSkillSpec(specFactory(), entry.name);
        } catch (error) {
            console.warn(`Skipping ${entry.name}: ${error.message}`);
            continue;
        }

        const roleList = typeof roles === 'function'
            ? roles().filter(value => typeof value === 'string' && value.trim())
            : [];

        registerRoles(roleList);

        const optionsResolver = buildOptionsResolver(skillModule);

        // Add VeritasAI-specific argument aliases if defined in the skill module
        const argumentAliases = typeof skillModule.argumentAliases === 'function'
            ? skillModule.argumentAliases()
            : (skillModule.argumentAliases && typeof skillModule.argumentAliases === 'object'
                ? skillModule.argumentAliases
                : null);

        const skillConfig = {
            ...additionalExports,
            specs: normalizedSpecs,
            roles: roleList,
            action,
            getOptions: optionsResolver,
            ...(argumentAliases && { argumentAliases }),
        };

        try {
            agentInstance.registerSkill(skillConfig);
        } catch (error) {
            console.warn(`Unable to register skill from ${entry.name}: ${error.message}`);
        }
    }
}

function updateSkillContext(user, task) {
    setSkillServices({
        ...baseServices,
        user: user ? { ...user } : null,
        task: typeof task === 'string' ? task : ''
    });
}

function loadSession() {
    const storage = ensureSessionStorage();
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.username === 'string') {
            // Support both old single-role and new multi-role format
            if (Array.isArray(parsed.roles) && parsed.roles.length > 0) {
                return parsed;  // New multi-role format
            } else if (typeof parsed.role === 'string') {
                // Convert old single-role format to new format
                return {
                    username: parsed.username,
                    roles: [parsed.role]
                };
            }
        }
    } catch (error) {
        console.warn(`Ignoring invalid session: ${error.message}`);
    }
    storage.removeItem(SESSION_KEY);
    return null;
}

function persistSession(user) {
    const storage = ensureSessionStorage();
    if (user) {
        storage.setItem(SESSION_KEY, JSON.stringify(user));
    } else {
        storage.removeItem(SESSION_KEY);
    }
}

function parseAuthenticationCommand(value) {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    const lower = trimmed.toLowerCase();
    if (!lower.startsWith('authenticate ')) {
        return null;
    }

    const remainder = trimmed.slice('authenticate '.length);
    const marker = remainder.toLowerCase().lastIndexOf(' as ');
    if (marker === -1) {
        return null;
    }

    const username = remainder.slice(0, marker).trim();
    const role = remainder.slice(marker + 4).trim();

    if (!username || !role) {
        return null;
    }

    return { username, role };
}

function resolveRole(roleInput, availableRoles) {
    const normalized = typeof roleInput === 'string' ? roleInput.trim().toLowerCase() : '';
    if (!normalized) {
        return null;
    }

    if (!Array.isArray(availableRoles) || availableRoles.length === 0) {
        return null;
    }

    return availableRoles.find((entry) => {
        if (!entry) {
            return false;
        }
        if (entry.id === normalized) {
            return true;
        }
        const labelMatch = typeof entry.label === 'string' && entry.label.trim().toLowerCase() === normalized;
        return labelMatch;
    }) || null;
}

async function executeSkill(skillName, user, taskDescription) {
    updateSkillContext(user, taskDescription);
    const auditLogger = getAuditLogger();

    try {
        const skillDefinition = agent.getSkill(skillName);
        const result = await agent.useSkill(skillName, { args: {}, taskDescription });

        // Audit successful execution
        try {
            await auditLogger.logExecution({
                user,
                taskDescription,
                skill: skillName,
                arguments: {},
                result,
                success: true
            });
        } catch (logError) {
            if (process.env.LLMAgentClient_DEBUG === 'true') {
                console.warn('Failed to log execution:', logError.message);
            }
        }
        // Only show result in debug mode - skills provide their own user-friendly messages
        if (process.env.LLMAgentClient_DEBUG === 'true' && typeof result !== 'undefined') {
            console.log('[DEBUG] Skill result:', typeof result === 'string' ? result : JSON.stringify(result, null, 2));
        }
    } catch (error) {
        const message = typeof error?.message === 'string' ? error.message : '';
        const lower = message.toLowerCase();
        const cancelled = lower.includes('cancelled by user');
        const is404 = lower.includes('status 404');
        const is403 = lower.includes('status 403');
        const is401 = lower.includes('status 401');
        const is500 = lower.includes('status 500');
        const isValidation = lower.includes('must be') ||
            lower.includes('required') ||
            lower.includes('invalid') ||
            lower.includes('cannot') ||
            lower.includes('should be');

        // Audit cancellation or failure
        if (cancelled) {
            try {
                await auditLogger.logCancellation({
                    user,
                    taskDescription,
                    skill: skillName,
                    arguments: {},
                    reason: 'user_cancelled'
                });
            } catch (logError) {
                if (process.env.LLMAgentClient_DEBUG === 'true') {
                    console.warn('Failed to log cancellation:', logError.message);
                }
            }
            console.log('Okay, cancelled. Nothing was changed.');
        } else {
            // Log execution failure
            try {
                await auditLogger.logExecution({
                    user,
                    taskDescription,
                    skill: skillName,
                    arguments: {},
                    result: { error: message },
                    success: false
                });
            } catch (logError) {
                if (process.env.LLMAgentClient_DEBUG === 'true') {
                    console.warn('Failed to log execution failure:', logError.message);
                }
            }

            if (is404 || lower.includes('not found')) {
                console.error(`I couldn’t find what was needed to finish '${skillName}'. Please double-check and try again.`);
            } else if (is403 || is401 || lower.includes('unauthorized')) {
                console.error('Your account doesn’t have permission to do that. Ask a System Administrator if you need access.');
            } else if (is500) {
                console.error('The backend service returned an internal error. Please try again in a moment.');
            } else {
                console.error(`I ran into a problem with '${skillName}': ${message || 'unexpected error.'}`);
                if (isValidation) {
                    console.log('Tip: You can try again with corrected values, or type "cancel" to start over.');
                }
            }
        }
    } finally {
        updateSkillContext(user, '');
    }
}

async function interactiveLoop(initialUser) {
    let user = (initialUser && typeof initialUser.username === 'string' && Array.isArray(initialUser.roles) && initialUser.roles.length > 0)
        ? { ...initialUser }
        : null;

    if (user) {
        updateSkillContext(user, '');
        const rolesList = user.roles.join(', ');
        console.log(`🔐 Authenticated as ${user.username} via SSO`);
        console.log(`   Roles: ${rolesList}`);
        console.log(`Type 'help' to see available actions, 'logout' to clear, or 'exit' to quit.`);
    } else {
        updateSkillContext(null, '');
        persistSession(null);
        printAuthenticationHelp(agent.listAvailableRoles());
    }

    while (true) {
        const rawInput = await agent.readUserPrompt('');
        const taskDescription = typeof rawInput === 'string' ? rawInput.trim() : '';
        if (!taskDescription) {
            continue;
        }

        const lower = taskDescription.toLowerCase();

        if (lower === 'quit' || lower === 'exit') {
            console.log('Exiting.');
            return 'exit';
        }

        if (lower === 'cancel') {
            console.log('Okay, ready for your next request.');
            continue;
        }

        if (lower === 'logout') {
            if (user) {
                console.log('Authentication cleared.');
                user = null;
                persistSession(null);
                updateSkillContext(null, '');
                printAuthenticationHelp(agent.listAvailableRoles());
            } else {
                console.log('No user is currently authenticated.');
            }
            continue;
        }

        // Help is now handled as a skill (show-help.mjs)
        // Removed hardcoded help keyword handling to support natural language variants

        const authRequest = parseAuthenticationCommand(taskDescription);
        if (authRequest) {
            const trimmedUsername = authRequest.username.trim();
            if (!trimmedUsername) {
                console.log('Authentication requires a name.');
                continue;
            }

            const availableRoles = agent.listAvailableRoles();
            const resolvedRole = resolveRole(authRequest.role, availableRoles);
            if (!resolvedRole) {
                const roleList = formatRoleList(availableRoles);
                if (roleList) {
                    console.log(`Unknown role '${authRequest.role}'. Known roles: ${roleList}.`);
                } else {
                    console.log(`Unknown role '${authRequest.role}'. No roles are currently registered.`);
                }
                continue;
            }

            user = {
                username: trimmedUsername,
                roles: [resolvedRole.label || authRequest.role.trim()],
            };
            persistSession(user);
            updateSkillContext(user, '');
            console.log(`Authenticated as ${user.username} (${user.roles[0]}).`);
            continue;
        }

        if (!user) {
            printAuthenticationHelp(agent.listAvailableRoles());
            continue;
        }

        let selectedSkill;
        const skillDiscoveryLogger = getSkillDiscoveryLogger();
        const noMatchLogger = getNoMatchLogger();
        const startTime = Date.now();

        try {
            const ranked = await agent.rankSkill(taskDescription, {
                limit: 5,
                roles: user.roles,
                verbose: true,
                startTime: startTime
            });

            // rankSkill returns an object like { "skill-name": rank, ... }
            // Use LLM to choose the best skill from the ranked results
            selectedSkill = null;
            if (ranked && typeof ranked === 'object' && !Array.isArray(ranked)) {
                const skillNames = Object.keys(ranked);
                if (skillNames.length > 0) {
                    // Use chooseSkillWithLLM to let the LLM select the best skill
                    selectedSkill = await agent.chooseSkillWithLLM(ranked, {
                        query: taskDescription,
                        mode: 'fast'
                    });

                    // If LLM returns 'none', no skill is appropriate
                    if (selectedSkill === 'none') {
                        selectedSkill = null;
                    }
                }
            }

            // Log skill discovery when LLM chooses a skill
            if (selectedSkill) {
                try {
                    await skillDiscoveryLogger.logDiscovery({
                        user,
                        taskDescription,
                        selectedSkill,
                        rankedSkills: Object.keys(ranked || {}) // All ranked skills
                    });
                } catch (logError) {
                    if (process.env.LLMAgentClient_DEBUG === 'true') {
                        console.warn('Failed to log skill discovery:', logError.message);
                    }
                }
            }
        } catch (error) {
            // Log failed skill discovery attempt
            try {
                await noMatchLogger.logNoMatch({
                    user,
                    taskDescription,
                    attemptedSkills: [],
                    reason: 'skill_ranking_error'
                });
            } catch (logError) {
                if (process.env.LLMAgentClient_DEBUG === 'true') {
                    console.warn('Failed to log no-match:', logError.message);
                }
            }
            console.error("I'm not sure how to help with that. Could you rephrase or try something else?");
            continue;
        }

        if (!selectedSkill) {
            // Log when no skill matches the request
            try {
                await noMatchLogger.logNoMatch({
                    user,
                    taskDescription,
                    attemptedSkills: [],
                    reason: 'no_matching_skill'
                });
            } catch (logError) {
                if (process.env.LLMAgentClient_DEBUG === 'true') {
                    console.warn('Failed to log no-match:', logError.message);
                }
            }
            console.log('No matching skill found for that request.');
            continue;
        }

        if (process.env.LLMAgentClient_DEBUG === 'true') {
            console.log(`Using skill '${selectedSkill}'.`);
        }

        await executeSkill(selectedSkill, user, taskDescription);
    }
}

async function main() {
    ensureSessionStorage();

    // Initialize logging system
    try {
        await initializeLogging();
    } catch (error) {
        console.warn('Warning: Failed to initialize logging system:', error.message);
    }

    initializeStrategies();
    // TODO: Enhanced extraction prompt integration
    // The improved-extraction-prompt.mjs is ready but needs proper integration
    // into ploinkyAgentLib's executor. For now, relying on the built-in extraction
    // with better enumerator support.

    await registerSkills(agent);
/*    try {
        await ensurePersistoSchemaRuntime();
    } catch (error) {
        if (process.env.LLMAgentClient_DEBUG === 'true') {
            console.warn(`Failed to verify Persisto schema: ${error.message}`);
        } else {
            console.log('Skipping schema verification because the data service is unavailable.');
        }
    }*/

    // Try CLI arguments first (for webchat sessions with SSO)
    let user = null;
    const cliAuth = parseCliArguments();
    if (cliAuth) {
        const availableRoles = agent.listAvailableRoles();
        const validRoles = [];

        // Validate all roles from CLI args
        for (const ssoRole of cliAuth.roles) {
            const resolved = resolveRole(ssoRole, availableRoles);
            if (resolved) {
                validRoles.push(resolved.label || ssoRole);
            }
        }

        if (validRoles.length > 0) {
            user = {
                username: cliAuth.username,
                roles: validRoles
            };
            if (cliAuth.userId) user.id = cliAuth.userId;
            if (cliAuth.email) user.email = cliAuth.email;
        } else {
            console.error(`⚠️  User ${cliAuth.username} has no valid VeritasAI roles.`);
            console.error(`   Provided roles: ${cliAuth.roles.join(', ')}`);
            console.error(`   Available: ${availableRoles.map(r => r.label).join(', ')}`);
        }
    }

    // Fall back to session restore if no CLI args
    if (!user) {
        user = loadSession();
        if (user) {
            const rolesList = user.roles.join(', ');
            console.log(`Restored session for ${user.username} (${rolesList}).`);
        }
    }

    await interactiveLoop(user);
    persistSession(null);
    updateSkillContext(null, '');
}

main().catch((error) => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
});

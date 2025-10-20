import { loadSchema } from './skills-helpers.mjs';

const DEFAULT_SERVER_HOST = process.env.PERSISTO_HOST || 'localhost';
const DEFAULT_SERVER_PORT = process.env.PERSISTO_PORT || '3000';
const SERVER_URL = process.env.PERSISTO_URL || `http://${DEFAULT_SERVER_HOST}:${DEFAULT_SERVER_PORT}`;

let PersistoClient;
try {
    const module = await import('ploinkyAgentLib/utils/PersistoClient.mjs');
    PersistoClient = module.default || module;
} catch (error) {
    const fallbackUrl = new URL('../../persisto/src/PersistoClient.cjs', import.meta.url);
    const module = await import(fallbackUrl);
    PersistoClient = module.default || module;
}

let cachedClient;
let cachedServices;


function getPersistoClient() {
    if (!cachedClient) {
        cachedClient = new PersistoClient(SERVER_URL);
    }
    return cachedClient;
}

function createLogger() {
    const debugEnabled = process.env.LLMAgentClient_DEBUG === 'true';
    return async (level, event, payload) => {
        const safeLevel = level && typeof level === 'string' ? level.toLowerCase() : 'info';
        if (!debugEnabled && (safeLevel === 'warn' || safeLevel === 'error')) {
            return;
        }
        const message = `[${safeLevel}] ${event || 'skill-event'}`;
        if (safeLevel === 'error' || safeLevel === 'warn') {
            console.warn(message, payload || '');
        } else {
            console.log(message, payload || '');
        }
    };
}

function createAudit() {
    return async () => {
        // No-op default audit reporter for standalone skill execution.
    };
}

export function setSkillServices(services) {
    cachedServices = services;
    globalThis.__veritasSkillServices = services;
}

export function getSkillServices() {
    if (globalThis.__veritasSkillServices) {
        return globalThis.__veritasSkillServices;
    }
    if (!cachedServices) {
        cachedServices = {
            client: getPersistoClient(),
            logger: createLogger(),
            audit: createAudit(),
            user: null,
            task: ''
        };
    }
    return cachedServices;
}

function normalizeTypeNameFromMethod(methodName) {
    const match = typeof methodName === 'string' ? methodName.match(/^create([A-Z].*)$/) : null;
    if (!match) {
        return null;
    }
    const raw = match[1];
    if (!raw) {
        return null;
    }
    return raw.charAt(0).toLowerCase() + raw.slice(1);
}

function isAlreadyExistsError(error) {
    if (!error) {
        return false;
    }
    const message = typeof error.message === 'string' ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('status 500') && message.includes('error executing command')) {
        return true;
    }
    return message.includes('already exists') || message.includes('exists already') || message.includes('duplicate') || message.includes('function');
}

function isIgnorableTypeError(error) {
    if (!error) {
        return false;
    }
    if (isAlreadyExistsError(error)) {
        return true;
    }
    const message = typeof error.message === 'string' ? error.message.toLowerCase() : String(error).toLowerCase();
    return message.includes('status 500') && message.includes('error executing command');
}

function isIgnorableIndexError(error) {
    if (!error) {
        return false;
    }
    if (isAlreadyExistsError(error)) {
        return true;
    }
    const message = typeof error.message === 'string' ? error.message.toLowerCase() : String(error).toLowerCase();
    return message.includes('status 500') && message.includes('error executing command');
}

export async function ensurePersistoSchema() {
    const { client, logger } = getSkillServices();
    const schema = await loadSchema();
    const types = schema.types || {};
    const indexes = schema.indexes || {};
    const groupings = schema.groupings || {};

    const existingTypeNames = new Set();
    try {
        const methods = await client.getAllMethods();
        if (Array.isArray(methods)) {
            for (const metadata of methods) {
                const typeName = normalizeTypeNameFromMethod(metadata?.methodName);
                if (typeName) {
                    existingTypeNames.add(typeName);
                }
            }
        }
    } catch (error) {
        await logger?.('warn', 'ensure-schema-methods-unavailable', { error: error.message });
    }

    const createdTypes = [];
    const updatedTypes = [];
    const skippedTypes = [];
    for (const [typeName, definition] of Object.entries(types)) {
        if (existingTypeNames.has(typeName)) {
            continue;
        }

        try {
            await client.addType({ [typeName]: definition });
            createdTypes.push(typeName);
        } catch (error) {
            if (isIgnorableTypeError(error)) {
                skippedTypes.push(typeName);
                if (process.env.LLMAgentClient_DEBUG === 'true') {
                    await logger?.('warn', 'ensure-schema-type-skipped', { typeName, error: error.message });
                }
                continue;
            }
            await logger?.('error', 'ensure-schema-type-failed', { typeName, error: error.message });
            throw new Error(`Failed to ensure Persisto type '${typeName}': ${error.message}`);
        }
    }

    const createdIndexes = [];
    const skippedIndexes = [];
    for (const [typeName, fieldName] of Object.entries(indexes)) {
        if (!fieldName) {
            continue;
        }

        try {
            await client.execute('createIndex', typeName, fieldName);
            createdIndexes.push(`${typeName}.${fieldName}`);
        } catch (error) {
            if (isIgnorableIndexError(error)) {
                skippedIndexes.push(`${typeName}.${fieldName}`);
                if (process.env.LLMAgentClient_DEBUG === 'true') {
                    await logger?.('warn', 'ensure-schema-index-skipped', { typeName, fieldName, error: error.message });
                }
                continue;
            }
            await logger?.('error', 'ensure-schema-index-failed', { typeName, fieldName, error: error.message });
            throw new Error(`Failed to ensure Persisto index '${typeName}.${fieldName}': ${error.message}`);
        }
    }

    const createdGroupings = [];
    const skippedGroupings = [];
    for (const [typeName, definitions] of Object.entries(groupings)) {
        if (!Array.isArray(definitions) || !definitions.length) {
            continue;
        }

        for (const definition of definitions) {
            const groupingName = definition?.name;
            const fieldName = definition?.field;

            if (!groupingName || !fieldName) {
                continue;
            }

            try {
                await client.execute('createGrouping', groupingName, typeName, fieldName);
                createdGroupings.push(`${groupingName}:${typeName}.${fieldName}`);
            } catch (error) {
                if (isAlreadyExistsError(error)) {
                    skippedGroupings.push(`${groupingName}:${typeName}.${fieldName}`);
                    if (process.env.LLMAgentClient_DEBUG === 'true') {
                        await logger?.('warn', 'ensure-schema-grouping-skipped', { groupingName, typeName, fieldName, error: error.message });
                    }
                    continue;
                }
                await logger?.('error', 'ensure-schema-grouping-failed', { groupingName, typeName, fieldName, error: error.message });
                throw new Error(`Failed to ensure Persisto grouping '${groupingName}' for ${typeName}.${fieldName}: ${error.message}`);
            }
        }
    }

    if (process.env.LLMAgentClient_DEBUG === 'true') {
        if (createdTypes.length || updatedTypes.length || createdIndexes.length || createdGroupings.length) {
            console.log(`Ensured schema. Types created: ${createdTypes.join(', ') || 'none'}. Updated: ${updatedTypes.join(', ') || 'none'}. Indexes created: ${createdIndexes.join(', ') || 'none'}. Groupings created: ${createdGroupings.join(', ') || 'none'}.`);
        }
    }

    return {
        createdTypes,
        updatedTypes,
        createdIndexes,
        createdGroupings,
        skippedTypes,
        skippedIndexes,
        skippedGroupings
    };
}

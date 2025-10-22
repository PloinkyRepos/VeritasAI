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

function createDefaultServices(overrides = {}) {
    const workspaceDir = process.cwd();
    const base = {
        client: null,
        logger: createLogger(),
        audit: createAudit(),
        ragService: null,
        llmAgent: null,
        user: null,
        task: '',
        workspaceDir
    };
    return { ...base, ...overrides };
}

let cachedServices = null;

function assignServices(services) {
    cachedServices = services;
    globalThis.__veritasSkillServices = services;
    return services;
}

export function setSkillServices(services = {}) {
    return assignServices(createDefaultServices(services));
}

export function getSkillServices() {
    if (globalThis.__veritasSkillServices) {
        cachedServices = globalThis.__veritasSkillServices;
        return cachedServices;
    }
    if (!cachedServices) {
        assignServices(createDefaultServices());
    }
    return cachedServices;
}

export function resetSkillServices() {
    cachedServices = null;
    if (globalThis.__veritasSkillServices) {
        delete globalThis.__veritasSkillServices;
    }
}

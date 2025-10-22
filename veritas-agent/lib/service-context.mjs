function createLogger() {
    const debugEnabled = process.env.LLMAgentClient_DEBUG === 'true';
    return async (level, event, payload) => {
        const safeLevel = typeof level === 'string' ? level.toLowerCase() : 'info';
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
        // Default audit reporter is a no-op; callers can override via setServices().
    };
}

function createDefaultServices(overrides = {}) {
    const base = {
        client: null,
        logger: createLogger(),
        audit: createAudit(),
        ragService: null,
        llmAgent: null,
        user: null,
        task: '',
        workspaceDir: process.cwd()
    };
    return { ...base, ...overrides };
}

function ensureServices(initializer) {
    if (!globalThis.__veritasServices) {
        const seed = typeof initializer === 'function' ? initializer() : createDefaultServices();
        globalThis.__veritasServices = seed;
    }
    return globalThis.__veritasServices;
}

export function getServices() {
    return ensureServices();
}

export function setServices(services = {}) {
    const merged = createDefaultServices(services);
    globalThis.__veritasServices = merged;
    return merged;
}

export function updateServices(updates = {}) {
    const existing = ensureServices();
    Object.assign(existing, updates);
    return existing;
}

export function resetServices() {
    delete globalThis.__veritasServices;
    return ensureServices();
}

export function withServices(initializer) {
    return ensureServices(initializer);
}

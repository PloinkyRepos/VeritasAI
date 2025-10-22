import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';

import { getServices } from './service-context.mjs';
import { getStrategy } from './strategy-registry.mjs';
import {
    ensureUploadsRegisteredFromTask,
    resolveUploadedFile
} from './upload-registry.mjs';

const STRATEGY_PREFERENCE = ['default', 'simple-llm', 'mock'];

export function resolveStrategy(preferredNames = []) {
    const candidates = Array.isArray(preferredNames) ? preferredNames.filter(Boolean) : [];
    for (const name of candidates) {
        const strategy = getStrategy(name);
        if (strategy) {
            return strategy;
        }
    }
    for (const name of STRATEGY_PREFERENCE) {
        const strategy = getStrategy(name);
        if (strategy) {
            return strategy;
        }
    }
    throw new Error('No registered strategy is available for this skill.');
}

export function getLlmAgentOrThrow() {
    const agent = globalThis.__veritasAgent;
    const llmAgent = agent?.llmAgent || getServices().llmAgent;
    if (!llmAgent || typeof llmAgent.doTask !== 'function') {
        throw new Error('LLM agent is unavailable. Configure an LLM invoker to run this skill.');
    }
    return llmAgent;
}

export function tryGetLlmAgent() {
    const agent = globalThis.__veritasAgent;
    const llmAgent = agent?.llmAgent || getServices().llmAgent;
    if (llmAgent && typeof llmAgent.doTask === 'function') {
        return llmAgent;
    }
    return null;
}

export async function resolveResourceInput(value) {
    if (typeof value !== 'string') {
        return { resourceURL: null, text: '' };
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return { resourceURL: null, text: '' };
    }

    const services = getServices();
    const workspaceDir = services?.workspaceDir || process.cwd();
    if (services?.task) {
        ensureUploadsRegisteredFromTask(services.task, { workspaceDir });
    }
    const registeredUpload = resolveUploadedFile(trimmed);
    if (registeredUpload?.path) {
        try {
            const text = await readFile(registeredUpload.path, 'utf8');
            return { resourceURL: registeredUpload.path, text };
        } catch {
            // Fall back to legacy resolution paths.
        }
    }

    if (!trimmed.includes('\n') && trimmed.length < 512) {
        try {
            const resolved = path.resolve(trimmed);
            const stats = await stat(resolved);
            if (stats.isFile()) {
                const text = await readFile(resolved, 'utf8');
                return { resourceURL: resolved, text };
            }
        } catch {
            // Treat as inline content when file lookup fails
        }
    }

    return { resourceURL: null, text: trimmed };
}

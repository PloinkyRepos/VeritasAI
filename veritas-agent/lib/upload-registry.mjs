import path from 'node:path';

import { toSafeString } from './rag-helpers.mjs';

const UPLOAD_MARKER = '[[uploaded-file]]';
const DEFAULT_BLOBS_DIR = 'blobs';

const registry = new Map();

function normalizeKey(value) {
    if (value === null || value === undefined) {
        return '';
    }
    const stringValue = typeof value === 'string' ? value : String(value);
    const trimmed = stringValue.trim();
    if (!trimmed) {
        return '';
    }
    return trimmed.toLowerCase();
}

function getWorkspaceDir(preferred) {
    if (preferred && typeof preferred === 'string' && preferred.trim()) {
        return preferred.trim();
    }
    if (process.env.PLOINKY_WORKSPACE_DIR && process.env.PLOINKY_WORKSPACE_DIR.trim()) {
        return process.env.PLOINKY_WORKSPACE_DIR.trim();
    }
    return process.cwd();
}

function stripPrefix(line) {
    if (typeof line !== 'string') {
        return '';
    }
    const trimmed = line.trimStart();
    if (trimmed.startsWith(':')) {
        return trimmed.slice(1).trimStart();
    }
    if (trimmed.startsWith('#')) {
        return trimmed.slice(1).trimStart();
    }
    return trimmed;
}

export function parseUploadMarkers(taskText) {
    if (!taskText || typeof taskText !== 'string') {
        return [];
    }

    return taskText
        .split(/\r?\n/)
        .map(line => stripPrefix(line))
        .filter(line => line.startsWith(UPLOAD_MARKER))
        .map(line => {
            const jsonPart = line.slice(UPLOAD_MARKER.length).trim();
            if (!jsonPart) {
                return null;
            }
            try {
                const parsed = JSON.parse(jsonPart);
                if (!parsed || typeof parsed !== 'object') {
                    return null;
                }
                const safeId = toSafeString(parsed.id);
                const safeName = toSafeString(parsed.name) || null;
                const safeUrl = toSafeString(parsed.url) || null;
                const safeMime = toSafeString(parsed.mime) || null;
                const size = typeof parsed.size === 'number' && Number.isFinite(parsed.size)
                    ? parsed.size
                    : null;
                return safeId
                    ? {
                        id: safeId,
                        name: safeName,
                        url: safeUrl,
                        mime: safeMime,
                        size
                    }
                    : null;
            } catch {
                return null;
            }
        })
        .filter(Boolean);
}

function buildRecord(entry = {}, options = {}) {
    const workspaceDir = getWorkspaceDir(options.workspaceDir);
    const blobsDir = options.blobsDir || DEFAULT_BLOBS_DIR;

    const record = {
        id: entry.id || null,
        name: entry.name || null,
        url: entry.url || null,
        mime: entry.mime || null,
        size: entry.size ?? null,
        workspaceDir,
        path: null,
        aliases: []
    };

    const candidatePaths = [];

    if (entry.path) {
        candidatePaths.push(entry.path);
    }
    if (entry.localPath) {
        candidatePaths.push(entry.localPath);
    }
    if (entry.url && typeof entry.url === 'string' && !/^[a-z]+:\/\//i.test(entry.url)) {
        const sanitizedUrl = entry.url.replace(/^\/+/, '');
        candidatePaths.push(path.join(workspaceDir, sanitizedUrl));
    }
    if (entry.id) {
        candidatePaths.push(path.join(workspaceDir, blobsDir, entry.id));
    }

    for (const candidate of candidatePaths) {
        if (!candidate || typeof candidate !== 'string') {
            continue;
        }
        const resolved = path.isAbsolute(candidate)
            ? candidate
            : path.resolve(workspaceDir, candidate);
        if (!record.path) {
            record.path = resolved;
        }
    }

    const aliasSet = new Set(options.aliases || []);
    const potentialAliases = [
        record.id,
        record.name,
        record.url,
        record.path,
        record.name ? path.basename(record.name) : null,
        record.url ? path.basename(record.url) : null,
        record.path ? path.basename(record.path) : null
    ];

    for (const value of potentialAliases) {
        const key = normalizeKey(value);
        if (key) {
            aliasSet.add(key);
        }
    }

    record.aliases = Array.from(aliasSet);
    return record;
}

export function registerUploadedEntries(entries = [], options = {}) {
    if (!Array.isArray(entries) || !entries.length) {
        return;
    }

    for (const entry of entries) {
        if (!entry || (typeof entry !== 'object' && typeof entry !== 'string')) {
            continue;
        }

        const normalizedEntry = typeof entry === 'string'
            ? { id: toSafeString(entry) }
            : entry;

        const record = buildRecord(normalizedEntry, options);
        if (!record.id && !record.name && !record.path) {
            continue;
        }

        for (const alias of record.aliases) {
            registry.set(alias, record);
        }
    }
}

export function ensureUploadsRegisteredFromTask(taskText, options = {}) {
    if (!taskText || typeof taskText !== 'string') {
        return [];
    }
    const entries = parseUploadMarkers(taskText);
    if (entries.length) {
        registerUploadedEntries(entries, options);
    }
    return entries;
}

export function resolveUploadedFile(identifier) {
    const key = normalizeKey(identifier);
    if (!key) {
        return null;
    }
    if (registry.has(key)) {
        return registry.get(key);
    }
    const baseKey = normalizeKey(path.basename(identifier));
    if (baseKey && registry.has(baseKey)) {
        return registry.get(baseKey);
    }
    return null;
}

export function getRegisteredUploads() {
    const unique = new Set();
    const results = [];
    for (const record of registry.values()) {
        if (!record) {
            continue;
        }
        if (unique.has(record)) {
            continue;
        }
        unique.add(record);
        results.push(record);
    }
    return results;
}

export {
    UPLOAD_MARKER
};

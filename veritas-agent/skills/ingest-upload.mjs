import fs from 'node:fs/promises';
import path from 'node:path';

import { getSkillServices } from '../lib/runtime.mjs';
import { toSafeString } from '../lib/rag-helpers.mjs';

const UPLOAD_MARKER = '[[uploaded-file]]';

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

function parseUploadMarkers(taskText) {
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
                return typeof parsed === 'object' && parsed !== null ? parsed : null;
            } catch (_) {
                return null;
            }
        })
        .filter(Boolean)
        .map((entry) => ({
            id: toSafeString(entry.id),
            name: toSafeString(entry.name),
            url: toSafeString(entry.url),
            size: typeof entry.size === 'number' ? entry.size : null,
            mime: toSafeString(entry.mime)
        }))
        .filter(entry => entry.id);
}

function isTextLikeFile({ mime, name }) {
    const lowered = (mime || '').toLowerCase();
    if (lowered.startsWith('text/')) return true;
    if (['application/json', 'application/xml'].includes(lowered)) return true;
    if (!lowered && name) {
        const ext = path.extname(name).toLowerCase();
        return ['.txt', '.md', '.json', '.csv', '.log', '.yaml', '.yml'].includes(ext);
    }
    return false;
}

async function loadDocumentFromBlob(workspaceDir, entry, DocumentCtor) {
    if (!entry.id) {
        throw new Error('Blob entry is missing an id.');
    }
    const blobPath = path.join(workspaceDir, 'blobs', entry.id);
    let content;
    if (isTextLikeFile(entry)) {
        content = await fs.readFile(blobPath, 'utf8');
    } else {
        throw new Error(`Unsupported file type for ingestion: ${entry.mime || entry.name || entry.id}`);
    }

    const metadata = {
        blobId: entry.id,
        filename: entry.name || null,
        sourceUrl: entry.url || null,
        mime: entry.mime || null,
        size: entry.size || content.length
    };

    if (DocumentCtor) {
        return new DocumentCtor({ text: content, metadata });
    }
    return { text: content, metadata };
}

export function specs() {
    return {
        name: 'ingest-upload',
        description: 'Indexes newly uploaded files into the Veritas knowledge base using LlamaIndex.',
        humanDescription: 'Process an uploaded file and add it to the RAG index.',
        what: 'Reads uploaded file content from the blobs directory and rebuilds the LlamaIndex vector store.',
        needConfirmation: false,
        arguments: {
            blobId: {
                description: 'Specific blob identifier to ingest. Defaults to the most recent upload detected in the request.',
                type: 'string'
            }
        }
    };
}

export function roles() {
    return ['sysAdmin'];
}

export async function action({ blobId } = {}) {
    const services = getSkillServices();
    const { llamaIndex, task, logger } = services;

    if (!llamaIndex) {
        throw new Error('LlamaIndex context is unavailable.');
    }

    const uploads = parseUploadMarkers(task);
    let targetEntries = uploads;

    if (blobId) {
        const safeId = toSafeString(blobId);
        targetEntries = uploads.filter(entry => entry.id === safeId);
        if (!targetEntries.length) {
            targetEntries = [{ id: safeId, name: null, url: null, mime: null }];
        }
    }

    if (!targetEntries.length) {
        throw new Error('No uploaded file metadata found. Provide a blobId or upload a file in the same request.');
    }

    const documents = [];
    const failures = [];

    for (const entry of targetEntries) {
        try {
            const document = await loadDocumentFromBlob(llamaIndex.workspaceDir, entry, llamaIndex.Document);
            documents.push(document);
        } catch (error) {
            failures.push({ id: entry.id, error: error.message });
            await logger?.('warn', 'ingest-upload-failed', { id: entry.id, error: error.message });
        }
    }

    if (!documents.length) {
        throw new Error('None of the files could be ingested.');
    }

    await llamaIndex.createIndex(documents);

    console.log('# Upload ingested');
    for (const document of documents) {
        const meta = document.metadata || {};
        console.log(`- Indexed blob ${meta.blobId || 'unknown'}${meta.filename ? ` (${meta.filename})` : ''}`);
    }

    if (failures.length) {
        console.log('\nFailed entries:');
        for (const failure of failures) {
            console.log(`- ${failure.id}: ${failure.error}`);
        }
    }

    return {
        success: true,
        ingested: documents.length,
        failures
    };
}

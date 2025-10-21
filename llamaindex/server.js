#!/usr/bin/env node
/*
 * LlamaIndex MCP server entrypoint.
 *
 * This module mirrors the semantics of the default AgentServer but expects
 * tooling metadata to be provided programmatically instead of via JSON config
 * files. Tool/resource/prompt definitions live in `./toolkit.js`, allowing the
 * agent to wire any llama-index helpers without modifying the server.
 */

'use strict';

const http = require('node:http');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let z;

async function loadSdkDeps() {
    const { streamHttp, mcp, types, zod } = await import('mcp-sdk');
    if (!z) {
        z = zod.z;
    }
    return {
        McpServer: mcp.McpServer,
        ResourceTemplate: mcp.ResourceTemplate,
        StreamableHTTPServerTransport: streamHttp.StreamableHTTPServerTransport,
        isInitializeRequest: types.isInitializeRequest,
        McpError: types.McpError,
        ErrorCode: types.ErrorCode
    };
}

async function loadToolkit() {
    const defaults = { tools: [], resources: [], prompts: [] };
    const toolkitPath = path.resolve(__dirname, 'toolkit.js');
    try {
        const imported = await import(pathToFileURL(toolkitPath).href);
        const factory = imported.createToolkit || imported.default || imported.toolkit || imported.getToolkit;
        if (!factory) {
            console.warn('[llamaindex/mcp] toolkit.js missing `createToolkit` export; using empty toolkit.');
            return defaults;
        }
        const value = await factory({ env: process.env });
        if (!value || typeof value !== 'object') {
            console.warn('[llamaindex/mcp] toolkit factory returned invalid payload; using empty toolkit.');
            return defaults;
        }
        return {
            tools: Array.isArray(value.tools) ? value.tools : [],
            resources: Array.isArray(value.resources) ? value.resources : [],
            prompts: Array.isArray(value.prompts) ? value.prompts : []
        };
    } catch (err) {
        if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND') {
            console.warn('[llamaindex/mcp] No toolkit.js found; server will start without tools.');
            return defaults;
        }
        console.error('[llamaindex/mcp] Failed to load toolkit.js:', err);
        return defaults;
    }
}

function createLiteralUnionSchema(values) {
    if (!Array.isArray(values) || values.length === 0) return null;
    const unique = [...new Set(values)];
    if (unique.length === 1) return z.literal(unique[0]);
    return z.union(unique.map((entry) => z.literal(entry)));
}

function createFieldSchema(spec) {
    if (typeof spec === 'string') spec = { type: spec };
    if (!spec || typeof spec !== 'object') return z.any();

    const type = typeof spec.type === 'string' ? spec.type.toLowerCase() : 'string';
    let schema;

    switch (type) {
        case 'string': {
            if (Array.isArray(spec.enum) && spec.enum.every((value) => typeof value === 'string')) {
                schema = createLiteralUnionSchema(spec.enum) || z.string();
            } else {
                schema = z.string();
            }
            if (typeof spec.minLength === 'number') schema = schema.min(spec.minLength);
            if (typeof spec.maxLength === 'number') schema = schema.max(spec.maxLength);
            break;
        }
        case 'number': {
            schema = z.number();
            if (typeof spec.min === 'number') schema = schema.min(spec.min);
            if (typeof spec.max === 'number') schema = schema.max(spec.max);
            if (Array.isArray(spec.enum) && spec.enum.every((value) => typeof value === 'number')) {
                schema = createLiteralUnionSchema(spec.enum) || schema;
            }
            break;
        }
        case 'boolean':
            schema = z.boolean();
            break;
        case 'array': {
            const itemSchema = createFieldSchema(spec.items ?? { type: 'string' });
            schema = z.array(itemSchema);
            if (typeof spec.minItems === 'number') schema = schema.min(spec.minItems);
            if (typeof spec.maxItems === 'number') schema = schema.max(spec.maxItems);
            break;
        }
        case 'object': {
            const nested = buildZodObjectSchema(spec.properties) || z.object({});
            schema = spec.additionalProperties === true ? nested.passthrough() : nested;
            break;
        }
        default:
            schema = z.any();
    }

    if (spec.isArray && type !== 'array') {
        let arraySchema = z.array(schema);
        if (typeof spec.minItems === 'number') arraySchema = arraySchema.min(spec.minItems);
        if (typeof spec.maxItems === 'number') arraySchema = arraySchema.max(spec.maxItems);
        schema = arraySchema;
    }

    if (Array.isArray(spec.enum) && !['string', 'number'].includes(type)) {
        const unionSchema = createLiteralUnionSchema(spec.enum);
        if (unionSchema) schema = unionSchema;
    }

    if (spec.nullable) schema = schema.nullable();
    if (spec.optional) schema = schema.optional();
    if (typeof spec.description === 'string' && schema.describe) schema = schema.describe(spec.description);

    return schema ?? z.any();
}

function buildZodObjectSchema(shapeSpec) {
    if (!shapeSpec || typeof shapeSpec !== 'object') return null;
    const shape = {};
    let hasFields = false;
    for (const [key, schemaSpec] of Object.entries(shapeSpec)) {
        shape[key] = createFieldSchema(schemaSpec);
        hasFields = true;
    }
    return hasFields ? z.object(shape) : z.object({});
}

function asToolResponse(result) {
    if (!result) return { content: [] };
    if (typeof result === 'string') {
        return { content: [{ type: 'text', text: result }] };
    }
    if (Array.isArray(result)) {
        return { content: result };
    }
    if (result.content) return result;
    if (result.text) return { content: [{ type: 'text', text: String(result.text) }] };
    return { content: [] };
}

function registerToolkit(server, toolkit, helpers) {
    const { ResourceTemplate, McpError, ErrorCode } = helpers;

    for (const entry of toolkit.tools) {
        if (!entry || typeof entry !== 'object') continue;
        const name = typeof entry.name === 'string' ? entry.name : null;
        if (!name) {
            console.warn('[llamaindex/mcp] Skipping tool without name.');
            continue;
        }
        if (typeof entry.invoke !== 'function' && typeof entry.handler !== 'function') {
            console.warn(`[llamaindex/mcp] Tool '${name}' missing handler.`);
            continue;
        }
        const handlerFn = entry.invoke || entry.handler;
        const definition = {
            title: entry.title || name,
            description: entry.description || ''
        };

        const wrapped = async (input = {}, context = {}) => {
            try {
                const payload = {
                    input: input ?? {},
                    context: context ?? {},
                    server
                };
                const result = await handlerFn(payload);
                return asToolResponse(result);
            } catch (err) {
                const message = err?.message || String(err);
                console.error(`[llamaindex/mcp] Tool '${name}' failed:`, message);
                throw new McpError(ErrorCode.InternalError, message);
            }
        };

        const registered = server.registerTool(name, definition, wrapped);

        if (entry.inputSchema instanceof z.ZodType) {
            registered.inputSchema = entry.inputSchema;
        } else if (entry.inputSchema && typeof entry.inputSchema === 'object') {
            try {
                registered.inputSchema = buildZodObjectSchema(entry.inputSchema) || z.object({});
            } catch (err) {
                console.warn(`[llamaindex/mcp] Tool '${name}' input schema invalid:`, err.message);
            }
        }
        if (!registered.inputSchema) {
            registered.inputSchema = z.object({});
        }
    }

    for (const resource of toolkit.resources) {
        if (!resource || typeof resource !== 'object') continue;
        const name = typeof resource.name === 'string' ? resource.name : null;
        if (!name) {
            console.warn('[llamaindex/mcp] Skipping resource without name.');
            continue;
        }
        if (typeof resource.resolve !== 'function' && typeof resource.handler !== 'function') {
            console.warn(`[llamaindex/mcp] Resource '${name}' missing resolve function.`);
            continue;
        }
        const resolveFn = resource.resolve || resource.handler;
        const metadata = {
            title: resource.title || name,
            description: resource.description || '',
            mimeType: resource.mimeType || 'text/plain'
        };

        const wrapper = async (uriObj, params = {}) => {
            try {
                const response = await resolveFn({
                    uri: uriObj?.href || String(uriObj),
                    params,
                    server
                });
                if (!response) {
                    return { contents: [{ uri: uriObj?.href || '', text: '', mimeType: metadata.mimeType }] };
                }
                if (response.contents) return response;
                if (response.text) {
                    return {
                        contents: [{ uri: uriObj?.href || '', text: String(response.text), mimeType: metadata.mimeType }]
                    };
                }
                if (typeof response === 'string') {
                    return {
                        contents: [{ uri: uriObj?.href || '', text: response, mimeType: metadata.mimeType }]
                    };
                }
                return response;
            } catch (err) {
                const message = err?.message || String(err);
                console.error(`[llamaindex/mcp] Resource '${name}' failed:`, message);
                throw new McpError(ErrorCode.InternalError, message);
            }
        };

        if (typeof resource.template === 'string') {
            const params = {};
            for (const match of resource.template.matchAll(/\{([^}]+)\}/g)) {
                params[match[1]] = undefined;
            }
            const template = new ResourceTemplate(resource.template, params);
            server.registerResource(name, template, metadata, wrapper);
        } else if (typeof resource.uri === 'string') {
            server.registerResource(name, resource.uri, metadata, wrapper);
        } else {
            console.warn(`[llamaindex/mcp] Resource '${name}' missing uri/template.`);
        }
    }

    for (const prompt of toolkit.prompts) {
        if (!prompt || typeof prompt !== 'object') continue;
        const name = typeof prompt.name === 'string' ? prompt.name : null;
        if (!name) continue;
        if (!Array.isArray(prompt.messages) || prompt.messages.length === 0) {
            console.warn(`[llamaindex/mcp] Prompt '${name}' missing messages.`);
            continue;
        }
        server.registerPrompt(name, {
            description: prompt.description,
            messages: prompt.messages
        });
    }

    if (typeof server.setToolRequestHandlers === 'function') server.setToolRequestHandlers();
    if (typeof server.setResourceRequestHandlers === 'function') server.setResourceRequestHandlers();
    if (typeof server.setPromptRequestHandlers === 'function') server.setPromptRequestHandlers();
}

async function createServerInstance() {
    const helpers = await loadSdkDeps();
    const toolkit = await loadToolkit();
    const server = new helpers.McpServer({ name: 'llamaindex-mcp', version: '1.0.0' });
    await registerToolkit(server, toolkit, helpers);
    return { server, helpers };
}

async function main() {
    const PORT = Number.parseInt(process.env.PORT || '7000', 10);
    const sessions = new Map();
    const { StreamableHTTPServerTransport, isInitializeRequest } = await loadSdkDeps();

    const httpServer = http.createServer((req, res) => {
        const sendJson = (code, obj) => {
            const payload = Buffer.from(JSON.stringify(obj));
            res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': payload.length });
            res.end(payload);
        };

        const fail = (err) => {
            console.error('[llamaindex/mcp] HTTP error:', err);
            if (!res.headersSent) sendJson(500, { ok: false, error: 'internal server error' });
        };

        try {
            const url = new URL(req.url || '/', 'http://localhost');
            if (req.method === 'GET' && url.pathname === '/health') {
                return sendJson(200, { ok: true, server: 'llamaindex-mcp' });
            }

            if (req.method === 'POST' && url.pathname === '/mcp') {
                const chunks = [];
                req.on('data', (c) => chunks.push(c));
                req.on('end', async () => {
                    let body = {};
                    try {
                        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                    } catch (_) {
                        body = {};
                    }

                    const sessionId = req.headers['mcp-session-id'];
                    const entry = sessionId ? sessions.get(sessionId) : null;

                    try {
                        if (!entry) {
                            if (!isInitializeRequest(body)) {
                                return sendJson(400, {
                                    jsonrpc: '2.0',
                                    error: { code: -32000, message: 'Missing session; initialize first' },
                                    id: body?.id ?? null
                                });
                            }

                            const transport = new StreamableHTTPServerTransport({
                                sessionIdGenerator: () => randomUUID(),
                                enableJsonResponse: true
                            });
                            const { server } = await createServerInstance();
                            await server.connect(transport);

                            transport.onclose = () => {
                                try { server.close(); } catch (_) {}
                                const sid = transport.sessionId;
                                if (sid && sessions.has(sid)) sessions.delete(sid);
                            };

                            const sid = transport.sessionId;
                            if (sid) sessions.set(sid, { transport, server });
                            await transport.handleRequest(req, res, body);
                            return;
                        }

                        await entry.transport.handleRequest(req, res, body);
                    } catch (err) {
                        console.error('[llamaindex/mcp] request handling failed:', err);
                        if (!res.headersSent) {
                            sendJson(500, { jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: body?.id ?? null });
                        }
                    }
                });
                return;
            }

            res.statusCode = 404;
            res.end('Not Found');
        } catch (err) {
            fail(err);
        }
    });

    httpServer.listen(PORT, () => {
        console.log(`[llamaindex/mcp] listening on ${PORT} (POST /mcp)`);
    });
}

main().catch((err) => {
    console.error('[llamaindex/mcp] fatal error:', err);
    process.exit(1);
});

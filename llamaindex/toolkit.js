'use strict';

/**
 * Placeholder toolkit factory.
 *
 * Replace the empty arrays with llama-index powered tool/resource bindings in
 * the next step. The MCP server expects this module to expose either a
 * `createToolkit` function or a default export compatible with that shape.
 */

async function createToolkit(/* context */) {
    return {
        tools: [],
        resources: [],
        prompts: []
    };
}

module.exports = {
    createToolkit,
    default: createToolkit
};

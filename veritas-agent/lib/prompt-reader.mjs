#!/usr/bin/env node

/**
 * Custom prompt reader for the VeritasAI agent.
 *
 * This replaces the default readline promptReader to disable terminal echo
 * when running inside a PTY (like webchat), preventing duplicate messages.
 */

import readline from 'node:readline';

/**
 * Creates a prompt reader that disables echo to prevent duplicate messages in webchat
 * @param {string} message - The prompt message to display
 * @returns {Promise<string>} The user's input
 */
export function createPromptReader(message) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false  // Disable echo - critical for PTY environments like webchat
    });
    
    return new Promise((resolve) => {
        rl.question(message, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

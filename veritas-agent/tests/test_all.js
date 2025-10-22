import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

import { TestRunner } from './utils/test-runner.js';
import { registerStrategyTests } from './strategy/simple-llm-strategy.test.js';
import { registerSkillTests } from './skills/skill-tests.js';

async function ensureApiKey() {
    if (process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim()) {
        return;
    }

    if (!input.isTTY || !output.isTTY) {
        throw new Error('OPENAI_API_KEY is not set and interactive input is unavailable.');
    }

    const rl = createInterface({ input, output, terminal: true });
    try {
        const response = await rl.question('Enter OPENAI_API_KEY (input hidden not supported): ');
        const key = response.trim();
        if (!key) {
            throw new Error('OPENAI_API_KEY was not provided.');
        }
        process.env.OPENAI_API_KEY = key;
    } finally {
        rl.close();
        output.write('\n');
    }
}

async function main() {
    await ensureApiKey();

    const runner = new TestRunner();

    await registerStrategyTests(runner);
    await registerSkillTests(runner);

    const result = await runner.run();
    runner.exitOnCompletion(result);
}

main().catch(error => {
    console.error('Fatal error while running tests:', error);
    process.exitCode = 1;
});

import process from 'node:process';

class TestRunner {
    constructor() {
        this.tests = [];
        this.failures = [];
    }

    add(name, fn) {
        if (typeof name !== 'string' || !name.trim()) {
            throw new Error('Test name must be a non-empty string.');
        }
        if (typeof fn !== 'function') {
            throw new Error(`Test "${name}" must provide a function.`);
        }
        this.tests.push({ name: name.trim(), fn });
    }

    async run() {
        if (!this.tests.length) {
            console.log('No tests registered.');
            return { passed: 0, failed: 0 };
        }

        console.log(`# Running ${this.tests.length} test${this.tests.length === 1 ? '' : 's'}\n`);

        let passed = 0;
        for (const { name, fn } of this.tests) {
            const start = Date.now();
            try {
                console.log(`→ ${name}`);
                await fn();
                passed += 1;
                const duration = ((Date.now() - start) / 1000).toFixed(2);
                console.log(`  ✓ Passed (${duration}s)\n`);
            } catch (error) {
                const duration = ((Date.now() - start) / 1000).toFixed(2);
                console.error(`  ✗ Failed (${duration}s)`);
                console.error(`    ${error instanceof Error ? error.stack || error.message : String(error)}\n`);
                this.failures.push({ name, error });
            }
        }

        const summary = `Completed ${this.tests.length} test${this.tests.length === 1 ? '' : 's'}: ${passed} passed, ${this.failures.length} failed.`;
        console.log(summary);

        if (this.failures.length) {
            const failureNames = this.failures.map(({ name }) => ` - ${name}`).join('\n');
            console.log(`Failures:\n${failureNames}\n`);
        }

        return { passed, failed: this.failures.length };
    }

    exitOnCompletion(result) {
        const hasFailures = result.failed > 0;
        if (hasFailures) {
            process.exitCode = 1;
        }
    }
}

export {
    TestRunner
};

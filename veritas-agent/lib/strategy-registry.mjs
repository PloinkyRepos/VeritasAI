import { KnowledgeStore } from './knowledge-store.mjs';
import { SimpleLLmStrategy } from './strategies/simple-llm-strategy.mjs';
import { getSkillServices } from './runtime.mjs';

const strategies = new Map();
let defaultKnowledgeStore = null;
let simpleStrategyInstance = null;

function normalizeStrategyArgs(defaultSkillName, skillNameOrOptions, maybeOptions) {
    if (skillNameOrOptions && typeof skillNameOrOptions === 'object') {
        const options = skillNameOrOptions;
        const skillName = typeof options.skillName === 'string' && options.skillName.trim()
            ? options.skillName.trim()
            : defaultSkillName;
        return { skillName, options };
    }

    const skillName = typeof skillNameOrOptions === 'string' && skillNameOrOptions.trim()
        ? skillNameOrOptions.trim()
        : defaultSkillName;
    const options = (maybeOptions && typeof maybeOptions === 'object') ? maybeOptions : {};
    return { skillName, options };
}

class MockStrategy {
    async processStatement(skillNameOrOptions, maybeOptions, _taskDescription) {
        const { skillName, options } = normalizeStrategyArgs('mock-strategy', skillNameOrOptions, maybeOptions);
        // For now, just return the skill name for debugging purposes
        return { result: `Mock strategy for ${skillName}`, details: options };
    }
}

function registerStrategy(name, strategy) {
    if (!name || !strategy) {
        return;
    }
    strategies.set(name, strategy);
}

function getStrategy(name) {
    return strategies.get(name);
}

function initializeStrategies() {
    registerStrategy('mock', new MockStrategy());

    if (!defaultKnowledgeStore) {
        defaultKnowledgeStore = new KnowledgeStore();
    }

    const services = getSkillServices();
    if (!simpleStrategyInstance) {
        simpleStrategyInstance = new SimpleLLmStrategy({
            knowledgeStore: defaultKnowledgeStore,
            llmAgent: services?.llmAgent || null,
            logger: services?.logger || null
        });
    } else if (!simpleStrategyInstance.llmAgent && services?.llmAgent) {
        simpleStrategyInstance.llmAgent = services.llmAgent;
    }

    registerStrategy('simple-llm', simpleStrategyInstance);
    registerStrategy('default', simpleStrategyInstance);
}

export {
    initializeStrategies,
    getStrategy,
    registerStrategy
};

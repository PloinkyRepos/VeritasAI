const strategies = new Map();

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
    // Future strategies can be registered here
}

export {
    initializeStrategies,
    getStrategy,
    registerStrategy
};

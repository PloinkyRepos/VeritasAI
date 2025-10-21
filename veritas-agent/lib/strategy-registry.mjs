
const strategies = new Map();

class MockStrategy {
    async processStatement(skillName, _user, _taskDescription) {
        // For now, just return the skill name for debugging purposes
        return { result: `Mock strategy for ${skillName}` };
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

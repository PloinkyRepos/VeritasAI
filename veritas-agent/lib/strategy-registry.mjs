const strategies = new Map();

class MockStrategy {
    async processStatement(skillName, _user, _taskDescription) {
        // For now, just return the skill name for debugging purposes
        return { result: `Mock strategy for ${skillName}` };
    }
}

class RankingStrategy {
    async rankStatements(skillName, _user, _taskDescription) {
        // For now, just return the skill name for debugging purposes
        return { result: `Ranking strategy for ${skillName}` };
    }
}

class UploadStrategy {
    async uploadRulesAndFacts(skillName, _user, _taskDescription) {
        // For now, just return the skill name for debugging purposes
        return { result: `Upload strategy for ${skillName}` };
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
    registerStrategy('ranking', new RankingStrategy());
    registerStrategy('upload', new UploadStrategy());
    // Future strategies can be registered here
}

export {
    initializeStrategies,
    getStrategy,
    registerStrategy
};
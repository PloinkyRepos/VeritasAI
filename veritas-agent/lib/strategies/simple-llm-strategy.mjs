import {KnowledgeStore} from '../knowledge-store.mjs';
import {
    readResourceFile,
    extractAspectsWithLLM,
    generateCitationsWithLLM
} from './simple-llm-utils.mjs';

class SimpleLLmStrategy {
    constructor(options = {}) {
        const {knowledgeStore = null, llmAgent = null, logger = null} = options;
        this.knowledgeStore = knowledgeStore || new KnowledgeStore();
        this.llmAgent = llmAgent;
        this.logger = logger;
    }

    async detectRelevantAspectsFromSingleFile(resourceURL, statement = '') {
        const text = await readResourceFile(resourceURL, this.logger);
        return extractAspectsWithLLM(this, {
            resourceURL,
            statement,
            text,
            defaultType: 'fact'
        });
    }

    async storeRelevantAspectsFromSingleFile(resourceURL, statement = '') {
        const text = await readResourceFile(resourceURL, this.logger);
        const aspects = await extractAspectsWithLLM(this, {
            resourceURL,
            statement,
            text,
            defaultType: 'fact'
        });
        if (!aspects.length) {
            return [];
        }
        await this.knowledgeStore.mergeResource(resourceURL, aspects, {
            statement,
            defaultType: 'fact'
        });
        return aspects;
    }

    async detectRulesFromStatement(statement) {
        return extractAspectsWithLLM(this, {
            resourceURL: null,
            statement,
            text: statement,
            defaultType: 'rule'
        });
    }

    async getEvidencesForStatement(statement) {
        return generateCitationsWithLLM(this, statement, 'support');
    }

    async getChallengesForStatement(statement) {
        return generateCitationsWithLLM(this, statement, 'challenge');
    }
}

export {
    SimpleLLmStrategy
};

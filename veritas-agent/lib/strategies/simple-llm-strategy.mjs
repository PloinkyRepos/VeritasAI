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

    async storeRelevantAspectsFromSingleFile(resourceURL, statement = '', options = {}) {
        const { defaultSource = resourceURL || null, defaultType = 'fact' } = options;
        const text = await readResourceFile(resourceURL, this.logger);
        const aspects = await extractAspectsWithLLM(this, {
            resourceURL,
            statement,
            text,
            defaultType
        });
        if (!aspects.length) {
            return [];
        }
        const enriched = aspects.map(aspect => ({
            ...aspect,
            source: aspect.source || defaultSource
        }));
        await this.knowledgeStore.mergeResource(resourceURL, enriched, {
            statement,
            defaultType
        });
        return enriched;
    }

    async detectRulesFromStatement(statement) {
        return extractAspectsWithLLM(this, {
            resourceURL: null,
            statement,
            text: statement,
            defaultType: 'rule'
        });
    }

    async storeRelevantAspectsFromStatement(statement, options = {}) {
        const {
            resourceKey = null,
            defaultType = 'fact',
            defaultSource = null
        } = options || {};

        const aspects = await extractAspectsWithLLM(this, {
            resourceURL: null,
            statement,
            text: statement,
            defaultType
        });

        if (!aspects.length) {
            return [];
        }

        const enriched = aspects.map(aspect => ({
            ...aspect,
            source: aspect.source || defaultSource || null
        }));

        await this.knowledgeStore.mergeResource(resourceKey, enriched, {
            statement,
            defaultType
        });

        return enriched;
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

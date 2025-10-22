import { printAvailableActions } from '../lib/help-helpers.mjs';
import { getServices } from '../lib/service-context.mjs';

export function specs() {
    return {
        name: 'show-help',
        needConfirmation: false,
        description: 'Show, list, or display the actions VeritasAI can perform. View available knowledge base operations and their required inputs.',
        why: 'Gives users quick visibility into the investigative skills that are available for their roles.',
        what: 'Displays available actions and skills with short descriptions and example prompts, optionally filtered by a search term.',
        humanDescription: 'List the VeritasAI capabilities you can run.',
        arguments: {
            query: {
                type: 'string',
                description: 'Optional keyword to filter actions (e.g. "audit", "upload").'
            }
        },
        requiredArguments: []
    };
}

export function roles() {
    return ['sysAdmin'];
}

export async function action({ query } = {}) {
    const services = getServices();
    const user = services.user;

    if (!user || !Array.isArray(user.roles) || !user.roles.length) {
        console.log('Please authenticate to view the available actions.');
        return { success: false, reason: 'not_authenticated' };
    }

    const agent = globalThis.__veritasAgent;
    if (!agent) {
        console.error('Help system is currently unavailable.');
        return { success: false, reason: 'agent_unavailable' };
    }

    printAvailableActions(agent, user, query || '');
    return {
        success: true,
        filterApplied: Boolean(query),
        userRoles: user.roles
    };
}

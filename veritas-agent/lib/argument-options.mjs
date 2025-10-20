const OPTIONS_PREFIX = '%';

function normalizeOptions(options) {
    if (!Array.isArray(options)) {
        return [];
    }
    const normalized = [];
    for (const entry of options) {
        if (entry == null) {
            continue;
        }
        if (typeof entry === 'string') {
            normalized.push({ value: entry, label: entry });
            continue;
        }
        if (typeof entry === 'object') {
            const value = Object.prototype.hasOwnProperty.call(entry, 'value') ? entry.value : entry;
            if (value == null) {
                continue;
            }
            const label = Object.prototype.hasOwnProperty.call(entry, 'label') ? entry.label : String(value);
            normalized.push({ value, label });
            continue;
        }
        normalized.push({ value: entry, label: String(entry) });
    }
    return normalized;
}

export async function resolveArgumentOptions(specDefinition, providers = {}) {
    const args = specDefinition?.arguments;
    if (!args || typeof args !== 'object') {
        return {};
    }

    const result = {};
    for (const [argumentName, argumentSpec] of Object.entries(args)) {
        const typeName = typeof argumentSpec?.type === 'string' ? argumentSpec.type : '';
        if (typeName.startsWith(OPTIONS_PREFIX)) {
            const providerName = typeName.slice(1);
            const provider = providers?.[providerName];
            if (typeof provider !== 'function') {
                throw new Error(`Missing options provider '${providerName}' for argument '${argumentName}'.`);
            }
            // Allow providers to return strings or { value, label } objects.
            const rawOptions = await provider({ argument: argumentName, spec: argumentSpec });
            result[argumentName] = normalizeOptions(rawOptions);
        } else {
            result[argumentName] = [];
        }
    }
    return result;
}

export { normalizeOptions };

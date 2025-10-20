import { getSkillServices } from './runtime.mjs';

export function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : NaN;
}

export function parseBooleanInput(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    const token = normalizeString(value).toLowerCase();
    if (!token) {
        return null;
    }
    if (['true', 'yes', 'y', '1'].includes(token)) {
        return true;
    }
    if (['false', 'no', 'n', '0'].includes(token)) {
        return false;
    }
    return null;
}

async function fetchCollection(typeName, sortBy = 'name') {
    const { client } = getSkillServices();
    const result = await client.execute('select', typeName, {}, { sortBy });
    return result?.objects || [];
}

export async function fetchEquipment(sortBy = 'name') {
    return fetchCollection('equipment', sortBy);
}

export async function fetchMaterials(sortBy = 'name') {
    return fetchCollection('material', sortBy);
}

export function determineNextItemId(existingItems, prefix, padLength = 5) {
    let maxSequence = 0;
    for (const item of existingItems) {
        const source = normalizeString(item?.item_id);
        if (!source) {
            continue;
        }
        if (source.startsWith(prefix)) {
            const tail = source.slice(prefix.length);
            const parsed = Number.parseInt(tail, 10);
            if (!Number.isNaN(parsed) && parsed > maxSequence) {
                maxSequence = parsed;
                continue;
            }
        }
        const fallback = Number(source);
        if (Number.isFinite(fallback) && fallback > maxSequence) {
            maxSequence = fallback;
        }
    }
    const sequence = maxSequence + 1;
    const padded = String(sequence).padStart(padLength, '0');
    return `${prefix}${padded}`;
}

let jobsSnapshotPromise;

async function loadJobsSnapshot() {
    if (!jobsSnapshotPromise) {
        const pending = (async () => {
            const { client } = getSkillServices();
            const result = await client.execute('select', 'job', {}, { sortBy: 'job_id' });
            return result?.objects || [];
        })();

        jobsSnapshotPromise = pending.then(
            (jobs) => {
                jobsSnapshotPromise = null;
                return jobs;
            },
            (error) => {
                jobsSnapshotPromise = null;
                throw error;
            }
        );
    }
    return jobsSnapshotPromise;
}

export async function getJobOptions() {
    const jobs = await loadJobsSnapshot();
    const options = jobs.map(job => ({
        value: job.job_id,
        label: `${job.job_id}${job.job_name ? ` — ${job.job_name}` : ''}`.trim(),
        synonyms: [job.job_name, job.client_name].filter(Boolean)
    }));
    return { options, totalCount: options.length };
}

export async function resolveJobId(value) {
    const token = normalizeString(value);
    if (!token) {
        return null;
    }
    const { client } = getSkillServices();
    if (/^(\d{3})-(\d{4})$/.test(token)) {
        try {
            const res = await client.execute('select', 'job', { job_id: token });
            if (Array.isArray(res?.objects) && res.objects.length > 0) {
                return token;
            }
        } catch { }
    }
    try {
        const [byName, byClient] = await Promise.all([
            client.execute('select', 'job', { job_name: { contains: token, mode: 'insensitive' } }),
            client.execute('select', 'job', { client_name: { contains: token, mode: 'insensitive' } })
        ]);
        const pool = [...(byName?.objects || []), ...(byClient?.objects || [])];
        const map = new Map();
        for (const job of pool) {
            if (job?.job_id) {
                map.set(job.job_id, job);
            }
        }
        if (map.size === 1) {
            return Array.from(map.keys())[0];
        }
    } catch { }
    return null;
}

export async function presentJobId(value) {
    const id = normalizeString(value);
    if (!id) {
        return 'not provided';
    }
    const { client } = getSkillServices();
    try {
        const res = await client.execute('select', 'job', { job_id: id });
        const job = res?.objects?.[0];
        if (job) {
            return `${job.job_id}${job.job_name ? ` — ${job.job_name}` : ''}`.trim();
        }
    } catch { }
    return id;
}

let areaSnapshotPromise;

async function loadAreaSnapshot() {
    if (!areaSnapshotPromise) {
        const pending = (async () => {
            const { client } = getSkillServices();
            const [areasResult, locationsResult] = await Promise.allSettled([
                client.execute('select', 'area', {}, { sortBy: 'name' }),
                client.execute('select', 'location', {}, { sortBy: 'name' })
            ]);
            const areas = areasResult.status === 'fulfilled' ? (areasResult.value?.objects || []) : [];
            const locations = locationsResult.status === 'fulfilled' ? (locationsResult.value?.objects || []) : [];
            return { areas, locations };
        })();

        areaSnapshotPromise = pending.then(
            (snapshot) => {
                areaSnapshotPromise = null;
                return snapshot;
            },
            (error) => {
                areaSnapshotPromise = null;
                throw error;
            }
        );
    }
    return areaSnapshotPromise;
}

export async function getAreaOptions() {
    const { areas, locations } = await loadAreaSnapshot();
    const seen = new Map();
    for (const area of areas) {
        if (area?.area_id) {
            seen.set(area.area_id, {
                value: area.area_id,
                label: `${area.area_id}${area.name ? ` — ${area.name}` : ''}`.trim(),
                synonyms: [area.name, area.location_id].filter(Boolean)
            });
        }
    }
    for (const location of locations) {
        if (location?.name && !seen.has(location.name)) {
            seen.set(location.name, {
                value: location.name,
                label: `${location.name}${location.type ? ` [${location.type}]` : ''}`,
                synonyms: [location.type].filter(Boolean)
            });
        }
    }
    const options = Array.from(seen.values());
    return { options, totalCount: options.length };
}

export async function resolveAreaId(value) {
    const token = normalizeString(value);
    if (!token) {
        return null;
    }
    const { client } = getSkillServices();
    const checks = [
        client.execute('select', 'area', { area_id: token }),
        client.execute('select', 'area', { name: { contains: token, mode: 'insensitive' } }),
        client.execute('select', 'location', { name: token }),
        client.execute('select', 'location', { name: { contains: token, mode: 'insensitive' } })
    ];
    try {
        const results = await Promise.all(checks);
        for (const res of results) {
            const objects = res?.objects || [];
            if (objects.length === 1) {
                const object = objects[0];
                return object.area_id || object.name || null;
            }
        }
    } catch { }
    return null;
}

export async function presentAreaId(value) {
    const id = normalizeString(value);
    if (!id) {
        return 'not provided';
    }
    const { client } = getSkillServices();
    const lookups = [
        ['area', { area_id: id }],
        ['area', { name: id }],
        ['location', { name: id }]
    ];
    for (const [typeName, filter] of lookups) {
        try {
            const res = await client.execute('select', typeName, filter);
            const object = res?.objects?.[0];
            if (object) {
                if (typeName === 'area') {
                    return `${object.area_id}${object.name ? ` — ${object.name}` : ''}`.trim();
                }
                return `${object.name}${object.type ? ` [${object.type}]` : ''}`;
            }
        } catch { }
    }
    return id;
}

export function buildSelectionOptions(records, {
    valueKey = 'item_id',
    labelFormatter,
    synonymsFormatter
} = {}) {
    const options = [];
    for (const record of records) {
        const value = record?.[valueKey];
        if (value === undefined || value === null || value === '') {
            continue;
        }
        const label = typeof labelFormatter === 'function'
            ? labelFormatter(record)
            : String(value);
        const synonyms = typeof synonymsFormatter === 'function'
            ? synonymsFormatter(record)
            : [];
        options.push({
            value,
            label,
            synonyms: Array.isArray(synonyms) ? synonyms.filter(Boolean) : []
        });
    }
    return { options, totalCount: options.length };
}

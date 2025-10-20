import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const ROLES_PATH = path.resolve(ROOT_DIR, '.roles');
const APPROVED_PATH = path.resolve(ROOT_DIR, '.approved.json');
const SCHEMA_PATH = path.resolve(ROOT_DIR, 'schema.json');

async function readJson(filePath, fallback = {}) {
    try {
        const raw = await readFile(filePath, 'utf-8');
        return JSON.parse(raw);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return fallback;
        }
        throw error;
    }
}

async function writeJson(filePath, value) {
    const payload = `${JSON.stringify(value, null, 2)}\n`;
    await writeFile(filePath, payload, 'utf-8');
}

export async function loadRoles() {
    return readJson(ROLES_PATH, {});
}

export async function saveRoles(roles) {
    await writeJson(ROLES_PATH, roles);
}

export async function loadApprovedMap() {
    return readJson(APPROVED_PATH, {});
}

export async function saveApprovedMap(map) {
    await writeJson(APPROVED_PATH, map);
}

export async function loadSchema() {
    return readJson(SCHEMA_PATH, { version: 1, types: {} });
}

export async function saveSchema(schema) {
    await writeJson(SCHEMA_PATH, schema);
}

export function displayTable(data) {
    if (!data || data.length === 0) {
        console.log('No data to display.');
        return;
    }

    const headers = Object.keys(data[0]);
    if (!headers.length) {
        console.log('No data to display.');
        return;
    }

    const escapeCell = (value) => {
        if (value === null || value === undefined) {
            return '';
        }
        if (Array.isArray(value)) {
            return value.map(escapeCell).join(', ');
        }
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch (error) {
                return String(value);
            }
        }
        return String(value)
            .replace(/\n+/g, '<br>')
            .replace(/\|/g, '\\|');
    };

    const headerLine = `| ${headers.map(h => escapeCell(h)).join(' | ')} |`;
    const separatorLine = `| ${headers.map(() => '---').join(' | ')} |`;
    const rowLines = data.map(row => {
        const cells = headers.map(header => escapeCell(row[header]));
        return `| ${cells.join(' | ')} |`;
    });

    // Add blank lines before and after table for proper markdown block parsing
    console.log('\n' + [headerLine, separatorLine, ...rowLines].join('\n') + '\n');
}

export function asArray(value) {
    return Array.isArray(value) ? value : [];
}

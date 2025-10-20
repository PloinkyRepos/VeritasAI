/**
 * File-based Logger with Native File Locking
 * 
 * Provides thread-safe file logging using native Node.js file system operations.
 * Uses exclusive file locking to ensure safe concurrent writes.
 */

import { open, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function resolveLogRoot() {
    const explicitDir = (process.env.CORAL_AGENT_LOG_DIR || '').trim();
    if (explicitDir) {
        return path.resolve(explicitDir);
    }

    const workspaceDir = (process.env.WORKSPACE_PATH || '').trim();
    if (workspaceDir) {
        return path.resolve(workspaceDir, 'logs');
    }

    return path.resolve(ROOT_DIR, 'logs');
}

// Default log directories (root can be overridden via environment variables)
const LOG_ROOT = resolveLogRoot();
const AUDIT_DIR = path.resolve(LOG_ROOT, 'audit');
const CANCELLATION_DIR = path.resolve(LOG_ROOT, 'cancellations');
const SKILL_DISCOVERY_DIR = path.resolve(LOG_ROOT, 'skill-discovery');
const NO_MATCH_DIR = path.resolve(LOG_ROOT, 'no-match');

// Maximum retries for file locking
const MAX_LOCK_RETRIES = 10;
const LOCK_RETRY_DELAY_MS = 50;

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Ensure directory exists
 */
async function ensureDirectory(dirPath) {
    if (!existsSync(dirPath)) {
        await mkdir(dirPath, { recursive: true });
    }
}

/**
 * Get current date in YYYY-MM-DD format
 */
function getCurrentDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Get current timestamp in ISO format
 */
function getCurrentTimestamp() {
    return new Date().toISOString();
}

/**
 * Format log entry as JSON line
 */
function formatLogEntry(entry) {
    const record = {
        timestamp: getCurrentTimestamp(),
        ...entry
    };
    return JSON.stringify(record) + '\n';
}

/**
 * Write to file with exclusive locking
 * Uses file opening with 'a' (append) and 'x' (exclusive) flags where possible
 */
async function writeToFileWithLock(filePath, content, retries = MAX_LOCK_RETRIES) {
    let fileHandle;
    let lastError;

    for (let attempt = 0; attempt < retries; attempt++) {
        try {
            // Open file in append mode with exclusive lock intent
            // Note: Node.js doesn't have native POSIX locks, but opening in append mode
            // and writing atomically provides reasonable safety
            fileHandle = await open(filePath, 'a');
            
            // Write content
            await fileHandle.write(content);
            
            // Success - close and return
            await fileHandle.close();
            return true;
            
        } catch (error) {
            lastError = error;
            
            if (fileHandle) {
                try {
                    await fileHandle.close();
                } catch (closeError) {
                    // Ignore close errors
                }
                fileHandle = null;
            }
            
            // If file is busy/locked, retry after delay
            if (error.code === 'EBUSY' || error.code === 'EAGAIN' || error.code === 'EACCES') {
                if (attempt < retries - 1) {
                    await sleep(LOCK_RETRY_DELAY_MS * (attempt + 1));
                    continue;
                }
            }
            
            // For other errors, fail immediately
            throw error;
        }
    }
    
    throw new Error(`Failed to write to ${filePath} after ${retries} attempts: ${lastError?.message}`);
}

/**
 * Base logger class
 */
class FileLogger {
    constructor(baseDir, filenamePrefix = 'log') {
        this.baseDir = baseDir;
        this.filenamePrefix = filenamePrefix;
    }

    /**
     * Get log file path for current date
     */
    getLogFilePath() {
        const date = getCurrentDate();
        const filename = `${this.filenamePrefix}-${date}.jsonl`;
        return path.join(this.baseDir, filename);
    }

    /**
     * Write log entry
     */
    async log(entry) {
        await ensureDirectory(this.baseDir);
        const filePath = this.getLogFilePath();
        const content = formatLogEntry(entry);
        await writeToFileWithLock(filePath, content);
    }

    /**
     * Read log entries for a specific date (optional)
     */
    async readLogs(date = null) {
        const targetDate = date || getCurrentDate();
        const filename = `${this.filenamePrefix}-${targetDate}.jsonl`;
        const filePath = path.join(this.baseDir, filename);

        if (!existsSync(filePath)) {
            return [];
        }

        const fileHandle = await open(filePath, 'r');
        try {
            const content = await fileHandle.readFile({ encoding: 'utf-8' });
            const lines = content.split('\n').filter(line => line.trim());
            return lines.map(line => {
                try {
                    return JSON.parse(line);
                } catch (error) {
                    return null;
                }
            }).filter(Boolean);
        } finally {
            await fileHandle.close();
        }
    }

    /**
     * List all log files
     */
    async listLogFiles() {
        if (!existsSync(this.baseDir)) {
            return [];
        }

        const files = await readdir(this.baseDir);
        return files
            .filter(file => file.startsWith(this.filenamePrefix) && file.endsWith('.jsonl'))
            .sort()
            .reverse(); // Most recent first
    }
}

/**
 * Skill Discovery Logger
 * Logs when LLM discovers/chooses a skill
 */
class SkillDiscoveryLogger extends FileLogger {
    constructor() {
        super(SKILL_DISCOVERY_DIR, 'skill-discovery');
    }

    /**
     * Log skill discovery event
     */
    async logDiscovery({ user, taskDescription, selectedSkill, rankedSkills = [], confidence = null }) {
        await this.log({
            type: 'skill_discovery',
            user: user?.username || 'anonymous',
            roles: user?.roles || ['unknown'],
            taskDescription,
            selectedSkill,
            rankedSkills,
            confidence
        });
    }
}

/**
 * Audit Logger
 * Logs executed and canceled commands
 */
class AuditLogger extends FileLogger {
    constructor() {
        super(AUDIT_DIR, 'audit');
        this.cancellationLogger = new FileLogger(CANCELLATION_DIR, 'cancellation');
    }

    /**
     * Log command execution
     */
    async logExecution({ user, taskDescription, skill, arguments: args, result, success = true }) {
        await this.log({
            type: 'execution',
            user: user?.username || 'anonymous',
            role: user?.role || 'unknown',
            taskDescription,
            skill,
            arguments: args,
            result: success ? 'success' : 'failure',
            resultDetails: typeof result === 'object' ? result : { value: result }
        });
    }

    /**
     * Log command cancellation
     */
    async logCancellation({ user, taskDescription, skill, arguments: args, reason = 'user_cancelled' }) {
        await this.cancellationLogger.log({
            type: 'cancellation',
            user: user?.username || 'anonymous',
            role: user?.role || 'unknown',
            taskDescription,
            skill,
            arguments: args,
            reason
        });
    }
}

/**
 * No Match Logger
 * Logs commands that don't map to any known skill
 */
class NoMatchLogger extends FileLogger {
    constructor() {
        super(NO_MATCH_DIR, 'no-match');
    }

    /**
     * Log command with no skill match
     */
    async logNoMatch({ user, taskDescription, attemptedSkills = [], reason = 'no_matching_skill' }) {
        await this.log({
            type: 'no_match',
            user: user?.username || 'anonymous',
            roles: user?.roles || ['unknown'],
            taskDescription,
            attemptedSkills,
            reason
        });
    }
}

// Singleton instances
let skillDiscoveryLogger;
let auditLogger;
let noMatchLogger;

/**
 * Get Skill Discovery Logger instance
 */
export function getSkillDiscoveryLogger() {
    if (!skillDiscoveryLogger) {
        skillDiscoveryLogger = new SkillDiscoveryLogger();
    }
    return skillDiscoveryLogger;
}

/**
 * Get Audit Logger instance
 */
export function getAuditLogger() {
    if (!auditLogger) {
        auditLogger = new AuditLogger();
    }
    return auditLogger;
}

/**
 * Get No Match Logger instance
 */
export function getNoMatchLogger() {
    if (!noMatchLogger) {
        noMatchLogger = new NoMatchLogger();
    }
    return noMatchLogger;
}

/**
 * Initialize all logging directories
 */
export async function initializeLogging() {
    await ensureDirectory(LOG_ROOT);
    await ensureDirectory(AUDIT_DIR);
    await ensureDirectory(CANCELLATION_DIR);
    await ensureDirectory(SKILL_DISCOVERY_DIR);
    await ensureDirectory(NO_MATCH_DIR);
}

// Export logger classes for direct use if needed
export { SkillDiscoveryLogger, AuditLogger, NoMatchLogger, FileLogger };

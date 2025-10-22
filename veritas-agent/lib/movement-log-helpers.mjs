import { getServices } from './service-context.mjs';

/**
 * Transaction types for movement log entries
 */
export const TRANSACTION_TYPES = {
    RECEIPT: 'Receipt',
    VAN_ALLOCATION: 'Van Allocation',
    STORES_RETURN: 'Stores Return',
    FAULT_REPORT: 'Fault Report'
};

const SUPPORTED_ITEM_TYPES = ['equipment', 'material'];

async function fetchMovementLogs(client) {
    try {
        const result = await client.execute('select', 'movementLog', {}, { sortBy: 'log_id' });
        return result?.objects || [];
    } catch (error) {
        if (process.env.LLMAgentClient_DEBUG === 'true') {
            console.warn('fetchMovementLogs warning:', error.message);
        }
        return [];
    }
}

function determineNextLogId(existingLogs) {
    let maxId = 0;
    for (const log of existingLogs) {
        const id = Number(log.log_id);
        if (!isNaN(id) && id > maxId) {
            maxId = id;
        }
    }
    return maxId + 1;
}

/**
 * Create a movement log entry and update the item accordingly
 * This ensures complete audit trail while keeping items table in sync
 * 
 * @param {Object} params
 * @param {string} params.item_type - The type of inventory item ('equipment' or 'material')
 * @param {number} params.item_id - The item being moved
 * @param {number} params.quantity_moved - Quantity affected
 * @param {string|null} params.from_area_id - Origin area (null for receipts)
 * @param {string|null} params.to_area_id - Destination area (null for disposals)
 * @param {string} params.transaction_type - Type from TRANSACTION_TYPES
 * @param {string} params.job_id - Associated job (optional)
 * @param {string} params.notes - Additional notes (optional)
 * @returns {Promise<Object>} The created movement log entry
 */
export async function createMovementLog({
    item_type,
    item_id,
    quantity_moved,
    from_area_id,
    to_area_id,
    transaction_type,
    job_id = '',
    notes = ''
}) {
    const { client, user } = getServices();

    const normalizedType = typeof item_type === 'string' ? item_type.trim().toLowerCase() : '';
    if (!SUPPORTED_ITEM_TYPES.includes(normalizedType)) {
        throw new Error(`item_type must be one of: ${SUPPORTED_ITEM_TYPES.join(', ')}`);
    }
    if (!item_id) {
        throw new Error('item_id is required for movement log');
    }
    if (!transaction_type || !Object.values(TRANSACTION_TYPES).includes(transaction_type)) {
        throw new Error(`transaction_type must be one of: ${Object.values(TRANSACTION_TYPES).join(', ')}`);
    }

    let movementQuantity = Number(quantity_moved);
    if (normalizedType === 'material') {
        if (!movementQuantity || movementQuantity <= 0) {
            throw new Error('quantity_moved must be a positive number for materials');
        }
    } else {
        if (!movementQuantity || movementQuantity <= 0) {
            movementQuantity = 1;
        }
    }

    // Generate next log_id
    const existingLogs = await fetchMovementLogs(client);
    const logId = String(determineNextLogId(existingLogs));

    // Create the movement log entry
    const logEntry = await client.execute('createMovementLog', {
        log_id: logId,
        item_id,
        item_type: normalizedType,
        quantity_moved: movementQuantity,
        from_area_id: from_area_id || null,
        to_area_id: to_area_id || null,
        user_id: user?.username || 'system',
        transaction_type,
        timestamp: new Date().toISOString(),
        job_id,
        notes
    });

    // Now update the item based on the movement log
    await processMovementLogEntry(logEntry);

    return logEntry;
}

/**
 * Process a movement log entry and update the item accordingly
 * This function can be called by a backend process or immediately after log creation
 * 
 * @param {Object} logEntry - The movement log entry to process
 */
async function processMovementLogEntry(logEntry) {
    const { client } = getServices();
    const itemType = SUPPORTED_ITEM_TYPES.includes(logEntry?.item_type)
        ? logEntry.item_type
        : 'material';
    const selectTypeName = itemType;
    const updateMethod = itemType === 'equipment' ? 'updateEquipment' : 'updateMaterial';

    // Fetch the current item state
    const itemResult = await client.execute('select', selectTypeName, { item_id: logEntry.item_id });
    const items = itemResult?.objects || [];
    
    if (items.length === 0) {
        throw new Error(`Item with ID ${logEntry.item_id} not found`);
    }

    const item = items[0];
    const updates = {};

    switch (logEntry.transaction_type) {
        case TRANSACTION_TYPES.RECEIPT:
            updates.status = 'Available';
            if (itemType === 'material') {
                updates.quantity = (Number(item.quantity) || 0) + (logEntry.quantity_moved || 0);
            }
            if (logEntry.to_area_id) {
                updates.area_id = logEntry.to_area_id;
            }
            break;

        case TRANSACTION_TYPES.VAN_ALLOCATION:
            updates.status = 'Allocated';
            if (itemType === 'material') {
                updates.quantity = Math.max(0, (Number(item.quantity) || 0) - (logEntry.quantity_moved || 0));
            }
            if (logEntry.to_area_id) {
                updates.area_id = logEntry.to_area_id;
            }
            if (logEntry.job_id) {
                updates.job_id = logEntry.job_id;
            }
            break;

        case TRANSACTION_TYPES.STORES_RETURN:
            updates.status = 'Available';
            if (itemType === 'material') {
                updates.quantity = (Number(item.quantity) || 0) + (logEntry.quantity_moved || 0);
            }
            if (logEntry.to_area_id) {
                updates.area_id = logEntry.to_area_id;
            }
            if (logEntry.job_id) {
                updates.job_id = logEntry.job_id;
            }
            break;

        case TRANSACTION_TYPES.FAULT_REPORT:
            updates.status = 'Faulty';
            if (logEntry.to_area_id) {
                updates.area_id = logEntry.to_area_id;
            }
            if (logEntry.notes) {
                updates.notes = logEntry.notes;
            }
            break;

        default:
            throw new Error(`Unknown transaction type: ${logEntry.transaction_type}`);
    }

    // Apply the updates
    await client.execute(updateMethod, item.item_id, updates);
}

/**
 * Get movement history for a specific item
 * 
 * @param {number} item_id - The item ID
 * @returns {Promise<Array>} Array of movement log entries
 */
export async function getItemMovementHistory(item_id) {
    const { client } = getServices();
    const result = await client.execute('select', 'movementLog', 
        { item_id }, 
        { sortBy: 'timestamp', descending: true }
    );
    return result?.objects || [];
}

/**
 * Get movement history for a specific job
 * 
 * @param {string} job_id - The job ID
 * @returns {Promise<Array>} Array of movement log entries
 */
export async function getJobMovementHistory(job_id) {
    const { client } = getServices();
    const result = await client.execute('select', 'movementLog', 
        { job_id }, 
        { sortBy: 'timestamp', descending: true }
    );
    return result?.objects || [];
}

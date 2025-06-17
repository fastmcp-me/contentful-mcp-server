import { z } from 'zod';
import {
    createSuccessResponse,
    withErrorHandling,
} from '../../utils/response.js';
import {BaseToolSchema, createToolClient } from '../../utils/tools.js';
import {
    BulkOperationParams,
    createEntryVersionedLinks,
    createEntitiesCollection,
    waitForBulkActionCompletion,
} from '../../utils/bulkOperations.js';

export const PublishEntryToolParams = BaseToolSchema.extend({
    entryId: z.union([
        z.string(),
        z.array(z.string()).max(100)
    ]).describe('The ID of the entry to publish (string) or an array of entry IDs (up to 100 entries)'),
});

type Params = z.infer<typeof PublishEntryToolParams>;

async function tool(args: Params) {
    const baseParams: BulkOperationParams = {
        spaceId: args.spaceId,
        environmentId: args.environmentId,
    };

    const contentfulClient = createToolClient(args);

    // Normalize input to always be an array
    const entryIds = Array.isArray(args.entryId) ? args.entryId : [args.entryId];
    
    // For single entry, use individual publish for simplicity
    if (entryIds.length === 1) {
        try {
            const entryId = entryIds[0];
            const params = {
                ...baseParams,
                entryId,
            };

            // Get the entry first
            const entry = await contentfulClient.entry.get(params);
            
            // Publish the entry
            const publishedEntry = await contentfulClient.entry.publish(params, entry);
            
            return createSuccessResponse('Entry published successfully', {
                publishedEntries: [{
                    id: publishedEntry.sys.id,
                    contentType: publishedEntry.sys.contentType.sys.id,
                    publishedVersion: publishedEntry.sys.publishedVersion,
                }],
                errors: [],
                summary: {
                    total: 1,
                    successful: 1,
                    failed: 0,
                },
            });
        } catch (error) {
            return createSuccessResponse('Entry publish failed', {
                publishedEntries: [],
                errors: [{
                    entryId: entryIds[0],
                    error: error instanceof Error ? error.message : 'Unknown error',
                }],
                summary: {
                    total: 1,
                    successful: 0,
                    failed: 1,
                },
            });
        }
    }

    // For multiple entries, use bulk action API
    // Get the current version of each entry
    const entityVersions = await createEntryVersionedLinks(
        contentfulClient,
        baseParams,
        entryIds
    );

    // Create the collection object
    const entitiesCollection = createEntitiesCollection(entityVersions);

    // Create the bulk action
    const bulkAction = await contentfulClient.bulkAction.publish(
        baseParams,
        {
            entities: entitiesCollection,
        },
    );

    // Wait for the bulk action to complete
    const action = await waitForBulkActionCompletion(
        contentfulClient,
        baseParams,
        bulkAction.sys.id
    );

    // Process results
    const publishedEntries = [];
    const errors = [];

    if (action.sys.status === "succeeded" && action.succeeded) {
        for (const succeededItem of action.succeeded) {
            // Get the published entry details
            try {
                const entry = await contentfulClient.entry.get({
                    ...baseParams,
                    entryId: succeededItem.sys.id,
                });
                
                publishedEntries.push({
                    id: entry.sys.id,
                    contentType: entry.sys.contentType.sys.id,
                    publishedVersion: entry.sys.publishedVersion,
                });
            } catch {
                publishedEntries.push({
                    id: succeededItem.sys.id,
                    contentType: "Unknown",
                    publishedVersion: undefined,
                });
            }
        }
    }

    if (action.failed) {
        for (const failedItem of action.failed) {
            errors.push({
                entryId: failedItem.sys.id,
                error: failedItem.error ? JSON.stringify(failedItem.error) : 'Unknown error',
            });
        }
    }

    // If the entire bulk action failed
    if (action.sys.status === "failed") {
        for (const entryId of entryIds) {
            errors.push({
                entryId,
                error: action.error ? JSON.stringify(action.error) : 'Bulk action failed',
            });
        }
    }

    return createSuccessResponse('Entry(s) published successfully', {
        publishedEntries,
        errors,
        summary: {
            total: entryIds.length,
            successful: publishedEntries.length,
            failed: errors.length,
        },
    });
}

export const publishEntryTool = withErrorHandling(
    tool,
    'Error publishing entry',
);
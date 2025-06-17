import { z } from 'zod';
import {
  createSuccessResponse,
  withErrorHandling,
} from '../../utils/response.js';
import { BaseToolSchema, createToolClient } from '../../utils/tools.js';
import {
  BulkOperationParams,
  createAssetVersionedLinks,
  createEntitiesCollection,
  waitForBulkActionCompletion,
} from '../../utils/bulkOperations.js';

export const PublishAssetToolParams = BaseToolSchema.extend({
  assetId: z.union([
    z.string(),
    z.array(z.string()).max(100)
  ]).describe('The ID of the asset to publish (string) or an array of asset IDs (up to 100 assets)'),
});

type Params = z.infer<typeof PublishAssetToolParams>;

async function tool(args: Params) {
  const baseParams: BulkOperationParams = {
    spaceId: args.spaceId,
    environmentId: args.environmentId,
  };

  const contentfulClient = createToolClient(args);

  // Normalize input to always be an array
  const assetIds = Array.isArray(args.assetId) ? args.assetId : [args.assetId];
  
  // For single asset, use individual publish
  if (assetIds.length === 1) {
    try {
      const assetId = assetIds[0];
      const params = {
        ...baseParams,
        assetId,
      };

      // Get the asset first
      const asset = await contentfulClient.asset.get(params);
      
      // Publish the asset
      const publishedAsset = await contentfulClient.asset.publish(params, asset);
      
      return createSuccessResponse('Asset published successfully', {
        publishedAssets: [{
          id: publishedAsset.sys.id,
          title: publishedAsset.fields.title?.["en-US"] || "Untitled",
          publishedVersion: publishedAsset.sys.publishedVersion,
        }],
        errors: [],
        summary: {
          total: 1,
          successful: 1,
          failed: 0,
        },
      });
    } catch (error) {
      return createSuccessResponse('Asset publish failed', {
        publishedAssets: [],
        errors: [{
          assetId: assetIds[0],
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

  // For multiple assets, use bulk action API
  // Get the current version of each asset
  const entityVersions = await createAssetVersionedLinks(
    contentfulClient,
    baseParams,
    assetIds
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
  const publishedAssets = [];
  const errors = [];

  if (action.sys.status === "succeeded" && action.succeeded) {
    for (const succeededItem of action.succeeded) {
      // Get the published asset details
      try {
        const asset = await contentfulClient.asset.get({
          ...baseParams,
          assetId: succeededItem.sys.id,
        });
        
        publishedAssets.push({
          id: asset.sys.id,
          title: asset.fields.title?.["en-US"] || "Untitled",
          publishedVersion: asset.sys.publishedVersion,
        });
      } catch {
        publishedAssets.push({
          id: succeededItem.sys.id,
          title: "Unknown",
          publishedVersion: undefined,
        });
      }
    }
  }

  if (action.failed) {
    for (const failedItem of action.failed) {
      errors.push({
        assetId: failedItem.sys.id,
        error: failedItem.error ? JSON.stringify(failedItem.error) : 'Unknown error',
      });
    }
  }

  // If the entire bulk action failed
  if (action.sys.status === "failed") {
    for (const assetId of assetIds) {
      errors.push({
        assetId,
        error: action.error ? JSON.stringify(action.error) : 'Bulk action failed',
      });
    }
  }

  return createSuccessResponse('Asset(s) published successfully', {
    publishedAssets,
    errors,
    summary: {
      total: assetIds.length,
      successful: publishedAssets.length,
      failed: errors.length,
    },
  });
}

export const publishAssetTool = withErrorHandling(
  tool,
  'Error publishing asset',
); 
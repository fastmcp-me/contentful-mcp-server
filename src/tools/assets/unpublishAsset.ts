import { z } from 'zod';
import {
  createSuccessResponse,
  withErrorHandling,
} from '../../utils/response.js';
import { BaseToolSchema, createToolClient } from '../../utils/tools.js';
import {
  BulkOperationParams,
  VersionedLink,
  createEntitiesCollection,
  waitForBulkActionCompletion,
} from '../../utils/bulkOperations.js';

export const UnpublishAssetToolParams = BaseToolSchema.extend({
  assetId: z.union([
    z.string(),
    z.array(z.string()).max(100)
  ]).describe('The ID of the asset to unpublish (string) or an array of asset IDs (up to 100 assets)'),
});

type Params = z.infer<typeof UnpublishAssetToolParams>;

async function tool(args: Params) {
  const baseParams: BulkOperationParams = {
    spaceId: args.spaceId,
    environmentId: args.environmentId,
  };

  const contentfulClient = createToolClient(args);

  // Normalize input to always be an array
  const assetIds = Array.isArray(args.assetId) ? args.assetId : [args.assetId];
  
  // For single asset, use individual unpublish for simplicity
  if (assetIds.length === 1) {
    try {
      const assetId = assetIds[0];
      const params = {
        ...baseParams,
        assetId,
      };

      // Get the asset first
      const asset = await contentfulClient.asset.get(params);
      
      // Only unpublish if the asset is currently published
      if (asset.sys.publishedVersion !== undefined) {
        // Unpublish the asset
        await contentfulClient.asset.unpublish(params, asset);
        
        return createSuccessResponse('Asset unpublished successfully', {
          unpublishedAssets: [{
            id: asset.sys.id,
            title: asset.fields.title?.["en-US"] || "Untitled",
            wasPublished: true,
          }],
          errors: [],
          summary: {
            total: 1,
            successful: 1,
            failed: 0,
          },
        });
      } else {
        // Asset was already unpublished
        return createSuccessResponse('Asset was already unpublished', {
          unpublishedAssets: [{
            id: asset.sys.id,
            title: asset.fields.title?.["en-US"] || "Untitled",
            wasPublished: false,
          }],
          errors: [],
          summary: {
            total: 1,
            successful: 1,
            failed: 0,
          },
        });
      }
    } catch (error) {
      return createSuccessResponse('Asset unpublish failed', {
        unpublishedAssets: [],
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
  // Get the current version of each asset and filter only published ones
  const assetsToUnpublish: VersionedLink[] = [];
  const alreadyUnpublished: Array<{
    id: string;
    title: string;
    wasPublished: boolean;
  }> = [];
  const errors = [];

  await Promise.all(
    assetIds.map(async (assetId) => {
      try {
        const currentAsset = await contentfulClient.asset.get({
          ...baseParams,
          assetId,
        });

        if (currentAsset.sys.publishedVersion !== undefined) {
          assetsToUnpublish.push({
            sys: {
              type: "Link" as const,
              linkType: "Asset" as const,
              id: assetId,
              version: currentAsset.sys.version,
            },
          });
        } else {
          alreadyUnpublished.push({
            id: assetId,
            title: currentAsset.fields.title?.["en-US"] || "Untitled",
            wasPublished: false,
          });
        }
      } catch (error) {
        errors.push({
          assetId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }),
  );

  let unpublishedAssets = [...alreadyUnpublished];

  // Only proceed with bulk action if there are assets to unpublish
  if (assetsToUnpublish.length > 0) {
    // Create the collection object
    const entitiesCollection = createEntitiesCollection(assetsToUnpublish);

    // Create the bulk action
    const bulkAction = await contentfulClient.bulkAction.unpublish(
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
    if (action.sys.status === "succeeded" && action.succeeded) {
      for (const succeededItem of action.succeeded) {
        // Get the unpublished asset details
        try {
          const asset = await contentfulClient.asset.get({
            ...baseParams,
            assetId: succeededItem.sys.id,
          });
          
          unpublishedAssets.push({
            id: asset.sys.id,
            title: asset.fields.title?.["en-US"] || "Untitled",
            wasPublished: true,
          });
        } catch {
          unpublishedAssets.push({
            id: succeededItem.sys.id,
            title: "Unknown",
            wasPublished: true,
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
      for (const entityLink of assetsToUnpublish) {
        errors.push({
          assetId: entityLink.sys.id,
          error: action.error ? JSON.stringify(action.error) : 'Bulk action failed',
        });
      }
    }
  }

  return createSuccessResponse('Asset(s) unpublished successfully', {
    unpublishedAssets,
    errors,
    summary: {
      total: assetIds.length,
      successful: unpublishedAssets.length,
      failed: errors.length,
    },
  });
}

export const unpublishAssetTool = withErrorHandling(
  tool,
  'Error unpublishing asset',
); 
import { z } from 'zod';
import {
  createSuccessResponse,
  withErrorHandling,
} from '../../utils/response.js';
import { BaseToolSchema, createToolClient } from '../../utils/tools.js';
import { summarizeData } from '../../utils/summarizer.js';

export const ListAssetsToolParams = BaseToolSchema.extend({
  limit: z
    .number()
    .optional()
    .describe('Maximum number of assets to return (max 3)'),
  skip: z
    .number()
    .optional()
    .describe('Skip this many assets for pagination'),
});

type Params = z.infer<typeof ListAssetsToolParams>;

async function tool(args: Params) {
  const params = {
    spaceId: args.spaceId,
    environmentId: args.environmentId,
  };

  const contentfulClient = createToolClient(args);

  const assets = await contentfulClient.asset.getMany({
    ...params,
    query: {
      limit: Math.min(args.limit || 3, 3),
      skip: args.skip || 0,
    },
  });

  const summarizedAssets = assets.items.map(asset => ({
    id: asset.sys.id,
    title: asset.fields.title?.["en-US"] || "Untitled",
    description: asset.fields.description?.["en-US"] || null,
    fileName: asset.fields.file?.["en-US"]?.fileName || null,
    contentType: asset.fields.file?.["en-US"]?.contentType || null,
    url: asset.fields.file?.["en-US"]?.url || null,
    size: asset.fields.file?.["en-US"]?.details?.size || null,
    createdAt: asset.sys.createdAt,
    updatedAt: asset.sys.updatedAt,
    publishedVersion: asset.sys.publishedVersion,
  }));

  const summarized = summarizeData(
    {
      ...assets,
      items: summarizedAssets,
    },
    {
      maxItems: 3,
      remainingMessage:
        'To see more assets, please ask me to retrieve the next page using the skip parameter.',
    }
  );

  return createSuccessResponse('Assets retrieved successfully', {
    assets: summarized,
    total: assets.total,
    limit: assets.limit,
    skip: assets.skip,
  });
}

export const listAssetsTool = withErrorHandling(
  tool,
  'Error listing assets',
); 
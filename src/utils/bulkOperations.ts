// Common types and utilities for Contentful bulk operations
import type { PlainClientAPI } from 'contentful-management';

export interface VersionedLink {
  sys: {
    type: "Link"
    linkType: "Entry" | "Asset"
    id: string
    version: number
  }
}

export interface Collection<T> {
  sys: {
    type: "Array"
  }
  items: T[]
}

export interface BulkActionResponse {
  sys: {
    id: string
    status: string
  }
  succeeded?: Array<{
    sys: {
      id: string
      type: string
    }
  }>
  failed?: Array<{
    sys: {
      id: string
      type: string
    }
    error?: unknown
  }>
  error?: unknown
}

export interface BulkOperationParams {
  spaceId: string
  environmentId: string
}

// Helper function to wait for bulk action completion
export async function waitForBulkActionCompletion(
  contentfulClient: PlainClientAPI,
  baseParams: BulkOperationParams,
  bulkActionId: string
): Promise<BulkActionResponse> {
  let action = (await contentfulClient.bulkAction.get({
    ...baseParams,
    bulkActionId,
  })) as unknown as BulkActionResponse;

  while (action.sys.status === "inProgress" || action.sys.status === "created") {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    action = (await contentfulClient.bulkAction.get({
      ...baseParams,
      bulkActionId,
    })) as unknown as BulkActionResponse;
  }

  return action;
}

// Helper function to create versioned links for entries
export async function createEntryVersionedLinks(
  contentfulClient: PlainClientAPI,
  baseParams: BulkOperationParams,
  entryIds: string[]
): Promise<VersionedLink[]> {
  return Promise.all(
    entryIds.map(async (entryId) => {
      const currentEntry = await contentfulClient.entry.get({
        ...baseParams,
        entryId,
      });

      return {
        sys: {
          type: "Link" as const,
          linkType: "Entry" as const,
          id: entryId,
          version: currentEntry.sys.version,
        },
      };
    })
  );
}

// Helper function to create versioned links for assets
export async function createAssetVersionedLinks(
  contentfulClient: PlainClientAPI,
  baseParams: BulkOperationParams,
  assetIds: string[]
): Promise<VersionedLink[]> {
  return Promise.all(
    assetIds.map(async (assetId) => {
      const currentAsset = await contentfulClient.asset.get({
        ...baseParams,
        assetId,
      });

      return {
        sys: {
          type: "Link" as const,
          linkType: "Asset" as const,
          id: assetId,
          version: currentAsset.sys.version,
        },
      };
    })
  );
}

// Helper function to create collection from versioned links
export function createEntitiesCollection(entities: VersionedLink[]): Collection<VersionedLink> {
  return {
    sys: {
      type: "Array",
    },
    items: entities,
  };
} 
/** Branded entity identifiers, so a RoomId cannot be passed where a WallId is expected. */

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type ProjectId = Brand<string, 'ProjectId'>;
export type SiteId = Brand<string, 'SiteId'>;
export type BuildingId = Brand<string, 'BuildingId'>;
export type FloorId = Brand<string, 'FloorId'>;
export type RoomId = Brand<string, 'RoomId'>;
export type WallId = Brand<string, 'WallId'>;
export type OpeningId = Brand<string, 'OpeningId'>;
export type ColumnId = Brand<string, 'ColumnId'>;
export type StairId = Brand<string, 'StairId'>;
export type FurnitureId = Brand<string, 'FurnitureId'>;
export type MaterialId = Brand<string, 'MaterialId'>;
export type ThemeId = Brand<string, 'ThemeId'>;
export type DesignId = Brand<string, 'DesignId'>;
export type VersionId = Brand<string, 'VersionId'>;
export type SupplierId = Brand<string, 'SupplierId'>;
export type ProductId = Brand<string, 'ProductId'>;
export type PriceId = Brand<string, 'PriceId'>;
export type SourceId = Brand<string, 'SourceId'>;
export type LabourRateId = Brand<string, 'LabourRateId'>;

/** Cast a raw string to a branded id. Use only at persistence and parsing boundaries. */
export function asId<T extends string>(raw: string): T {
  return raw as T;
}

let counter = 0;

/**
 * Deterministic-prefix identifier generator.
 *
 * Uses `crypto.randomUUID` where available and falls back to a counter+time id
 * so the core package stays runnable under plain Node, in the Electron main
 * process, and in the renderer without a polyfill.
 */
export function newId<T extends string>(prefix: string): T {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const uuid =
    typeof g.crypto?.randomUUID === 'function'
      ? g.crypto.randomUUID()
      : `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  return `${prefix}_${uuid}` as T;
}

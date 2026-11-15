import type { Database } from "../config/schema.js";

/** Identifies an item: GUID (with or without braces) or a Sitecore path. */
export interface ItemRef {
  idOrPath: string;
  database: Database;
  language: string;
  version?: number;
}

export interface ReadOptions {
  /** Restrict returned fields to these names. */
  fields?: string[];
  /** Include fields inherited from the Standard Template (__Created, __Renderings, ...). */
  includeStandardFields?: boolean;
}

/** Adapter-agnostic item shape. IDs are always "{UPPERCASE-GUID}". */
export interface Item {
  id: string;
  name: string;
  path: string;
  displayName: string;
  parentId: string | null;
  templateId: string;
  templateName: string;
  language: string;
  version: number | null;
  hasChildren: boolean;
  fields: Record<string, string>;
}

export interface IndexSearchRequest {
  term: string;
  database: Database;
  language: string;
  page: number;
  pageSize: number;
  fields?: string[];
}

export interface IndexSearchResult {
  totalCount: number;
  items: Item[];
}

export interface ServerInfo {
  sitecoreVersion?: string;
}

export interface CreateItemInput {
  name: string;
  templateId: string;
  fields: Record<string, string>;
}

/** Port implemented by each Sitecore integration surface (SSC ItemService now, Authoring GraphQL later). */
export interface ContentAdapter {
  readonly name: string;
  getItem(ref: ItemRef, opts?: ReadOptions): Promise<Item | null>;
  getChildren(ref: ItemRef, opts?: ReadOptions): Promise<Item[]>;
  searchIndex(req: IndexSearchRequest): Promise<IndexSearchResult>;
  getServerInfo(): Promise<ServerInfo>;

  // Writes. Callers MUST run the write guard first (src/domain/writes.ts does).
  /** Creates an item under `parentPath`; returns the new item ID ("{GUID}"). */
  createItem(parentPath: string, loc: Pick<ItemRef, "database" | "language">, input: CreateItemInput): Promise<string>;
  /** Updates field values on one language version (latest when version is omitted). */
  updateItem(ref: ItemRef & { idOrPath: string }, fields: Record<string, string>): Promise<void>;
  /** Deletes an item and its subtree; Sitecore moves it to the Recycle Bin. */
  deleteItem(id: string, database: ItemRef["database"]): Promise<void>;
}

import type {
  ContentAdapter,
  CreateItemInput,
  IndexSearchRequest,
  IndexSearchResult,
  Item,
  ItemRef,
  ReadOptions,
  ServerInfo,
} from "../../domain/types.js";
import { NotFoundError } from "../../errors.js";
import { bareGuid, isGuid, normalizeId, normalizePath } from "../../util/ids.js";
import type { Query, SscClient } from "./sscClient.js";

/** Metadata keys returned by the SSC ItemService next to field values. */
const META_KEYS = new Set([
  "ItemID",
  "ItemName",
  "ItemPath",
  "ParentID",
  "TemplateID",
  "TemplateName",
  "CloneSource",
  "ItemLanguage",
  "ItemVersion",
  "DisplayName",
  "HasChildren",
  "ItemIcon",
  "ItemMedialUrl",
  "ItemUrl",
]);

type RawItem = Record<string, unknown>;

interface RawSearchResult {
  TotalCount?: number;
  Results?: RawItem[];
}

const ITEM_ROOT = "/sitecore/api/ssc/item";

/** ContentAdapter backed by the Sitecore Services Client ItemService (works on 9.x and 10.x). */
export class SscItemServiceAdapter implements ContentAdapter {
  readonly name = "ssc-itemservice";

  constructor(private readonly client: SscClient) {}

  async getItem(ref: ItemRef, opts: ReadOptions = {}): Promise<Item | null> {
    const query = baseQuery(ref, opts);
    const raw = isGuid(ref.idOrPath)
      ? await this.client.getJson<RawItem>(`${ITEM_ROOT}/${bareGuid(ref.idOrPath)}`, query)
      : await this.client.getJson<RawItem>(`${ITEM_ROOT}/`, { ...query, path: normalizePath(ref.idOrPath) });
    return raw ? mapItem(raw) : null;
  }

  async getChildren(ref: ItemRef, opts: ReadOptions = {}): Promise<Item[]> {
    let id = ref.idOrPath;
    if (!isGuid(id)) {
      const parent = await this.getItem(ref, { fields: ["__Sortorder"] });
      if (!parent) throw notFound(ref);
      id = parent.id;
    }
    const raw = await this.client.getJson<RawItem[]>(`${ITEM_ROOT}/${bareGuid(id)}/children`, baseQuery(ref, opts));
    if (raw === null) throw notFound(ref);
    return raw.map(mapItem);
  }

  async searchIndex(req: IndexSearchRequest): Promise<IndexSearchResult> {
    const raw = await this.client.getJson<RawSearchResult>(`${ITEM_ROOT}/search`, {
      term: req.term,
      database: req.database,
      language: req.language,
      page: req.page,
      pageSize: req.pageSize,
      includeStandardTemplateFields: false,
      fields: fieldsParam(req.fields),
    });
    const results = raw?.Results ?? [];
    return { totalCount: raw?.TotalCount ?? results.length, items: results.map(mapItem) };
  }

  async getServerInfo(): Promise<ServerInfo> {
    // Log in first so both requests below share one session.
    await this.client.login();
    const [, res] = await Promise.all([
      // Proves auth works and the item API is reachable.
      this.client.getJson<RawItem>(`${ITEM_ROOT}/`, { path: "/sitecore", database: "master", fields: "ItemID" }),
      this.client.getRaw("/sitecore/shell/sitecore.version.xml", {}, "text/xml"),
    ]);
    return { sitecoreVersion: res.status === 200 ? parseVersionXml(res.body) : undefined };
  }

  // Writes, verified on 10.4: POST -> 201 + Location, PATCH -> 204 (unknown fields silently ignored),
  // DELETE -> 204 with the item moved to the Recycle Bin.

  async createItem(
    parentPath: string,
    loc: Pick<ItemRef, "database" | "language">,
    input: CreateItemInput,
  ): Promise<string> {
    // The parent is addressed by path: no leading slash, URL-encoded as one segment.
    const encodedParent = encodeURIComponent(normalizePath(parentPath).slice(1));
    const res = await this.client.write(
      "POST",
      `${ITEM_ROOT}/${encodedParent}`,
      { database: loc.database, language: loc.language },
      { ItemName: input.name, TemplateID: input.templateId, ...input.fields },
    );
    const location = res.headers.location;
    const fromLocation = typeof location === "string" ? /\/item\/([0-9a-f-]{36})/i.exec(location)?.[1] : undefined;
    if (fromLocation) return normalizeId(fromLocation);
    const created = await this.getItem({ idOrPath: `${normalizePath(parentPath)}/${input.name}`, ...loc });
    if (!created) throw new NotFoundError(`Item was created under ${parentPath} but could not be read back.`);
    return created.id;
  }

  async updateItem(ref: ItemRef, fields: Record<string, string>): Promise<void> {
    await this.client.write(
      "PATCH",
      `${ITEM_ROOT}/${bareGuid(ref.idOrPath)}`,
      { database: ref.database, language: ref.language, version: ref.version },
      fields,
    );
  }

  async deleteItem(id: string, database: ItemRef["database"]): Promise<void> {
    // No language parameter: the whole item (all languages, subtree) goes to the Recycle Bin.
    await this.client.write("DELETE", `${ITEM_ROOT}/${bareGuid(id)}`, { database });
  }
}

function notFound(ref: ItemRef): NotFoundError {
  return new NotFoundError(`Item not found: ${ref.idOrPath} (${ref.database}/${ref.language})`);
}

/** Item properties we always need. SSC's `fields=` filter drops them unless listed explicitly. */
const REQUIRED_PROPS = [
  "ItemID",
  "ItemName",
  "ItemPath",
  "ParentID",
  "TemplateID",
  "TemplateName",
  "ItemLanguage",
  "ItemVersion",
  "DisplayName",
  "HasChildren",
];

/** Builds the SSC `fields` parameter: required item properties + requested fields. */
export function fieldsParam(fields: string[] | undefined): string | undefined {
  if (!fields || fields.length === 0) return undefined;
  return [...new Set([...REQUIRED_PROPS, ...fields])].join(",");
}

// Note: SSC's `includeMetadata=true` adds a large per-field definition object, so we never request it.
function baseQuery(ref: ItemRef, opts: ReadOptions): Query {
  return {
    database: ref.database,
    language: ref.language,
    version: ref.version,
    includeStandardTemplateFields: opts.includeStandardFields ?? false,
    fields: fieldsParam(opts.fields),
  };
}

export function mapItem(raw: RawItem): Item {
  const str = (k: string) => (raw[k] === undefined || raw[k] === null ? "" : String(raw[k]));
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (META_KEYS.has(k)) continue;
    if (v !== null && typeof v === "object") continue; // e.g. "metadata" (field definitions)
    fields[k] = v === null || v === undefined ? "" : String(v);
  }
  const version = Number.parseInt(str("ItemVersion"), 10);
  const parent = str("ParentID");
  return {
    id: normalizeId(str("ItemID")),
    name: str("ItemName"),
    path: str("ItemPath"),
    displayName: str("DisplayName"),
    parentId: parent ? normalizeId(parent) : null,
    templateId: normalizeId(str("TemplateID")),
    templateName: str("TemplateName"),
    language: str("ItemLanguage"),
    version: Number.isNaN(version) ? null : version,
    hasChildren: raw.HasChildren === true || str("HasChildren").toLowerCase() === "true",
    fields,
  };
}

export function parseVersionXml(xml: string): string | undefined {
  const part = (tag: string) => new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`, "i").exec(xml)?.[1];
  const major = part("major");
  if (!major) return undefined;
  const nums = [major, part("minor"), part("build"), part("revision")].filter((x) => x !== undefined && x !== "");
  const name = part("name");
  return name ? `${nums.join(".")} (${name})` : nums.join(".");
}

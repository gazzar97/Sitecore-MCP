/** File formats of the Instance Knowledge Base (docs/08-instance-knowledge-base.md). */

export const KNOWLEDGE_SCHEMA_VERSION = 1;

/** Sections discovered from Sitecore, in run order. */
export const SECTIONS = [
  "environment",
  "sites",
  "templates",
  "renderings",
  "placeholders",
  "layouts",
  "content-map",
] as const;
export type DiscoverySection = (typeof SECTIONS)[number];
/** Discovered sections plus "relationships", which is derived locally from them (no Sitecore calls). */
export type SectionName = DiscoverySection | "relationships";

export interface SectionMeta {
  status: "ok" | "partial" | "error";
  generatedAt: string;
  durationMs: number;
  count: number;
  truncated: boolean;
  error?: string;
}

export interface Manifest {
  schemaVersion: number;
  instance: string;
  cmUrl: string;
  sitecoreVersion?: string;
  updatedAt: string;
  sections: Partial<Record<SectionName, SectionMeta>>;
}

export interface SectionFile<T> {
  schemaVersion: number;
  section: SectionName;
  instance: string;
  generatedAt: string;
  data: T;
}

export interface Ref {
  id: string;
  name: string;
  path?: string;
}

// ---- environment
export interface EnvironmentInfo {
  sitecoreVersion?: string;
  languages: string[];
  modules: Record<"sxa" | "headless" | "forms" | "spe" | "exm", { detected: boolean; evidence: string }>;
}

// ---- sites
export interface SiteInfo {
  name: string;
  rootId: string;
  rootPath: string;
  rootTemplate: string;
  homePath: string;
  /** Siblings of Home under the site root (e.g. Data, Settings, Media). */
  folders: string[];
}
export interface SitesData {
  sites: SiteInfo[];
  scannedRoots: string[];
  truncated: boolean;
}

// ---- templates
export type TemplateKind = "page" | "datasource" | "folder" | "base" | "other";

export interface KnowledgeField {
  id: string;
  name: string;
  type: string;
  section: string;
  source?: string;
  shared: boolean;
  unversioned: boolean;
}

export interface KnowledgeTemplate {
  id: string;
  name: string;
  path: string;
  kind: TemplateKind;
  kindReason: string;
  baseTemplates: Ref[];
  ownFields: KnowledgeField[];
  standardValuesId?: string;
  insertOptions: Ref[];
  /** Templates whose insert options include this template (computed). */
  allowedUnder: Ref[];
  /** Renderings that use this template as datasource template (computed). */
  datasourceFor: Ref[];
  hasLayout: boolean;
  defaultWorkflow?: Ref;
  /** How content uses this template (from the content map; absent until it is discovered). */
  usage?: TemplateUsageSummary;
  icon?: string;
  revision?: string;
}

export interface TemplatesData {
  roots: string[];
  missingRoots: string[];
  excluded: string[];
  itemsWalked: number;
  truncated: boolean;
  templates: KnowledgeTemplate[];
  /** Base templates outside the catalogued roots (e.g. Standard template). */
  external: Ref[];
}

// ---- renderings
export type RenderingType = "view" | "controller" | "json" | "other";

export interface KnowledgeRendering {
  id: string;
  name: string;
  path: string;
  type: RenderingType;
  templateName: string;
  componentName?: string;
  viewPath?: string;
  controller?: string;
  datasourceTemplate?: { raw: string; template?: Ref };
  datasourceLocation?: string;
  parametersTemplate?: { raw: string; template?: Ref };
  compatibleRenderings: Ref[];
}

export interface RenderingsData {
  roots: string[];
  missingRoots: string[];
  truncated: boolean;
  renderings: KnowledgeRendering[];
}

// ---- placeholders / layouts
export interface KnowledgePlaceholder {
  id: string;
  name: string;
  path: string;
  key: string;
  allowedRenderings: Ref[];
}
export interface PlaceholdersData {
  truncated: boolean;
  placeholders: KnowledgePlaceholder[];
}

export interface LayoutsData {
  layouts: { id: string; name: string; path: string; filePath?: string }[];
  devices: { id: string; name: string }[];
}

// ---- content map (phase E)
export interface TemplateUsageSummary {
  /** Items using the template in the walked content. */
  items: number;
  /** Sampled items, and how many of them have a layout. */
  sampled: number;
  sampledWithLayout: number;
  samplePaths: string[];
}

export interface OutlineNode {
  path: string;
  templateName: string;
  /** Depth below the site root (1 = direct child). */
  depth: number;
  /** Items below this node seen in the walk. */
  descendants: number;
}

export interface ContentTemplateUsage {
  template: Ref;
  count: number;
  /** How many of them are at or below the site's Home. */
  underHome: number;
  minDepth: number;
  maxDepth: number;
  /** Templates of the parents these items live under, most common first. */
  parentTemplates: { name: string; count: number }[];
  samplePaths: string[];
}

export interface PlacedRendering {
  rendering: Ref;
  placeholder: string;
  /** Raw datasource as stored (GUID, path, local:/…, query). */
  datasource?: string;
  /** Datasource path when it could be resolved from the walked content. */
  datasourcePath?: string;
  /** Rendering parameters, values truncated. */
  params?: Record<string, string>;
}

export interface PageSample {
  id: string;
  path: string;
  template: Ref;
  layoutSource: "final" | "shared" | "none";
  layout?: Ref;
  device?: string;
  renderings: PlacedRendering[];
}

export interface SiteContentMap {
  site: string;
  rootPath: string;
  homePath: string;
  itemsWalked: number;
  truncated: boolean;
  maxDepth: number;
  outline: OutlineNode[];
  templates: ContentTemplateUsage[];
  samples: PageSample[];
}

export interface ContentMapData {
  sites: SiteContentMap[];
  truncated: boolean;
}

// ---- relationships (derived locally, no Sitecore calls)
export interface PageType {
  template: Ref;
  /** Items using the template across all walked sites. */
  items: number;
  sites: string[];
  allowedUnder: string[];
  kindReason: string;
  /** Renderings on the sampled pages, most used first. */
  renderings: { rendering: Ref; pages: number; placeholders: string[] }[];
  sampled: number;
  samplePaths: string[];
}

export interface RenderingUsage {
  rendering: Ref;
  /** Sampled pages that use it. */
  pages: number;
  placeholders: string[];
  pageTypes: string[];
  samplePaths: string[];
  /** Folders its datasources live in, most common first. */
  datasourceFolders: string[];
}

export interface RelationshipsData {
  /** Templates whose items are pages (have a layout), with what renders on them. */
  pageTypes: PageType[];
  renderingUsage: RenderingUsage[];
  /** Catalogued renderings not seen on any sampled page (sample-based: a hint, not proof). */
  unusedRenderings: Ref[];
  /** Placeholder keys seen on sampled pages, with the renderings placed in them. */
  placeholderUsage: { key: string; renderings: string[]; pages: number }[];
  sampledPages: number;
}

export interface SectionDataMap {
  environment: EnvironmentInfo;
  sites: SitesData;
  templates: TemplatesData;
  renderings: RenderingsData;
  placeholders: PlaceholdersData;
  layouts: LayoutsData;
  "content-map": ContentMapData;
  relationships: RelationshipsData;
}

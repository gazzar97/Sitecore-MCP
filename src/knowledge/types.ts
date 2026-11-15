/** File formats of the Instance Knowledge Base (docs/08-instance-knowledge-base.md). */

export const KNOWLEDGE_SCHEMA_VERSION = 1;

export const SECTIONS = ["environment", "sites", "templates", "renderings", "placeholders", "layouts"] as const;
export type SectionName = (typeof SECTIONS)[number];

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

export interface SectionDataMap {
  environment: EnvironmentInfo;
  sites: SitesData;
  templates: TemplatesData;
  renderings: RenderingsData;
  placeholders: PlaceholdersData;
  layouts: LayoutsData;
}

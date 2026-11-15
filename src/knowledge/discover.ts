import type { InstanceConfig } from "../config/schema.js";
import { WELL_KNOWN_TEMPLATES as T } from "../domain/templates.js";
import { treeSearch } from "../domain/treeSearch.js";
import type { ContentAdapter, Item } from "../domain/types.js";
import { toUserMessage } from "../errors.js";
import { isGuid, normalizeId, normalizePath, parseIdList } from "../util/ids.js";
import { generateOverview } from "./overview.js";
import type { KnowledgeStore } from "./store.js";
import {
  SECTIONS,
  type EnvironmentInfo,
  type KnowledgeField,
  type KnowledgePlaceholder,
  type KnowledgeRendering,
  type KnowledgeTemplate,
  type LayoutsData,
  type PlaceholdersData,
  type Ref,
  type RenderingType,
  type RenderingsData,
  type SectionDataMap,
  type SectionMeta,
  type SectionName,
  type SitesData,
  type TemplateKind,
  type TemplatesData,
} from "./types.js";

/**
 * First-run discovery (docs/08-instance-knowledge-base.md, phases A–D).
 * READ-ONLY against Sitecore: only adapter read methods are used. Writes go to the local knowledge folder.
 */

export interface DiscoverContext {
  name: string;
  config: InstanceConfig;
  adapter: ContentAdapter;
}

export interface DiscoverOptions {
  sections?: SectionName[];
  onProgress?: (message: string) => void;
}

export interface DiscoverResult {
  instance: string;
  dir: string;
  durationMs: number;
  sections: Partial<Record<SectionName, Pick<SectionMeta, "status" | "count" | "truncated" | "durationMs" | "error">>>;
}

const DB = "master" as const;
const MAX_DEPTH = 15;
const MAX_RESOLVE = 300;
const FOLDER_TEMPLATE = "{A87A00B1-E6DB-45AB-8B54-636FEC3B5523}";

const TEMPLATE_FIELDS = [
  "__Base template",
  "__Standard values",
  "__Icon",
  "__Revision",
  "__Masters",
  "__Renderings",
  "__Final Renderings",
  "__Default workflow",
  "Type",
  "Source",
  "Shared",
  "Unversioned",
  "__Sortorder",
];
const RENDERING_FIELDS = [
  "Path",
  "Controller",
  "Controller Action",
  "Component Name",
  "Datasource Template",
  "Datasource Location",
  "Parameters Template",
  "Compatible Renderings",
];

const MODULE_CHECKS: { key: keyof EnvironmentInfo["modules"]; path: string }[] = [
  { key: "sxa", path: "/sitecore/system/Settings/Foundation/Experience Accelerator" },
  { key: "headless", path: "/sitecore/templates/Foundation/JavaScript Services" },
  { key: "forms", path: "/sitecore/Forms" },
  { key: "spe", path: "/sitecore/system/Modules/PowerShell" },
  { key: "exm", path: "/sitecore/system/Modules/E-mail Experience Manager" },
];

export async function discover(ctx: DiscoverContext, store: KnowledgeStore, opts: DiscoverOptions = {}): Promise<DiscoverResult> {
  const started = Date.now();
  const wanted = new Set<SectionName>(opts.sections && opts.sections.length > 0 ? opts.sections : SECTIONS);
  const log = opts.onProgress ?? (() => {});
  const loc = { database: DB, language: ctx.config.defaultLanguage };
  const result: DiscoverResult = { instance: ctx.name, dir: store.dir, durationMs: 0, sections: {} };
  const resolver = new RefResolver(ctx.adapter, loc);
  let sitecoreVersion: string | undefined = (await store.readManifest())?.sitecoreVersion;
  const info = () => ({ cmUrl: ctx.config.cmUrl, sitecoreVersion });

  const phase = async <K extends SectionName>(
    name: K,
    run: () => Promise<{ data: SectionDataMap[K]; count: number; truncated: boolean }>,
  ) => {
    if (!wanted.has(name)) return;
    const t0 = Date.now();
    log(`[${name}] starting…`);
    try {
      const { data, count, truncated } = await run();
      const meta = { status: truncated ? ("partial" as const) : ("ok" as const), durationMs: Date.now() - t0, count, truncated };
      await store.writeSection(name, data, meta, info());
      result.sections[name] = meta;
      log(`[${name}] ${meta.status}: ${count} in ${(meta.durationMs / 1000).toFixed(1)} s${truncated ? " (truncated)" : ""}`);
    } catch (err) {
      const message = toUserMessage(err);
      await store.recordSectionError(name, message, Date.now() - t0, info());
      result.sections[name] = { status: "error", count: 0, truncated: false, durationMs: Date.now() - t0, error: message };
      log(`[${name}] error: ${message}`);
    }
  };

  const walk = async (root: string, w: { fields: string[]; includeStandardFields?: boolean; maxItems: number; skip?: string[] }) => {
    const rootItem = await ctx.adapter.getItem({ idOrPath: root, ...loc }, { fields: ["__Sortorder"] });
    if (!rootItem) return { root: null, items: [] as Item[], truncated: false };
    const res = await treeSearch(
      ctx.adapter,
      { idOrPath: rootItem.id, ...loc },
      {},
      {
        maxDepth: MAX_DEPTH,
        maxVisited: w.maxItems,
        limit: w.maxItems + 1,
        fields: w.fields,
        includeStandardFields: w.includeStandardFields,
        skipPaths: w.skip,
        concurrency: ctx.config.maxConcurrency,
      },
    );
    return { root: rootItem, items: res.matches, truncated: res.truncated };
  };

  // ---------------------------------------------------------------- A. environment
  await phase("environment", async () => {
    const [server, languages, ...checks] = await Promise.all([
      ctx.adapter.getServerInfo(),
      ctx.adapter
        .getChildren({ idOrPath: "/sitecore/system/Languages", ...loc }, { fields: ["__Sortorder"] })
        .catch(() => [] as Item[]),
      ...MODULE_CHECKS.map((c) =>
        ctx.adapter.getItem({ idOrPath: c.path, ...loc }, { fields: ["__Sortorder"] }).catch(() => null),
      ),
    ]);
    sitecoreVersion = server.sitecoreVersion ?? sitecoreVersion;
    const modules = Object.fromEntries(
      MODULE_CHECKS.map((c, i) => [c.key, { detected: !!checks[i], evidence: `${checks[i] ? "found" : "not found"}: ${c.path}` }]),
    ) as EnvironmentInfo["modules"];
    const data: EnvironmentInfo = { sitecoreVersion, languages: languages.map((l) => l.name), modules };
    return { data, count: data.languages.length, truncated: false };
  });

  // ---------------------------------------------------------------- B. sites
  await phase("sites", async () => {
    const data: SitesData = { sites: [], scannedRoots: [], truncated: false };
    for (const root of ctx.config.knowledge.contentRoots) {
      const w = await walk(root, { fields: ["__Sortorder"], maxItems: 2_000 });
      if (!w.root) continue;
      data.scannedRoots.push(w.root.path);
      data.truncated ||= w.truncated;
      const all = [w.root, ...w.items];
      const byId = new Map(all.map((i) => [i.id, i]));
      for (const home of all.filter((i) => i.name.toLowerCase() === "home" && i.parentId)) {
        const site = byId.get(home.parentId!);
        if (!site) continue;
        const isContentRoot = normalizePath(site.path).toLowerCase() === normalizePath(root).toLowerCase();
        data.sites.push({
          name: isContentRoot ? "website" : site.name,
          rootId: site.id,
          rootPath: site.path,
          rootTemplate: site.templateName,
          homePath: home.path,
          folders: all.filter((i) => i.parentId === site.id && i.id !== home.id).map((i) => i.name),
        });
      }
    }
    return { data, count: data.sites.length, truncated: data.truncated };
  });

  // ---------------------------------------------------------------- C. templates
  await phase("templates", async () => {
    const k = ctx.config.knowledge;
    const items: Item[] = [];
    const missingRoots: string[] = [];
    let truncated = false;
    let budget = k.maxTemplateItems;
    for (const root of k.templateRoots) {
      if (budget <= 0) {
        truncated = true;
        break;
      }
      const w = await walk(root, { fields: TEMPLATE_FIELDS, includeStandardFields: true, maxItems: budget, skip: k.excludePaths });
      if (!w.root) {
        missingRoots.push(root);
        continue;
      }
      log(`[templates] ${root}: ${w.items.length} items${w.truncated ? " (truncated)" : ""}`);
      items.push(...w.items);
      budget -= w.items.length;
      truncated ||= w.truncated;
    }
    const built = await buildTemplates(items, resolver);
    const data: TemplatesData = {
      ...built,
      roots: k.templateRoots,
      missingRoots,
      excluded: k.excludePaths,
      itemsWalked: items.length,
      truncated,
    };
    return { data, count: built.templates.length, truncated };
  });

  // ---------------------------------------------------------------- D. renderings, placeholders, layouts
  await phase("renderings", async () => {
    const k = ctx.config.knowledge;
    const items: Item[] = [];
    const missingRoots: string[] = [];
    let truncated = false;
    for (const root of k.renderingRoots) {
      const w = await walk(root, { fields: RENDERING_FIELDS, maxItems: k.maxRenderingItems, skip: k.excludePaths });
      if (!w.root) {
        missingRoots.push(root);
        continue;
      }
      items.push(...w.items);
      truncated ||= w.truncated;
    }
    const templates = (await store.readSection("templates"))?.data.templates ?? [];
    const renderings = buildRenderings(items, templates);
    const data: RenderingsData = { roots: k.renderingRoots, missingRoots, truncated, renderings };
    return { data, count: renderings.length, truncated };
  });

  await phase("placeholders", async () => {
    const w = await walk("/sitecore/layout/Placeholder Settings", { fields: ["Placeholder Key", "Allowed Controls"], maxItems: 3_000 });
    resolver.addKnown((await store.readSection("renderings"))?.data.renderings ?? []);
    const raw = w.items.filter((i) => (i.fields["Placeholder Key"] ?? "").trim() !== "");
    await resolver.resolve(raw.flatMap((p) => parseIdList(p.fields["Allowed Controls"])));
    const placeholders: KnowledgePlaceholder[] = raw.map((p) => ({
      id: p.id,
      name: p.name,
      path: p.path,
      key: p.fields["Placeholder Key"]!.trim(),
      allowedRenderings: parseIdList(p.fields["Allowed Controls"]).map((id) => resolver.ref(id)),
    }));
    const data: PlaceholdersData = { truncated: w.truncated, placeholders };
    return { data, count: placeholders.length, truncated: w.truncated };
  });

  await phase("layouts", async () => {
    const [w, devices] = await Promise.all([
      walk("/sitecore/layout/Layouts", { fields: ["Path"], maxItems: 1_000 }),
      ctx.adapter
        .getChildren({ idOrPath: "/sitecore/layout/Devices", ...loc }, { fields: ["__Sortorder"] })
        .catch(() => [] as Item[]),
    ]);
    const layouts = w.items
      .filter((i) => !/folder/i.test(i.templateName) && (/layout/i.test(i.templateName) || i.fields.Path))
      .map((i) => ({ id: i.id, name: i.name, path: i.path, filePath: i.fields.Path || undefined }));
    const data: LayoutsData = { layouts, devices: devices.map((d) => ({ id: d.id, name: d.name })) };
    return { data, count: layouts.length, truncated: w.truncated };
  });

  // ---------------------------------------------------------------- finalize
  if (wanted.has("templates") || wanted.has("renderings")) await relinkOnDisk(store, info());
  await store.ensureNotes();
  await store.writeOverview(await generateOverview(store));
  result.durationMs = Date.now() - started;
  log(`done in ${(result.durationMs / 1000).toFixed(1)} s -> ${store.dir}`);
  return result;
}

// ==================================================================== helpers

export class RefResolver {
  private readonly known = new Map<string, Ref>();
  private fetched = 0;

  constructor(
    private readonly adapter: ContentAdapter,
    private readonly loc: { database: typeof DB; language: string },
  ) {}

  addKnown(refs: Ref[]): void {
    for (const r of refs) this.known.set(r.id, { id: r.id, name: r.name, path: r.path });
  }

  /** Looks up unknown IDs (bounded) so references show names, not bare GUIDs. */
  async resolve(ids: string[]): Promise<void> {
    const unknown = [...new Set(ids.map(normalizeId))].filter((id) => !this.known.has(id));
    const batch = unknown.slice(0, Math.max(0, MAX_RESOLVE - this.fetched));
    this.fetched += batch.length;
    const items = await Promise.all(
      batch.map((id) => this.adapter.getItem({ idOrPath: id, ...this.loc }, { fields: ["__Sortorder"] }).catch(() => null)),
    );
    items.forEach((item, i) => {
      if (item) this.known.set(batch[i]!, { id: item.id, name: item.name, path: item.path });
    });
  }

  ref(id: string): Ref {
    const n = normalizeId(id);
    return this.known.get(n) ?? { id: n, name: "(unresolved)" };
  }
}

const toRef = (x: { id: string; name: string; path?: string }): Ref => ({ id: x.id, name: x.name, path: x.path });

function sortOrder(i: Item): number {
  const n = Number.parseInt(i.fields.__Sortorder ?? "", 10);
  return Number.isNaN(n) ? 100 : n;
}
const bySortOrder = (a: Item, b: Item) => sortOrder(a) - sortOrder(b) || a.name.localeCompare(b.name);

/** Resolves a "Datasource Template"-style value (GUID or path) against catalogued templates. */
function templateLookup(templates: KnowledgeTemplate[]) {
  const byPath = new Map(templates.map((t) => [normalizePath(t.path).toLowerCase(), t]));
  const byId = new Map(templates.map((t) => [t.id, t]));
  return (raw: string | undefined): { raw: string; template?: Ref } | undefined => {
    const v = (raw ?? "").trim();
    if (!v) return undefined;
    const t = isGuid(v) ? byId.get(normalizeId(v)) : byPath.get(normalizePath(v).toLowerCase());
    return { raw: v, template: t ? toRef(t) : undefined };
  };
}

export async function buildTemplates(items: Item[], resolver: RefResolver): Promise<Pick<TemplatesData, "templates" | "external">> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const children = new Map<string, Item[]>();
  for (const i of items) if (i.parentId) children.set(i.parentId, [...(children.get(i.parentId) ?? []), i]);
  const kids = (id: string) => children.get(id) ?? [];

  const templateItems = items.filter((i) => i.templateId === T.template);
  resolver.addKnown(templateItems.map(toRef));

  const raw = templateItems.map((t) => {
    const svField = t.fields["__Standard values"];
    const sv =
      (svField && isGuid(svField) ? byId.get(normalizeId(svField)) : undefined) ??
      kids(t.id).find((c) => c.name.toLowerCase() === "__standard values");
    const ownFields: KnowledgeField[] = kids(t.id)
      .filter((s) => s.templateId === T.templateSection)
      .sort(bySortOrder)
      .flatMap((section) =>
        kids(section.id)
          .filter((f) => f.templateId === T.templateField)
          .sort(bySortOrder)
          .map((f) => ({
            id: f.id,
            name: f.name,
            type: f.fields.Type ?? "",
            section: section.name,
            source: f.fields.Source || undefined,
            shared: f.fields.Shared === "1",
            unversioned: f.fields.Unversioned === "1",
          })),
      );
    const workflow = sv?.fields["__Default workflow"] || t.fields["__Default workflow"] || "";
    return {
      t,
      sv,
      ownFields,
      baseIds: parseIdList(t.fields["__Base template"]),
      insertIds: parseIdList(sv?.fields["__Masters"]),
      workflowId: isGuid(workflow) ? normalizeId(workflow) : undefined,
      hasLayout: !!((sv?.fields["__Final Renderings"] ?? "").trim() || (sv?.fields["__Renderings"] ?? "").trim()),
    };
  });

  await resolver.resolve(raw.flatMap((r) => [...r.baseIds, ...r.insertIds, ...(r.workflowId ? [r.workflowId] : [])]));
  const inScope = new Set(templateItems.map((t) => t.id));
  const external = new Map<string, Ref>();

  const templates: KnowledgeTemplate[] = raw.map((r) => {
    const baseTemplates = r.baseIds.map((id) => resolver.ref(id));
    for (const b of baseTemplates) if (!inScope.has(b.id)) external.set(b.id, b);
    return {
      id: r.t.id,
      name: r.t.name,
      path: r.t.path,
      kind: "other",
      kindReason: "",
      baseTemplates,
      ownFields: r.ownFields,
      standardValuesId: r.sv?.id,
      insertOptions: r.insertIds.map((id) => resolver.ref(id)),
      allowedUnder: [],
      datasourceFor: [],
      hasLayout: r.hasLayout,
      defaultWorkflow: r.workflowId ? resolver.ref(r.workflowId) : undefined,
      icon: r.t.fields.__Icon || undefined,
      revision: r.t.fields.__Revision || undefined,
    };
  });
  linkTemplates(templates, []);
  return { templates, external: [...external.values()] };
}

/** Computes allowedUnder, datasourceFor and kind. Pure; safe to re-run. */
export function linkTemplates(templates: KnowledgeTemplate[], renderings: KnowledgeRendering[]): void {
  const usedAsBase = new Map<string, number>();
  for (const t of templates) {
    t.allowedUnder = [];
    t.datasourceFor = [];
    for (const b of t.baseTemplates) usedAsBase.set(b.id, (usedAsBase.get(b.id) ?? 0) + 1);
  }
  const byId = new Map(templates.map((t) => [t.id, t]));
  for (const t of templates) for (const io of t.insertOptions) byId.get(io.id)?.allowedUnder.push(toRef(t));
  for (const r of renderings) {
    const ds = r.datasourceTemplate?.template;
    if (ds) byId.get(ds.id)?.datasourceFor.push(toRef(r));
  }
  for (const t of templates) [t.kind, t.kindReason] = classify(t, usedAsBase.get(t.id) ?? 0);
}

function classify(t: KnowledgeTemplate, usedAsBaseBy: number): [TemplateKind, string] {
  if (t.hasLayout) return ["page", "standard values have a layout"];
  if (t.datasourceFor.length > 0) {
    return ["datasource", `datasource template of: ${t.datasourceFor.slice(0, 5).map((r) => r.name).join(", ")}`];
  }
  if (/folder/i.test(t.name)) return ["folder", "name contains 'folder'"];
  if (t.baseTemplates.some((b) => b.id === FOLDER_TEMPLATE)) return ["folder", "inherits the Folder template"];
  if (t.name.startsWith("_")) return ["base", "name starts with '_'"];
  if (usedAsBaseBy > 0 && !t.standardValuesId) return ["base", `base template of ${usedAsBaseBy} template(s), no standard values`];
  return ["other", "no layout, not a known datasource, folder or base template"];
}

function renderingType(templateName: string): RenderingType | null {
  const n = templateName.toLowerCase();
  if (n.includes("folder")) return null;
  if (n === "view rendering") return "view";
  if (n === "controller rendering") return "controller";
  if (n === "json rendering") return "json";
  return n.includes("rendering") ? "other" : null;
}

export function buildRenderings(items: Item[], templates: KnowledgeTemplate[]): KnowledgeRendering[] {
  const lookup = templateLookup(templates);
  const renderings: KnowledgeRendering[] = [];
  for (const i of items) {
    const type = renderingType(i.templateName);
    if (!type) continue;
    const controller = i.fields.Controller;
    const action = i.fields["Controller Action"];
    renderings.push({
      id: i.id,
      name: i.name,
      path: i.path,
      type,
      templateName: i.templateName,
      componentName: i.fields["Component Name"] || undefined,
      viewPath: i.fields.Path || undefined,
      controller: controller ? `${controller}${action ? `.${action}` : ""}` : undefined,
      datasourceTemplate: lookup(i.fields["Datasource Template"]),
      datasourceLocation: i.fields["Datasource Location"] || undefined,
      parametersTemplate: lookup(i.fields["Parameters Template"]),
      compatibleRenderings: parseIdList(i.fields["Compatible Renderings"]).map((id) => ({ id, name: "(unresolved)" })),
    });
  }
  const byId = new Map(renderings.map((r) => [r.id, r]));
  for (const r of renderings) {
    r.compatibleRenderings = r.compatibleRenderings.map((c) => (byId.has(c.id) ? toRef(byId.get(c.id)!) : c));
  }
  return renderings;
}

/** Re-links templates <-> renderings from what's on disk, so refreshing either section keeps both consistent. */
async function relinkOnDisk(store: KnowledgeStore, info: { cmUrl: string; sitecoreVersion?: string }): Promise<void> {
  const [tFile, rFile, manifest] = await Promise.all([
    store.readSection("templates"),
    store.readSection("renderings"),
    store.readManifest(),
  ]);
  if (!tFile) return;
  const lookup = templateLookup(tFile.data.templates);
  const renderings = (rFile?.data.renderings ?? []).map((r) => ({
    ...r,
    datasourceTemplate: lookup(r.datasourceTemplate?.raw),
    parametersTemplate: lookup(r.parametersTemplate?.raw),
  }));
  linkTemplates(tFile.data.templates, renderings);

  const keepMeta = (name: SectionName, count: number) => {
    const m = manifest?.sections[name];
    return { status: m?.status ?? ("ok" as const), durationMs: m?.durationMs ?? 0, count, truncated: m?.truncated ?? false };
  };
  await store.writeSection("templates", tFile.data, keepMeta("templates", tFile.data.templates.length), info);
  if (rFile) {
    await store.writeSection("renderings", { ...rFile.data, renderings }, keepMeta("renderings", renderings.length), info);
  }
}

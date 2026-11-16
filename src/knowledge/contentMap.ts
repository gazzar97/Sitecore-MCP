import { primaryDevice, resolveLayout } from "../domain/layout.js";
import { treeSearch } from "../domain/treeSearch.js";
import type { ContentAdapter, Item } from "../domain/types.js";
import { mapLimit } from "../util/concurrency.js";
import { isGuid, isPathAtOrUnder, normalizeId, normalizePath } from "../util/ids.js";
import type {
  ContentMapData,
  ContentTemplateUsage,
  KnowledgeRendering,
  KnowledgeTemplate,
  LayoutsData,
  OutlineNode,
  PageSample,
  PlacedRendering,
  Ref,
  SiteContentMap,
  SiteInfo,
} from "./types.js";

/**
 * Phase E of discovery (docs/08-instance-knowledge-base.md §5): a bounded walk of each site,
 * template usage counts, and the parsed layout of a few sample pages per template.
 * READ-ONLY: only getItem/getChildren are used.
 */

export interface RefLookup {
  addKnown(refs: Ref[]): void;
  resolve(ids: string[]): Promise<void>;
  ref(id: string): Ref;
}

export interface ContentMapInput {
  adapter: ContentAdapter;
  loc: { database: "master"; language: string };
  sites: SiteInfo[];
  templates: KnowledgeTemplate[];
  renderings: KnowledgeRendering[];
  layouts?: LayoutsData;
  resolver: RefLookup;
  limits: { maxContentItems: number; samplesPerTemplate: number; maxSampledPages: number; concurrency: number };
  log: (message: string) => void;
}

const MAX_DEPTH = 15;
const OUTLINE_DEPTH = 2;
const MAX_OUTLINE = 60;
const MAX_PARAM_LENGTH = 100;
const LAYOUT_FIELDS = ["__Renderings", "__Final Renderings"];
const SECRET_RE = /password|secret|token|apikey|api_key|connectionstring/i;
const NOT_PAGE_KINDS = new Set(["folder", "datasource", "base"]);

const segments = (path: string) => normalizePath(path).split("/").filter(Boolean).length;
const samePath = (a: string, b: string) => normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();

export async function discoverContentMap(input: ContentMapInput): Promise<ContentMapData> {
  const { adapter, loc, limits, log } = input;
  const kindById = new Map(input.templates.map((t) => [t.id, t.kind]));
  const data: ContentMapData = { sites: [], truncated: false };
  const walkedById = new Map<string, Item>();
  const walked: { site: SiteContentMap; items: Item[] }[] = [];

  // 1. Walk every site (bounded) and count templates.
  for (const site of input.sites) {
    // A site whose root contains other sites (classic /sitecore/content) must not walk into them.
    const nested = input.sites
      .filter((s) => s !== site && !samePath(s.rootPath, site.rootPath) && isPathAtOrUnder(s.rootPath, site.rootPath))
      .map((s) => s.rootPath);
    const res = await treeSearch(
      adapter,
      { idOrPath: site.rootId, ...loc },
      {},
      {
        maxDepth: MAX_DEPTH,
        maxVisited: limits.maxContentItems,
        limit: limits.maxContentItems + 1,
        concurrency: limits.concurrency,
        skipPaths: nested,
      },
    );
    for (const i of res.matches) walkedById.set(i.id, i);
    const map = summarizeSite(site, res.matches, res.truncated);
    data.truncated ||= res.truncated;
    data.sites.push(map);
    walked.push({ site: map, items: res.matches });
    log(`[content-map] ${site.name}: ${res.matches.length} items${res.truncated ? " (truncated)" : ""}`);
  }

  // 2. Pick sample pages: per template, the shallowest few (BFS order), within a global budget.
  let budget = limits.maxSampledPages;
  const toSample: { site: SiteContentMap; item: Item }[] = [];
  for (const { site, items } of walked) {
    const perTemplate = new Map<string, number>();
    for (const item of items) {
      if (!isPageCandidate(item, site.homePath, kindById.get(item.templateId))) continue;
      const n = perTemplate.get(item.templateId) ?? 0;
      if (n >= limits.samplesPerTemplate) continue;
      if (budget <= 0) {
        data.truncated = true;
        break;
      }
      perTemplate.set(item.templateId, n + 1);
      toSample.push({ site, item });
      budget--;
    }
  }

  // 3. Read and parse their layouts.
  const fetched = await mapLimit(toSample, limits.concurrency, ({ item }) =>
    adapter.getItem({ idOrPath: item.id, ...loc }, { fields: LAYOUT_FIELDS, includeStandardFields: true }).catch(() => null),
  );
  const parsed = toSample.map(({ site, item }, i) => {
    const full = fetched[i];
    const layout = resolveLayout(full?.fields.__Renderings, full?.fields["__Final Renderings"]);
    return { site, item, layout, device: primaryDevice(layout) };
  });

  input.resolver.addKnown(input.renderings);
  input.resolver.addKnown(input.layouts?.layouts ?? []);
  await input.resolver.resolve(
    parsed.flatMap((p) => [
      ...(p.device?.renderings.map((r) => r.renderingId) ?? []),
      ...(p.device?.layoutId ? [p.device.layoutId] : []),
    ]),
  );
  const deviceName = new Map((input.layouts?.devices ?? []).map((d) => [d.id, d.name]));

  for (const { site, item, layout, device } of parsed) {
    const sample: PageSample = {
      id: item.id,
      path: item.path,
      template: { id: item.templateId, name: item.templateName },
      layoutSource: layout.source,
      layout: device?.layoutId ? input.resolver.ref(device.layoutId) : undefined,
      device: device ? (deviceName.get(device.deviceId) ?? device.deviceId) : undefined,
      renderings: (device?.renderings ?? []).map((r) => placed(r, item.path, walkedById, input.resolver)),
    };
    site.samples.push(sample);
  }
  const withLayout = parsed.filter((p) => p.layout.source !== "none").length;
  log(`[content-map] sampled ${parsed.length} pages, ${withLayout} with a layout`);
  return data;
}

function isPageCandidate(item: Item, homePath: string, kind: string | undefined): boolean {
  if (kind === "page") return true;
  if (kind && NOT_PAGE_KINDS.has(kind)) return false;
  if (/folder/i.test(item.templateName)) return false;
  return isPathAtOrUnder(item.path, homePath);
}

function placed(
  r: { renderingId: string; placeholder: string; datasource?: string; params: Record<string, string> },
  pagePath: string,
  walked: Map<string, Item>,
  resolver: RefLookup,
): PlacedRendering {
  const ds = r.datasource;
  let datasourcePath: string | undefined;
  if (ds && isGuid(ds)) datasourcePath = walked.get(normalizeId(ds))?.path;
  else if (ds?.toLowerCase().startsWith("local:")) datasourcePath = normalizePath(`${pagePath}/${ds.slice(6).replace(/^\/+/, "")}`);
  else if (ds?.startsWith("/sitecore")) datasourcePath = normalizePath(ds);
  const params = Object.fromEntries(
    Object.entries(r.params)
      .filter(([k, v]) => v !== "" && !SECRET_RE.test(k))
      .map(([k, v]) => [k, v.length > MAX_PARAM_LENGTH ? `${v.slice(0, MAX_PARAM_LENGTH)}…` : v]),
  );
  return {
    rendering: resolver.ref(r.renderingId),
    placeholder: r.placeholder,
    datasource: ds,
    datasourcePath,
    params: Object.keys(params).length ? params : undefined,
  };
}

export function summarizeSite(site: SiteInfo, items: Item[], truncated: boolean): SiteContentMap {
  const rootDepth = segments(site.rootPath);
  const depthOf = (i: Item) => segments(i.path) - rootDepth;
  const byId = new Map(items.map((i) => [i.id, i]));

  // Outline: the top levels, with how many walked items sit below each node.
  const descendants = new Map<string, number>();
  for (const i of items) {
    const parts = normalizePath(i.path).split("/").filter(Boolean);
    for (let d = 1; d <= OUTLINE_DEPTH && d < depthOf(i); d++) {
      const key = `/${parts.slice(0, rootDepth + d).join("/")}`.toLowerCase();
      descendants.set(key, (descendants.get(key) ?? 0) + 1);
    }
  }
  const outline: OutlineNode[] = items
    .filter((i) => depthOf(i) <= OUTLINE_DEPTH)
    .slice(0, MAX_OUTLINE)
    .map((i) => ({
      path: i.path,
      templateName: i.templateName,
      depth: depthOf(i),
      descendants: descendants.get(normalizePath(i.path).toLowerCase()) ?? 0,
    }));

  // Template usage.
  const usage = new Map<string, ContentTemplateUsage & { parents: Map<string, number> }>();
  for (const i of items) {
    let u = usage.get(i.templateId);
    if (!u) {
      u = {
        template: { id: i.templateId, name: i.templateName },
        count: 0,
        underHome: 0,
        minDepth: Number.POSITIVE_INFINITY,
        maxDepth: 0,
        parentTemplates: [],
        samplePaths: [],
        parents: new Map(),
      };
      usage.set(i.templateId, u);
    }
    const depth = depthOf(i);
    u.count++;
    if (isPathAtOrUnder(i.path, site.homePath)) u.underHome++;
    u.minDepth = Math.min(u.minDepth, depth);
    u.maxDepth = Math.max(u.maxDepth, depth);
    if (u.samplePaths.length < 3) u.samplePaths.push(i.path);
    const parentTemplate = (i.parentId && byId.get(i.parentId)?.templateName) || (depth === 1 ? site.rootTemplate : "?");
    u.parents.set(parentTemplate, (u.parents.get(parentTemplate) ?? 0) + 1);
  }
  const templates = [...usage.values()]
    .map(({ parents, ...u }) => ({
      ...u,
      parentTemplates: [...parents.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, count]) => ({ name, count })),
    }))
    .sort((a, b) => b.count - a.count || a.template.name.localeCompare(b.template.name));

  return {
    site: site.name,
    rootPath: site.rootPath,
    homePath: site.homePath,
    itemsWalked: items.length,
    truncated,
    maxDepth: items.reduce((m, i) => Math.max(m, depthOf(i)), 0),
    outline,
    templates,
    samples: [],
  };
}

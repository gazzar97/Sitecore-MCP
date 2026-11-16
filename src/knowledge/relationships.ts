import { placeholderKey } from "../domain/layout.js";
import { normalizePath } from "../util/ids.js";
import type {
  ContentMapData,
  KnowledgeRendering,
  KnowledgeTemplate,
  PageSample,
  PageType,
  Ref,
  RelationshipsData,
  RenderingUsage,
} from "./types.js";

/**
 * Derives relationships from the discovered sections (docs/08 §3 "Relationships"). Pure and local:
 * no Sitecore calls, so it is recomputed after every discovery run.
 */

const MAX_SAMPLE_PATHS = 3;
const top = <T>(counts: Map<T, number>, n: number): T[] =>
  [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
const bump = <T>(m: Map<T, number>, k: T) => m.set(k, (m.get(k) ?? 0) + 1);

/** Copies content usage onto templates (templates.json `usage`), so classification can use it. */
export function applyContentUsage(templates: KnowledgeTemplate[], map: ContentMapData | undefined): void {
  const byId = new Map(templates.map((t) => [t.id, t]));
  for (const t of templates) delete t.usage;
  if (!map) return;
  for (const site of map.sites) {
    for (const u of site.templates) {
      const t = byId.get(u.template.id);
      if (!t) continue;
      t.usage ??= { items: 0, sampled: 0, sampledWithLayout: 0, samplePaths: [] };
      t.usage.items += u.count;
      for (const p of u.samplePaths) if (t.usage.samplePaths.length < MAX_SAMPLE_PATHS) t.usage.samplePaths.push(p);
    }
    for (const s of site.samples) {
      const t = byId.get(s.template.id);
      if (!t?.usage) continue;
      t.usage.sampled++;
      if (s.layoutSource !== "none") t.usage.sampledWithLayout++;
    }
  }
}

/** Where a datasource lives, generalized so it can be counted: "<page>/Data", "local:/Data", "/sitecore/content/Site/Data/Heroes". */
function datasourceFolder(r: { datasource?: string; datasourcePath?: string }, pagePath: string): string | undefined {
  if (r.datasource?.toLowerCase().startsWith("local:")) {
    const rel = normalizePath(r.datasource.slice(6)).replace(/\/[^/]*$/, "");
    return `local:${rel || "/"}`;
  }
  if (!r.datasourcePath) return undefined;
  const folder = normalizePath(r.datasourcePath).replace(/\/[^/]*$/, "");
  const page = normalizePath(pagePath);
  if (folder.toLowerCase() === page.toLowerCase()) return "<page>";
  if (folder.toLowerCase().startsWith(`${page.toLowerCase()}/`)) return `<page>${folder.slice(page.length)}`;
  return folder;
}

export function buildRelationships(
  templates: KnowledgeTemplate[],
  renderings: KnowledgeRendering[],
  map: ContentMapData,
): RelationshipsData {
  const tplById = new Map(templates.map((t) => [t.id, t]));
  const samples: { site: string; sample: PageSample }[] = map.sites.flatMap((s) =>
    s.samples.filter((x) => x.layoutSource !== "none").map((sample) => ({ site: s.site, sample })),
  );

  // Item counts and sites per template, across all walked sites.
  const items = new Map<string, { ref: Ref; count: number; sites: Set<string>; paths: string[] }>();
  for (const site of map.sites) {
    for (const u of site.templates) {
      const e = items.get(u.template.id) ?? { ref: u.template, count: 0, sites: new Set<string>(), paths: [] };
      e.count += u.count;
      e.sites.add(site.site);
      e.paths.push(...u.samplePaths);
      items.set(u.template.id, e);
    }
  }

  // Page types: templates sampled with a layout, plus catalogued page templates that have content.
  const pageTypeIds = new Set(samples.map((s) => s.sample.template.id));
  for (const t of templates) if (t.kind === "page" && (items.get(t.id)?.count ?? 0) > 0) pageTypeIds.add(t.id);

  const pageTypes: PageType[] = [...pageTypeIds].map((id) => {
    const own = samples.filter((s) => s.sample.template.id === id);
    const perRendering = new Map<string, { rendering: Ref; pages: Set<string>; placeholders: Set<string> }>();
    for (const { sample } of own) {
      for (const r of sample.renderings) {
        const e = perRendering.get(r.rendering.id) ?? { rendering: r.rendering, pages: new Set(), placeholders: new Set() };
        e.pages.add(sample.id);
        if (r.placeholder) e.placeholders.add(placeholderKey(r.placeholder));
        perRendering.set(r.rendering.id, e);
      }
    }
    const t = tplById.get(id);
    const usage = items.get(id);
    return {
      template: t ? { id: t.id, name: t.name, path: t.path } : (usage?.ref ?? own[0]!.sample.template),
      items: usage?.count ?? 0,
      sites: [...(usage?.sites ?? [])],
      allowedUnder: t?.allowedUnder.map((r) => r.name) ?? [],
      kindReason: t ? t.kindReason : "not catalogued; sampled items have a layout",
      renderings: [...perRendering.values()]
        .map((e) => ({ rendering: e.rendering, pages: e.pages.size, placeholders: [...e.placeholders] }))
        .sort((a, b) => b.pages - a.pages || a.rendering.name.localeCompare(b.rendering.name)),
      sampled: own.length,
      samplePaths: (own.length ? own.map((s) => s.sample.path) : (usage?.paths ?? [])).slice(0, MAX_SAMPLE_PATHS),
    };
  });
  pageTypes.sort((a, b) => b.items - a.items || a.template.name.localeCompare(b.template.name));

  // Rendering usage across sampled pages.
  const usage = new Map<
    string,
    { rendering: Ref; pages: Set<string>; placeholders: Set<string>; pageTypes: Set<string>; paths: string[]; folders: Map<string, number> }
  >();
  const placeholders = new Map<string, { renderings: Set<string>; pages: Set<string> }>();
  for (const { sample } of samples) {
    for (const r of sample.renderings) {
      const e = usage.get(r.rendering.id) ?? {
        rendering: r.rendering,
        pages: new Set<string>(),
        placeholders: new Set<string>(),
        pageTypes: new Set<string>(),
        paths: [],
        folders: new Map<string, number>(),
      };
      if (!e.pages.has(sample.id) && e.paths.length < MAX_SAMPLE_PATHS) e.paths.push(sample.path);
      e.pages.add(sample.id);
      e.pageTypes.add(sample.template.name);
      const key = r.placeholder ? placeholderKey(r.placeholder) : "";
      if (key) e.placeholders.add(key);
      const folder = datasourceFolder(r, sample.path);
      if (folder) bump(e.folders, folder);
      usage.set(r.rendering.id, e);
      if (key) {
        const p = placeholders.get(key) ?? { renderings: new Set<string>(), pages: new Set<string>() };
        p.renderings.add(r.rendering.name);
        p.pages.add(sample.id);
        placeholders.set(key, p);
      }
    }
  }
  const renderingUsage: RenderingUsage[] = [...usage.values()]
    .map((e) => ({
      rendering: e.rendering,
      pages: e.pages.size,
      placeholders: [...e.placeholders],
      pageTypes: [...e.pageTypes],
      samplePaths: e.paths,
      datasourceFolders: top(e.folders, 3),
    }))
    .sort((a, b) => b.pages - a.pages || a.rendering.name.localeCompare(b.rendering.name));

  return {
    pageTypes,
    renderingUsage,
    unusedRenderings:
      samples.length === 0 ? [] : renderings.filter((r) => !usage.has(r.id)).map((r) => ({ id: r.id, name: r.name, path: r.path })),
    placeholderUsage: [...placeholders.entries()]
      .map(([key, p]) => ({ key, renderings: [...p.renderings].sort(), pages: p.pages.size }))
      .sort((a, b) => b.pages - a.pages || a.key.localeCompare(b.key)),
    sampledPages: samples.length,
  };
}

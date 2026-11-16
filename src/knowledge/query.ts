import type { KnowledgeStore } from "./store.js";
import type { KnowledgeRendering, KnowledgeTemplate, TemplateKind } from "./types.js";

export const QUERY_SECTIONS = [
  "overview",
  "notes",
  "manifest",
  "environment",
  "sites",
  "templates",
  "renderings",
  "placeholders",
  "layouts",
  "content-map",
  "relationships",
] as const;
export type QuerySection = (typeof QUERY_SECTIONS)[number];

export interface QueryArgs {
  section: QuerySection;
  query?: string;
  kind?: TemplateKind;
  limit: number;
  staleAfterDays: number;
}

/** Above this many matches, results are summaries; at or below, full detail. */
const DETAIL_THRESHOLD = 3;

const contains = (haystack: string | undefined, needle: string) =>
  (haystack ?? "").toLowerCase().includes(needle.toLowerCase());

export async function queryKnowledge(store: KnowledgeStore, args: QueryArgs): Promise<Record<string, unknown>> {
  const manifest = await store.readManifest();
  if (!manifest) {
    return {
      available: false,
      instance: store.instance,
      message: `No knowledge base for instance "${store.instance}" yet.`,
      hint: `Run discovery: npm run discover -- ${store.instance}   (read-only; writes to ${store.dir})`,
    };
  }
  const ageDays = Math.floor((Date.now() - Date.parse(manifest.updatedAt)) / 86_400_000);
  const base = {
    available: true,
    instance: store.instance,
    section: args.section,
    updatedAt: manifest.updatedAt,
    ageDays,
    stale: ageDays > args.staleAfterDays,
  };
  const q = args.query?.trim();

  switch (args.section) {
    case "overview":
      return {
        ...base,
        overview: (await store.readOverview()) ?? "(overview.md missing: re-run discovery)",
        hasNotes: !!(await store.readNotes()),
      };
    case "notes":
      return { ...base, notesPath: `${store.dir}/notes.md`, notes: (await store.readNotes()) ?? "" };
    case "manifest":
      return { ...base, manifest };
    case "environment":
    case "sites":
    case "layouts": {
      const file = await store.readSection(args.section);
      return file ? { ...base, generatedAt: file.generatedAt, data: file.data } : missing(base, args.section);
    }
    case "templates": {
      const file = await store.readSection("templates");
      if (!file) return missing(base, "templates");
      const all = file.data.templates;
      const matches = all.filter(
        (t) =>
          (!q || contains(t.name, q) || contains(t.path, q) || t.id === q.toUpperCase()) &&
          (!args.kind || t.kind === args.kind),
      );
      const detailed = matches.length <= DETAIL_THRESHOLD;
      return {
        ...base,
        generatedAt: file.generatedAt,
        total: all.length,
        matched: matches.length,
        results: detailed ? matches.map((t) => templateDetail(t, all)) : matches.slice(0, args.limit).map(templateSummary),
        truncatedResults: !detailed && matches.length > args.limit,
      };
    }
    case "renderings": {
      const file = await store.readSection("renderings");
      if (!file) return missing(base, "renderings");
      const all = file.data.renderings;
      const matches = all.filter(
        (r) => !q || contains(r.name, q) || contains(r.componentName, q) || contains(r.path, q) || r.id === q.toUpperCase(),
      );
      const detailed = matches.length <= DETAIL_THRESHOLD;
      return {
        ...base,
        generatedAt: file.generatedAt,
        total: all.length,
        matched: matches.length,
        results: detailed ? matches : matches.slice(0, args.limit).map(renderingSummary),
        truncatedResults: !detailed && matches.length > args.limit,
      };
    }
    case "content-map": {
      const file = await store.readSection("content-map");
      if (!file) return missing(base, "content-map");
      const sites = file.data.sites;
      if (!q) {
        // Summary per site; samples and full template lists only on request.
        return {
          ...base,
          generatedAt: file.generatedAt,
          truncated: file.data.truncated,
          sites: sites.map((s) => ({
            site: s.site,
            rootPath: s.rootPath,
            homePath: s.homePath,
            itemsWalked: s.itemsWalked,
            truncated: s.truncated,
            maxDepth: s.maxDepth,
            outline: s.outline,
            topTemplates: s.templates.slice(0, args.limit).map((t) => ({ template: t.template.name, count: t.count })),
            sampledPages: s.samples.length,
          })),
          hint: 'Pass query = a site name for its full map, or a template name / path for matching templates and sample pages.',
        };
      }
      const site = sites.find((s) => s.site.toLowerCase() === q.toLowerCase());
      if (site) return { ...base, generatedAt: file.generatedAt, site };
      return {
        ...base,
        generatedAt: file.generatedAt,
        results: sites
          .map((s) => ({
            site: s.site,
            templates: s.templates.filter((t) => contains(t.template.name, q) || t.template.id === q.toUpperCase()),
            samples: s.samples.filter((p) => contains(p.template.name, q) || contains(p.path, q)).slice(0, args.limit),
          }))
          .filter((s) => s.templates.length > 0 || s.samples.length > 0),
      };
    }
    case "relationships": {
      const file = await store.readSection("relationships");
      if (!file) return missing(base, "content-map");
      const d = file.data;
      const pageTypes = d.pageTypes.filter((p) => !q || contains(p.template.name, q) || p.template.id === q.toUpperCase());
      const renderingUsage = d.renderingUsage.filter(
        (r) => !q || contains(r.rendering.name, q) || r.rendering.id === q.toUpperCase(),
      );
      const placeholderUsage = d.placeholderUsage.filter((p) => !q || contains(p.key, q));
      return {
        ...base,
        generatedAt: file.generatedAt,
        sampledPages: d.sampledPages,
        pageTypes: pageTypes.slice(0, args.limit),
        renderingUsage: renderingUsage.slice(0, args.limit),
        placeholderUsage: placeholderUsage.slice(0, args.limit),
        unusedRenderings: q ? undefined : d.unusedRenderings.slice(0, args.limit).map((r) => r.name),
        note: "Rendering usage is based on sampled pages, not every page.",
      };
    }
    case "placeholders": {
      const file = await store.readSection("placeholders");
      if (!file) return missing(base, "placeholders");
      const all = file.data.placeholders;
      const matches = all.filter((p) => !q || contains(p.key, q) || contains(p.name, q));
      return {
        ...base,
        generatedAt: file.generatedAt,
        total: all.length,
        matched: matches.length,
        results: matches.slice(0, args.limit),
      };
    }
  }
}

function missing(base: Record<string, unknown>, section: string) {
  return {
    ...base,
    data: null,
    message: `Section "${section}" was not discovered yet.`,
    hint: `npm run discover -- <instance> --sections ${section}`,
  };
}

function templateSummary(t: KnowledgeTemplate) {
  return {
    id: t.id,
    name: t.name,
    path: t.path,
    kind: t.kind,
    items: t.usage?.items,
    ownFields: t.ownFields.length,
    insertOptions: t.insertOptions.map((r) => r.name),
    datasourceFor: t.datasourceFor.map((r) => r.name),
  };
}

/** Full detail, including fields inherited through catalogued base templates. */
export function templateDetail(t: KnowledgeTemplate, all: KnowledgeTemplate[]) {
  const byId = new Map(all.map((x) => [x.id, x]));
  const inheritedFields: { name: string; type: string; section: string; definedIn: string }[] = [];
  const inheritsFromNotCatalogued: string[] = [];
  const seen = new Set([t.id]);
  const queue = [...t.baseTemplates];
  while (queue.length > 0) {
    const ref = queue.shift()!;
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    const base = byId.get(ref.id);
    if (!base) {
      inheritsFromNotCatalogued.push(ref.name);
      continue;
    }
    inheritedFields.push(...base.ownFields.map((f) => ({ name: f.name, type: f.type, section: f.section, definedIn: base.name })));
    queue.push(...base.baseTemplates);
  }
  return { ...t, inheritedFields, inheritsFromNotCatalogued };
}

function renderingSummary(r: KnowledgeRendering) {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    componentName: r.componentName,
    datasourceTemplate: r.datasourceTemplate?.template?.name ?? r.datasourceTemplate?.raw,
    datasourceLocation: r.datasourceLocation,
  };
}

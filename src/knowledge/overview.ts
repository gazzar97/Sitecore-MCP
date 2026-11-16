import type { KnowledgeStore } from "./store.js";
import { SECTIONS, type KnowledgeTemplate, type SectionName, type TemplateKind } from "./types.js";

const MAX_LIST = 25;

/**
 * Builds overview.md: the compact (~3k tokens) summary read at the start of every session.
 * Detail stays in the section files and is fetched through sitecore_knowledge.
 */
export async function generateOverview(store: KnowledgeStore): Promise<string> {
  const [manifest, env, sites, templates, renderings, placeholders, layouts, contentMap, relationships] = await Promise.all([
    store.readManifest(),
    store.readSection("environment"),
    store.readSection("sites"),
    store.readSection("templates"),
    store.readSection("renderings"),
    store.readSection("placeholders"),
    store.readSection("layouts"),
    store.readSection("content-map"),
    store.readSection("relationships"),
  ]);
  const out: string[] = [];
  const more = (n: number, max = MAX_LIST) => (n > max ? `… and ${n - max} more` : "");

  const modules = env
    ? Object.entries(env.data.modules)
        .filter(([, m]) => m.detected)
        .map(([k]) => k.toUpperCase())
    : [];
  out.push(`# Instance: ${store.instance} (Sitecore ${manifest?.sitecoreVersion ?? "unknown"})`);
  out.push(
    `Updated ${manifest?.updatedAt?.slice(0, 10) ?? "?"} · languages: ${env?.data.languages.join(", ") || "?"} · modules: ${modules.join(", ") || "none detected"}`,
  );
  out.push("");
  out.push(
    "Use `sitecore_knowledge` with a section (templates, renderings, placeholders, sites, layouts, content-map, relationships) and a `query` for detail. " +
      "Read the `notes` section for conventions. Confirm with live tools before writing.",
  );

  if (sites) {
    out.push("", `## Sites (${sites.data.sites.length})`);
    for (const s of sites.data.sites.slice(0, MAX_LIST)) {
      const folders = s.folders.length ? `; folders: ${s.folders.slice(0, 8).join(", ")}` : "";
      out.push(`- ${s.name}: ${s.rootPath} (home: ${s.homePath}${folders})`);
    }
    out.push(more(sites.data.sites.length));
  }

  if (contentMap) {
    out.push("", `## Content${contentMap.data.truncated ? " (walk TRUNCATED: counts are lower bounds)" : ""}`);
    for (const site of contentMap.data.sites.slice(0, 10)) {
      const top = site.outline
        .filter((n) => n.depth === 1)
        .slice(0, 8)
        .map((n) => `${n.path.split("/").pop()} (${n.descendants + 1})`);
      out.push(`- ${site.site}: ${site.itemsWalked} items, depth ≤ ${site.maxDepth}; top level: ${top.join(", ") || "-"}`);
    }
    out.push(more(contentMap.data.sites.length, 10));
  }

  if (relationships) {
    const r = relationships.data;
    out.push("", `## Page types (template → pages; renderings from ${r.sampledPages} sampled pages)`);
    for (const pt of r.pageTypes.slice(0, MAX_LIST)) {
      const extras: string[] = [];
      if (pt.allowedUnder.length) extras.push(`under: ${pt.allowedUnder.slice(0, 3).join(", ")}`);
      const names = pt.renderings.map((x) => x.rendering.name);
      extras.push(`renderings: ${names.slice(0, 8).join(", ") || (pt.sampled ? "none" : "not sampled")}${names.length > 8 ? ` +${names.length - 8}` : ""}`);
      out.push(`- ${pt.template.name} (${pt.items}) — ${extras.join(" · ")}`);
    }
    out.push(more(r.pageTypes.length));
  }

  if (templates) {
    const all = templates.data.templates;
    const group = (kind: TemplateKind) => all.filter((t) => t.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
    out.push("", `## Templates (${all.length} catalogued${templates.data.truncated ? ", TRUNCATED" : ""})`);
    const line = (t: KnowledgeTemplate) => {
      const extras: string[] = [];
      if (t.allowedUnder.length) extras.push(`under: ${t.allowedUnder.slice(0, 3).map((r) => r.name).join(", ")}`);
      if (t.datasourceFor.length) extras.push(`for: ${t.datasourceFor.slice(0, 3).map((r) => r.name).join(", ")}`);
      return `- ${t.name} (${t.ownFields.length} own fields)${extras.length ? ` — ${extras.join(" · ")}` : ""}`;
    };
    for (const [kind, title] of [
      ["page", "Page templates"],
      ["datasource", "Datasource templates"],
      ["folder", "Folder templates"],
    ] as const) {
      const list = group(kind);
      if (list.length === 0) continue;
      out.push(`### ${title} (${list.length})`, ...list.slice(0, MAX_LIST).map(line), more(list.length));
    }
    out.push(
      `Base templates: ${group("base").length} · other: ${group("other").length} · external bases referenced: ${templates.data.external.length}`,
    );
  }

  if (renderings) {
    const all = renderings.data.renderings;
    const count = (t: string) => all.filter((r) => r.type === t).length;
    out.push(
      "",
      `## Renderings (${all.length}: ${count("json")} JSON, ${count("view")} view, ${count("controller")} controller, ${count("other")} other)`,
    );
    const pagesUsing = new Map((relationships?.data.renderingUsage ?? []).map((u) => [u.rendering.id, u.pages]));
    for (const r of [...all].sort((a, b) => a.name.localeCompare(b.name)).slice(0, MAX_LIST)) {
      const ds = r.datasourceTemplate
        ? `datasource: ${r.datasourceTemplate.template?.name ?? r.datasourceTemplate.raw}`
        : "no datasource";
      const loc = r.datasourceLocation ? ` @ ${r.datasourceLocation}` : "";
      const used = relationships ? ` · on ${pagesUsing.get(r.id) ?? 0} sampled pages` : "";
      out.push(`- ${r.name} [${r.type}${r.componentName ? `: ${r.componentName}` : ""}] — ${ds}${loc}${used}`);
    }
    out.push(more(all.length));
    const unused = relationships?.data.unusedRenderings ?? [];
    if (unused.length) {
      out.push(`Not seen on sampled pages (${unused.length}): ${unused.slice(0, 15).map((u) => u.name).join(", ")}${unused.length > 15 ? " …" : ""}`);
    }
  }

  if (placeholders) {
    const all = placeholders.data.placeholders;
    out.push("", `## Placeholders (${all.length})`);
    for (const p of all.slice(0, 15)) {
      const names = p.allowedRenderings.map((r) => r.name);
      out.push(`- ${p.key}: ${names.slice(0, 8).join(", ") || "(any)"}${names.length > 8 ? ` +${names.length - 8}` : ""}`);
    }
    out.push(more(all.length, 15));
  }
  const inUse = relationships?.data.placeholderUsage ?? [];
  if (inUse.length) {
    out.push("", "## Placeholders in use (sampled pages)");
    for (const p of inUse.slice(0, 15)) {
      out.push(`- ${p.key} (${p.pages} pages): ${p.renderings.slice(0, 8).join(", ")}${p.renderings.length > 8 ? ` +${p.renderings.length - 8}` : ""}`);
    }
    out.push(more(inUse.length, 15));
  }

  if (layouts) {
    out.push(
      "",
      "## Layouts & devices",
      `- Layouts: ${layouts.data.layouts.map((l) => l.name).slice(0, 10).join(", ") || "none"}`,
      `- Devices: ${layouts.data.devices.map((d) => d.name).join(", ") || "none"}`,
    );
  }

  out.push("", "## Discovery status");
  for (const name of [...SECTIONS, "relationships"] as SectionName[]) {
    const m = manifest?.sections[name];
    if (!m && name === "relationships") continue;
    out.push(
      m
        ? `- ${name}: ${m.status}, ${m.count} items, ${m.generatedAt.slice(0, 10)}${m.truncated ? " (truncated)" : ""}${m.error ? ` — ${m.error.split("\n")[0]}` : ""}`
        : `- ${name}: not discovered yet`,
    );
  }
  // Drop empty "more" lines and collapse blank runs.
  const lines = out.filter((l, i, a) => !(l === "" && (a[i - 1] === "" || i === a.length - 1)));
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

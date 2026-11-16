import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config/load.js";
import { InstanceRegistry } from "../src/instances.js";
import { discover, linkTemplates } from "../src/knowledge/discover.js";
import { queryKnowledge, type QueryArgs } from "../src/knowledge/query.js";
import { KnowledgeStore, NOTES_TEMPLATE } from "../src/knowledge/store.js";
import type { DiscoverySection, KnowledgeTemplate } from "../src/knowledge/types.js";
import { createServer } from "../src/server.js";
import { IDS, createFakeSitecore } from "./fakeSitecore.js";

const auth = { mode: "ssc", username: "admin", passwordEnv: "SC_PWD" };
const knowledge = {
  templateRoots: ["/sitecore/templates"],
  excludePaths: ["/sitecore/templates/Standard template"],
  renderingRoots: ["/sitecore/layout/Renderings/Project"],
  contentRoots: ["/sitecore/content"],
};

function setup() {
  const fake = createFakeSitecore();
  const root = mkdtempSync(join(tmpdir(), "scknow-"));
  const config = parseConfig({ instances: { local: { cmUrl: "https://cm.localhost", auth, knowledge } } });
  const registry = new InstanceRegistry(
    { config, path: "t.json" },
    { env: { SC_PWD: "b" }, transportFactory: () => fake.transport, knowledgeRoot: root },
  );
  return { fake, registry, root };
}

async function runDiscovery(sections?: DiscoverySection[]) {
  const s = setup();
  const ctx = await s.registry.get("local");
  const store = s.registry.knowledgeStore("local");
  const result = await discover(ctx, store, { sections });
  return { ...s, store, result };
}

const q = (store: KnowledgeStore, section: QueryArgs["section"], extra: Partial<QueryArgs> = {}) =>
  queryKnowledge(store, { section, limit: 50, staleAfterDays: 14, ...extra });

describe("discovery", () => {
  it("is read-only and writes every section, the overview and notes", async () => {
    const { fake, store, result } = await runDiscovery();
    expect(fake.writes()).toHaveLength(0);
    expect(Object.values(result.sections).map((s) => s?.status)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok", "ok"]);
    const manifest = await store.readManifest();
    expect(manifest).toMatchObject({ schemaVersion: 1, instance: "local", sitecoreVersion: "10.4.0.010422" });
    expect(manifest!.sections.relationships).toMatchObject({ status: "ok", count: 1 });
    expect(await store.readNotes()).toBe(NOTES_TEMPLATE);
  });

  it("captures environment and sites", async () => {
    const { store } = await runDiscovery(["environment", "sites"]);
    const env = (await store.readSection("environment"))!.data;
    expect(env.languages).toEqual(["en", "ar"]);
    expect(env.modules.forms.detected).toBe(true);
    expect(env.modules.sxa.detected).toBe(false);
    const sites = (await store.readSection("sites"))!.data.sites;
    expect(sites).toEqual([
      expect.objectContaining({ name: "website", rootPath: "/sitecore/content", homePath: "/sitecore/content/Home" }),
    ]);
  });

  it("detects SXA-style sites and ignores nested 'Home' items inside a site", async () => {
    const s = setup();
    const id = (n: number) => `ffffffff-0000-0000-0000-${String(n).padStart(12, "0")}`;
    const folder = "f0000000-0000-0000-0000-000000000000";
    const add = (n: number, name: string, parent: string) =>
      s.fake.addItem({ id: id(n), name, parent, template: folder, templateName: "Folder", fields: {} });
    add(1, "Tenant", "0de95ae4-41ab-4d01-9eb0-67441b7c2450");
    add(2, "MySite", id(1));
    add(3, "Home", id(2));
    add(4, "Data", id(2));
    add(5, "Dictionary", id(4));
    add(6, "Home", id(5)); // a dictionary folder named Home: not a site
    await discover(await s.registry.get("local"), s.registry.knowledgeStore("local"), { sections: ["sites"] });
    const sites = (await s.registry.knowledgeStore("local").readSection("sites"))!.data.sites;
    expect(sites.map((x) => `${x.name}:${x.homePath}`)).toEqual([
      "website:/sitecore/content/Home",
      "MySite:/sitecore/content/Tenant/MySite/Home",
    ]);
    expect(sites[1]!.folders).toEqual(["Data"]);
  });

  it("catalogues templates with kinds, fields, insert options and links to renderings", async () => {
    const { store } = await runDiscovery();
    const data = (await store.readSection("templates"))!.data;
    const byName = Object.fromEntries(data.templates.map((t) => [t.name, t]));
    expect(Object.keys(byName).sort()).toEqual(["Hero", "News Folder", "Page", "_Base"]);
    expect(byName.Page).toMatchObject({ kind: "page", hasLayout: true });
    expect(byName.Page!.ownFields.map((f) => f.name)).toEqual(["Title", "Body"]);
    expect(byName.Page!.insertOptions.map((r) => r.name)).toEqual(["Page"]);
    expect(byName.Page!.allowedUnder.map((r) => r.name)).toEqual(["Page"]);
    expect(byName.Hero).toMatchObject({ kind: "datasource" });
    expect(byName.Hero!.datasourceFor.map((r) => r.name)).toEqual(["Hero"]);
    expect(byName["News Folder"]!.kind).toBe("folder");
    expect(byName._Base!.kind).toBe("base");
    expect(data.external.map((r) => r.name)).toEqual(["Standard template"]);
  });

  it("captures renderings, placeholders and layouts", async () => {
    const { store } = await runDiscovery();
    const renderings = (await store.readSection("renderings"))!.data.renderings;
    const hero = renderings.find((r) => r.name === "Hero")!;
    expect(hero).toMatchObject({ type: "json", componentName: "Hero", datasourceLocation: "./Data" });
    expect(hero.datasourceTemplate?.template?.name).toBe("Hero");
    expect(hero.compatibleRenderings.map((r) => r.name)).toEqual(["Promo"]);
    expect(renderings.find((r) => r.name === "Promo")).toMatchObject({ type: "view", viewPath: "/Views/Promo.cshtml" });

    const placeholders = (await store.readSection("placeholders"))!.data.placeholders;
    expect(placeholders).toEqual([expect.objectContaining({ key: "main" })]);
    expect(placeholders[0]!.allowedRenderings.map((r) => r.name)).toEqual(["Hero", "Promo"]);

    const layouts = (await store.readSection("layouts"))!.data;
    expect(layouts.layouts).toEqual([expect.objectContaining({ name: "Main Layout", filePath: "/Views/Main.cshtml" })]);
    expect(layouts.devices.map((d) => d.name)).toEqual(["Default"]);
  });

  it("maps content: outline, template usage and sampled page layouts", async () => {
    const { store } = await runDiscovery();
    const [site] = (await store.readSection("content-map"))!.data.sites;
    expect(site).toMatchObject({ site: "website", itemsWalked: 4, maxDepth: 3, truncated: false });
    expect(site!.outline.map((n) => [n.path, n.depth, n.descendants])).toEqual([
      ["/sitecore/content/Home", 1, 3],
      ["/sitecore/content/Home/About", 2, 0],
      ["/sitecore/content/Home/News", 2, 1],
    ]);
    expect(site!.templates).toEqual([
      expect.objectContaining({
        template: expect.objectContaining({ name: "Page" }),
        count: 4,
        underHome: 4,
        minDepth: 1,
        maxDepth: 3,
        parentTemplates: [
          { name: "Page", count: 3 },
          { name: "Main section", count: 1 },
        ],
      }),
    ]);
    // samplesPerTemplate = 3, shallowest first: Big Launch is not sampled
    expect(site!.samples.map((x) => [x.path, x.layoutSource])).toEqual([
      ["/sitecore/content/Home", "final"],
      ["/sitecore/content/Home/About", "shared"],
      ["/sitecore/content/Home/News", "none"],
    ]);
    const home = site!.samples[0]!;
    expect(home).toMatchObject({ layout: { name: "Main Layout" }, device: "Default" });
    expect(home.renderings).toEqual([
      expect.objectContaining({
        rendering: expect.objectContaining({ name: "Promo" }),
        placeholder: "/main/col-{11111111-2222-3333-4444-555555555555}-0",
        params: { color: "red" }, // secret-looking params are dropped
      }),
      expect.objectContaining({
        rendering: expect.objectContaining({ name: "Hero" }),
        placeholder: "main",
        datasource: "local:/Data/Hero",
        datasourcePath: "/sitecore/content/Home/Data/Hero",
      }),
    ]);
    expect(site!.samples[1]!.renderings[0]).toMatchObject({
      datasource: `{${IDS.news.toUpperCase()}}`,
      datasourcePath: "/sitecore/content/Home/News",
    });
  });

  it("derives page types, rendering usage and placeholders in use", async () => {
    const { store } = await runDiscovery();
    const rel = (await store.readSection("relationships"))!.data;
    expect(rel.sampledPages).toBe(2);
    expect(rel.pageTypes).toEqual([
      expect.objectContaining({
        template: expect.objectContaining({ name: "Page" }),
        items: 4,
        sites: ["website"],
        allowedUnder: ["Page"],
        sampled: 2,
        renderings: [
          { rendering: expect.objectContaining({ name: "Hero" }), pages: 2, placeholders: ["main"] },
          { rendering: expect.objectContaining({ name: "Promo" }), pages: 1, placeholders: ["col"] },
        ],
      }),
    ]);
    const hero = rel.renderingUsage.find((r) => r.rendering.name === "Hero")!;
    expect(hero).toMatchObject({ pages: 2, pageTypes: ["Page"], datasourceFolders: ["local:/Data", "/sitecore/content/Home"] });
    expect(rel.placeholderUsage).toEqual([
      { key: "main", renderings: ["Hero"], pages: 2 },
      { key: "col", renderings: ["Promo"], pages: 1 },
    ]);
    expect(rel.unusedRenderings).toEqual([]);

    const page = (await store.readSection("templates"))!.data.templates.find((t) => t.name === "Page")!;
    expect(page.usage).toMatchObject({ items: 4, sampled: 3, sampledWithLayout: 2 });
  });

  it("classifies a template as page when sampled items using it have a layout", () => {
    const t = {
      id: "{1}", name: "Landing", path: "/x", kind: "other", kindReason: "", baseTemplates: [], ownFields: [],
      insertOptions: [], allowedUnder: [], datasourceFor: [], hasLayout: false,
      usage: { items: 5, sampled: 2, sampledWithLayout: 2, samplePaths: [] },
    } as KnowledgeTemplate;
    linkTemplates([t], []);
    expect([t.kind, t.kindReason]).toEqual(["page", "2 of 2 sampled items using it have a layout"]);
  });

  it("needs the sites section for the content map", async () => {
    const { result } = await runDiscovery(["content-map"]);
    expect(result.sections["content-map"]).toMatchObject({ status: "error" });
    expect(result.sections["content-map"]!.error).toContain('needs the "sites" section');
  });

  it("writes a compact overview", async () => {
    const { store } = await runDiscovery();
    const overview = (await store.readOverview())!;
    expect(overview).toContain("# Instance: local (Sitecore 10.4.0.010422)");
    expect(overview).toContain("languages: en, ar");
    expect(overview).toContain("### Page templates (1)");
    expect(overview).toContain("- Hero [json: Hero] — datasource: Hero @ ./Data");
    expect(overview).toContain("- main: Hero, Promo");
    expect(overview).toContain("## Page types (template → pages; renderings from 2 sampled pages)");
    expect(overview).toContain("- Page (4) — under: Page · renderings: Hero, Promo");
    expect(overview).toContain("- website: 4 items, depth ≤ 3; top level: Home (4)");
    expect(overview).toContain("- Hero [json: Hero] — datasource: Hero @ ./Data · on 2 sampled pages");
    expect(overview).toContain("- main (2 pages): Hero");
    expect(overview).toContain("- relationships: ok");
    expect(overview.length).toBeLessThan(12_000);
  });

  it("refreshes one section without losing others, and never overwrites notes", async () => {
    const s = await runDiscovery(["templates"]);
    writeFileSync(join(s.store.dir, "notes.md"), "my rules", "utf8");
    await discover(await s.registry.get("local"), s.store, { sections: ["renderings"] });
    const templates = (await s.store.readSection("templates"))!.data.templates;
    expect(templates.find((t) => t.name === "Hero")!.datasourceFor.map((r) => r.name)).toEqual(["Hero"]);
    expect(readFileSync(join(s.store.dir, "notes.md"), "utf8")).toBe("my rules");
    expect(Object.keys((await s.store.readManifest())!.sections).sort()).toEqual(["renderings", "templates"]);
  });

  it("records a failing section as error and keeps going", async () => {
    const s = setup();
    const ctx = await s.registry.get("local");
    const adapter = Object.create(ctx.adapter);
    adapter.getServerInfo = async () => Promise.reject(new Error("boom"));
    const result = await discover({ ...ctx, adapter }, s.registry.knowledgeStore("local"), {
      sections: ["environment", "sites"],
    });
    expect(result.sections.environment?.status).toBe("error");
    expect(result.sections.sites?.status).toBe("ok");
  });
});

describe("queryKnowledge", () => {
  it("reports when no knowledge exists", async () => {
    const { registry } = setup();
    expect(await q(registry.knowledgeStore("local"), "overview")).toMatchObject({ available: false });
  });

  it("returns full detail with inherited fields for few matches, summaries for many", async () => {
    const { store } = await runDiscovery();
    const one = (await q(store, "templates", { query: "page" })) as { results: Record<string, unknown>[] };
    expect(one.results).toHaveLength(1);
    expect(one.results[0]).toMatchObject({
      name: "Page",
      inheritedFields: [expect.objectContaining({ name: "MetaTitle", definedIn: "_Base" })],
      inheritsFromNotCatalogued: ["Standard template"],
    });
    const all = (await q(store, "templates", { limit: 2 })) as { matched: number; results: unknown[]; truncatedResults: boolean };
    expect(all.matched).toBe(4);
    expect(all.results).toHaveLength(2);
    expect(all.truncatedResults).toBe(true);
    const ds = (await q(store, "templates", { kind: "datasource" })) as { results: { name: string }[] };
    expect(ds.results.map((r) => r.name)).toEqual(["Hero"]);
  });

  it("answers content-map and relationships questions", async () => {
    const { store } = await runDiscovery();
    const summary = (await q(store, "content-map")) as { sites: { site: string; sampledPages: number }[] };
    expect(summary.sites).toEqual([expect.objectContaining({ site: "website", sampledPages: 3 })]);
    const site = (await q(store, "content-map", { query: "website" })) as { site: { samples: unknown[] } };
    expect(site.site.samples).toHaveLength(3);
    const byPath = (await q(store, "content-map", { query: "about" })) as { results: { samples: { path: string }[] }[] };
    expect(byPath.results[0]!.samples.map((x) => x.path)).toEqual(["/sitecore/content/Home/About"]);

    const rel = (await q(store, "relationships", { query: "promo" })) as Record<string, { rendering?: { name: string } }[]>;
    expect(rel.renderingUsage!.map((r) => r.rendering!.name)).toEqual(["Promo"]);
    expect(rel.pageTypes).toEqual([]);
  });

  it("reports freshness", async () => {
    const { store } = await runDiscovery(["environment"]);
    expect(await q(store, "overview")).toMatchObject({ available: true, stale: false, ageDays: 0 });
  });
});

describe("sitecore_knowledge tool", () => {
  it("serves the overview, sections and notes over MCP without calling Sitecore", async () => {
    const { registry, fake } = await runDiscovery();
    const before = fake.requests.length;
    const server = createServer(registry);
    const [c, s] = InMemoryTransport.createLinkedPair();
    await server.connect(s);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(c);
    const text = (r: unknown) => JSON.parse((r as { content: { text: string }[] }).content[0]!.text);

    expect(text(await client.callTool({ name: "sitecore_knowledge", arguments: {} })).overview).toContain("# Instance: local");
    const hero = text(await client.callTool({ name: "sitecore_knowledge", arguments: { section: "renderings", query: "hero" } }));
    expect(hero.results[0].componentName).toBe("Hero");

    const resources = await client.listResources();
    expect(resources.resources.map((r) => r.uri)).toContain("sitecore://local/knowledge/overview");
    const notes = await client.readResource({ uri: "sitecore://local/knowledge/notes" });
    expect((notes.contents[0] as { text: string }).text).toBe(NOTES_TEMPLATE);
    expect(fake.requests.length).toBe(before);
  });
});

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config/load.js";
import { InstanceRegistry } from "../src/instances.js";
import { discover } from "../src/knowledge/discover.js";
import { queryKnowledge, type QueryArgs } from "../src/knowledge/query.js";
import { KnowledgeStore, NOTES_TEMPLATE } from "../src/knowledge/store.js";
import type { SectionName } from "../src/knowledge/types.js";
import { createServer } from "../src/server.js";
import { createFakeSitecore } from "./fakeSitecore.js";

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

async function runDiscovery(sections?: SectionName[]) {
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
    expect(Object.values(result.sections).map((s) => s?.status)).toEqual(["ok", "ok", "ok", "ok", "ok", "ok"]);
    expect(await store.readManifest()).toMatchObject({ schemaVersion: 1, instance: "local", sitecoreVersion: "10.4.0.010422" });
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

  it("writes a compact overview", async () => {
    const { store } = await runDiscovery();
    const overview = (await store.readOverview())!;
    expect(overview).toContain("# Instance: local (Sitecore 10.4.0.010422)");
    expect(overview).toContain("languages: en, ar");
    expect(overview).toContain("### Page templates (1)");
    expect(overview).toContain("- Hero [json: Hero] — datasource: Hero @ ./Data");
    expect(overview).toContain("- main: Hero, Promo");
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

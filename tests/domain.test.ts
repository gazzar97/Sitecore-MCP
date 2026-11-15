import { describe, expect, it } from "vitest";
import { SscItemServiceAdapter } from "../src/adapters/ssc/sscAdapter.js";
import { SscClient } from "../src/adapters/ssc/sscClient.js";
import { readTemplate } from "../src/domain/templates.js";
import { treeSearch } from "../src/domain/treeSearch.js";
import { shapeItem, truncate } from "../src/formatting/format.js";
import { normalizeId, normalizePath, parseIdList } from "../src/util/ids.js";
import { IDS, createFakeSitecore } from "./fakeSitecore.js";

function adapter() {
  const fake = createFakeSitecore();
  return new SscItemServiceAdapter(
    new SscClient({
      baseUrl: "https://cm.localhost",
      domain: "sitecore",
      username: "admin",
      password: () => "b",
      transport: fake.transport,
      timeoutMs: 1000,
    }),
  );
}
const loc = { database: "master" as const, language: "en" };
const search = { maxVisited: 100, limit: 10 };

describe("readTemplate", () => {
  it("reads own and inherited fields in sort order, excluding Standard Template", async () => {
    const t = await readTemplate(
      adapter(),
      { idOrPath: "/sitecore/templates/Page", ...loc },
      { includeInherited: true, includeStandardTemplate: false },
    );
    expect(t.name).toBe("Page");
    expect(t.baseTemplates.map((b) => b.name)).toEqual(["_Base"]);
    expect(t.inheritanceChain.map((b) => b.name)).toEqual(["_Base", "Standard template"]);
    expect(t.fields.map((f) => `${f.definedIn}.${f.section}.${f.name}`)).toEqual([
      "Page.Content.Title",
      "Page.Content.Body",
      "_Base.Meta.MetaTitle",
    ]);
    expect(t.fields[0]).toMatchObject({ type: "Single-Line Text", unversioned: true, shared: false });
    expect(t.fields[2]).toMatchObject({ shared: true });
  });

  it("resolves the template of a content item and can include standard fields", async () => {
    const t = await readTemplate(adapter(), { idOrPath: IDS.home, ...loc }, { includeInherited: true, includeStandardTemplate: true });
    expect(t.resolvedFromItem?.path).toBe("/sitecore/content/Home");
    expect(t.fields.map((f) => f.name)).toContain("__Created");
  });

  it("can return only own fields", async () => {
    const t = await readTemplate(adapter(), { idOrPath: IDS.pageTpl, ...loc }, { includeInherited: false, includeStandardTemplate: false });
    expect(t.fields.map((f) => f.name)).toEqual(["Title", "Body"]);
  });
});

describe("treeSearch", () => {
  it("finds items by name under a root", async () => {
    const res = await treeSearch(adapter(), { idOrPath: "/sitecore/content/Home", ...loc }, { nameContains: "launch" }, { maxDepth: 5, ...search });
    expect(res.matches.map((m) => m.path)).toEqual(["/sitecore/content/Home/News/Big Launch"]);
    expect(res.truncated).toBe(false);
  });

  it("matches field values and reports depth truncation", async () => {
    const criteria = { fieldName: "Title", fieldContains: "about" };
    const shallow = await treeSearch(adapter(), { idOrPath: "/sitecore/content", ...loc }, criteria, { maxDepth: 1, ...search });
    expect(shallow.matches).toHaveLength(0);
    expect(shallow.truncatedReason).toMatch(/maxDepth/);
    const deeper = await treeSearch(adapter(), { idOrPath: "/sitecore/content", ...loc }, criteria, { maxDepth: 3, ...search });
    expect(deeper.matches.map((m) => m.name)).toEqual(["About"]);
  });

  it("stops at maxVisited", async () => {
    const res = await treeSearch(adapter(), { idOrPath: "/sitecore", ...loc }, { templateName: "Page" }, { maxDepth: 5, maxVisited: 2, limit: 10 });
    expect(res.visited).toBe(2);
    expect(res.truncated).toBe(true);
  });
});

describe("concurrency", () => {
  it("Semaphore caps in-flight work and mapLimit preserves order", async () => {
    const { Semaphore, mapLimit } = await import("../src/util/concurrency.js");
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;
    const task = (v: number) =>
      sem.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return v * 2;
      });
    expect(await Promise.all([1, 2, 3, 4, 5].map(task))).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
    expect(await mapLimit([3, 1, 2], 2, async (v) => v + 1)).toEqual([4, 2, 3]);
  });
});

describe("helpers", () => {
  it("normalizes ids and paths", () => {
    expect(normalizeId("110d559f-dea5-42ea-9c1c-8a5df7e70ef9")).toBe("{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}");
    expect(normalizeId("/sitecore")).toBe("/sitecore");
    expect(parseIdList("{110d559f-dea5-42ea-9c1c-8a5df7e70ef9}| junk |")).toEqual(["{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}"]);
    expect(normalizePath("sitecore\\content\\")).toBe("/sitecore/content");
  });

  it("truncates and shapes items", () => {
    expect(truncate("abcdef", 3)).toBe("abc…[truncated, 6 chars total]");
    const shaped = shapeItem(
      {
        id: "{A}", name: "n", path: "/p", displayName: "n", parentId: null, templateId: "{T}", templateName: "T",
        language: "en", version: 1, hasChildren: false, fields: { a: "1234567", b: "" },
      },
      { maxFieldLength: 3 },
    );
    expect(shaped.fields).toEqual({ a: "123…[truncated, 7 chars total]" });
    expect(shaped.displayName).toBeUndefined();
  });
});

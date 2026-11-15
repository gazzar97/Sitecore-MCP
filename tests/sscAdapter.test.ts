import { describe, expect, it } from "vitest";
import { SscItemServiceAdapter, parseVersionXml } from "../src/adapters/ssc/sscAdapter.js";
import { SscClient } from "../src/adapters/ssc/sscClient.js";
import { AuthError, SitecoreApiError } from "../src/errors.js";
import { IDS, createFakeSitecore, type FakeSitecoreOptions } from "./fakeSitecore.js";

function setup(opts: FakeSitecoreOptions & { pwd?: string } = {}) {
  const fake = createFakeSitecore(opts);
  const client = new SscClient({
    baseUrl: "https://cm.localhost/",
    domain: "sitecore",
    username: "admin",
    password: () => opts.pwd ?? "b",
    transport: fake.transport,
    timeoutMs: 1000,
  });
  return { fake, adapter: new SscItemServiceAdapter(client) };
}

const loc = { database: "master" as const, language: "en" };

describe("SscItemServiceAdapter", () => {
  it("gets an item by path and maps metadata vs fields", async () => {
    const { adapter, fake } = setup();
    const item = await adapter.getItem({ idOrPath: "sitecore/content/Home/", ...loc });
    expect(item).toMatchObject({
      id: "{110D559F-DEA5-42EA-9C1C-8A5DF7E70EF9}",
      name: "Home",
      path: "/sitecore/content/Home",
      templateName: "Page",
      parentId: `{${IDS.content.toUpperCase()}}`,
      version: 1,
      hasChildren: true,
    });
    expect(item!.fields.Title).toBe("Welcome");
    expect(item!.fields.ItemID).toBeUndefined();
    expect(item!.fields.__Sortorder).toBeUndefined(); // standard fields excluded by default
    const getReq = fake.requests.find((r) => r.method === "GET")!;
    expect(getReq.url).toContain("path=%2Fsitecore%2Fcontent%2FHome");
    expect(getReq.url).toContain("database=master");
  });

  it("gets an item by braced GUID and returns null when missing", async () => {
    const { adapter } = setup();
    expect((await adapter.getItem({ idOrPath: `{${IDS.about.toUpperCase()}}`, ...loc }))?.name).toBe("About");
    expect(await adapter.getItem({ idOrPath: "/sitecore/content/Nope", ...loc })).toBeNull();
  });

  it("keeps item properties when a fields filter is used (real SSC filters them too)", async () => {
    const { adapter, fake } = setup();
    const item = await adapter.getItem({ idOrPath: IDS.home, ...loc }, { fields: ["Title"] });
    expect(item).toMatchObject({ id: `{${IDS.home.toUpperCase()}}`, name: "Home", path: "/sitecore/content/Home" });
    expect(item!.fields).toEqual({ Title: "Welcome" });
    const url = fake.requests.find((r) => r.method === "GET")!.url;
    expect(decodeURIComponent(url)).toContain("fields=ItemID,ItemName");
    expect(url).not.toContain("includeMetadata");
  });

  it("ignores object-valued properties such as metadata", async () => {
    const { mapItem } = await import("../src/adapters/ssc/sscAdapter.js");
    const item = mapItem({ ItemID: IDS.home, ItemName: "Home", Title: "x", metadata: { Title: { Type: "Single-Line Text" } } });
    expect(item.fields).toEqual({ Title: "x" });
  });

  it("lists children by path", async () => {
    const { adapter } = setup();
    const kids = await adapter.getChildren({ idOrPath: "/sitecore/content/Home", ...loc });
    expect(kids.map((k) => k.name).sort()).toEqual(["About", "News"]);
  });

  it("re-authenticates once when the session expires", async () => {
    const { adapter, fake } = setup();
    await adapter.getItem({ idOrPath: IDS.home, ...loc });
    fake.expireSessions();
    await adapter.getItem({ idOrPath: IDS.home, ...loc });
    expect(fake.loginCount).toBe(2);
  });

  it("raises AuthError on bad credentials without leaking the password", async () => {
    const { adapter } = setup({ pwd: "wrong-secret" });
    const err = await adapter.getItem({ idOrPath: IDS.home, ...loc }).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(String(err.toUserMessage())).not.toContain("wrong-secret");
  });

  it("explains the local-only security policy on 403", async () => {
    const { adapter } = setup({ localOnlyPolicy: true });
    const err = await adapter.getItem({ idOrPath: IDS.home, ...loc }).catch((e) => e);
    expect(err).toBeInstanceOf(SitecoreApiError);
    expect(err.toUserMessage()).toMatch(/ServicesOnPolicy/);
  });

  it("searches the index", async () => {
    const { adapter } = setup();
    const res = await adapter.searchIndex({ term: "launch", ...loc, page: 1, pageSize: 10 });
    expect(res.totalCount).toBe(1);
    expect(res.items[0]!.name).toBe("Big Launch");
  });

  it("reports server version", async () => {
    const { adapter } = setup();
    expect((await adapter.getServerInfo()).sitecoreVersion).toBe("10.4.0.010422");
  });
});

describe("parseVersionXml", () => {
  it("handles missing parts", () => {
    expect(parseVersionXml("<version><major>9</major><minor>3</minor></version>")).toBe("9.3");
    expect(parseVersionXml("<html/>")).toBeUndefined();
  });
});

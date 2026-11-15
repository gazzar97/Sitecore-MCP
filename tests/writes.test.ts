import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { SscItemServiceAdapter } from "../src/adapters/ssc/sscAdapter.js";
import { SscClient } from "../src/adapters/ssc/sscClient.js";
import { AuditLog } from "../src/audit/auditLog.js";
import { parseConfig } from "../src/config/load.js";
import { createItem, deleteItem, updateItem, type WriteContext } from "../src/domain/writes.js";
import { InstanceRegistry } from "../src/instances.js";
import { assertValidItemName, assertWriteAllowed, isAtOrUnder, WriteNotAllowedError } from "../src/safety/writeGuard.js";
import { createServer } from "../src/server.js";
import { IDS, createFakeSitecore } from "./fakeSitecore.js";

const auth = { mode: "ssc", username: "admin", passwordEnv: "SC_PWD" };

function instanceConfig(extra: Record<string, unknown> = {}) {
  return parseConfig({ instances: { local: { cmUrl: "https://cm.localhost", auth, ...extra } } }).instances.local!;
}

function setup(extra: Record<string, unknown> = { permissions: { write: true, delete: true } }) {
  const fake = createFakeSitecore();
  const adapter = new SscItemServiceAdapter(
    new SscClient({
      baseUrl: "https://cm.localhost",
      domain: "sitecore",
      username: "admin",
      password: () => "b",
      transport: fake.transport,
      timeoutMs: 1000,
    }),
  );
  const auditPath = join(mkdtempSync(join(tmpdir(), "scaudit-")), "audit.log");
  const ctx: WriteContext = { name: "local", config: instanceConfig(extra), adapter, audit: new AuditLog(auditPath) };
  const auditLines = () =>
    readFileSync(auditPath, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
  return { fake, ctx, auditLines };
}

const create = (over: Record<string, unknown> = {}) => ({
  parent: "/sitecore/content/Home",
  name: "Contact",
  template: "/sitecore/templates/Page",
  fields: { Title: "Contact us" } as Record<string, string>,
  language: "en",
  dryRun: false,
  allowDuplicateName: false,
  ...over,
});

describe("write guard", () => {
  const writable = instanceConfig({ permissions: { write: true, delete: true }, writeRoots: ["/sitecore/content/Home"] });
  const at = (path: string, database: "master" | "web" = "master") => ({ path, database });

  it("is off by default", () => {
    expect(() => assertWriteAllowed("update", "local", instanceConfig(), at("/sitecore/content/Home"))).toThrow(/Writes are disabled/);
    const writeOnly = instanceConfig({ permissions: { write: true } });
    expect(() => assertWriteAllowed("delete", "local", writeOnly, at("/sitecore/content/Home/x"))).toThrow(/Deletes are disabled/);
  });

  it("allows master only, outside protected paths, inside writeRoots", () => {
    assertWriteAllowed("create", "local", writable, at("/sitecore/content/Home"));
    assertWriteAllowed("update", "local", writable, at("/sitecore/content/home/About"));
    expect(() => assertWriteAllowed("update", "local", writable, at("/sitecore/content/Home", "web"))).toThrow(/master/);
    expect(() => assertWriteAllowed("update", "local", writable, at("/sitecore/content/Homepage"))).toThrow(WriteNotAllowedError);
    const everywhere = instanceConfig({ permissions: { write: true }, writeRoots: ["/sitecore"] });
    expect(() => assertWriteAllowed("update", "local", everywhere, at("/sitecore/system/Settings"))).toThrow(/protected path/);
  });

  it("never deletes a write root itself", () => {
    expect(() => assertWriteAllowed("delete", "local", writable, at("/sitecore/content/Home"))).toThrow(/strictly below/);
    assertWriteAllowed("delete", "local", writable, at("/sitecore/content/Home/About"));
  });

  it("validates item names (Unicode aware)", () => {
    expect(isAtOrUnder("/sitecore/content2", "/sitecore/content")).toBe(false);
    assertValidItemName("Contact us");
    assertValidItemName("اتصل بنا");
    for (const bad of ["", "a/b", "-x", "dot.name", "x".repeat(101)]) expect(() => assertValidItemName(bad)).toThrow();
  });
});

describe("createItem", () => {
  it("dry run validates and writes nothing", async () => {
    const { fake, ctx, auditLines } = setup();
    const res = await createItem(ctx, create({ dryRun: true }));
    expect(res).toMatchObject({
      dryRun: true,
      path: "/sitecore/content/Home/Contact",
      fieldValidation: "validated",
      template: { name: "Page" },
    });
    expect(fake.writes()).toHaveLength(0);
    expect(auditLines()[0]).toMatchObject({ tool: "sitecore_item_create", dryRun: true, ok: true });
  });

  it("creates the item with field values and audits it", async () => {
    const { fake, ctx, auditLines } = setup();
    const res = await createItem(ctx, create());
    expect(res).toMatchObject({ created: true, path: "/sitecore/content/Home/Contact" });
    expect(res.notApplied).toBeUndefined();
    expect(fake.byPath("/sitecore/content/Home/Contact")?.fields.Title).toBe("Contact us");
    expect(auditLines()[0]).toMatchObject({ ok: true, itemId: res.id, path: "/sitecore/content/Home/Contact" });
  });

  it("rejects unknown fields, duplicates, non-templates and paths outside writeRoots before writing", async () => {
    const { fake, ctx, auditLines } = setup();
    await expect(createItem(ctx, create({ fields: { Titel: "typo" } }))).rejects.toThrow(/Unknown field.*Titel/);
    await expect(createItem(ctx, create({ name: "About" }))).rejects.toThrow(/already has a child named "About"/);
    await expect(createItem(ctx, create({ template: "/sitecore/content/Home" }))).rejects.toThrow(/not a data template/);
    await expect(createItem(ctx, create({ parent: "/sitecore/templates" }))).rejects.toThrow(/outside the allowed write roots/);
    expect(fake.writes()).toHaveLength(0);
    const lines = auditLines();
    expect(lines).toHaveLength(4);
    expect(lines.every((l) => l.ok === false && typeof l.error === "string")).toBe(true);
  });
});

describe("updateItem", () => {
  it("returns a before/after diff on dry run without writing", async () => {
    const { fake, ctx } = setup();
    const res = await updateItem(ctx, {
      idOrPath: "/sitecore/content/Home/About",
      fields: { Title: "About NBE" },
      language: "en",
      dryRun: true,
    });
    expect(res.changes).toEqual([{ field: "Title", before: "About us", after: "About NBE", changed: true }]);
    expect(fake.writes()).toHaveLength(0);
  });

  it("writes only changed fields and confirms by re-reading", async () => {
    const { fake, ctx } = setup();
    const res = await updateItem(ctx, { idOrPath: IDS.about, fields: { Title: "About NBE", Body: "" }, language: "en", dryRun: false });
    expect(res).toMatchObject({ updated: true, version: 1 });
    expect(res.notApplied).toBeUndefined();
    expect(fake.byPath("/sitecore/content/Home/About")?.fields.Title).toBe("About NBE");
    expect(JSON.parse(fake.writes()[0]!.body!)).toEqual({ Title: "About NBE" });
  });

  it("skips no-op updates and rejects unknown fields", async () => {
    const { fake, ctx } = setup();
    const same = await updateItem(ctx, { idOrPath: IDS.about, fields: { Title: "About us" }, language: "en", dryRun: false });
    expect(same).toMatchObject({ noChange: true });
    await expect(updateItem(ctx, { idOrPath: IDS.about, fields: { Nope: "x" }, language: "en", dryRun: false })).rejects.toThrow(
      /Unknown field/,
    );
    expect(fake.writes()).toHaveLength(0);
  });

  it("is refused when writes are disabled", async () => {
    const { fake, ctx } = setup({});
    await expect(updateItem(ctx, { idOrPath: IDS.about, fields: { Title: "x" }, language: "en", dryRun: false })).rejects.toThrow(
      /disabled/,
    );
    expect(fake.writes()).toHaveLength(0);
  });
});

describe("deleteItem", () => {
  it("requires includeChildren for subtrees and moves them to the recycle bin", async () => {
    const { fake, ctx } = setup();
    await expect(deleteItem(ctx, { idOrPath: "/sitecore/content/Home/News", includeChildren: false, dryRun: false })).rejects.toThrow(
      /1 descendant/,
    );
    const plan = await deleteItem(ctx, { idOrPath: "/sitecore/content/Home/News", includeChildren: true, dryRun: true });
    expect(plan).toMatchObject({ dryRun: true, descendants: 1, destination: "Recycle Bin" });
    expect(fake.writes()).toHaveLength(0);

    const res = await deleteItem(ctx, { idOrPath: "/sitecore/content/Home/News", includeChildren: true, dryRun: false });
    expect(res).toMatchObject({ deleted: true, path: "/sitecore/content/Home/News" });
    expect(fake.recycled.map((i) => i.name).sort()).toEqual(["Big Launch", "News"]);
  });

  it("refuses subtrees larger than maxDeleteItems and the write root itself", async () => {
    const { ctx } = setup({ permissions: { write: true, delete: true }, maxDeleteItems: 2 });
    await expect(deleteItem(ctx, { idOrPath: "/sitecore/content/Home", includeChildren: true, dryRun: false })).rejects.toThrow(
      /more than 2 descendants/,
    );
    await expect(deleteItem(ctx, { idOrPath: "/sitecore/content", includeChildren: true, dryRun: false })).rejects.toThrow(
      /strictly below/,
    );
  });
});

describe("tool registration", () => {
  async function tools(instance: Record<string, unknown>) {
    const config = parseConfig({ instances: { local: { cmUrl: "https://cm.localhost", auth, ...instance } } });
    const server = createServer(new InstanceRegistry({ config, path: "t.json" }, { env: { SC_PWD: "b" } }));
    const [c, s] = InMemoryTransport.createLinkedPair();
    await server.connect(s);
    const client = new Client({ name: "t", version: "0" });
    await client.connect(c);
    return (await client.listTools()).tools;
  }

  it("exposes write tools only when permitted", async () => {
    expect((await tools({})).some((t) => t.name.includes("create"))).toBe(false);
    const writeOnly = (await tools({ permissions: { write: true } })).map((t) => t.name);
    expect(writeOnly).toContain("sitecore_item_create");
    expect(writeOnly).toContain("sitecore_item_update");
    expect(writeOnly).not.toContain("sitecore_item_delete");
    const del = (await tools({ permissions: { write: true, delete: true } })).find((t) => t.name === "sitecore_item_delete")!;
    expect(del.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});

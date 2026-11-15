import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { parseConfig } from "../src/config/load.js";
import { InstanceRegistry } from "../src/instances.js";
import { createServer } from "../src/server.js";
import { createFakeSitecore } from "./fakeSitecore.js";

async function connect(registry: InstanceRegistry) {
  const server = createServer(registry);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientT);
  return client;
}

function registryWithFake() {
  const fake = createFakeSitecore();
  const auth = { mode: "ssc", username: "admin", passwordEnv: "SC_PWD" };
  const config = parseConfig({
    instances: {
      local: { cmUrl: "https://cm.localhost", auth },
      remote: { cmUrl: "https://prod.example.com", auth },
    },
    defaultInstance: "local",
  });
  return new InstanceRegistry(
    { config, path: "test.json" },
    { env: { SC_PWD: "b" }, transportFactory: () => fake.transport, lookup: async () => ["52.1.1.1"] },
  );
}

const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;
const data = (r: unknown) => JSON.parse(text(r));

describe("MCP server", () => {
  it("registers the Phase 1 read-only tools", async () => {
    const client = await connect(registryWithFake());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "sitecore_instances_list",
      "sitecore_item_children",
      "sitecore_item_get",
      "sitecore_logs_tail",
      "sitecore_ping",
      "sitecore_search",
      "sitecore_template_get",
    ]);
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("lists instances without secrets", async () => {
    const client = await connect(registryWithFake());
    const res = data(await client.callTool({ name: "sitecore_instances_list", arguments: {} }));
    expect(res.defaultInstance).toBe("local");
    expect(JSON.stringify(res)).not.toContain('"b"');
  });

  it("pings and reads items through the tools", async () => {
    const client = await connect(registryWithFake());
    expect(data(await client.callTool({ name: "sitecore_ping", arguments: {} })).sitecoreVersion).toBe("10.4.0.010422");

    const item = data(await client.callTool({ name: "sitecore_item_get", arguments: { idOrPath: "/sitecore/content/Home" } }));
    expect(item.fields.Title).toBe("Welcome");
    expect(item.fields.Body).toMatch(/truncated/);
    expect(item.fields.MetaTitle).toBeUndefined();

    const kids = data(
      await client.callTool({ name: "sitecore_item_children", arguments: { idOrPath: "/sitecore/content/Home", pageSize: 1 } }),
    );
    expect(kids.total).toBe(2);
    expect(kids.hasMore).toBe(true);

    const tree = data(await client.callTool({ name: "sitecore_item_children", arguments: { idOrPath: "/sitecore/content", depth: 3 } }));
    expect(tree.children[0].children.map((c: { name: string }) => c.name).sort()).toEqual(["About", "News"]);

    const tpl = data(await client.callTool({ name: "sitecore_template_get", arguments: { idOrPath: "/sitecore/content/Home" } }));
    expect(tpl.fields).toHaveLength(3);

    const search = data(
      await client.callTool({ name: "sitecore_search", arguments: { root: "/sitecore/content", nameContains: "launch" } }),
    );
    expect(search.count).toBe(1);
  });

  it("returns tool errors for bad input, unknown instance, and non-local hosts", async () => {
    const client = await connect(registryWithFake());
    const missing = await client.callTool({ name: "sitecore_item_get", arguments: { idOrPath: "/sitecore/nope" } });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toMatch(/Item not found/);

    const unknown = await client.callTool({ name: "sitecore_ping", arguments: { instance: "ghost" } });
    expect(text(unknown)).toMatch(/Unknown instance/);

    const remote = await client.callTool({ name: "sitecore_ping", arguments: { instance: "remote" } });
    expect(remote.isError).toBe(true);
    expect(text(remote)).toMatch(/Refusing to connect/);

    const noCriteria = await client.callTool({ name: "sitecore_search", arguments: { root: "/sitecore" } });
    expect(text(noCriteria)).toMatch(/at least one criterion/);

    const noLogs = await client.callTool({ name: "sitecore_logs_tail", arguments: {} });
    expect(text(noLogs)).toMatch(/No "logs" configured/);
  });

  it("starts with a config error and reports it", async () => {
    const client = await connect(new InstanceRegistry({ error: new Error("No config file found") }));
    const res = data(await client.callTool({ name: "sitecore_instances_list", arguments: {} }));
    expect(res).toMatchObject({ configured: false });
    expect(res.error).toMatch(/No config file found/);
  });
});

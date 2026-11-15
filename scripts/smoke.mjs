#!/usr/bin/env node
// Smoke test against a REAL local instance through the stdio MCP server.
// Usage: NBE_SC_PASSWORD=... node scripts/smoke.mjs [instance] [contentRoot]
// Env vars are passed through to the server; nothing is written to disk.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const instance = process.argv[2];
const contentRoot = process.argv[3] ?? "/sitecore/content";
const serverPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));

const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [serverPath], env: process.env, stderr: "inherit" }));

let failures = 0;
async function call(name, args = {}) {
  const started = Date.now();
  const res = await client.callTool({ name, arguments: { ...(instance ? { instance } : {}), ...args } });
  const text = res.content?.[0]?.text ?? "";
  const ms = Date.now() - started;
  if (res.isError) failures++;
  console.log(`\n=== ${res.isError ? "FAIL" : "OK  "} ${name} ${JSON.stringify(args)} (${ms} ms, ${text.length} chars)`);
  console.log(text.length > 1500 ? `${text.slice(0, 1500)} …` : text);
  if (res.isError) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

await call("sitecore_instances_list");
await call("sitecore_ping");
const root = await call("sitecore_item_children", { idOrPath: contentRoot, depth: 2 });
const first = root?.children?.find((c) => c.hasChildren) ?? root?.children?.[0];
if (first) {
  await call("sitecore_item_get", { idOrPath: first.path });
  await call("sitecore_item_get", { idOrPath: first.id, includeStandardFields: true, fields: ["__Created", "__Updated by", "__Final Renderings"] });
  await call("sitecore_template_get", { idOrPath: first.path });
  await call("sitecore_item_children", { idOrPath: first.path, pageSize: 5 });
  await call("sitecore_search", { root: first.path, nameContains: first.name.slice(0, 3), maxVisited: 300, limit: 5 });
  await call("sitecore_search", { mode: "index", term: first.name, limit: 3 });
}
await call("sitecore_template_get", { idOrPath: "/sitecore/templates/System/Templates/Template" });
await call("sitecore_item_get", { idOrPath: "/sitecore/content/does-not-exist" });
await call("sitecore_logs_tail", { levels: ["ERROR"], maxEntries: 2 });

await client.close();
console.log(`\n${failures} tool call(s) returned errors (the does-not-exist call is expected to).`);

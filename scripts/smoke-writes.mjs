#!/usr/bin/env node
// Write smoke test against a REAL local instance through the stdio MCP server.
// It only touches a scratch folder: create -> update -> guard checks -> delete (to Recycle Bin).
//
// Usage: NBE_SC_PASSWORD=... SITECORE_MCP_CONFIG=<config with write+delete, writeRoots=[scratch]> \
//        node scripts/smoke-writes.mjs <scratchFolderPath> <templatePath> <fieldName> [instance]
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const [scratch, template, field, instance] = process.argv.slice(2);
if (!scratch || !template || !field) {
  console.error("usage: smoke-writes.mjs <scratchFolderPath> <templatePath> <fieldName> [instance]");
  process.exit(2);
}
const serverPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const client = new Client({ name: "smoke-writes", version: "0" });
await client.connect(
  new StdioClientTransport({ command: process.execPath, args: [serverPath], env: process.env, stderr: "inherit" }),
);

let unexpected = 0;
async function call(name, args, expectError = false) {
  const started = Date.now();
  const res = await client.callTool({ name, arguments: { ...(instance ? { instance } : {}), ...args } }, undefined, {
    timeout: 120_000,
  });
  const text = res.content?.[0]?.text ?? "";
  const ok = Boolean(res.isError) === expectError;
  if (!ok) unexpected++;
  console.log(`\n=== ${ok ? "PASS" : "UNEXPECTED"} ${name}${expectError ? " (expect error)" : ""} (${Date.now() - started} ms)`);
  console.log(text.length > 900 ? `${text.slice(0, 900)} …` : text);
  return res.isError ? undefined : JSON.parse(text);
}

const stamp = `mcp-smoke-${Date.now()}`;
const tools = (await client.listTools()).tools.map((t) => t.name);
console.log("write tools:", tools.filter((t) => /create|update|delete/.test(t)).join(", "));

await call("sitecore_item_create", { parent: scratch, name: stamp, template, fields: { [field]: "created" }, dryRun: true });
const created = await call("sitecore_item_create", { parent: scratch, name: stamp, template, fields: { [field]: "created" } });
const child = await call("sitecore_item_create", { parent: `${scratch}/${stamp}`, name: "child", template });
await call("sitecore_item_create", { parent: scratch, name: stamp, template }, true); // duplicate name
await call("sitecore_item_create", { parent: scratch, name: "x", template, fields: { NoSuchField: "x" } }, true);
await call("sitecore_item_create", { parent: "/sitecore/content", name: "outside", template }, true); // outside writeRoots

await call("sitecore_item_update", { idOrPath: `${scratch}/${stamp}`, fields: { [field]: "updated" }, dryRun: true });
await call("sitecore_item_update", { idOrPath: `${scratch}/${stamp}`, fields: { [field]: "updated" } });
await call("sitecore_item_update", { idOrPath: `${scratch}/${stamp}`, fields: { NoSuchField: "x" } }, true);
await call("sitecore_item_get", { idOrPath: `${scratch}/${stamp}`, fields: [field] });

await call("sitecore_item_delete", { idOrPath: `${scratch}/${stamp}` }, true); // has a child
await call("sitecore_item_delete", { idOrPath: scratch, includeChildren: true }, true); // write root itself
await call("sitecore_item_delete", { idOrPath: `${scratch}/${stamp}`, includeChildren: true, dryRun: true });
await call("sitecore_item_delete", { idOrPath: `${scratch}/${stamp}`, includeChildren: true });
await call("sitecore_item_get", { idOrPath: `${scratch}/${stamp}` }, true); // gone

await client.close();
console.log(`\ncreated=${created?.id} child=${child?.id}`);
console.log(unexpected === 0 ? "\nALL CHECKS PASSED" : `\n${unexpected} UNEXPECTED RESULT(S)`);
process.exit(unexpected === 0 ? 0 : 1);

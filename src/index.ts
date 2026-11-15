#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config/load.js";
import { toUserMessage } from "./errors.js";
import { InstanceRegistry } from "./instances.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  // stdout is the MCP channel: all diagnostics go to stderr.
  let registry: InstanceRegistry;
  try {
    const loaded = loadConfig();
    console.error(`[sitecore-mcp] using config ${loaded.path}`);
    registry = new InstanceRegistry(loaded);
  } catch (err) {
    // Start anyway so the client can surface the error via sitecore_instances_list.
    console.error(`[sitecore-mcp] config error: ${toUserMessage(err)}`);
    registry = new InstanceRegistry({ error: err as Error });
  }

  const server = createServer(registry);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("[sitecore-mcp] fatal:", err);
  process.exit(1);
});

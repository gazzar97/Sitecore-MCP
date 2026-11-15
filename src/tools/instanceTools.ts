import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toUserMessage } from "../errors.js";
import type { InstanceRegistry } from "../instances.js";
import { READ_ONLY_ANNOTATIONS, instanceArg, run } from "./common.js";

export function registerInstanceTools(server: McpServer, registry: InstanceRegistry): void {
  server.registerTool(
    "sitecore_instances_list",
    {
      title: "List Sitecore instances",
      description: "Lists the locally configured Sitecore instances, the default instance, and their settings (no secrets).",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS,
    },
    () =>
      run(async () => {
        if (registry.configError) {
          return { configured: false, error: toUserMessage(registry.configError) };
        }
        const cfg = registry.config;
        return {
          configured: true,
          configPath: registry.configPath,
          auditLog: registry.anyInstanceAllows("write") ? registry.audit.path : undefined,
          defaultInstance: registry.defaultName(),
          instances: Object.entries(cfg.instances).map(([name, i]) => ({
            name,
            cmUrl: i.cmUrl,
            type: i.type,
            account: `${i.auth.domain}\\${i.auth.username}`,
            defaultDatabase: i.defaultDatabase,
            defaultLanguage: i.defaultLanguage,
            logs: i.logs ? (i.logs.source === "file" ? `file:${i.logs.path}` : `docker:${i.logs.container}`) : null,
            writeEnabled: i.permissions.write,
            deleteEnabled: i.permissions.write && i.permissions.delete,
            writeRoots: i.permissions.write ? i.writeRoots : undefined,
          })),
        };
      }),
  );

  server.registerTool(
    "sitecore_ping",
    {
      title: "Check Sitecore connectivity",
      description:
        "Verifies the instance host is local, logs in, reads /sitecore, and reports the Sitecore version when available.",
      inputSchema: { instance: instanceArg },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    ({ instance }) =>
      run(async () => {
        const started = Date.now();
        const ctx = await registry.get(instance);
        const info = await ctx.adapter.getServerInfo();
        return {
          instance: ctx.name,
          cmUrl: ctx.config.cmUrl,
          adapter: ctx.adapter.name,
          ok: true,
          sitecoreVersion: info.sitecoreVersion ?? "unknown (sitecore.version.xml not readable)",
          elapsedMs: Date.now() - started,
        };
      }),
  );
}

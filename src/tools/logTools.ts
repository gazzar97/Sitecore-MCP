import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { LOG_LEVELS } from "../adapters/logs/parser.js";
import { truncate } from "../formatting/format.js";
import type { InstanceRegistry } from "../instances.js";
import { READ_ONLY_ANNOTATIONS, UNTRUSTED_NOTE, instanceArg, run } from "./common.js";

const MAX_MESSAGE_CHARS = 2000;

export function registerLogTools(server: McpServer, registry: InstanceRegistry): void {
  server.registerTool(
    "sitecore_logs_tail",
    {
      title: "Tail Sitecore logs",
      description:
        "Returns the most recent Sitecore log entries (oldest first), optionally filtered by level and text. " +
        "Multi-line entries (exceptions + stack traces) are kept together. Reads log files from a folder or " +
        `"docker logs", depending on the instance config. ${UNTRUSTED_NOTE}`,
      inputSchema: {
        instance: instanceArg,
        levels: z.array(z.enum(LOG_LEVELS)).optional().describe('e.g. ["ERROR","FATAL"]'),
        contains: z.string().optional().describe("Case-insensitive text filter."),
        maxEntries: z.number().int().min(1).max(500).default(50),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const source = registry.getLogSource(args.instance);
        const res = await source.tail({ levels: args.levels, contains: args.contains, maxEntries: args.maxEntries });
        return {
          ...res,
          count: res.entries.length,
          entries: res.entries.map((e) => ({ ...e, message: truncate(e.message, MAX_MESSAGE_CHARS) })),
        };
      }),
  );
}

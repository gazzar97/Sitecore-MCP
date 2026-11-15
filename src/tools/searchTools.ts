import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { treeSearch } from "../domain/treeSearch.js";
import { SitecoreMcpError } from "../errors.js";
import { shapeItem, shapeItemSummary } from "../formatting/format.js";
import type { InstanceRegistry } from "../instances.js";
import {
  READ_ONLY_ANNOTATIONS,
  UNTRUSTED_NOTE,
  databaseArg,
  instanceArg,
  languageArg,
  location,
  run,
} from "./common.js";

export function registerSearchTools(server: McpServer, registry: InstanceRegistry): void {
  server.registerTool(
    "sitecore_search",
    {
      title: "Search Sitecore items",
      description:
        'Searches items. mode="tree" (default when root is given) walks the live database under root and matches ' +
        "name / template / field value - accurate but bounded by maxDepth and maxVisited. " +
        'mode="index" runs a full-text term search through the content search index (fast, but may be stale and ' +
        `is not limited to a root). ${UNTRUSTED_NOTE}`,
      inputSchema: {
        instance: instanceArg,
        database: databaseArg,
        language: languageArg,
        mode: z.enum(["tree", "index"]).optional(),
        root: z.string().optional().describe('Root item ID or path for tree mode, e.g. "/sitecore/content/MySite".'),
        nameContains: z.string().optional(),
        templateName: z.string().optional().describe("Exact template name (case-insensitive)."),
        templateId: z.string().optional(),
        fieldName: z.string().optional().describe("Only items that have this field (combine with fieldContains)."),
        fieldContains: z.string().optional(),
        term: z.string().optional().describe("Full-text term for index mode."),
        maxDepth: z.number().int().min(1).max(10).default(5),
        maxVisited: z.number().int().min(1).max(10_000).default(2_000),
        limit: z.number().int().min(1).max(200).default(50),
        page: z.number().int().min(1).default(1).describe("Index mode page."),
        fields: z.array(z.string()).optional().describe("Field values to include on each result."),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const ctx = await registry.get(args.instance);
        const loc = location(ctx, args);
        const mode = args.mode ?? (args.root ? "tree" : "index");
        const shape = (i: Parameters<typeof shapeItem>[0]) =>
          args.fields ? shapeItem(i, { maxFieldLength: ctx.maxFieldLength }) : shapeItemSummary(i);

        if (mode === "index") {
          if (!args.term) throw new SitecoreMcpError('Index mode requires "term".', 'Or pass "root" to use tree mode.');
          const res = await ctx.adapter.searchIndex({
            term: args.term,
            ...loc,
            page: args.page,
            pageSize: args.limit,
            fields: args.fields,
          });
          return { mode, totalCount: res.totalCount, page: args.page, results: res.items.map(shape) };
        }

        if (!args.root) throw new SitecoreMcpError('Tree mode requires "root".');
        const criteria = {
          nameContains: args.nameContains,
          templateName: args.templateName,
          templateId: args.templateId,
          fieldName: args.fieldName,
          fieldContains: args.fieldContains,
        };
        if (!Object.values(criteria).some(Boolean)) {
          throw new SitecoreMcpError(
            "Tree mode needs at least one criterion: nameContains, templateName, templateId, fieldName.",
          );
        }
        if (args.fieldContains && !args.fieldName) throw new SitecoreMcpError('"fieldContains" requires "fieldName".');
        const res = await treeSearch(ctx.adapter, { idOrPath: args.root, ...loc }, criteria, {
          maxDepth: args.maxDepth,
          maxVisited: args.maxVisited,
          limit: args.limit,
          fields: args.fields,
          concurrency: ctx.config.maxConcurrency,
        });
        return {
          mode,
          root: args.root,
          visited: res.visited,
          truncated: res.truncated,
          truncatedReason: res.truncatedReason,
          count: res.matches.length,
          results: res.matches.map(shape),
        };
      }),
  );
}

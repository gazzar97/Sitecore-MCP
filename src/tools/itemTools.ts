import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ContentAdapter, ItemRef } from "../domain/types.js";
import { NotFoundError } from "../errors.js";
import { shapeItem, shapeItemSummary } from "../formatting/format.js";
import type { InstanceRegistry } from "../instances.js";
import {
  READ_ONLY_ANNOTATIONS,
  UNTRUSTED_NOTE,
  databaseArg,
  idOrPathArg,
  instanceArg,
  languageArg,
  location,
  run,
} from "./common.js";

const MAX_TREE_NODES = 300;

export function registerItemTools(server: McpServer, registry: InstanceRegistry): void {
  server.registerTool(
    "sitecore_item_get",
    {
      title: "Get Sitecore item",
      description:
        "Gets an item by ID or path with its field values. Long values are truncated and empty fields omitted unless " +
        `verbose=true. Standard fields (__Created, __Renderings, ...) are excluded by default. ${UNTRUSTED_NOTE}`,
      inputSchema: {
        idOrPath: idOrPathArg,
        instance: instanceArg,
        database: databaseArg,
        language: languageArg,
        version: z.number().int().positive().optional().describe("Item version. Defaults to latest."),
        fields: z.array(z.string()).optional().describe("Only return these fields."),
        includeStandardFields: z.boolean().default(false),
        verbose: z.boolean().default(false).describe("Return full, untruncated values including empty fields."),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const ctx = await registry.get(args.instance);
        const ref: ItemRef = { idOrPath: args.idOrPath, ...location(ctx, args), version: args.version };
        const item = await ctx.adapter.getItem(ref, {
          fields: args.fields,
          includeStandardFields: args.includeStandardFields,
        });
        if (!item) throw new NotFoundError(`Item not found: ${args.idOrPath} (${ref.database}/${ref.language})`);
        return shapeItem(item, { maxFieldLength: ctx.maxFieldLength, verbose: args.verbose });
      }),
  );

  server.registerTool(
    "sitecore_item_children",
    {
      title: "Get Sitecore item children",
      description:
        "Lists children of an item (paged). With depth > 1, returns a nested tree of item summaries " +
        `(max ${MAX_TREE_NODES} nodes). ${UNTRUSTED_NOTE}`,
      inputSchema: {
        idOrPath: idOrPathArg,
        instance: instanceArg,
        database: databaseArg,
        language: languageArg,
        depth: z.number().int().min(1).max(3).default(1),
        page: z.number().int().min(1).default(1).describe("Page number (depth=1 only)."),
        pageSize: z.number().int().min(1).max(200).default(50).describe("Page size (depth=1 only)."),
        fields: z
          .array(z.string())
          .optional()
          .describe("Include these field values on each child (depth=1 only). Omit for summaries only."),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const ctx = await registry.get(args.instance);
        const loc = location(ctx, args);
        if (args.depth === 1) {
          const children = await ctx.adapter.getChildren(
            { idOrPath: args.idOrPath, ...loc },
            { fields: args.fields ?? ["__Sortorder"] },
          );
          const start = (args.page - 1) * args.pageSize;
          return {
            parent: args.idOrPath,
            total: children.length,
            page: args.page,
            pageSize: args.pageSize,
            hasMore: start + args.pageSize < children.length,
            children: children
              .slice(start, start + args.pageSize)
              .map((c) => (args.fields ? shapeItem(c, { maxFieldLength: ctx.maxFieldLength }) : shapeItemSummary(c))),
          };
        }
        const budget = { remaining: MAX_TREE_NODES, truncated: false };
        const tree = await buildTree(ctx.adapter, { idOrPath: args.idOrPath, ...loc }, args.depth, budget);
        return { parent: args.idOrPath, depth: args.depth, truncated: budget.truncated, children: tree };
      }),
  );
}

type TreeNode = Record<string, unknown> & { children?: TreeNode[] };

async function buildTree(
  adapter: ContentAdapter,
  ref: ItemRef,
  depth: number,
  budget: { remaining: number; truncated: boolean },
): Promise<TreeNode[]> {
  const children = await adapter.getChildren(ref, { fields: ["__Sortorder"] });
  const nodes: TreeNode[] = [];
  const expand: { node: TreeNode; id: string }[] = [];
  for (const child of children) {
    if (budget.remaining <= 0) {
      budget.truncated = true;
      break;
    }
    budget.remaining--;
    const node: TreeNode = shapeItemSummary(child);
    if (depth > 1 && child.hasChildren) expand.push({ node, id: child.id });
    nodes.push(node);
  }
  // Siblings' subtrees load in parallel (the HTTP client caps concurrency per instance).
  await Promise.all(
    expand.map(async ({ node, id }) => {
      node.children = await buildTree(adapter, { ...ref, idOrPath: id }, depth - 1, budget);
    }),
  );
  return nodes;
}

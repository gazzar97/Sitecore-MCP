import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { InstanceRegistry } from "../instances.js";
import { QUERY_SECTIONS, queryKnowledge } from "../knowledge/query.js";
import { SECTIONS, type SectionName } from "../knowledge/types.js";
import { READ_ONLY_ANNOTATIONS, UNTRUSTED_NOTE, instanceArg, run } from "./common.js";

export function registerKnowledgeTools(server: McpServer, registry: InstanceRegistry): void {
  server.registerTool(
    "sitecore_knowledge",
    {
      title: "Read the instance knowledge base",
      description:
        "Answers questions about an instance's structure from its local knowledge base (built once by discovery): " +
        "sites, templates (kind, fields incl. inherited, insert options, where allowed, item counts), renderings (type, component, " +
        "datasource template/location), placeholders, layouts, content-map (site outline, template usage, sample pages with " +
        "their renderings) and relationships (page types -> renderings, rendering usage, placeholders in use), plus the " +
        "user's notes. Instant, no Sitecore calls. " +
        'Start sessions with section="overview" and section="notes". Confirm with live tools before writing. ' +
        UNTRUSTED_NOTE,
      inputSchema: {
        instance: instanceArg,
        section: z.enum(QUERY_SECTIONS).default("overview"),
        query: z
          .string()
          .optional()
          .describe('Filter by name/path/ID, e.g. "article". For content-map: a site name, or a template name/path.'),
        kind: z.enum(["page", "datasource", "folder", "base", "other"]).optional().describe("Template kind filter."),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const name = registry.resolveName(args.instance);
        return queryKnowledge(registry.knowledgeStore(name), {
          section: args.section,
          query: args.query,
          kind: args.kind,
          limit: args.limit,
          staleAfterDays: registry.config.instances[name]!.knowledge.staleAfterDays,
        });
      }),
  );

  // The same content as MCP resources, for clients that attach resources to context.
  server.registerResource(
    "sitecore-knowledge",
    new ResourceTemplate("sitecore://{instance}/knowledge/{section}", {
      list: async () => {
        if (registry.configError) return { resources: [] };
        const resources = Object.keys(registry.config.instances)
          .filter((name) => registry.knowledgeStore(name).exists())
          .flatMap((name) =>
            (["overview", "notes"] as const).map((section) => ({
              uri: `sitecore://${name}/knowledge/${section}`,
              name: `${name} ${section}`,
              mimeType: "text/markdown",
            })),
          );
        return { resources };
      },
    }),
    { title: "Sitecore instance knowledge", description: "Overview, notes and sections of a discovered instance" },
    async (uri, variables) => {
      const name = registry.resolveName(String(variables.instance));
      const section = String(variables.section);
      const store = registry.knowledgeStore(name);
      if (section === "overview" || section === "notes") {
        const text =
          section === "notes"
            ? ((await store.readNotes()) ?? "")
            : ((await store.readOverview()) ?? `No knowledge base yet. Run: npm run discover -- ${name}`);
        return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
      }
      const valid: readonly string[] = [...SECTIONS, "relationships"];
      if (!valid.includes(section)) {
        throw new Error(`Unknown section "${section}". Valid: overview, notes, ${valid.join(", ")}`);
      }
      const file = await store.readSection(section as SectionName);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(file) }] };
    },
  );
}

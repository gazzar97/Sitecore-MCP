import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readTemplate } from "../domain/templates.js";
import type { InstanceRegistry } from "../instances.js";
import { READ_ONLY_ANNOTATIONS, databaseArg, idOrPathArg, instanceArg, languageArg, location, run } from "./common.js";

export function registerTemplateTools(server: McpServer, registry: InstanceRegistry): void {
  server.registerTool(
    "sitecore_template_get",
    {
      title: "Get Sitecore template",
      description:
        "Gets a template definition: sections, fields (type, source, shared/unversioned), base templates and the full " +
        "inheritance chain, with the template each field is defined in. Accepts a template ID/path, or any content " +
        "item (its template is resolved). Standard Template fields are excluded unless includeStandardTemplate=true.",
      inputSchema: {
        idOrPath: idOrPathArg,
        instance: instanceArg,
        database: databaseArg,
        language: languageArg,
        includeInherited: z.boolean().default(true).describe("Include fields from base templates."),
        includeStandardTemplate: z.boolean().default(false),
      },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    (args) =>
      run(async () => {
        const ctx = await registry.get(args.instance);
        return readTemplate(
          ctx.adapter,
          { idOrPath: args.idOrPath, ...location(ctx, args) },
          { includeInherited: args.includeInherited, includeStandardTemplate: args.includeStandardTemplate },
        );
      }),
  );
}

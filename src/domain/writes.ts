import type { AuditLog } from "../audit/auditLog.js";
import type { Database, InstanceConfig } from "../config/schema.js";
import { NotFoundError, SitecoreMcpError, toUserMessage } from "../errors.js";
import { truncate } from "../formatting/format.js";
import { assertValidItemName, assertWriteAllowed } from "../safety/writeGuard.js";
import { isGuid, normalizePath } from "../util/ids.js";
import { WELL_KNOWN_TEMPLATES } from "./templates.js";
import { treeSearch } from "./treeSearch.js";
import type { ContentAdapter, Item } from "./types.js";

export interface WriteContext {
  name: string;
  config: InstanceConfig;
  adapter: ContentAdapter;
  audit: AuditLog;
}

const PREVIEW = 200;
/** Writes default to master; core is accepted only in super admin mode (enforced by assertWriteAllowed). */
const DEFAULT_DB: Database = "master";

/** Runs a write, recording success or failure in the audit log. */
async function audited<T extends { id?: string; path?: string }>(
  ctx: WriteContext,
  tool: string,
  dryRun: boolean,
  request: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const result = await fn();
    await ctx.audit.record({
      instance: ctx.name,
      tool,
      dryRun,
      ok: true,
      itemId: result.id,
      path: result.path,
      details: { request, result },
    });
    return result;
  } catch (err) {
    await ctx.audit.record({ instance: ctx.name, tool, dryRun, ok: false, details: { request }, error: toUserMessage(err) });
    throw err;
  }
}

function hasStandardFieldNames(fields: Record<string, string>): boolean {
  return Object.keys(fields).some((k) => k.startsWith("__"));
}

function unknownFieldError(unknown: string[], item: Item, what: string): SitecoreMcpError {
  const available = Object.keys(item.fields).filter((k) => !k.startsWith("__"));
  return new SitecoreMcpError(
    `Unknown field(s) on ${what}: ${unknown.join(", ")}. Sitecore would silently ignore them, so nothing was written.`,
    `Available fields: ${available.slice(0, 60).join(", ")}${available.length > 60 ? ", …" : ""}`,
  );
}

// ---------------------------------------------------------------- create

export interface CreateArgs {
  parent: string;
  name: string;
  template: string;
  fields: Record<string, string>;
  language: string;
  dryRun: boolean;
  /** Target database (default master). */
  database?: Database;
  allowDuplicateName: boolean;
}

export async function createItem(ctx: WriteContext, args: CreateArgs) {
  return audited(ctx, "sitecore_item_create", args.dryRun, { ...args }, async () => {
    const DB = args.database ?? DEFAULT_DB;
    assertValidItemName(args.name);
    const loc = { database: DB, language: args.language };
    const [parent, template, siblings] = await Promise.all([
      ctx.adapter.getItem({ idOrPath: args.parent, ...loc }, { fields: ["__Sortorder"] }),
      ctx.adapter.getItem({ idOrPath: args.template, ...loc }, { includeStandardFields: true, fields: ["__Standard values"] }),
      ctx.adapter.getChildren({ idOrPath: args.parent, ...loc }, { fields: ["__Sortorder"] }).catch(() => [] as Item[]),
    ]);
    if (!parent) throw new NotFoundError(`Parent item not found: ${args.parent}`);
    if (!template) throw new NotFoundError(`Template not found: ${args.template}`);
    if (template.templateId !== WELL_KNOWN_TEMPLATES.template) {
      throw new SitecoreMcpError(
        `"${template.path}" is not a data template (it is a "${template.templateName}").`,
        "Pass the template item ID or path, e.g. /sitecore/templates/Project/MySite/Page.",
      );
    }
    assertWriteAllowed("create", ctx.name, ctx.config, { path: parent.path, database: DB });

    const duplicate = siblings.find((s) => s.name.toLowerCase() === args.name.toLowerCase());
    if (duplicate && !args.allowDuplicateName) {
      throw new SitecoreMcpError(
        `"${parent.path}" already has a child named "${args.name}" (${duplicate.id}).`,
        "Pick another name, or pass allowDuplicateName=true.",
      );
    }

    // Validate field names against the template's standard values item (it carries every template field).
    let fieldValidation: "validated" | "skipped (template has no standard values)" | "none" = "none";
    if (Object.keys(args.fields).length > 0) {
      const svId = template.fields["__Standard values"];
      const sv =
        svId && isGuid(svId)
          ? await ctx.adapter.getItem({ idOrPath: svId, ...loc }, { includeStandardFields: hasStandardFieldNames(args.fields) })
          : null;
      if (sv) {
        const unknown = Object.keys(args.fields).filter((f) => !(f in sv.fields));
        if (unknown.length > 0) throw unknownFieldError(unknown, sv, `template ${template.name}`);
        fieldValidation = "validated";
      } else {
        fieldValidation = "skipped (template has no standard values)";
      }
    }

    const plan = {
      operation: "create" as const,
      instance: ctx.name,
      database: DB,
      path: `${normalizePath(parent.path)}/${args.name}`,
      parent: { id: parent.id, path: parent.path },
      template: { id: template.id, name: template.name, path: template.path },
      language: args.language,
      fields: Object.fromEntries(Object.entries(args.fields).map(([k, v]) => [k, truncate(v, PREVIEW)])),
      fieldValidation,
      duplicateNameAllowed: duplicate ? true : undefined,
    };
    if (args.dryRun) return { dryRun: true, ...plan, id: undefined as string | undefined };

    const id = await ctx.adapter.createItem(parent.path, loc, {
      name: args.name,
      templateId: template.id,
      fields: args.fields,
    });

    // Read back to confirm which values were stored (SSC ignores unknown fields silently).
    let notApplied: string[] = [];
    if (Object.keys(args.fields).length > 0) {
      const created = await ctx.adapter.getItem(
        { idOrPath: id, ...loc },
        { fields: Object.keys(args.fields), includeStandardFields: hasStandardFieldNames(args.fields) },
      );
      notApplied = Object.keys(args.fields).filter((f) => created?.fields[f] !== args.fields[f]);
    }
    return { dryRun: false, created: true, ...plan, id, notApplied: notApplied.length ? notApplied : undefined };
  });
}

// ---------------------------------------------------------------- update

export interface UpdateArgs {
  idOrPath: string;
  fields: Record<string, string>;
  language: string;
  version?: number;
  dryRun: boolean;
  /** Target database (default master). */
  database?: Database;
}

export async function updateItem(ctx: WriteContext, args: UpdateArgs) {
  return audited(ctx, "sitecore_item_update", args.dryRun, { ...args }, async () => {
    const DB = args.database ?? DEFAULT_DB;
    const names = Object.keys(args.fields);
    if (names.length === 0) throw new SitecoreMcpError("No fields to update.");
    const ref = { idOrPath: args.idOrPath, database: DB, language: args.language, version: args.version };

    const item = await ctx.adapter.getItem(ref, { includeStandardFields: hasStandardFieldNames(args.fields) });
    if (!item) throw new NotFoundError(`Item not found: ${args.idOrPath} (${DB}/${args.language})`);
    assertWriteAllowed("update", ctx.name, ctx.config, { path: item.path, database: DB });
    if (!item.version) {
      throw new SitecoreMcpError(
        `${item.path} has no version in language "${args.language}".`,
        "Adding language versions is not supported yet; edit an existing language version.",
      );
    }
    const unknown = names.filter((f) => !(f in item.fields));
    if (unknown.length > 0) throw unknownFieldError(unknown, item, item.path);

    const changes = names.map((f) => ({
      field: f,
      before: truncate(item.fields[f] ?? "", PREVIEW),
      after: truncate(args.fields[f]!, PREVIEW),
      changed: item.fields[f] !== args.fields[f],
    }));
    const changed = Object.fromEntries(
      names.filter((f) => item.fields[f] !== args.fields[f]).map((f) => [f, args.fields[f]!]),
    );
    const plan = {
      operation: "update" as const,
      instance: ctx.name,
      database: DB,
      id: item.id,
      path: item.path,
      language: item.language || args.language,
      version: item.version,
      changes,
    };
    if (Object.keys(changed).length === 0) return { dryRun: args.dryRun, noChange: true, ...plan };
    if (args.dryRun) return { dryRun: true, ...plan };

    const target = { ...ref, idOrPath: item.id, version: item.version };
    await ctx.adapter.updateItem(target, changed);
    const after = await ctx.adapter.getItem(target, {
      fields: Object.keys(changed),
      includeStandardFields: hasStandardFieldNames(changed),
    });
    const notApplied = Object.keys(changed).filter((f) => after?.fields[f] !== changed[f]);
    return { dryRun: false, updated: true, ...plan, notApplied: notApplied.length ? notApplied : undefined };
  });
}

// ---------------------------------------------------------------- delete

export interface DeleteArgs {
  idOrPath: string;
  includeChildren: boolean;
  dryRun: boolean;
  /** Target database (default master). */
  database?: Database;
}

export async function deleteItem(ctx: WriteContext, args: DeleteArgs) {
  return audited(ctx, "sitecore_item_delete", args.dryRun, { ...args }, async () => {
    const DB = args.database ?? DEFAULT_DB;
    const loc = { database: DB, language: ctx.config.defaultLanguage };
    const item = await ctx.adapter.getItem({ idOrPath: args.idOrPath, ...loc }, { fields: ["__Sortorder"] });
    if (!item) throw new NotFoundError(`Item not found: ${args.idOrPath} (${DB})`);
    assertWriteAllowed("delete", ctx.name, ctx.config, { path: item.path, database: DB });

    const max = ctx.config.maxDeleteItems;
    let descendants = 0;
    if (item.hasChildren) {
      const walk = await treeSearch(
        ctx.adapter,
        { idOrPath: item.id, ...loc },
        {},
        { maxDepth: 50, maxVisited: max + 1, limit: max + 2, concurrency: ctx.config.maxConcurrency },
      );
      descendants = walk.visited;
      if (descendants > max) {
        throw new SitecoreMcpError(
          `${item.path} has more than ${max} descendants; refusing to delete.`,
          `Delete smaller subtrees, or raise "maxDeleteItems" for instance "${ctx.name}".`,
        );
      }
      if (!args.includeChildren) {
        throw new SitecoreMcpError(
          `${item.path} has ${descendants} descendant item(s).`,
          "Pass includeChildren=true to delete the whole subtree (it goes to the Recycle Bin).",
        );
      }
    }

    const plan = {
      operation: "delete" as const,
      instance: ctx.name,
      database: DB,
      id: item.id,
      path: item.path,
      template: item.templateName,
      descendants,
      destination: "Recycle Bin",
    };
    if (args.dryRun) return { dryRun: true, ...plan };

    await ctx.adapter.deleteItem(item.id, DB);
    const still = await ctx.adapter.getItem({ idOrPath: item.id, ...loc }, { fields: ["__Sortorder"] });
    if (still) throw new SitecoreMcpError(`Delete reported success but ${item.path} still exists.`);
    return { dryRun: false, deleted: true, ...plan };
  });
}

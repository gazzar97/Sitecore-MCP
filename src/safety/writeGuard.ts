import type { Database, InstanceConfig } from "../config/schema.js";
import { SitecoreMcpError } from "../errors.js";
import { normalizePath } from "../util/ids.js";

export class WriteNotAllowedError extends SitecoreMcpError {}

export type WriteOperation = "create" | "update" | "delete";

/** Never writable, regardless of writeRoots. */
export const BLOCKED_PATHS = ["/sitecore/system", "/sitecore/templates/system", "/sitecore/layout/system"];

export { isPathAtOrUnder as isAtOrUnder } from "../util/ids.js";
import { isPathAtOrUnder as isAtOrUnder } from "../util/ids.js";

export function isStrictlyUnder(path: string, root: string): boolean {
  return isAtOrUnder(path, root) && normalizePath(path).toLowerCase() !== normalizePath(root).toLowerCase();
}

/** Never deletable, even in super admin mode: the root and its top-level nodes. */
export const UNDELETABLE_ROOT = "/sitecore";

/** Databases writable in super admin mode (normal mode: master only). */
export const SUPER_ADMIN_DATABASES: readonly Database[] = ["master", "core"];

/** Effective permissions: super admin implies write and delete. */
export function canWrite(inst: InstanceConfig): boolean {
  return inst.superAdmin || inst.permissions.write;
}
export function canDelete(inst: InstanceConfig): boolean {
  return inst.superAdmin || (inst.permissions.write && inst.permissions.delete);
}

/**
 * Enforces the write guard layers (docs/04-security-safety.md):
 * permission flags, master-only, blocked system paths, and writeRoots.
 * Super admin mode lifts the permission flags and both path guards and also allows the core
 * database; web stays blocked and the undeletable root nodes still apply.
 * `path` is the parent path for create, the item path for update/delete.
 */
export function assertWriteAllowed(
  op: WriteOperation,
  instanceName: string,
  inst: InstanceConfig,
  target: { path: string; database: Database },
): void {
  const cfgHint = `~/.sitecore-mcp/config.json -> instances.${instanceName}`;
  if (inst.superAdmin) {
    if (!SUPER_ADMIN_DATABASES.includes(target.database)) {
      throw new WriteNotAllowedError(
        `Super admin writes are only allowed in the ${SUPER_ADMIN_DATABASES.join(" and ")} databases (got "${target.database}").`,
        "The web database is filled by publishing; publish from master instead.",
      );
    }
    if (!isAtOrUnder(target.path, UNDELETABLE_ROOT)) {
      throw new WriteNotAllowedError(`"${target.path}" is not under ${UNDELETABLE_ROOT}.`);
    }
    // Deleting /sitecore or /sitecore/<node> would break the instance.
    const depth = normalizePath(target.path).split("/").filter(Boolean).length;
    if (op === "delete" && depth <= 2) {
      throw new WriteNotAllowedError(`"${target.path}" is a Sitecore root node and can never be deleted.`);
    }
    return;
  }
  if (!inst.permissions.write) {
    throw new WriteNotAllowedError(
      `Writes are disabled for instance "${instanceName}".`,
      `Set "permissions": { "write": true } in ${cfgHint} and restart the MCP server.`,
    );
  }
  if (op === "delete" && !inst.permissions.delete) {
    throw new WriteNotAllowedError(
      `Deletes are disabled for instance "${instanceName}".`,
      `Set "permissions": { "write": true, "delete": true } in ${cfgHint} and restart the MCP server.`,
    );
  }
  if (target.database !== "master") {
    throw new WriteNotAllowedError(`Writes are only allowed in the master database (got "${target.database}").`);
  }
  const blocked = BLOCKED_PATHS.find((b) => isAtOrUnder(target.path, b));
  if (blocked) throw new WriteNotAllowedError(`"${target.path}" is under the protected path ${blocked}.`);

  const allowed =
    op === "delete"
      ? inst.writeRoots.some((r) => isStrictlyUnder(target.path, r))
      : inst.writeRoots.some((r) => isAtOrUnder(target.path, r));
  if (!allowed) {
    const where = op === "delete" ? "strictly below" : "at or below";
    throw new WriteNotAllowedError(
      `"${target.path}" is outside the allowed write roots. ${op} requires a path ${where} one of: ${inst.writeRoots.join(", ")}.`,
      `Adjust "writeRoots" in ${cfgHint} if this path should be writable.`,
    );
  }
}

// Sitecore's default ItemNameValidation, made Unicode-aware (.NET \w matches letters in any script).
const ITEM_NAME_RE = /^[\p{L}\p{N}_*$][\p{L}\p{N}_\s\-$]*(\(\d+\))?$/u;

export function assertValidItemName(name: string): void {
  if (name.length === 0 || name.length > 100) {
    throw new SitecoreMcpError(`Item name must be 1-100 characters (got ${name.length}).`);
  }
  if (!ITEM_NAME_RE.test(name)) {
    throw new SitecoreMcpError(
      `"${name}" is not a valid Sitecore item name.`,
      "Use letters, digits, spaces, '_', '-' or '$'; it must not start with a space or '-'.",
    );
  }
}

import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface AuditEntry {
  instance: string;
  tool: string;
  dryRun: boolean;
  ok: boolean;
  itemId?: string;
  path?: string;
  details?: Record<string, unknown>;
  error?: string;
}

const MAX_VALUE = 300;

export function defaultAuditLogPath(): string {
  return join(homedir(), ".sitecore-mcp", "audit.log");
}

/** Append-only JSONL audit log of write attempts (NFR-09). Values are truncated; no secrets are ever passed in. */
export class AuditLog {
  constructor(readonly path: string = defaultAuditLogPath()) {}

  async record(entry: AuditEntry): Promise<void> {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry, details: clip(entry.details) });
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, `${line}\n`, "utf8");
    } catch (e) {
      console.error(`[sitecore-mcp] could not write audit log ${this.path}: ${(e as Error).message}`);
    }
  }
}

function clip(value: unknown): unknown {
  if (typeof value === "string") return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE)}…` : value;
  if (Array.isArray(value)) return value.map(clip);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, clip(v)]));
  }
  return value;
}

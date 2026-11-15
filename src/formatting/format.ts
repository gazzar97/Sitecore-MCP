import type { Item } from "../domain/types.js";

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[truncated, ${value.length} chars total]`;
}

export interface ShapeOptions {
  maxFieldLength: number;
  verbose?: boolean;
  includeFields?: boolean;
  /** Drop empty field values to save tokens (default true unless verbose). */
  omitEmpty?: boolean;
}

/** Token-efficient item representation (NFR-05). */
export function shapeItem(item: Item, opts: ShapeOptions): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: item.id,
    name: item.name,
    path: item.path,
    template: `${item.templateName} ${item.templateId}`,
    language: item.language,
    version: item.version,
    hasChildren: item.hasChildren,
  };
  if (item.displayName && item.displayName !== item.name) out.displayName = item.displayName;
  if (opts.includeFields !== false) {
    const omitEmpty = opts.omitEmpty ?? !opts.verbose;
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(item.fields)) {
      if (omitEmpty && v === "") continue;
      fields[k] = opts.verbose ? v : truncate(v, opts.maxFieldLength);
    }
    out.fields = fields;
  }
  return out;
}

export function shapeItemSummary(item: Item): Record<string, unknown> {
  return {
    id: item.id,
    name: item.name,
    path: item.path,
    template: item.templateName,
    hasChildren: item.hasChildren,
  };
}

export function toJsonText(value: unknown): string {
  return JSON.stringify(value);
}

import { normalizeId } from "../util/ids.js";
import type { ContentAdapter, Item, ItemRef } from "./types.js";

export interface TreeSearchCriteria {
  nameContains?: string;
  templateName?: string;
  templateId?: string;
  fieldName?: string;
  fieldContains?: string;
}

export interface TreeSearchOptions {
  maxDepth: number;
  maxVisited: number;
  limit: number;
  /** Extra fields to load on each item (for output). */
  fields?: string[];
  /** Parallel children requests per batch (default 6). */
  concurrency?: number;
}

export interface TreeSearchResult {
  matches: Item[];
  visited: number;
  truncated: boolean;
  truncatedReason?: string;
}

/**
 * Breadth-first search under a root item against the live database (FR-SRCH-01).
 * Accurate even when indexes are stale, but bounded by maxDepth/maxVisited.
 */
export async function treeSearch(
  adapter: ContentAdapter,
  root: Omit<ItemRef, "version">,
  criteria: TreeSearchCriteria,
  opts: TreeSearchOptions,
): Promise<TreeSearchResult> {
  const fields = [...new Set([...(opts.fields ?? []), ...(criteria.fieldName ? [criteria.fieldName] : [])])];
  const readOpts = { fields: fields.length > 0 ? fields : ["__Sortorder"] };
  const matches: Item[] = [];
  let visited = 0;
  let frontier: string[] = [root.idOrPath];

  const batchSize = opts.concurrency ?? 6;
  for (let depth = 1; depth <= opts.maxDepth && frontier.length > 0; depth++) {
    const next: string[] = [];
    // Fetch siblings' children in parallel batches, then evaluate in BFS order so limits stay exact.
    for (let b = 0; b < frontier.length; b += batchSize) {
      const batch = frontier.slice(b, b + batchSize);
      const results = await Promise.all(batch.map((parent) => adapter.getChildren({ ...root, idOrPath: parent }, readOpts)));
      for (const child of results.flat()) {
        visited++;
        if (matchesCriteria(child, criteria)) {
          matches.push(child);
          if (matches.length >= opts.limit) return { matches, visited, truncated: true, truncatedReason: "limit reached" };
        }
        if (child.hasChildren) next.push(child.id);
        if (visited >= opts.maxVisited) {
          return { matches, visited, truncated: true, truncatedReason: `visited ${visited} items (maxVisited)` };
        }
      }
    }
    frontier = next;
    if (depth === opts.maxDepth && next.length > 0) {
      return { matches, visited, truncated: true, truncatedReason: `maxDepth ${opts.maxDepth} reached` };
    }
  }
  return { matches, visited, truncated: false };
}

export function matchesCriteria(item: Item, c: TreeSearchCriteria): boolean {
  const ci = (a: string, b: string) => a.toLowerCase().includes(b.toLowerCase());
  if (c.nameContains && !ci(item.name, c.nameContains) && !ci(item.displayName, c.nameContains)) return false;
  if (c.templateName && item.templateName.toLowerCase() !== c.templateName.toLowerCase()) return false;
  if (c.templateId && item.templateId !== normalizeId(c.templateId)) return false;
  if (c.fieldName) {
    const value = item.fields[c.fieldName];
    if (value === undefined) return false;
    if (c.fieldContains && !ci(value, c.fieldContains)) return false;
  }
  return true;
}

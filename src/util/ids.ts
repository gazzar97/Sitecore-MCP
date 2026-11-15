const GUID_RE = /^\{?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\}?$/;

export function isGuid(value: string): boolean {
  return GUID_RE.test(value.trim());
}

/** "110d559f-dea5-..." -> "{110D559F-DEA5-...}". Non-GUIDs are returned unchanged. */
export function normalizeId(value: string): string {
  const m = GUID_RE.exec(value.trim());
  return m ? `{${m[1]!.toUpperCase()}}` : value;
}

/** "{110D559F-...}" -> "110d559f-..." (form used in REST URLs). */
export function bareGuid(value: string): string {
  const m = GUID_RE.exec(value.trim());
  if (!m) throw new Error(`Not a GUID: ${value}`);
  return m[1]!.toLowerCase();
}

/** Parses a Sitecore multilist value ("{A}|{B}") into normalized IDs. */
export function parseIdList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split("|")
    .map((s) => s.trim())
    .filter(isGuid)
    .map(normalizeId);
}

/** True if `path` equals `root` or is below it (case-insensitive, as in Sitecore). */
export function isPathAtOrUnder(path: string, root: string): boolean {
  const p = normalizePath(path).toLowerCase();
  const r = normalizePath(root).toLowerCase();
  return p === r || p.startsWith(`${r}/`);
}

export function normalizePath(path: string): string {
  let p = path.trim().replace(/\\/g, "/");
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, "");
  return p;
}

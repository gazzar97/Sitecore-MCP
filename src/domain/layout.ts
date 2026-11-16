import { isGuid, normalizeId } from "../util/ids.js";

/**
 * Parser for Sitecore layout XML (`__Renderings` / `__Final Renderings`), FR-LAY-01.
 *
 * Shared layout looks like:
 *   <r><d id="{device}" l="{layout}"><r uid="{..}" id="{rendering}" ph="main" ds="{..}" par="a=1&amp;b=2" /></d></r>
 * Final layout is usually stored as a delta against the shared layout:
 *   <r xmlns:p="p" xmlns:s="s" p:p="1"><d id="{device}"><r uid="{..}" p:after="r[@uid='{..}']" s:id="{..}" s:ph="main" /></d></r>
 * where `s:` sets attributes, `p:d="1"` deletes a rendering and `p:before`/`p:after` position it.
 * No XML dependency: layout XML is small and regular, so a tolerant tokenizer is enough.
 */

export const DEFAULT_DEVICE_ID = "{FE5D7FDF-89C0-4D99-9AA3-B5FBD009C9F3}";

export interface LayoutRendering {
  uid?: string;
  /** Rendering item ID ("{GUID}"). */
  renderingId: string;
  /** Placeholder path as stored (may be nested or dynamic, e.g. "/main/col-{GUID}-0"). */
  placeholder: string;
  /** Raw datasource: GUID (normalized), path, "local:/Data/x" or query. */
  datasource?: string;
  params: Record<string, string>;
}

export interface DeviceLayout {
  deviceId: string;
  layoutId?: string;
  renderings: LayoutRendering[];
}

export interface ResolvedLayout {
  /** "final" when a __Final Renderings value was applied on top of the shared layout. */
  source: "final" | "shared" | "none";
  devices: DeviceLayout[];
}

// ------------------------------------------------------------------ tiny XML reader

interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

const TOKEN_RE =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<!DOCTYPE[^>]*>|<\/([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e: string) => {
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "amp") return "&";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const code = e.startsWith("#x") ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : "";
  });
}

/** Parses well-formed-ish XML into a node tree. Returns null when there is no root element. */
function parseXml(xml: string): XmlNode | null {
  const root: XmlNode = { name: "#document", attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  for (const m of xml.matchAll(TOKEN_RE)) {
    if (m[1]) {
      // closing tag: pop back to the matching element (tolerates stray closers)
      const idx = stack.map((n) => n.name).lastIndexOf(m[1]);
      if (idx > 0) stack.length = idx;
      continue;
    }
    if (!m[2]) continue; // comment, PI, CDATA, doctype
    const attrs: Record<string, string> = {};
    for (const a of (m[3] ?? "").matchAll(ATTR_RE)) attrs[a[1]!] = decodeEntities(a[2] ?? a[3] ?? "");
    const node: XmlNode = { name: m[2], attrs, children: [] };
    stack[stack.length - 1]!.children.push(node);
    if (m[4] !== "/") stack.push(node);
  }
  return root.children[0] ?? null;
}

// ------------------------------------------------------------------ layout model

/** Attribute value with or without the delta "s:" (set) prefix. */
const attr = (n: XmlNode, name: string): string | undefined => n.attrs[`s:${name}`] ?? n.attrs[name];

export function parseParams(par: string | undefined): Record<string, string> {
  if (!par) return {};
  const out: Record<string, string> = {};
  try {
    for (const [k, v] of new URLSearchParams(par)) if (k) out[k] = v;
  } catch {
    // malformed: keep nothing rather than failing the whole layout
  }
  return out;
}

const cleanDatasource = (ds: string | undefined): string | undefined => {
  const v = (ds ?? "").trim();
  if (!v) return undefined;
  return isGuid(v) ? normalizeId(v) : v;
};

const cleanUid = (uid: string | undefined): string | undefined =>
  uid && isGuid(uid) ? normalizeId(uid) : uid || undefined;

function toRendering(n: XmlNode): LayoutRendering | null {
  const id = attr(n, "id");
  if (!id || !isGuid(id)) return null;
  return {
    uid: cleanUid(n.attrs.uid),
    renderingId: normalizeId(id),
    placeholder: attr(n, "ph") ?? "",
    datasource: cleanDatasource(attr(n, "ds")),
    params: parseParams(attr(n, "par")),
  };
}

function deviceOf(n: XmlNode): DeviceLayout | null {
  const id = attr(n, "id");
  if (!id) return null;
  const l = attr(n, "l");
  return {
    deviceId: isGuid(id) ? normalizeId(id) : id,
    layoutId: l && isGuid(l) ? normalizeId(l) : undefined,
    renderings: n.children.filter((c) => c.name === "r").flatMap((c) => toRendering(c) ?? []),
  };
}

const isDelta = (root: XmlNode) => root.attrs["p:p"] === "1";

/** Parses one layout value (shared or full). Delta-only attributes are ignored. */
export function parseLayoutXml(xml: string | undefined): DeviceLayout[] {
  const root = xml?.trim() ? parseXml(xml) : null;
  if (!root) return [];
  return root.children.filter((c) => c.name === "d").flatMap((d) => deviceOf(d) ?? []);
}

/** "r[@uid='{X}']" -> "{X}" */
function uidFromXPath(expr: string | undefined): string | undefined {
  const m = /@uid\s*=\s*['"]([^'"]+)['"]/.exec(expr ?? "");
  return m ? normalizeId(m[1]!) : undefined;
}

/** Applies a __Final Renderings delta on top of the shared layout (Sitecore XmlDeltas semantics, simplified). */
export function applyLayoutDelta(base: DeviceLayout[], deltaXml: string): DeviceLayout[] {
  const root = parseXml(deltaXml);
  if (!root) return base;
  if (!isDelta(root)) return parseLayoutXml(deltaXml); // a full value replaces the shared layout
  const devices = base.map((d) => ({ ...d, renderings: d.renderings.map((r) => ({ ...r, params: { ...r.params } })) }));

  for (const dn of root.children.filter((c) => c.name === "d")) {
    const rawId = attr(dn, "id");
    if (!rawId) continue;
    const deviceId = isGuid(rawId) ? normalizeId(rawId) : rawId;
    let device = devices.find((d) => d.deviceId === deviceId);
    if (!device) {
      device = { deviceId, renderings: [] };
      devices.push(device);
    }
    const l = attr(dn, "l");
    if (l && isGuid(l)) device.layoutId = normalizeId(l);
    const list = device.renderings;

    for (const rn of dn.children.filter((c) => c.name === "r")) {
      const uid = cleanUid(rn.attrs.uid);
      const idx = uid ? list.findIndex((r) => r.uid === uid) : -1;
      if (rn.attrs["p:d"] === "1") {
        if (idx >= 0) list.splice(idx, 1);
        continue;
      }
      let current: LayoutRendering | null;
      if (idx >= 0) {
        const prev = list.splice(idx, 1)[0]!;
        const id = attr(rn, "id");
        const ds = attr(rn, "ds");
        const par = attr(rn, "par");
        current = {
          ...prev,
          renderingId: id && isGuid(id) ? normalizeId(id) : prev.renderingId,
          placeholder: attr(rn, "ph") ?? prev.placeholder,
          datasource: ds !== undefined ? cleanDatasource(ds) : prev.datasource,
          params: par !== undefined ? parseParams(par) : prev.params,
        };
      } else {
        current = toRendering(rn);
      }
      if (!current) continue;
      // Position: after/before a uid; otherwise keep the old slot (updates) or append (new).
      const anchor = (u: string | undefined) => (u ? list.findIndex((r) => r.uid === u) : -1);
      const after = anchor(uidFromXPath(rn.attrs["p:after"]));
      const before = anchor(uidFromXPath(rn.attrs["p:before"]));
      let at = idx >= 0 ? idx : list.length;
      if (after >= 0) at = after + 1;
      else if (before >= 0) at = before;
      list.splice(Math.min(at, list.length), 0, current);
    }
  }
  return devices;
}

/** Effective layout of an item: shared (__Renderings) with the final delta (__Final Renderings) applied. */
export function resolveLayout(shared: string | undefined, final: string | undefined): ResolvedLayout {
  const base = parseLayoutXml(shared);
  const hasFinal = !!final?.trim();
  const devices = hasFinal ? applyLayoutDelta(base, final!) : base;
  const nonEmpty = devices.some((d) => d.layoutId || d.renderings.length > 0);
  return { source: !nonEmpty ? "none" : hasFinal ? "final" : "shared", devices };
}

/** The default device's layout, else the first device that has anything. */
export function primaryDevice(layout: ResolvedLayout): DeviceLayout | undefined {
  const used = (d: DeviceLayout) => !!d.layoutId || d.renderings.length > 0;
  return layout.devices.find((d) => d.deviceId === DEFAULT_DEVICE_ID && used(d)) ?? layout.devices.find(used);
}

/**
 * Normalizes a placeholder path to its key: last segment, without dynamic-placeholder suffixes.
 * "/main/container-{GUID}-0" -> "container", "main_{GUID}" -> "main", "/root/main" -> "main".
 */
export function placeholderKey(ph: string): string {
  const last = ph.split("/").filter(Boolean).pop() ?? ph;
  return last
    .replace(/[-_]?\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?(-\d+)?$/, "")
    .replace(/-\d+$/, "");
}

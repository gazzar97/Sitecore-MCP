import { NotFoundError, SitecoreMcpError } from "../errors.js";
import { normalizeId, parseIdList } from "../util/ids.js";
import type { ContentAdapter, Item, ItemRef } from "./types.js";

export const WELL_KNOWN_TEMPLATES = {
  template: "{AB86861A-6030-46C5-B394-E8F99E8B87DB}",
  templateSection: "{E269FBB5-3750-427A-9149-7AA950B49301}",
  templateField: "{455A3E98-A627-4B40-8035-E683A0331AC7}",
  standardTemplate: "{1930BBEB-7805-471A-A3BE-4858AC7CF696}",
} as const;

const MAX_TEMPLATES = 50;

export interface TemplateRefInfo {
  id: string;
  name: string;
  path: string;
}

export interface TemplateFieldInfo {
  id: string;
  name: string;
  type: string;
  section: string;
  source?: string;
  shared: boolean;
  unversioned: boolean;
  definedIn: string;
}

export interface TemplateInfo extends TemplateRefInfo {
  resolvedFromItem?: { id: string; path: string };
  standardValuesId?: string;
  baseTemplates: TemplateRefInfo[];
  inheritanceChain: TemplateRefInfo[];
  fields: TemplateFieldInfo[];
}

export interface ReadTemplateOptions {
  includeInherited: boolean;
  includeStandardTemplate: boolean;
}

type Location = Pick<ItemRef, "database" | "language">;

/**
 * Reads a template definition (FR-TPL-01) by walking the template item tree:
 * template -> sections -> fields, and following "__Base template" recursively.
 * If the reference points at a content item, its template is resolved instead.
 */
export async function readTemplate(
  adapter: ContentAdapter,
  ref: Omit<ItemRef, "version">,
  opts: ReadTemplateOptions,
): Promise<TemplateInfo> {
  const loc: Location = { database: ref.database, language: ref.language };
  let root = await getTemplateItem(adapter, ref.idOrPath, loc);
  if (!root) throw new NotFoundError(`Item not found: ${ref.idOrPath} (${ref.database})`);

  let resolvedFromItem: TemplateInfo["resolvedFromItem"];
  if (root.templateId !== WELL_KNOWN_TEMPLATES.template) {
    resolvedFromItem = { id: root.id, path: root.path };
    const tpl = await getTemplateItem(adapter, root.templateId, loc);
    if (!tpl) throw new NotFoundError(`Template ${root.templateId} of item ${root.path} was not found`);
    root = tpl;
  }

  // Breadth-first over base templates; each level is fetched in parallel (order stays deterministic).
  const baseTemplateIds = parseIdList(root.fields["__Base template"]);
  const chain: Item[] = [root];
  const seen = new Set([root.id]);
  let level = baseTemplateIds;
  while (level.length > 0) {
    const ids = [...new Set(level)].filter((id) => !seen.has(id));
    ids.forEach((id) => seen.add(id));
    if (seen.size > MAX_TEMPLATES) {
      throw new SitecoreMcpError(`Template inheritance exceeds ${MAX_TEMPLATES} templates; aborting.`);
    }
    const fetched = await Promise.all(ids.map((id) => getTemplateItem(adapter, id, loc)));
    level = [];
    for (const t of fetched) {
      if (!t) continue; // dangling base template reference
      chain.push(t);
      if (t.id !== WELL_KNOWN_TEMPLATES.standardTemplate) level.push(...parseIdList(t.fields["__Base template"]));
    }
  }

  const templatesToRead = chain.filter(
    (t, i) =>
      (i === 0 || opts.includeInherited) && (opts.includeStandardTemplate || !isStandardTemplateFamily(t, chain)),
  );

  const fields = (await Promise.all(templatesToRead.map((t) => readOwnFields(adapter, t, loc)))).flat();

  const toRef = (t: Item): TemplateRefInfo => ({ id: t.id, name: t.name, path: t.path });
  const sv = root.fields["__Standard values"];
  return {
    ...toRef(root),
    resolvedFromItem,
    standardValuesId: sv ? normalizeId(sv) : undefined,
    baseTemplates: chain.filter((t) => baseTemplateIds.includes(t.id)).map(toRef),
    inheritanceChain: chain.slice(1).map(toRef),
    fields,
  };
}

/** Standard Template and the system templates it pulls in (Advanced, Appearance, ...). */
function isStandardTemplateFamily(t: Item, chain: Item[]): boolean {
  if (t.id === WELL_KNOWN_TEMPLATES.standardTemplate) return true;
  const std = chain.find((c) => c.id === WELL_KNOWN_TEMPLATES.standardTemplate);
  return !!std && parseIdList(std.fields["__Base template"]).includes(t.id);
}

function getTemplateItem(adapter: ContentAdapter, idOrPath: string, loc: Location): Promise<Item | null> {
  return adapter.getItem(
    { ...loc, idOrPath },
    { includeStandardFields: true, fields: ["__Base template", "__Standard values"] },
  );
}

async function readOwnFields(adapter: ContentAdapter, template: Item, loc: Location): Promise<TemplateFieldInfo[]> {
  const sections = (
    await adapter.getChildren({ ...loc, idOrPath: template.id }, { includeStandardFields: true, fields: ["__Sortorder"] })
  ).filter((s) => s.templateId === WELL_KNOWN_TEMPLATES.templateSection);

  const sorted = sortBySortorder(sections);
  const perSection = await Promise.all(
    sorted.map((section) =>
      adapter.getChildren(
        { ...loc, idOrPath: section.id },
        { includeStandardFields: true, fields: ["Type", "Source", "Shared", "Unversioned", "__Sortorder"] },
      ),
    ),
  );
  const result: TemplateFieldInfo[] = [];
  sorted.forEach((section, i) => {
    const fieldItems = perSection[i]!.filter((f) => f.templateId === WELL_KNOWN_TEMPLATES.templateField);
    for (const f of sortBySortorder(fieldItems)) {
      result.push({
        id: f.id,
        name: f.name,
        type: f.fields.Type ?? "",
        section: section.name,
        source: f.fields.Source || undefined,
        shared: f.fields.Shared === "1",
        unversioned: f.fields.Unversioned === "1",
        definedIn: template.name,
      });
    }
  });
  return result;
}

function sortBySortorder(items: Item[]): Item[] {
  const order = (i: Item) => {
    const n = Number.parseInt(i.fields.__Sortorder ?? "", 10);
    return Number.isNaN(n) ? 100 : n;
  };
  return [...items].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}

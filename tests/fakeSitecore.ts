import type { HttpRequest, HttpResponse, HttpTransport } from "../src/http/transport.js";
import { WELL_KNOWN_TEMPLATES as T } from "../src/domain/templates.js";

export interface FakeItem {
  id: string; // bare lowercase guid
  name: string;
  parent: string | null;
  template: string; // bare guid
  templateName: string;
  fields: Record<string, string>;
}

const bare = (id: string) => id.replace(/[{}]/g, "").toLowerCase();

export const IDS = {
  sitecore: "11111111-1111-1111-1111-111111111111",
  content: "0de95ae4-41ab-4d01-9eb0-67441b7c2450",
  home: "110d559f-dea5-42ea-9c1c-8a5df7e70ef9",
  about: "22222222-2222-2222-2222-222222222222",
  news: "33333333-3333-3333-3333-333333333333",
  article: "44444444-4444-4444-4444-444444444444",
  templates: "3c1715fe-6a13-4fcf-845f-de308ba9741d",
  pageTpl: "aaaaaaaa-0000-0000-0000-000000000001",
  pageSection: "aaaaaaaa-0000-0000-0000-000000000002",
  titleField: "aaaaaaaa-0000-0000-0000-000000000003",
  bodyField: "aaaaaaaa-0000-0000-0000-000000000004",
  baseTpl: "bbbbbbbb-0000-0000-0000-000000000001",
  baseSection: "bbbbbbbb-0000-0000-0000-000000000002",
  metaField: "bbbbbbbb-0000-0000-0000-000000000003",
  pageSv: "aaaaaaaa-0000-0000-0000-000000000005",
  stdTpl: bare(T.standardTemplate),
  stdSection: "cccccccc-0000-0000-0000-000000000002",
  stdField: "cccccccc-0000-0000-0000-000000000003",
};

const tpl = bare(T.template);
const sec = bare(T.templateSection);
const fld = bare(T.templateField);
const folder = "f0000000-0000-0000-0000-000000000000";

export function defaultItems(): FakeItem[] {
  return [
    { id: IDS.sitecore, name: "sitecore", parent: null, template: folder, templateName: "Root", fields: {} },
    { id: IDS.content, name: "content", parent: IDS.sitecore, template: folder, templateName: "Main section", fields: {} },
    {
      id: IDS.home, name: "Home", parent: IDS.content, template: IDS.pageTpl, templateName: "Page",
      fields: { Title: "Welcome", Body: `<p>${"x".repeat(800)}</p>`, MetaTitle: "", __Sortorder: "100", "__Final Renderings": "<r/>" },
    },
    { id: IDS.about, name: "About", parent: IDS.home, template: IDS.pageTpl, templateName: "Page", fields: { Title: "About us", Body: "", MetaTitle: "", __Sortorder: "200" } },
    { id: IDS.news, name: "News", parent: IDS.home, template: IDS.pageTpl, templateName: "Page", fields: { Title: "News", Body: "", MetaTitle: "", __Sortorder: "100" } },
    { id: IDS.article, name: "Big Launch", parent: IDS.news, template: IDS.pageTpl, templateName: "Page", fields: { Title: "Launch day", Body: "rocket", MetaTitle: "", __Sortorder: "100" } },
    { id: IDS.templates, name: "templates", parent: IDS.sitecore, template: folder, templateName: "Main section", fields: {} },
    // Page template -> _Base -> Standard template
    { id: IDS.pageTpl, name: "Page", parent: IDS.templates, template: tpl, templateName: "Template", fields: { "__Base template": `{${IDS.baseTpl.toUpperCase()}}`, "__Standard values": `{${IDS.pageSv.toUpperCase()}}` } },
    { id: IDS.pageSv, name: "__Standard Values", parent: IDS.pageTpl, template: IDS.pageTpl, templateName: "Page", fields: { Title: "", Body: "", MetaTitle: "", __Sortorder: "" } },
    { id: IDS.pageSection, name: "Content", parent: IDS.pageTpl, template: sec, templateName: "Template section", fields: { __Sortorder: "100" } },
    { id: IDS.bodyField, name: "Body", parent: IDS.pageSection, template: fld, templateName: "Template field", fields: { Type: "Rich Text", Shared: "", Unversioned: "", Source: "", __Sortorder: "200" } },
    { id: IDS.titleField, name: "Title", parent: IDS.pageSection, template: fld, templateName: "Template field", fields: { Type: "Single-Line Text", Shared: "", Unversioned: "1", Source: "", __Sortorder: "100" } },
    { id: IDS.baseTpl, name: "_Base", parent: IDS.templates, template: tpl, templateName: "Template", fields: { "__Base template": T.standardTemplate } },
    { id: IDS.baseSection, name: "Meta", parent: IDS.baseTpl, template: sec, templateName: "Template section", fields: {} },
    { id: IDS.metaField, name: "MetaTitle", parent: IDS.baseSection, template: fld, templateName: "Template field", fields: { Type: "Single-Line Text", Shared: "1", Unversioned: "", Source: "" } },
    { id: IDS.stdTpl, name: "Standard template", parent: IDS.templates, template: tpl, templateName: "Template", fields: { "__Base template": "" } },
    { id: IDS.stdSection, name: "Statistics", parent: IDS.stdTpl, template: sec, templateName: "Template section", fields: {} },
    { id: IDS.stdField, name: "__Created", parent: IDS.stdSection, template: fld, templateName: "Template field", fields: { Type: "Datetime", Shared: "", Unversioned: "1" } },
  ];
}

export interface FakeSitecoreOptions {
  password?: string;
  items?: FakeItem[];
  /** Respond 403 to every item request (simulates ServicesLocalOnlyPolicy). */
  localOnlyPolicy?: boolean;
}

/** In-memory emulation of the SSC ItemService endpoints used by the adapter. */
export function createFakeSitecore(opts: FakeSitecoreOptions = {}) {
  const items = opts.items ?? defaultItems();
  const byId = new Map(items.map((i) => [i.id, i]));
  const validCookies = new Set<string>();
  const requests: HttpRequest[] = [];
  const recycled: FakeItem[] = [];
  let loginCount = 0;

  const pathOf = (i: FakeItem): string => (i.parent ? `${pathOf(byId.get(i.parent)!)}/${i.name}` : `/${i.name}`);
  const byPath = (p: string) => items.find((i) => pathOf(i).toLowerCase() === p.toLowerCase());

  const toRaw = (i: FakeItem, q: URLSearchParams): Record<string, unknown> => {
    const includeStd = q.get("includeStandardTemplateFields") === "true";
    const only = q.get("fields")?.split(",");
    const props: Record<string, unknown> = {
      ItemID: i.id,
      ItemName: i.name,
      ItemPath: pathOf(i),
      ParentID: i.parent ?? "",
      TemplateID: i.template,
      TemplateName: i.templateName,
      ItemLanguage: q.get("language") ?? "en",
      ItemVersion: "1",
      DisplayName: i.name,
      HasChildren: items.some((c) => c.parent === i.id) ? "True" : "False",
    };
    // Like real SSC: `fields=` filters item properties too, and includeMetadata adds field definitions.
    const raw: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) if (!only || only.includes(k)) raw[k] = v;
    if (q.get("includeMetadata") === "true") raw.metadata = { Title: { Type: "Single-Line Text" } };
    for (const [k, v] of Object.entries(i.fields)) {
      if (k.startsWith("__") && !includeStd) continue;
      if (only && !only.includes(k)) continue;
      raw[k] = v;
    }
    return raw;
  };

  const json = (status: number, body: unknown): HttpResponse => ({ status, headers: {}, body: JSON.stringify(body) });

  const transport: HttpTransport = async (req) => {
    requests.push(req);
    const url = new URL(req.url);
    const q = url.searchParams;

    if (url.pathname === "/sitecore/api/ssc/auth/login") {
      const body = JSON.parse(req.body ?? "{}");
      if (body.password !== (opts.password ?? "b")) return { status: 403, headers: {}, body: "" };
      loginCount++;
      const cookie = `auth${loginCount}`;
      validCookies.add(cookie);
      return { status: 200, headers: { "set-cookie": [`.ASPXAUTH=${cookie}; path=/; HttpOnly`, "empty=; path=/"] }, body: "" };
    }

    const cookie = /\.ASPXAUTH=([^;]+)/.exec(req.headers?.cookie ?? "")?.[1];
    if (!cookie || !validCookies.has(cookie)) return { status: 401, headers: {}, body: "" };

    if (url.pathname === "/sitecore/shell/sitecore.version.xml") {
      return {
        status: 200,
        headers: {},
        body: "<information><version><major>10</major><minor>4</minor><build>0</build><revision>010422</revision></version></information>",
      };
    }
    if (opts.localOnlyPolicy) return json(403, { Message: "Forbidden" });

    // ---- writes, mirroring real SSC 10.4 behaviour (unknown fields are silently ignored)
    const tplFields = (templateId: string): Set<string> => {
      const names = new Set<string>(["__Sortorder"]);
      const sv = items.find((i) => i.template === templateId && i.name === "__Standard Values");
      Object.keys(sv?.fields ?? {}).forEach((n) => names.add(n));
      return names;
    };
    if (req.method === "POST" && url.pathname.startsWith("/sitecore/api/ssc/item/")) {
      const parentPath = `/${decodeURIComponent(url.pathname.slice("/sitecore/api/ssc/item/".length))}`;
      const parent = byPath(parentPath);
      if (!parent) return json(404, { Message: "parent not found" });
      const body = JSON.parse(req.body ?? "{}") as Record<string, string>;
      const { ItemName, TemplateID, ...values } = body;
      const template = bare(TemplateID!);
      const allowed = tplFields(template);
      const id = `dddddddd-0000-0000-0000-${String(items.length).padStart(12, "0")}`;
      const created: FakeItem = {
        id,
        name: ItemName!,
        parent: parent.id,
        template,
        templateName: byId.get(template)?.name ?? "?",
        fields: Object.fromEntries([...allowed].map((f) => [f, values[f] ?? ""])),
      };
      items.push(created);
      byId.set(id, created);
      return { status: 201, headers: { location: `https://cm.localhost/sitecore/api/ssc/item/${id}?Database=master` }, body: "" };
    }
    const writeMatch = /^\/sitecore\/api\/ssc\/item\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (writeMatch && (req.method === "PATCH" || req.method === "DELETE")) {
      const item = byId.get(writeMatch[1]!);
      if (!item) return json(404, { Message: "not found" });
      if (req.method === "PATCH") {
        const body = JSON.parse(req.body ?? "{}") as Record<string, string>;
        for (const [k, v] of Object.entries(body)) if (k in item.fields) item.fields[k] = v;
        return { status: 204, headers: {}, body: "" };
      }
      const doomed = new Set<string>([item.id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const i of items) if (i.parent && doomed.has(i.parent) && !doomed.has(i.id)) (doomed.add(i.id), (grew = true));
      }
      for (const id of doomed) {
        recycled.push(byId.get(id)!);
        byId.delete(id);
        items.splice(items.findIndex((i) => i.id === id), 1);
      }
      return { status: 204, headers: {}, body: "" };
    }

    if (url.pathname === "/sitecore/api/ssc/item/search") {
      const term = (q.get("term") ?? "").toLowerCase();
      const hits = items.filter(
        (i) => i.name.toLowerCase().includes(term) || Object.values(i.fields).some((v) => v.toLowerCase().includes(term)),
      );
      return json(200, { TotalCount: hits.length, TotalPage: 1, Results: hits.map((i) => toRaw(i, q)) });
    }
    const m = /^\/sitecore\/api\/ssc\/item\/?([0-9a-f-]{36})?(\/children)?$/.exec(url.pathname);
    if (m) {
      const item = m[1] ? byId.get(m[1]) : byPath(q.get("path") ?? "");
      if (!item) return json(404, { Message: "not found" });
      if (m[2]) return json(200, items.filter((c) => c.parent === item.id).map((c) => toRaw(c, q)));
      return json(200, toRaw(item, q));
    }
    return json(404, {});
  };

  return {
    transport,
    requests,
    items,
    recycled,
    byPath,
    writes: () => requests.filter((r) => r.method !== "GET" && !r.url.includes("/auth/login")),
    get loginCount() {
      return loginCount;
    },
    expireSessions: () => validCookies.clear(),
  };
}

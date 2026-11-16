# 08 — Instance Knowledge Base (first-run discovery)

> Status: **K1–K4 implemented**: the knowledge store, the `sitecore_knowledge` tool and resources, discovery of environment, sites, templates, renderings, placeholders and layouts (`npm run discover`), and (K4) the layout XML parser, the content map with sampled page layouts, `relationships.json` and page types in `overview.md`. K4 is verified against the fake SSC server only, not yet on a real instance. K5–K8 (forms, workflows, background discovery, cache-aware tools) are still planned. This is the reference for how the MCP learns a Sitecore instance the first time it connects, stores what it learned, and reuses it in every later session.

## 1. Problem

Today every session starts cold. To answer *"which template should I use for a news article?"* or *"what renders on the home page?"* the AI has to rediscover the instance live:

- **It's slow.** Some local instances take several seconds per request, so walking one template can take 25–45 s and a broad exploration takes minutes.
- **It's shallow.** The model only sees what it happened to fetch, so it guesses at naming conventions, page types, which renderings exist, where datasources live and which forms exist.
- **It's repeated.** The same discovery happens in every session and is thrown away afterwards.

## 2. Goal

Run a one-time **discovery** against an instance and save a compact, structured **Instance Knowledge Base (IKB)** on disk. Every later session reads the IKB first, then uses live calls only to confirm details or fetch fresh content.

Success looks like:
- *"What page types does this site have?"*, *"Which template do I use for X?"* and *"Which renderings can go in the main placeholder?"* are answered **from the IKB in under a second**, with no Sitecore calls.
- Create/update suggestions use the instance's own conventions: insert options, datasource locations, naming patterns.
- Discovery of a typical project instance finishes in **≤ 10 minutes** even on a slow CM, and can be re-run section by section.

## 3. What gets discovered

Discovery is scoped to **project-owned** things by default. Sitecore's own system templates and renderings are summarized, not catalogued.

| Area | Where it's read from | What's kept |
|---|---|---|
| **Environment** | `ping`, `/sitecore/system/Languages`, presence checks | Sitecore version, languages, databases, detected modules: SXA, Headless/JSS, Sitecore Forms, SPE, EXM |
| **Sites** | `/sitecore/content` children, site-root / SXA site templates, start items | Site name, root path, home item, languages, data and media folders |
| **Templates** | `/sitecore/templates/Project`, `/Feature`, `/Foundation`, `/User Defined` (configurable) | Name, ID, path, sections and fields (name, type, source, shared/unversioned), base templates, standard values, **insert options** (`__Masters`), icon, usage count, classification (page / datasource / folder / settings / base) |
| **Renderings** | `/sitecore/layout/Renderings/{Project,Feature}` | Name, ID, type (View / Controller / JSON rendering), component name or view path, **datasource template and location**, parameters template, compatible renderings, usage count |
| **Placeholders** | `/sitecore/layout/Placeholder Settings` | Placeholder key and allowed renderings |
| **Layouts and devices** | `/sitecore/layout/Layouts`, `/sitecore/layout/Devices` | Name, ID, path or type |
| **Content map** | Bounded walk of each site root | Tree outline (top levels), page count per template, depth, typical paths, shared datasource folders, 1–3 **sample items per page template**, and the renderings used on each sampled page (parsed from `__Final Renderings`) |
| **Forms** (if present) | `/sitecore/Forms` | Form name, ID, fields (type, label, required), submit actions, which pages use the form rendering |
| **Workflows** | `/sitecore/system/Workflows` | Workflows, states (initial and final), commands with their next state, which templates use each as default |
| **Dictionary** | Dictionary domains and `Dictionary entry` items | Domains, entry count, sample keys |
| **Media library** | `/sitecore/media library` (outline only) | Top folders and item counts. Binaries are never downloaded. |

**Relationships** are derived from the data above, because they're what makes answers useful:
- template → renderings that use it as datasource template
- rendering → pages that use it
- template → pages using it, and the parent templates where it's an insert option
- form → pages using it
- workflow → templates that use it as default

## 4. Where it's stored

The IKB is stored per instance, outside any repo, next to the config:

```
~/.sitecore-mcp/knowledge/<instance>/
  manifest.json        # schema version, generated-at, Sitecore version, scope, per-section counts/durations/status
  overview.md          # ≤ ~3k tokens human+AI summary: the entry point read at the start of every session
  sites.json
  templates.json
  renderings.json
  placeholders.json
  layouts.json
  content-map.json
  forms.json
  workflows.json
  dictionary.json
  media.json
  relationships.json
  notes.md             # YOUR curated knowledge: conventions, do/don't, glossary. Never overwritten by discovery.
```

Rules:
- **`overview.md` is small and always loaded.** The JSON files are detailed and queried on demand, never dumped wholesale into the conversation.
- **`notes.md` belongs to you.** Discovery creates it once from a template and then never touches it. Use it for things the instance can't tell the MCP, for example *"news articles always go under Home/News/<year>"* or *"never use the legacy Promo rendering"*.
- **Content values are not mirrored.** Only structure, counts and short samples (truncated, first ~100 characters per field) are stored.
- Every file carries `generatedAt` and the instance's Sitecore version, so it's clear how old the knowledge is.

### `overview.md` example (shape)

```markdown
# Instance: projectA (Sitecore 10.4, XM, Headless/JSS detected, Forms detected)
Generated 2026-11-15 · languages: en, ar · 1 site

## Sites
- MySite: /sitecore/content/MySite (home: /Home, data: /Data, media: /sitecore/media library/MySite)

## Page types (template → pages)
- Article Page (412) — insert under: News Folder · renderings: Hero, Rich Text, Related Articles
- Landing Page (37) — renderings: Hero, Card Grid, Form
- ...

## Datasource types
- Hero (datasource for rendering "Hero", location: ./Data or /Data/Heroes)
- ...

## Placeholders
- main: Hero, Rich Text, Card Grid, Form, ...

## Forms
- Contact Us (6 fields, submit: Send Email + Save Data) — used on /Home/Contact

## Workflows
- Sample Workflow: Draft → Awaiting Approval → Approved (default for Article Page)

## Conventions noticed
- Item names are lowercase-hyphenated under /Home/News
- Every page has a local "Data" folder for datasources
```

### `templates.json` entry example (shape)

```json
{
  "id": "{11111111-2222-3333-4444-555555555555}",
  "name": "Article Page",
  "path": "/sitecore/templates/Project/MySite/Pages/Article Page",
  "kind": "page",
  "kindReason": "standard values have a layout; 412 items with layout use it",
  "baseTemplates": ["_Page Base", "_Seo"],
  "fields": [
    { "name": "Title", "type": "Single-Line Text", "section": "Content", "definedIn": "Article Page" },
    { "name": "Body", "type": "Rich Text", "section": "Content", "definedIn": "Article Page" }
  ],
  "insertOptions": ["Article Data Folder"],
  "allowedUnder": ["News Folder"],
  "usedBy": { "items": 412, "samplePaths": ["/sitecore/content/MySite/Home/News/2026/first-article"] },
  "datasourceFor": [],
  "defaultWorkflow": "Sample Workflow",
  "revision": "8f0c…"
}
```

## 5. How the MCP builds it (discovery algorithm)

Discovery runs in **phases**. Each phase writes its own file, so a failure or timeout loses only that phase and phases can be refreshed on their own.

| Phase | Reads | Bounded by |
|---|---|---|
| A. Environment | ping, languages, module presence checks | ~10 requests |
| B. Sites | `/sitecore/content` two levels deep; detect site roots | ~20 requests |
| C. Templates | template folders in scope; each template's sections, fields and standard values | `maxTemplates` (default 500) |
| D. Renderings, placeholders, layouts | rendering folders in scope | `maxRenderings` (default 500) |
| E. Content map | per-site breadth-first walk; count templates; sample pages; parse layout of samples | `maxContentItems` per site (default 3,000), `samplesPerTemplate` (default 3) |
| F. Forms | `/sitecore/Forms` subtree | `maxForms` (default 200) |
| G. Workflows, dictionary, media outline | system folders, media outline | small |
| H. Relationships and overview | local processing only, no Sitecore calls | — |

Engineering notes:
- **Parallel and bounded.** Discovery uses the per-instance `maxConcurrency` limiter that already exists. Each phase reports `visited`, `truncated` and `durationMs` in `manifest.json`.
- **Slow-instance aware.** On a CM taking ~4 s per request, with 6 in flight, about 1,000 requests take roughly 11 minutes. Phase budgets should be sized to stay within that.
- **Layout parsing.** `__Final Renderings` (falling back to `__Renderings`) is XML with entries like `<r uid s:id s:ph s:ds s:par>`. Parse it into `{rendering, placeholder, datasource, params}` and resolve IDs against `renderings.json`.
- **Classification heuristics** label templates as:
  - *page*: has layout in standard values, or is used by items that have layout
  - *datasource*: used as a rendering's datasource template
  - *folder*: name or base template is a folder, and it has insert options
  - *base / settings*: name starts with `_`, or it's only used as a base template

  Every label records why it was chosen (`kindReason`), so it can be checked.
- **Read-only.** Discovery never writes to Sitecore. It writes only to the local knowledge folder.
- **Long runs happen outside the chat.** MCP clients time out tool calls after about 60 s, so the full run is a CLI command (`npm run discover -- <instance>`) or a background job inside the server (see §6), never a single blocking tool call.

## 6. How the MCP uses it

### New tools

| Tool | Purpose |
|---|---|
| `sitecore_knowledge` | Read the IKB: `section` = overview / sites / templates / renderings / placeholders / forms / workflows / content-map / notes, plus an optional `query` (e.g. `templates` + `"article"`). Answers from disk instantly. |
| `sitecore_discover` | Start or refresh discovery in the background (`sections` optional). Returns immediately with a job ID. Read-only against Sitecore. |
| `sitecore_discover_status` | Progress per phase, errors, and when it finished |

Also:
- **MCP resources:** `sitecore://<instance>/knowledge/overview` and the other sections, for clients that support resources.
- **MCP prompt:** `sitecore-onboard`, which runs discovery, shows the overview, and asks you to fill in `notes.md`.

### Changes to existing tools

- **`sitecore_template_get`** answers from `templates.json` when the cache is fresh (`source: "knowledge"`), and goes live with `fresh: true`. This cuts 25–45 s calls to milliseconds.
- **`sitecore_item_get`** adds a short `context` block, for example `pageType: "Article Page"`, `insertOptions: [...]`, `renderings on this page: [...]`.
- **`sitecore_item_create`** checks the chosen template against the parent's insert options and warns (doesn't block) when it's unusual. It also suggests the conventional location and naming.
- **`sitecore_ping`** reports the IKB age and flags it as stale. By default it's stale after 14 days, or when the Sitecore version has changed.

### Server instructions (what the model is told at startup)

> "Before answering questions about an instance's structure, call `sitecore_knowledge` with `section: "overview"`, and read `notes`. Use the knowledge base to resolve names to IDs and paths, pick templates and renderings, and follow conventions. Confirm with live tools before any write. If the knowledge base is missing or stale, say so and offer to run `sitecore_discover`."

## 7. Your session playbook (use this every time)

1. **First time on an instance:**
   - Run `npm run discover -- <instance>`, or ask Claude to *"run Sitecore discovery"*.
   - Read `overview.md` and add anything it missed to `notes.md`.
2. **Start of each session:**
   - Ask *"Load the Sitecore knowledge for <instance>"*. Claude reads the overview and your notes.
   - If it reports stale knowledge, refresh only what changed: *"refresh templates and renderings"*.
3. **Asking questions:** refer to things by name (*"the Article Page template"*, *"the Hero rendering"*). The IKB maps names to IDs and paths.
4. **Before writing:** ask for a dry run. Claude uses the IKB to pick the template, location and fields, and the live tools confirm them.
5. **After big changes** (deployments, serialization syncs, new templates): refresh the affected sections.
6. **Teach it:** when Claude gets a convention wrong, add the rule to `notes.md` so the next session starts with it.

## 8. Freshness

SSC has no change feed. So freshness is handled by:
- **Manual and section refresh**, which is cheap and targeted.
- **Spot checks:** before relying on a cached template or rendering for a write, compare its `__Revision` with a single live read and refresh that entry if it differs.
- **Version change:** if `ping` shows a different Sitecore version than the manifest, mark everything stale.
- **Later:** with Authoring GraphQL or SPE, query items updated since the last run and refresh incrementally.

## 9. Configuration (proposed)

```json
"knowledge": {
  "enabled": true,
  "path": "~/.sitecore-mcp/knowledge",
  "staleAfterDays": 14,
  "scope": {
    "templateRoots": ["/sitecore/templates/Project", "/sitecore/templates/Feature", "/sitecore/templates/Foundation", "/sitecore/templates/User Defined"],
    "renderingRoots": ["/sitecore/layout/Renderings/Project", "/sitecore/layout/Renderings/Feature"],
    "contentRoots": ["/sitecore/content"],
    "includeForms": true
  },
  "limits": { "maxTemplates": 500, "maxRenderings": 500, "maxContentItems": 3000, "samplesPerTemplate": 3 }
}
```

As implemented, the keys sit directly under each instance's `"knowledge"` object. These are the defaults:

```json
"knowledge": {
  "staleAfterDays": 14,
  "templateRoots": ["/sitecore/templates/Project", "/sitecore/templates/Feature", "/sitecore/templates/Foundation", "/sitecore/templates/User Defined"],
  "renderingRoots": ["/sitecore/layout/Renderings/Project", "/sitecore/layout/Renderings/Feature"],
  "excludePaths": ["… SXA / JSS vendor folders …"],
  "contentRoots": ["/sitecore/content"],
  "maxTemplateItems": 20000,
  "maxRenderingItems": 3000,
  "maxContentItems": 3000,
  "samplesPerTemplate": 3,
  "maxSampledPages": 200
}
```

This goes per instance and falls back to these defaults.

## 10. Safety and privacy

- The IKB lives in the user profile, **not the repo**, so it can't be committed by accident. Treat it as being as sensitive as the content it describes.
- Field values aren't stored, apart from short truncated samples. Fields whose names look secret (`password`, `apikey`, `secret`, `token`, `connectionstring`) are never sampled.
- Everything in the IKB came from CMS content, so it's untrusted data, never instructions. That rule already applies to live tool output.
- Discovery is read-only and passes the same local-host check as every other call.

## 11. Implementation plan

| Step | Work | Done when |
|---|---|---|
| K1 ✅ | Knowledge store: folder layout, `manifest.json`, JSON schemas, `notes.md` template, read API | Unit tests read and write a sample IKB |
| K2 ✅ | `sitecore_knowledge` tool and resources; server instructions updated | Questions answered from a fixture IKB with no Sitecore calls |
| K3 ✅ | Discovery phases A–D (environment, sites, templates, renderings/placeholders/layouts) and the `npm run discover` CLI | Runs against a real instance; template counts match the Content Editor |
| K4 ✅ | Layout XML parser, phase E (content map and samples), relationships and the `overview.md` generator | Overview lists page types with their renderings correctly for a sample site |
| K5 | Phases F–G (forms, workflows, dictionary, media outline) | Forms listed with fields and the pages that use them |
| K6 | Background `sitecore_discover` and `sitecore_discover_status`, section refresh, staleness in `ping` | Discovery starts from chat; progress visible; partial refresh works |
| K7 | Cache-aware existing tools (template from cache, item `context`, create insert-options check) | `template_get` from cache under 100 ms; create warns on unusual template |
| K8 | `sitecore-onboard` prompt; docs; smoke test that discovery is read-only (no writes in the request log) | First-run flow documented and tested end to end |

### K4 as built

- **Layout parser** (`src/domain/layout.ts`): reads `__Renderings` and applies the `__Final Renderings` delta (`s:` set, `p:d` delete, `p:before`/`p:after` position). Placeholder paths are reduced to keys (`/main/col-{GUID}-0` → `col`). It's reusable for the Phase 2 `sitecore_layout_get` tool.
- **Content map** (`content-map.json`): per site, a bounded breadth-first walk (`maxContentItems`, default 3,000) that skips other sites nested under its root. It records:
  - an outline of the top 2 levels with descendant counts
  - template usage: count, items under Home, depth range, parent templates
  - up to `samplesPerTemplate` (default 3) of the shallowest pages per template, with their parsed layout, capped at `maxSampledPages` (default 200) in total
  - datasources resolved to paths when possible, and `local:` datasources resolved relative to the page
  - rendering parameters truncated to 100 characters, with secret-looking keys dropped
- **Relationships** (`relationships.json`): computed locally after every run once a content map exists. It holds:
  - page types: the templates whose items have a layout, with their renderings and placeholders
  - rendering usage, including where each rendering's datasources live
  - placeholders in use
  - catalogued renderings not seen on any sampled page
- **Classification:** a template with no layout in its standard values is now classified as `page` when sampled items using it have a layout. Templates carry a `usage` block.
- **Refresh:** `--sections sites,content-map` refreshes only the content map. The content map needs the `sites` section.

Testing: extend the fake SSC server with renderings, a layout XML sample, forms and workflows, so every phase has deterministic tests. Run the real-instance smoke test in read-only mode.

## 12. Open questions

1. Should a deliberately shorter "quick discovery" (environment, sites and templates only, about 1–2 minutes) run automatically the first time an instance is used?
2. Should `notes.md` also live in the project repo (e.g. `docs/sitecore-notes.md`) so a team can share conventions? Discovery output would stay private.
3. Headless sites: should we also capture the Layout Service JSON for each sampled page, which shows component names exactly as the front end sees them?
4. Serialization: when `repoPath` is set, should the IKB also map which SCS/Unicorn module owns each template and rendering?

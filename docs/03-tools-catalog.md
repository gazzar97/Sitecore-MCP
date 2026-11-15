# 03 — Proposed Tool Catalog

Naming: `sitecore_<area>_<action>`. Every tool accepts optional `instance` (defaults to configured default).
Legend: **R** = read-only, **W** = write (guarded), **Ph** = phase (see roadmap).

## Instance & diagnostics

| Tool | Type | Ph | Description | Maps to |
|---|---|---|---|---|
| `sitecore_instances_list` | R | 1 | List configured instances and their status | config |
| `sitecore_ping` | R | 1 | Connectivity, version, enabled APIs, auth check | FR-CON-03 |
| `sitecore_logs_tail` | R | 1 | Last N lines / entries, filter by level & text | FR-DIAG-01/02 |
| `sitecore_logs_errors_summary` | R | 2 | Group recent errors by exception & count | FR-DIAG-03 |
| `sitecore_config_show` | R | 2 | Query showconfig output by xpath | FR-DIAG-04 |

## Items

| Tool | Type | Ph | Description | Maps to |
|---|---|---|---|---|
| `sitecore_item_get` | R | 1 | Item by path/ID; `fields` filter; `language`, `version`, `database` | FR-READ-01/05 |
| `sitecore_item_children` | R | 1 | Children (paged), optional `depth` | FR-READ-02 |
| `sitecore_item_versions` | R | 2 | Languages & versions | FR-READ-03 |
| `sitecore_item_create` | W | 3 | Create from template | FR-WRITE-01 |
| `sitecore_item_update` | W | 3 | Update fields | FR-WRITE-02 |
| `sitecore_item_move` / `_rename` / `_copy` | W | 4 | Structural changes | FR-WRITE-03 |
| `sitecore_item_delete` | W | 4 | Recycle only | FR-WRITE-04 |

## Templates

| Tool | Type | Ph | Description | Maps to |
|---|---|---|---|---|
| `sitecore_template_get` | R | 1 | Sections, fields, base templates chain | FR-TPL-01 |
| `sitecore_template_usages` | R | 2 | Items using a template | FR-TPL-02 |
| `sitecore_template_generate_model` | R | 4 | C#/TS model code | FR-TPL-03 |

## Presentation

| Tool | Type | Ph | Description | Maps to |
|---|---|---|---|---|
| `sitecore_layout_get` | R | 2 | Parsed shared/final renderings, placeholders, datasources | FR-LAY-01/02 |
| `sitecore_layout_headless` | R | 2 | Layout Service / Edge JSON for a route | FR-LAY-03 |

## Search

| Tool | Type | Ph | Description | Maps to |
|---|---|---|---|---|
| `sitecore_search` | R | 1 | Search by name/template/field under root | FR-SRCH-01 |
| `sitecore_query` | R | 2 | Sitecore query (read-only) | FR-SRCH-02 |
| `sitecore_indexes_list` | R | 2 | Indexes + status | FR-SRCH-03 |

## Operations

| Tool | Type | Ph | Description | Maps to |
|---|---|---|---|---|
| `sitecore_publish` | W | 3 | Publish item/subtree/site | FR-OPS-01 |
| `sitecore_index_rebuild` | W | 4 | Rebuild index | FR-OPS-02 |
| `sitecore_cache_clear` | W | 4 | Clear caches | FR-OPS-03 |
| `sitecore_jobs_list` | R | 4 | Running jobs / publish queue | FR-OPS-04 |

## Serialization

| Tool | Type | Ph | Description | Maps to |
|---|---|---|---|---|
| `sitecore_ser_modules` | R | 2 | List SCS/Unicorn modules & includes | FR-SER-01 |
| `sitecore_ser_owner` | R | 2 | Which module owns a path | FR-SER-04 |
| `sitecore_ser_diff` | R | 3 | YAML vs instance diff | FR-SER-02 |
| `sitecore_ser_run` | W | 4 | pull / push / validate via CLI | FR-SER-03 |

## Resources & prompts

- Resource template: `sitecore://{instance}/{database}/{pathOrId}` → item JSON.
- Prompts: `explain-item`, `debug-rendering`, `summarize-errors`, `generate-model`.

## Output shaping rules (apply to all tools)

- Default to **summary** output; `verbose: true` for full data.
- Truncate long field values (configurable, default 500 chars) with a marker.
- Layout XML is always returned **parsed**, never raw, unless `raw: true`.
- IDs always in `{GUID}` uppercase braces format for consistency with Sitecore.

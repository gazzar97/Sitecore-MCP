# 01 — Requirements

Priority: **M** = Must (MVP), **S** = Should, **C** = Could, **W** = Won't (v1).
IDs are stable so we can reference them in discussion and later in work items.

## 1. Functional requirements

### 1.1 Connection & instance management

| ID | Requirement | Pri |
|---|---|---|
| FR-CON-01 | Configure one or more **named instance profiles** (e.g. `projectA-docker`, `projectB-iis`) with host URL, auth, database, and paths. | M |
| FR-CON-02 | Select the active instance per call (`instance` parameter) with a default instance. | M |
| FR-CON-03 | Validate connectivity on startup / on demand (`sitecore_ping`) and report version, edition (XM/XP), and enabled APIs. | M |
| FR-CON-04 | Accept self-signed local certs (e.g. `*.localhost`, `*.dev.local`) when explicitly configured. | M |
| FR-CON-05 | Auto-discover instances from a Docker Compose project (`.env`, `docker-compose.yml`) or IIS site bindings. | C |
| FR-CON-06 | Refuse to connect to hosts that don't match a local allowlist (localhost, `*.localhost`, configured hostnames, private IPs). | M |

### 1.2 Content reading

| ID | Requirement | Pri |
|---|---|---|
| FR-READ-01 | Get item by path or ID, with language & version, returning fields (name, value, type, shared/unversioned). | M |
| FR-READ-02 | Get children of an item (paged), with optional depth. | M |
| FR-READ-03 | Get item versions and languages available. | S |
| FR-READ-04 | Resolve standard values and inherited fields (show which template a field comes from). | S |
| FR-READ-05 | Choose database: `master` (default), `web`, `core`. | M |
| FR-READ-06 | Get media item metadata (not binary by default). | S |

### 1.3 Templates

| ID | Requirement | Pri |
|---|---|---|
| FR-TPL-01 | Get template definition: sections, fields, field types, base templates (full inheritance chain). | M |
| FR-TPL-02 | Find items using a given template. | S |
| FR-TPL-03 | Generate code models from templates (C# / TypeScript) as a prompt or tool output. | C |

### 1.4 Presentation / layout

| ID | Requirement | Pri |
|---|---|---|
| FR-LAY-01 | Read shared & final layout (renderings, placeholders, datasources, parameters) for an item and device. | M |
| FR-LAY-02 | Resolve rendering definitions (rendering item, component name, datasource template/location). | S |
| FR-LAY-03 | Get headless layout JSON (Layout Service / Edge preview) for a route, for JSS/Next.js debugging. | S |

### 1.5 Search

| ID | Requirement | Pri |
|---|---|---|
| FR-SRCH-01 | Search items by name/path/template/field value under a root. | M |
| FR-SRCH-02 | Run Sitecore Query / fast query (read-only). | S |
| FR-SRCH-03 | Query a content search index (Solr) and list indexes with status/doc count. | S |

### 1.6 Content writing (guarded — see 04-security-safety.md)

| ID | Requirement | Pri |
|---|---|---|
| FR-WRITE-01 | Create item from template under a parent. | S |
| FR-WRITE-02 | Update field values (with language/version). | S |
| FR-WRITE-03 | Rename / move / copy item. | C |
| FR-WRITE-04 | Delete item (to Recycle Bin only, never permanent). | C |
| FR-WRITE-05 | Add version / language version. | C |
| FR-WRITE-06 | Modify presentation details (add/remove rendering). | C |
| FR-WRITE-07 | All write ops support `dryRun: true` returning what *would* change. | S |

### 1.7 Operations

| ID | Requirement | Pri |
|---|---|---|
| FR-OPS-01 | Publish item / subtree / site (smart / incremental / republish) to `web`. | S |
| FR-OPS-02 | Rebuild / refresh an index and report progress. | C |
| FR-OPS-03 | Clear caches. | C |
| FR-OPS-04 | Read publishing queue / job status. | C |

### 1.8 Diagnostics & logs

| ID | Requirement | Pri |
|---|---|---|
| FR-DIAG-01 | Tail / search the latest Sitecore log files (filter by level, time range, text). | M |
| FR-DIAG-02 | Read logs from Docker containers (`docker logs` / mounted log volumes) and IIS file paths. | M |
| FR-DIAG-03 | Summarize recent errors (group by exception type). | S |
| FR-DIAG-04 | Show installed modules / config patches (`/sitecore/admin/showconfig.aspx` output, filtered by xpath). | S |

### 1.9 Serialization

| ID | Requirement | Pri |
|---|---|---|
| FR-SER-01 | Read SCS module.json / Unicorn config from the repo and list modules & includes. | S |
| FR-SER-02 | Diff serialized YAML vs. live instance for an item/subtree. | S |
| FR-SER-03 | Run `dotnet sitecore ser pull/push/validate` (guarded). | C |
| FR-SER-04 | Find which serialization module owns a given item path. | S |

### 1.10 MCP resources & prompts

| ID | Requirement | Pri |
|---|---|---|
| FR-MCP-01 | Expose items as MCP resources via URI scheme `sitecore://{instance}/{db}/{path-or-id}`. | S |
| FR-MCP-02 | Provide prompts: "explain this item", "debug this rendering", "summarize recent errors", "generate model from template". | C |

## 2. Non-functional requirements

| ID | Requirement | Pri |
|---|---|---|
| NFR-01 | **Local only**: runs on the developer's machine; transport `stdio` (HTTP optional later). | M |
| NFR-02 | Works on Windows 10/11 (primary); macOS/Linux for Docker-only setups is a bonus. | M |
| NFR-03 | Supports Sitecore **10.x** first (exact minimum version TBD). | M |
| NFR-04 | Minimal footprint on Sitecore: prefer built-in APIs; any server-side package must be optional. | M |
| NFR-05 | Responses are **token-efficient**: paging, field filtering, truncation of large values (rich text, layout XML). | M |
| NFR-06 | p95 latency < 2s for single-item reads on a local instance. | S |
| NFR-07 | Clear, actionable error messages (e.g. "Authoring GraphQL API not enabled — set X in config"). | M |
| NFR-08 | Secrets never logged or returned in tool output; read from env vars / user secrets / config file outside the repo. | M |
| NFR-09 | Audit log of every write operation (local file). | S |
| NFR-10 | Installable with one command (`npx` / `dotnet tool install`) and documented config for Claude Code, Claude Desktop, VS Code. | M |
| NFR-11 | Unit tests + integration tests against a real local instance (Docker). | S |
| NFR-12 | Open-source-ready structure (license TBD). | C |

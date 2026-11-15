# 07 — Getting Started

## Requirements

- Node.js **18.16+** (Node 20+ recommended)
- A local Sitecore 9.x/10.x instance (IIS or Docker) with **Sitecore Services Client (SSC)** enabled (it is by default)

## 1. Build

```bash
npm install
npm run build
```

## 2. Configure

Copy `sitecore-mcp.config.example.json` to one of these locations (checked in order):

1. Path in env var `SITECORE_MCP_CONFIG`
2. `./sitecore-mcp.config.json` (current working directory; git-ignored)
3. `~/.sitecore-mcp/config.json`

Passwords are **never** stored in the config. Each instance names an env var (`passwordEnv`) that holds the password.

| Setting | Notes |
|---|---|
| `cmUrl` | CM base URL. Must be local: `localhost`, `*.localhost`, a loopback/private IP, a name that resolves only to local IPs (hosts file), or listed in `allowedHosts`. |
| `auth` | `mode: "ssc"`, `domain` (default `sitecore`), `username`, `passwordEnv`. |
| `allowInsecureTls` | `true` to accept self-signed dev certificates. Usually needed on IIS installs, because Node doesn't use the Windows certificate store. |
| `logs` | `{ "source": "file", "path": "<webroot>/App_Data/logs" }` or `{ "source": "docker", "container": "<cm container>" }`. |

## 3. Check the connection

```bash
PROJECTA_SC_PASSWORD=<password> npm run ping
```

## 4. Register with your AI client

**Claude Code** (`-s user` makes it available in every folder):

```bash
claude mcp add sitecore -s user --env PROJECTA_SC_PASSWORD=<password> -- node <path-to>/sitecore-mcp/dist/index.js
```

**Claude Desktop / VS Code** (`mcpServers` / `servers` block):

```json
{
  "sitecore": {
    "command": "node",
    "args": ["<path-to>/sitecore-mcp/dist/index.js"],
    "env": { "PROJECTA_SC_PASSWORD": "<password>" }
  }
}
```

Add `SITECORE_MCP_CONFIG` to `env` if your config isn't in one of the default locations. Restart the client after changing the config: the server reads it at startup.

## Read tools

| Tool | Purpose |
|---|---|
| `sitecore_instances_list` | Configured instances (or the config error, if any) |
| `sitecore_ping` | Host check + login + Sitecore version |
| `sitecore_item_get` | Item by ID/path with fields (truncated unless `verbose`) |
| `sitecore_item_children` | Children (paged) or a nested tree up to depth 3 |
| `sitecore_template_get` | Template sections/fields, base templates, inheritance chain |
| `sitecore_search` | `tree` mode (live DB walk under a root) or `index` mode (content search term) |
| `sitecore_logs_tail` | Recent log entries filtered by level/text |

Example requests:
- *"Show the content tree under /sitecore/content/MySite, 2 levels deep."*
- *"What template does /sitecore/content/MySite/Home use, and what fields does it have?"*
- *"Find items under /sitecore/content/MySite/Home whose Title contains 'contact'."*
- *"Show the last 10 errors from the Sitecore log."*

## Teach it your instance (knowledge base)

Run discovery once per instance. It's read-only against Sitecore and writes to `~/.sitecore-mcp/knowledge/<instance>/`:

```bash
PROJECTA_SC_PASSWORD=<password> npm run discover -- projectA
```

It catalogues the environment (version, languages, modules), sites, project templates (fields, base templates, insert options, page/datasource/folder kind), renderings (type, component, datasource template and location), placeholders and layouts. It then writes:
- `overview.md`, a short summary
- `notes.md`, for your own conventions; discovery never overwrites it

After that, start sessions with *"Load the Sitecore knowledge"*. Claude calls `sitecore_knowledge`, which answers structure questions instantly with no Sitecore calls. Refresh after deployments, all at once or per section:

```bash
PROJECTA_SC_PASSWORD=<password> npm run discover -- projectA --sections templates,renderings
```

The scope is configurable per instance under `"knowledge"`: `templateRoots`, `renderingRoots`, `excludePaths` (SXA/JSS vendor folders are excluded by default), `contentRoots` and limits. See [08-instance-knowledge-base.md](08-instance-knowledge-base.md).

## Enabling writes (create / update / delete)

Writes are **off** by default. Turn them on per instance in the config, then restart your AI client:

```json
"projectA": {
  "...": "...",
  "permissions": { "write": true, "delete": false },
  "writeRoots": ["/sitecore/content/MySite"],
  "maxDeleteItems": 50
}
```

| Setting | Effect |
|---|---|
| `permissions.write` | Adds `sitecore_item_create` and `sitecore_item_update` |
| `permissions.delete` | Also adds `sitecore_item_delete` (needs `write` too). Deleted items always go to the **Recycle Bin**. |
| `writeRoots` | Writes only at or below these paths (default `["/sitecore/content"]`). A write root itself can never be deleted. |
| `maxDeleteItems` | Refuse deletes whose subtree has more items than this (default 50) |
| `auditLogPath` (top level) | Where every write attempt is logged (default `~/.sitecore-mcp/audit.log`) |

These rules always apply, whatever the config says:
- writes go to the `master` database only
- `/sitecore/system`, `/sitecore/templates/System` and `/sitecore/layout/System` are never writable
- unknown field names are rejected, because Sitecore would silently drop them
- duplicate sibling names are refused unless you ask for them
- items with children need `includeChildren=true` to be deleted
- nothing is **published**: changes stay in `master` until you publish

Example requests:
- *"Create a Sample Item called Test under /sitecore/content/MySite/_mcp-test with Title 'Hello'. Do a dry run first."*
- *"Change the Title of /sitecore/content/MySite/_mcp-test/Test to 'Hi'."*
- *"Put /sitecore/content/MySite/Home/News into the 'Sample Workflow' workflow."* (sets `__Workflow` and `__Workflow state` to the workflow's initial state)
- *"Delete /sitecore/content/MySite/_mcp-test/Test."*

## Real-instance smoke tests

Read tools, through the real stdio server against your configured instance:

```bash
PROJECTA_SC_PASSWORD=<password> npm run smoke -- [instance] [contentRoot]
```

Write tools, against a scratch folder only. Use a separate config whose `writeRoots` is just that folder:

```bash
MSYS_NO_PATHCONV=1 PROJECTA_SC_PASSWORD=<password> SITECORE_MCP_CONFIG=<scratch-config.json> node scripts/smoke-writes.mjs /sitecore/content/MySite/_mcp-test "/sitecore/templates/Sample/Sample Item" Title
```

(`MSYS_NO_PATHCONV=1` stops Git Bash rewriting `/sitecore/...` arguments into Windows paths.)

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Refusing to connect to "<host>"` | Host isn't local. If it is (e.g. a custom hosts-file name not resolving), add it to `allowedHosts`. |
| `SSC login failed ... (HTTP 403)` over `http://` | SSC only allows login over HTTPS unless `Sitecore.Services.AllowToLoginWithHttp` is `true`. Use the HTTPS binding. |
| Item calls return HTTP 403 (common in Docker) | SSC's default `ServicesLocalOnlyPolicy` rejects non-local requests. In a **local-only** config patch, set `Sitecore.Services.SecurityPolicy` to `Sitecore.Services.Infrastructure.Web.Http.Security.ServicesOnPolicy, Sitecore.Services.Infrastructure`. |
| TLS certificate errors | Trust the dev cert (mkcert / Docker init script) or set `allowInsecureTls: true`. |
| `docker logs` shows no Sitecore entries | Sitecore containers write log files inside the container. Mount `C:\inetpub\wwwroot\App_Data\logs` to a host folder and use `"source": "file"`. |
| Version shows "unknown" | `/sitecore/shell/sitecore.version.xml` isn't readable. Harmless. |
| Every call takes seconds; template/tree tools take tens of seconds | The CM itself is slow per request (compare `curl -w '%{time_starttransfer}'` on any `/sitecore/api/ssc` URL). A common cause is a module in the request pipeline that keeps trying to reach a local service that isn't running (e.g. a telemetry exporter); on Windows each refused local connection costs ~2 s. Start that service or disable it locally. `maxConcurrency` (default 6) runs template/tree requests in parallel to hide some of the delay. |

## Development

```bash
npm test          # unit + in-memory MCP integration tests (fake SSC server)
npm run typecheck
```
